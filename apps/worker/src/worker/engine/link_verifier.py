"""Claim and recheck manually submitted live placements."""

from __future__ import annotations

import asyncio

import structlog
from psycopg_pool import AsyncConnectionPool

from worker.fetch.fetcher import PoliteFetcher
from worker.verify.links import verify_link


class LinkVerifier:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        fetcher: PoliteFetcher,
        worker_id: str,
        stop: asyncio.Event,
        poll_seconds: float,
    ) -> None:
        self.pool, self.fetcher, self.worker_id = pool, fetcher, worker_id
        self.stop, self.poll_seconds = stop, poll_seconds
        self.log = structlog.get_logger()

    async def run(self) -> None:
        while not self.stop.is_set():
            try:
                await self.tick()
            except Exception:
                self.log.exception("link_verification_failed")
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=self.poll_seconds)
            except TimeoutError:
                pass

    async def tick(self) -> None:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    "select id,source_url,target_url,attempts "
                    "from public.worker_claim_link_placement(%s,%s)",
                    (self.worker_id, 60),
                )
            ).fetchone()
        if row is None:
            return
        placement_id, source_url, target_url, attempt = row
        try:
            check = verify_link(await self.fetcher.fetch(source_url), target_url)
        except Exception:
            self.log.exception("link_fetch_failed", placement_id=str(placement_id))
            return
        async with self.pool.connection() as conn:
            await conn.execute(
                "select public.worker_finish_link_placement(%s,%s,%s,%s,%s,%s,%s)",
                (
                    placement_id,
                    self.worker_id,
                    attempt,
                    check.status,
                    check.rel,
                    check.final_url,
                    check.reason,
                ),
            )
