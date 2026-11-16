from __future__ import annotations

import asyncio
import ipaddress
import time

import httpx
import pytest
import respx

from worker.fetch.fetcher import FetcherConfig, PoliteFetcher
from worker.fetch.rate_limiter import DomainRateLimiter
from worker.fetch.ssrf import DNSResolver
from worker.fetch.types import DNSResolutionError


class StaticResolver(DNSResolver):
    """DNS Resolver mapping hosts to static IP addresses for deterministic unit tests."""

    def __init__(self, host_map: dict[str, list[str]] | None = None) -> None:
        self.host_map: dict[str, list[str]] = host_map or {}

    async def resolve(
        self, host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        if host in self.host_map:
            return [ipaddress.ip_address(ip) for ip in self.host_map[host]]
        # Default public IP for any unmapped host
        return [ipaddress.ip_address("93.184.216.34")]


class FailingDNSResolver(DNSResolver):
    async def resolve(
        self, host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        raise DNSResolutionError(f"Host not found: {host}")


@pytest.fixture
def static_resolver() -> StaticResolver:
    return StaticResolver(
        {
            "example.com": ["93.184.216.34"],
            "other.com": ["93.184.216.35"],
            "private.local": ["10.0.0.1"],
            "metadata.internal": ["169.254.169.254"],
        }
    )


@pytest.fixture
def fast_config() -> FetcherConfig:
    return FetcherConfig(
        user_agent="BacklinkBot/1.0 (+https://example.com/bot; bot@example.com)",
        connect_timeout=1.0,
        total_timeout=2.0,
        max_redirects=5,
        max_body_bytes=2 * 1024 * 1024,
        domain_delay_seconds=0.0,
        concurrency=10,
        max_retries=2,
        retry_backoff_base=0.01,
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_ok(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    html = (
        "<html><head><title>Test</title></head>"
        "<body><h1>Hello world</h1><p>Substantive text content for testing.</p></body></html>"
    )
    with respx.mock:
        respx.get("https://example.com/page").mock(
            return_value=httpx.Response(
                200, text=html, headers={"Content-Type": "text/html; charset=utf-8"}
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/page")
        await fetcher.close()

    assert res.outcome == "ok"
    assert res.status_code == 200
    assert res.final_url == "https://example.com/page"
    assert "Hello world" in (res.text or "")
    assert res.redirect_chain == []
    summary = res.to_summary_dict()
    assert summary["outcome"] == "ok"
    assert summary["status_code"] == 200


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_user_agent_header(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        route = respx.get("https://example.com/test-ua").mock(
            return_value=httpx.Response(
                200,
                text=(
                    "<html><body><p>Hello content with enough words "
                    "to be regular page</p></body></html>"
                ),
                headers={"Content-Type": "text/html"},
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        await fetcher.fetch("https://example.com/test-ua")
        await fetcher.close()

    assert route.called
    req = route.calls.last.request
    assert req.headers["user-agent"] == fast_config.user_agent


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_http_4xx(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        respx.get("https://example.com/missing").mock(
            return_value=httpx.Response(
                404, text="Not Found", headers={"Content-Type": "text/html"}
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/missing")
        await fetcher.close()

    assert res.outcome == "http_4xx"
    assert res.status_code == 404


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_http_5xx_retries_and_fails(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        route = respx.get("https://example.com/server-error").mock(
            return_value=httpx.Response(
                500, text="Internal Server Error", headers={"Content-Type": "text/html"}
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/server-error")
        await fetcher.close()

    assert res.outcome == "http_5xx"
    assert res.status_code == 500
    # 1 initial attempt + 2 retries = 3 calls
    assert route.call_count == 3


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_5xx_retries_and_succeeds(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        route = respx.get("https://example.com/transient").mock(
            side_effect=[
                httpx.Response(502, text="Bad Gateway", headers={"Content-Type": "text/html"}),
                httpx.Response(
                    200,
                    text=(
                        "<html><body><p>Recovered content with plenty "
                        "of text words</p></body></html>"
                    ),
                    headers={"Content-Type": "text/html"},
                ),
            ]
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/transient")
        await fetcher.close()

    assert res.outcome == "ok"
    assert res.status_code == 200
    assert route.call_count == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_timeout(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        route = respx.get("https://example.com/slow").mock(
            side_effect=httpx.ReadTimeout("Read timed out")
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/slow")
        await fetcher.close()

    assert res.outcome == "timeout"
    assert route.call_count == 3  # initial + 2 retries


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_dns_fail(fast_config: FetcherConfig) -> None:
    fetcher = local_fetcher(config=fast_config, dns_resolver=FailingDNSResolver())
    res = await fetcher.fetch("https://nonexistent-site-test.xyz/index")
    await fetcher.close()

    assert res.outcome == "dns_fail"
    assert "Host not found" in (res.error_message or "")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_tls_error(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        respx.get("https://example.com/bad-cert").mock(
            side_effect=httpx.ConnectError(
                "SSL: CERTIFICATE_VERIFY_FAILED certificate verify failed"
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/bad-cert")
        await fetcher.close()

    assert res.outcome == "tls_error"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_blocked_suspected_cloudflare_challenge(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    body = (
        b"<!DOCTYPE html><html><head><title>Just a moment...</title></head>"
        b"<body>Checking your browser</body></html>"
    )
    with respx.mock:
        route = respx.get("https://example.com/cf-challenge").mock(
            return_value=httpx.Response(
                403,
                content=body,
                headers={
                    "Content-Type": "text/html",
                    "cf-ray": "8937402394",
                    "server": "cloudflare",
                },
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/cf-challenge")
        await fetcher.close()

    assert res.outcome == "blocked_suspected"
    assert res.status_code == 403
    # Cloudflare challenge should NOT be retried
    assert route.call_count == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_blocked_suspected_429(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        respx.get("https://example.com/rate-limited").mock(
            return_value=httpx.Response(
                429, text="Rate limit exceeded", headers={"Content-Type": "text/html"}
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/rate-limited")
        await fetcher.close()

    assert res.outcome == "blocked_suspected"
    assert res.status_code == 429


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_js_only_suspected(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    spa_html = (
        "<!DOCTYPE html><html><head><title>App</title></head>"
        "<body><div id='root'></div><script src='/app.js'></script></body></html>"
    )
    with respx.mock:
        respx.get("https://example.com/spa").mock(
            return_value=httpx.Response(200, text=spa_html, headers={"Content-Type": "text/html"})
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/spa")
        await fetcher.close()

    assert res.outcome == "js_only_suspected"
    assert res.status_code == 200


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_non_html(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        respx.get("https://example.com/document.pdf").mock(
            return_value=httpx.Response(
                200, content=b"%PDF-1.5...", headers={"Content-Type": "application/pdf"}
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/document.pdf")
        await fetcher.close()

    assert res.outcome == "non_html"
    assert res.status_code == 200


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_too_large(static_resolver: StaticResolver) -> None:
    # 2.5 MB body
    huge_body = b"A" * (2500 * 1024)
    custom_config = FetcherConfig(
        user_agent="TestBot",
        connect_timeout=1.0,
        total_timeout=2.0,
        max_redirects=5,
        max_body_bytes=2 * 1024 * 1024,  # 2MB cap
        domain_delay_seconds=0.0,
        concurrency=10,
        max_retries=0,
    )
    with respx.mock:
        respx.get("https://example.com/huge").mock(
            return_value=httpx.Response(
                200, content=huge_body, headers={"Content-Type": "text/html"}
            )
        )
        fetcher = local_fetcher(config=custom_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/huge")
        await fetcher.close()

    assert res.outcome == "too_large"
    assert res.status_code == 200


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_ssrf_blocked_initial(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
    # Direct private IP literal
    res = await fetcher.fetch("http://127.0.0.1/admin")
    assert res.outcome == "ssrf_blocked"

    # Domain resolving to private IP
    res = await fetcher.fetch("https://private.local/internal")
    assert res.outcome == "ssrf_blocked"

    # Cloud metadata domain
    res = await fetcher.fetch("http://metadata.internal/latest/meta-data")
    assert res.outcome == "ssrf_blocked"

    # Forbidden port
    res = await fetcher.fetch("https://example.com:8080/path")
    assert res.outcome == "ssrf_blocked"
    await fetcher.close()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_outcome_ssrf_blocked_on_redirect(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        # Public URL redirects to private IP
        respx.get("https://example.com/open-redirect").mock(
            return_value=httpx.Response(302, headers={"Location": "http://127.0.0.1/secret"})
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/open-redirect")
        await fetcher.close()

    assert res.outcome == "ssrf_blocked"
    assert len(res.redirect_chain) == 1
    assert res.redirect_chain[0].url == "https://example.com/open-redirect"
    assert res.redirect_chain[0].status_code == 302
    assert res.final_url == "http://127.0.0.1/secret"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_redirect_chain_and_final_url(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        respx.get("https://example.com/step1").mock(
            return_value=httpx.Response(301, headers={"Location": "/step2"})
        )
        respx.get("https://example.com/step2").mock(
            return_value=httpx.Response(302, headers={"Location": "https://other.com/destination"})
        )
        respx.get("https://other.com/destination").mock(
            return_value=httpx.Response(
                200,
                text=(
                    "<html><body><p>Final content with many words "
                    "for a normal page</p></body></html>"
                ),
                headers={"Content-Type": "text/html"},
            )
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/step1")
        await fetcher.close()

    assert res.outcome == "ok"
    assert res.status_code == 200
    assert res.final_url == "https://other.com/destination"
    assert len(res.redirect_chain) == 2
    assert res.redirect_chain[0].url == "https://example.com/step1"
    assert res.redirect_chain[0].status_code == 301
    assert res.redirect_chain[1].url == "https://example.com/step2"
    assert res.redirect_chain[1].status_code == 302


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fetch_max_redirects_exceeded(
    static_resolver: StaticResolver, fast_config: FetcherConfig
) -> None:
    with respx.mock:
        # Infinite loop redirect
        respx.get("https://example.com/loop1").mock(
            return_value=httpx.Response(302, headers={"Location": "/loop2"})
        )
        respx.get("https://example.com/loop2").mock(
            return_value=httpx.Response(302, headers={"Location": "/loop1"})
        )
        fetcher = local_fetcher(config=fast_config, dns_resolver=static_resolver)
        res = await fetcher.fetch("https://example.com/loop1")
        await fetcher.close()

    assert res.outcome == "too_many_redirects"
    assert len(res.redirect_chain) == 5


@pytest.mark.unit
@pytest.mark.asyncio
async def test_domain_rate_limiter_spacing(static_resolver: StaticResolver) -> None:
    rate_limiter = DomainRateLimiter(delay_seconds=0.08)
    config = FetcherConfig(
        user_agent="TestBot",
        connect_timeout=1.0,
        total_timeout=2.0,
        domain_delay_seconds=0.08,
        concurrency=10,
        max_retries=0,
    )
    with respx.mock:
        respx.get("https://example.com/page1").mock(
            return_value=httpx.Response(
                200,
                text="<html><body><p>Page 1 with enough content for regular text</p></body></html>",
                headers={"Content-Type": "text/html"},
            )
        )
        respx.get("https://example.com/page2").mock(
            return_value=httpx.Response(
                200,
                text="<html><body><p>Page 2 with enough content for regular text</p></body></html>",
                headers={"Content-Type": "text/html"},
            )
        )
        fetcher = local_fetcher(
            config=config, dns_resolver=static_resolver, rate_limiter=rate_limiter
        )
        t0 = time.monotonic()
        await asyncio.gather(
            fetcher.fetch("https://example.com/page1"),
            fetcher.fetch("https://example.com/page2"),
        )
        t1 = time.monotonic()
        await fetcher.close()

    elapsed = t1 - t0
    # Must have taken at least delay_seconds (0.08s) due to spacing
    assert elapsed >= 0.07


def local_fetcher(config, dns_resolver, rate_limiter=None):
    from worker.fetch.rate_limiter import DomainRateLimiter

    return PoliteFetcher(
        config=config,
        dns_resolver=dns_resolver,
        rate_limiter=rate_limiter or DomainRateLimiter(config.domain_delay_seconds),
    )


@pytest.mark.unit
async def test_preserves_independent_x_robots_tag_headers(static_resolver, fast_config):
    with respx.mock:
        respx.get("https://example.com/headers").respond(
            200,
            text="<html><body>Useful page text</body></html>",
            headers=[
                ("content-type", "text/html"),
                ("x-robots-tag", "otherbot: noindex"),
                ("x-robots-tag", "noindex"),
            ],
        )
        async with local_fetcher(config=fast_config, dns_resolver=static_resolver) as fetcher:
            result = await fetcher.fetch("https://example.com/headers")
    assert result.x_robots_tags == ["otherbot: noindex", "noindex"]
