from __future__ import annotations

import asyncio
import time
from typing import Any, Final, Protocol

from psycopg.rows import tuple_row
from psycopg_pool import AsyncConnectionPool

DEFAULT_DOMAIN_DELAY: Final[float] = 2.0
_CLEANUP_INTERVAL: Final[float] = 300.0  # Clean up domains idle for > 5 minutes


class DomainRateLimiter:
    """Async per-domain rate limiter ensuring a minimum delay between requests to each domain."""

    def __init__(self, delay_seconds: float = DEFAULT_DOMAIN_DELAY) -> None:
        self.delay_seconds = delay_seconds
        self._last_request_time: dict[str, float] = {}
        self._domain_locks: dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()
        self._last_cleanup = time.monotonic()

    async def _get_domain_lock(self, domain: str) -> asyncio.Lock:
        async with self._global_lock:
            lock = self._domain_locks.get(domain)
            if lock is None:
                lock = asyncio.Lock()
                self._domain_locks[domain] = lock
            return lock

    async def _maybe_cleanup(self, now: float) -> None:
        if now - self._last_cleanup < _CLEANUP_INTERVAL:
            return
        async with self._global_lock:
            self._last_cleanup = now
            threshold = now - (self.delay_seconds * 2 + 60.0)
            expired_domains = [d for d, t in self._last_request_time.items() if t < threshold]
            for d in expired_domains:
                self._last_request_time.pop(d, None)
                lock = self._domain_locks.get(d)
                if lock is not None and not lock.locked():
                    self._domain_locks.pop(d, None)

    async def acquire(self, domain: str) -> None:
        """Wait if necessary so that at least `delay_seconds` have passed
        since the previous request to domain.
        """
        if self.delay_seconds <= 0:
            return

        domain_key = domain.strip().lower()
        lock = await self._get_domain_lock(domain_key)

        async with lock:
            now = time.monotonic()
            last_time = self._last_request_time.get(domain_key)
            if last_time is not None:
                elapsed = now - last_time
                remaining = self.delay_seconds - elapsed
                if remaining > 0:
                    await asyncio.sleep(remaining)
                    now = time.monotonic()

            self._last_request_time[domain_key] = now
            await self._maybe_cleanup(now)


class RequestRateLimiter(Protocol):
    async def acquire(self, domain: str) -> None: ...


class PostgresDomainRateLimiter:
    """Coordinate dispatch slots across processes, using the database clock.

    Waiting callers do not reserve future slots and release the DB connection
    before sleeping. Cancellation can waste one granted slot, never refund it.
    Database errors propagate; there is deliberately no local fallback.
    """

    def __init__(
        self, pool: AsyncConnectionPool[Any] | None, delay_seconds: float = DEFAULT_DOMAIN_DELAY
    ) -> None:
        if pool is None:
            raise ValueError("A shared database pool is required")
        self.pool = pool
        self.delay_seconds = delay_seconds

    async def acquire(self, domain: str) -> None:
        while True:
            async with self.pool.connection() as conn:
                async with conn.cursor(row_factory=tuple_row) as cursor:
                    await cursor.execute(
                        "select public.worker_acquire_fetch_slot(%s, %s)",
                        (domain.strip().lower(), self.delay_seconds),
                    )
                    row = await cursor.fetchone()
                if row is None:
                    raise RuntimeError("Rate limiter returned no slot decision")
                wait = float(row[0])
            # The grant commits before the caller may dispatch its request.
            if wait <= 0:
                return
            await asyncio.sleep(wait)
