"""Origin-scoped crawl permission. Infrastructure errors deliberately propagate."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Protocol
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from protego import Protego
from psycopg.rows import tuple_row
from psycopg_pool import AsyncConnectionPool

from worker.fetch.types import FetchResult
from worker.urls.domain import registered_domain


def origin_for(url: str) -> str:
    """Preserve scheme, full IDNA hostname and effective port (including www)."""
    parsed = httpx.URL(url)
    host = parsed.raw_host.decode("ascii").lower()
    if ":" in host:
        host = f"[{host}]"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return f"{parsed.scheme}://{host}:{port}"


def retry_seconds(headers: dict[str, str], default: int) -> int:
    value = headers.get("retry-after", "")
    try:
        seconds = int(value)
    except ValueError:
        try:
            seconds = int((parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            seconds = default
    return max(default, min(seconds, 86400))


class RobotsCache(Protocol):
    async def claim(self, origin: str, token: str) -> dict[str, Any]: ...
    async def complete(self, origin: str, token: str, state: str, text: str, ttl: int) -> bool: ...
    async def block(self, origin: str, seconds: int) -> None: ...


class PostgresRobotsCache:
    def __init__(self, pool: AsyncConnectionPool[Any]) -> None:
        self.pool = pool

    async def _call(self, query: str, params: tuple[Any, ...]) -> Any:
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=tuple_row) as cur:
                await cur.execute(query, params)
                row = await cur.fetchone()
                if row is None:
                    raise RuntimeError("Missing robots cache response")
                return row[0]

    async def claim(self, origin: str, token: str) -> dict[str, Any]:
        domain = registered_domain(urlsplit(origin).hostname or "")
        result: dict[str, Any] = await self._call(
            "select public.worker_claim_robots(%s, %s, %s)", (origin, domain, token)
        )
        return result

    async def complete(self, origin: str, token: str, state: str, text: str, ttl: int) -> bool:
        return bool(
            await self._call(
                "select public.worker_complete_robots(%s, %s, %s, %s, %s)",
                (origin, token, state, text, ttl),
            )
        )

    async def block(self, origin: str, seconds: int) -> None:
        await self._call("select public.worker_block_origin(%s, %s)", (origin, seconds))


class RobotsPolicy:
    def __init__(
        self,
        cache: RobotsCache,
        retrieve: Callable[[str], Awaitable[FetchResult]],
        user_agent: str,
        *,
        cooldown_seconds: int = 900,
    ) -> None:
        if not 1 <= cooldown_seconds <= 86400:
            raise ValueError("Cooldown must be between one second and one day")
        self.cache = cache
        self.retrieve = retrieve
        self.user_agent = user_agent
        self.cooldown_seconds = cooldown_seconds

    async def check(self, url: str) -> str | None:
        reason, _ = await self.check_with_rules(url)
        return reason

    async def check_with_rules(self, url: str) -> tuple[str | None, str | None]:
        origin = origin_for(url)
        token = str(uuid4())
        while True:
            entry = await self.cache.claim(origin, token)
            action = entry["action"]
            if action == "blocked":
                return "origin_blocked_cooldown", None
            if action == "wait":
                # No database connection held while another worker refreshes.
                # The enclosing fetch deadline bounds the total wait.
                await asyncio.sleep(0.1)
                continue
            if action == "refresh":
                result = await self.retrieve(origin + "/robots.txt")
                state, text, ttl = "unavailable", "", self.cooldown_seconds
                if result.outcome == "ok" and result.status_code is not None:
                    if 200 <= result.status_code < 300:
                        state, text, ttl = "rules", result.text or "", 86400
                elif result.outcome == "http_4xx" and result.status_code in (404, 410):
                    state, ttl = "absent", 86400
                if result.outcome == "blocked_suspected":
                    ttl = retry_seconds(result.headers, self.cooldown_seconds)
                    await self.cache.block(origin, ttl)
                # NUL is invalid in PostgreSQL text; replacement also bounds UTF-8
                # expansion from malformed bytes to the schema's 512 KiB limit.
                text = text.replace("\x00", "\ufffd")
                if len(text.encode("utf-8")) > 524288:
                    state, text, ttl = "unavailable", "", self.cooldown_seconds
                saved = await self.cache.complete(origin, token, state, text, ttl)
                if not saved:
                    # Expired owner must not authorize a page using superseded rules.
                    continue
                entry = {"state": state, "robots_txt": text}
            if entry["state"] == "unavailable":
                return "robots_unavailable", None
            robots_txt = entry["robots_txt"] if entry["state"] == "rules" else ""
            if entry["state"] == "rules":
                rules = Protego.parse(robots_txt)
                if not rules.can_fetch(url, self.user_agent):
                    return "robots_disallowed_for_bot", robots_txt
            return None, robots_txt

    async def record_block(self, result: FetchResult) -> None:
        await self.cache.block(
            origin_for(result.final_url), retry_seconds(result.headers, self.cooldown_seconds)
        )
