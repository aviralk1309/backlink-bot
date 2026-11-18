from __future__ import annotations

import asyncio
import ssl
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Final

import charset_normalizer
import httpx
from psycopg_pool import AsyncConnectionPool

from worker.config.settings import Settings, get_settings
from worker.fetch.detector import (
    is_blocked_suspected,
    is_html,
    is_js_only_suspected,
)
from worker.fetch.rate_limiter import PostgresDomainRateLimiter, RequestRateLimiter
from worker.fetch.robots import PostgresRobotsCache, RobotsPolicy
from worker.fetch.ssrf import (
    DNSResolver,
    SystemDNSResolver,
    validate_target_url,
)
from worker.fetch.transport import PublicHTTPTransport
from worker.fetch.types import (
    DNSResolutionError,
    FetchResult,
    RedirectStep,
    SSRFBlockedError,
)
from worker.urls.domain import registered_domain

_DEFAULT_ACCEPT_HEADER: Final[str] = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
)


def _decode_html(content: bytes, content_type: str | None = None) -> str:
    """Decode raw HTML bytes using charset from header or charset_normalizer."""
    if not content:
        return ""

    if content_type:
        parts = content_type.split(";")
        for part in parts[1:]:
            p_strip = part.strip()
            if p_strip.lower().startswith("charset="):
                encoding = p_strip[8:].strip(" '\"")
                try:
                    return content.decode(encoding, errors="replace")
                except (LookupError, UnicodeDecodeError):
                    pass

    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        pass

    match = charset_normalizer.from_bytes(content).best()
    if match is not None:
        return str(match)

    return content.decode("utf-8", errors="replace")


@dataclass
class FetcherConfig:
    user_agent: str
    connect_timeout: float = 5.0
    total_timeout: float = 15.0
    max_redirects: int = 5
    max_body_bytes: int = 2 * 1024 * 1024  # 2 MB
    domain_delay_seconds: float = 2.0
    concurrency: int = 10
    max_retries: int = 2
    retry_backoff_base: float = 0.5

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> FetcherConfig:
        s = settings or get_settings()
        return cls(
            user_agent=s.bot_user_agent,
            connect_timeout=s.fetch_connect_timeout,
            total_timeout=s.fetch_total_timeout,
            max_redirects=s.fetch_max_redirects,
            max_body_bytes=s.fetch_max_body_bytes,
            domain_delay_seconds=s.fetch_domain_delay_seconds,
            concurrency=s.fetch_concurrency,
            max_retries=s.fetch_max_retries,
        )


class PoliteFetcher:
    """Async HTTP fetcher enforcing SSRF guards, rate limits, size caps, and polite headers."""

    def __init__(
        self,
        config: FetcherConfig | None = None,
        dns_resolver: DNSResolver | None = None,
        rate_limiter: RequestRateLimiter | None = None,
        *,
        pool: AsyncConnectionPool[Any] | None = None,
        robots_policy: RobotsPolicy | None = None,
    ) -> None:
        self.config = config or FetcherConfig.from_settings()
        self.dns_resolver = dns_resolver or SystemDNSResolver()
        if (rate_limiter is None) == (pool is None):
            raise ValueError("Provide a shared database pool or an explicit rate_limiter")
        self.rate_limiter: RequestRateLimiter = (
            rate_limiter
            if rate_limiter is not None
            else PostgresDomainRateLimiter(pool, self.config.domain_delay_seconds)
        )
        self.robots_policy = robots_policy
        if self.robots_policy is None and pool is not None:
            self.robots_policy = RobotsPolicy(
                PostgresRobotsCache(pool), self._fetch_robots, self.config.user_agent
            )
        self._concurrency_semaphore = asyncio.Semaphore(self.config.concurrency)
        # Own the client so a caller-supplied transport/proxy cannot bypass the
        # connection guard. Tests can mock the HTTP or socket boundary instead.
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                transport=PublicHTTPTransport(self.dns_resolver),
                trust_env=False,
                follow_redirects=False,
                timeout=httpx.Timeout(
                    self.config.total_timeout,
                    connect=self.config.connect_timeout,
                ),
            )
        return self._client

    async def close(self) -> None:
        """Close the owned HTTP client and its connection pool."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def __aenter__(self) -> PoliteFetcher:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def fetch(self, url: str) -> FetchResult:
        """Fetch a single URL asynchronously with SSRF protection, rate limiting, and retries."""
        start_time = time.monotonic()
        progress = FetchResult(url=url, final_url=url.strip(), outcome="timeout")
        budget = asyncio.timeout(self.config.total_timeout)
        try:
            async with budget:
                async with self._concurrency_semaphore:
                    result = await self._fetch_guarded(url, start_time, progress)
                    if self.robots_policy is not None and result.outcome == "blocked_suspected":
                        await self.robots_policy.record_block(result)
                    return result
        except TimeoutError:
            if not budget.expired():
                raise
            progress.error_message = "Total fetch deadline exceeded"
            progress.elapsed_seconds = time.monotonic() - start_time
            return progress

    async def _fetch_robots(self, url: str) -> FetchResult:
        # Called inside the page's deadline/semaphore; never reacquire that slot.
        progress = FetchResult(url=url, final_url=url, outcome="timeout")
        # Keep refresh work below the database's 60-second lease even if a
        # deployment raises the overall page budget. The outer deadline still wins.
        try:
            async with asyncio.timeout(45):
                return await self._fetch_guarded(url, time.monotonic(), progress, robots=True)
        except TimeoutError:
            return progress

    async def _fetch_guarded(
        self, initial_url: str, start_time: float, progress: FetchResult, *, robots: bool = False
    ) -> FetchResult:
        current_url = progress.final_url
        redirect_chain = progress.redirect_chain
        robots_txt: str | None = None

        for _redirect_count in range(self.config.max_redirects + 1):
            # 1. SSRF and scheme/port validation for current_url
            try:
                host, _, _ = await validate_target_url(current_url, resolver=self.dns_resolver)
            except SSRFBlockedError as err:
                return FetchResult(
                    url=initial_url,
                    final_url=current_url,
                    outcome="ssrf_blocked",
                    redirect_chain=redirect_chain,
                    error_message=str(err),
                    elapsed_seconds=time.monotonic() - start_time,
                )
            except DNSResolutionError as err:
                return FetchResult(
                    url=initial_url,
                    final_url=current_url,
                    outcome="dns_fail",
                    redirect_chain=redirect_chain,
                    error_message=str(err),
                    elapsed_seconds=time.monotonic() - start_time,
                )

            if not robots and self.robots_policy is not None:
                reason, robots_txt = await self.robots_policy.check_with_rules(current_url)
                if reason is not None:
                    return FetchResult(
                        url=initial_url,
                        final_url=current_url,
                        outcome="could_not_check",
                        reason_code=reason,
                        redirect_chain=redirect_chain,
                        robots_txt=robots_txt,
                        elapsed_seconds=time.monotonic() - start_time,
                    )

            # 2. Rate limiting per registered domain
            domain = registered_domain(host) or host

            # 3. Request loop with retries for 5xx and timeouts
            attempt = 0
            while True:
                attempt += 1
                # Infrastructure failures propagate to the runner; never bypass
                # coordination or classify a database outage as a website failure.
                await self.rate_limiter.acquire(domain)
                try:
                    headers = {
                        "User-Agent": self.config.user_agent,
                        "Accept": "text/plain,*/*;q=0.1" if robots else _DEFAULT_ACCEPT_HEADER,
                    }
                    timeout = httpx.Timeout(
                        self.config.total_timeout,
                        connect=self.config.connect_timeout,
                    )

                    async with self.client.stream(
                        "GET",
                        current_url,
                        headers=headers,
                        follow_redirects=False,
                        timeout=timeout,
                    ) as resp:
                        status = resp.status_code
                        resp_headers = dict(resp.headers)
                        content_type = resp_headers.get("content-type")

                        # Handle redirects (301, 302, 303, 307, 308)
                        if status in (301, 302, 303, 307, 308):
                            location = resp_headers.get("location")
                            if not location:
                                return FetchResult(
                                    url=initial_url,
                                    final_url=current_url,
                                    outcome="http_4xx",
                                    status_code=status,
                                    redirect_chain=redirect_chain,
                                    headers=resp_headers,
                                    x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                    error_message="Redirect missing Location header",
                                    elapsed_seconds=time.monotonic() - start_time,
                                )

                            next_url = urllib.parse.urljoin(current_url, location)

                            if len(redirect_chain) >= self.config.max_redirects:
                                return FetchResult(
                                    url=initial_url,
                                    final_url=next_url,
                                    outcome="too_many_redirects",
                                    status_code=status,
                                    redirect_chain=redirect_chain,
                                    headers=resp_headers,
                                    x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                    error_message=(
                                        f"Exceeded max redirects ({self.config.max_redirects})"
                                    ),
                                    elapsed_seconds=time.monotonic() - start_time,
                                )

                            redirect_chain.append(RedirectStep(url=current_url, status_code=status))

                            current_url = next_url
                            progress.final_url = next_url
                            # Move to next redirect step
                            break

                        # For non-redirect responses:
                        # 4xx or 5xx check first
                        if 400 <= status <= 599:
                            # Read small body to check for challenge markers
                            err_body_chunks: list[bytes] = []
                            async for chunk in resp.aiter_bytes(chunk_size=4096):
                                err_body_chunks.append(chunk)
                                if sum(len(c) for c in err_body_chunks) >= 16384:
                                    break
                            err_body = b"".join(err_body_chunks)

                            if is_blocked_suspected(status, resp_headers, err_body):
                                return FetchResult(
                                    url=initial_url,
                                    final_url=current_url,
                                    outcome="blocked_suspected",
                                    status_code=status,
                                    redirect_chain=redirect_chain,
                                    content=err_body,
                                    headers=resp_headers,
                                    x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                    error_message=(
                                        f"Suspected blocking / challenge (status {status})"
                                    ),
                                    elapsed_seconds=time.monotonic() - start_time,
                                )

                            if status >= 500:
                                if attempt <= self.config.max_retries:
                                    backoff = self.config.retry_backoff_base * (2 ** (attempt - 1))
                                    await asyncio.sleep(backoff)
                                    continue
                                return FetchResult(
                                    url=initial_url,
                                    final_url=current_url,
                                    outcome="http_5xx",
                                    status_code=status,
                                    redirect_chain=redirect_chain,
                                    content=err_body,
                                    headers=resp_headers,
                                    x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                    error_message=f"HTTP 5xx server error: {status}",
                                    elapsed_seconds=time.monotonic() - start_time,
                                )

                            # Normal 4xx
                            return FetchResult(
                                url=initial_url,
                                final_url=current_url,
                                outcome="http_4xx",
                                status_code=status,
                                redirect_chain=redirect_chain,
                                content=err_body,
                                headers=resp_headers,
                                x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                error_message=f"HTTP 4xx client error: {status}",
                                elapsed_seconds=time.monotonic() - start_time,
                            )

                        # For 2xx responses: verify HTML content-type
                        if not robots and not is_html(content_type):
                            return FetchResult(
                                url=initial_url,
                                final_url=current_url,
                                outcome="non_html",
                                status_code=status,
                                redirect_chain=redirect_chain,
                                headers=resp_headers,
                                x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                error_message=f"Non-HTML content type: {content_type}",
                                elapsed_seconds=time.monotonic() - start_time,
                            )

                        # Stream and cut body at max_body_bytes (2 MB)
                        body_limit = 524288 if robots else self.config.max_body_bytes
                        body_chunks: list[bytes] = []
                        total_bytes = 0
                        too_large = False

                        async for chunk in resp.aiter_bytes(chunk_size=16384):
                            total_bytes += len(chunk)
                            if total_bytes > body_limit:
                                too_large = True
                                break
                            body_chunks.append(chunk)

                        body = b"".join(body_chunks)

                        if too_large:
                            return FetchResult(
                                url=initial_url,
                                final_url=current_url,
                                outcome="too_large",
                                status_code=status,
                                redirect_chain=redirect_chain,
                                content=body,
                                headers=resp_headers,
                                x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                error_message=(
                                    f"Body exceeded limit of {self.config.max_body_bytes} bytes"
                                ),
                                elapsed_seconds=time.monotonic() - start_time,
                            )

                        text = _decode_html(body, content_type)

                        if robots:
                            # A challenge served as 200 must never become an empty allow-all policy.
                            blocked = is_blocked_suspected(status, resp_headers, body)
                            media_type = (content_type or "").split(";", 1)[0].strip().lower()
                            invalid = media_type not in (
                                "",
                                "text/plain",
                            ) or body.lstrip().startswith(b"<")
                            return FetchResult(
                                url=initial_url,
                                final_url=current_url,
                                outcome="blocked_suspected"
                                if blocked
                                else "non_html"
                                if invalid
                                else "ok",
                                status_code=status,
                                content=body,
                                text=body.decode("utf-8-sig", errors="replace"),
                                headers=resp_headers,
                                x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                redirect_chain=redirect_chain,
                            )

                        if is_js_only_suspected(body, content_type):
                            return FetchResult(
                                url=initial_url,
                                final_url=current_url,
                                outcome="js_only_suspected",
                                status_code=status,
                                redirect_chain=redirect_chain,
                                content=body,
                                text=text,
                                headers=resp_headers,
                                x_robots_tags=resp.headers.get_list("x-robots-tag"),
                                elapsed_seconds=time.monotonic() - start_time,
                            )

                        return FetchResult(
                            url=initial_url,
                            final_url=current_url,
                            outcome="ok",
                            status_code=status,
                            redirect_chain=redirect_chain,
                            content=body,
                            text=text,
                            headers=resp_headers,
                            x_robots_tags=resp.headers.get_list("x-robots-tag"),
                            robots_txt=robots_txt,
                            elapsed_seconds=time.monotonic() - start_time,
                        )

                except (SSRFBlockedError, DNSResolutionError) as err:
                    # DNS can change after preflight; the transport checks the
                    # actual connection address as well. Preserve the reason.
                    return FetchResult(
                        url=initial_url,
                        final_url=current_url,
                        outcome="ssrf_blocked" if isinstance(err, SSRFBlockedError) else "dns_fail",
                        redirect_chain=redirect_chain,
                        error_message=str(err),
                        elapsed_seconds=time.monotonic() - start_time,
                    )
                except httpx.TimeoutException as err:
                    if attempt <= self.config.max_retries:
                        backoff = self.config.retry_backoff_base * (2 ** (attempt - 1))
                        await asyncio.sleep(backoff)
                        continue
                    return FetchResult(
                        url=initial_url,
                        final_url=current_url,
                        outcome="timeout",
                        redirect_chain=redirect_chain,
                        error_message=f"Request timed out: {err}",
                        elapsed_seconds=time.monotonic() - start_time,
                    )
                except (ssl.SSLError, httpx.ConnectError) as err:
                    err_str = str(err).lower()
                    is_tls = isinstance(err, ssl.SSLError) or any(
                        term in err_str for term in ("ssl", "tls", "certificate", "handshake")
                    )
                    if is_tls:
                        return FetchResult(
                            url=initial_url,
                            final_url=current_url,
                            outcome="tls_error",
                            redirect_chain=redirect_chain,
                            error_message=f"TLS/SSL error: {err}",
                            elapsed_seconds=time.monotonic() - start_time,
                        )
                    # Non-TLS ConnectError (e.g. refused or DNS failure during connection)
                    return FetchResult(
                        url=initial_url,
                        final_url=current_url,
                        outcome="dns_fail"
                        if "name" in err_str or "resolve" in err_str
                        else "http_5xx",
                        redirect_chain=redirect_chain,
                        error_message=f"Connection error: {err}",
                        elapsed_seconds=time.monotonic() - start_time,
                    )
        # In case max redirects loop fell through
        return FetchResult(
            url=initial_url,
            final_url=current_url,
            outcome="too_many_redirects",
            redirect_chain=redirect_chain,
            error_message="Too many redirects",
            elapsed_seconds=time.monotonic() - start_time,
        )
