"""Thin async wrappers over the M3-S6 SQL functions. No logic lives here."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True, slots=True)
class ClaimedRow:
    id: uuid.UUID
    job_id: uuid.UUID
    original_url: str
    normalized_url: str
    host: str
    domain: str
    activity_key: str | None
    priority: int
    config_version: int
    attempts: int
    lease_expires_at: datetime


async def claim_checks(
    pool: AsyncConnectionPool, worker_id: str, batch: int, lease_seconds: int
) -> list[ClaimedRow]:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "select id, job_id, original_url, normalized_url, host, domain,"
            " activity_key, priority, config_version, attempts, lease_expires_at"
            " from public.claim_opportunity_checks(%s, %s, %s)",
            (worker_id, batch, lease_seconds),
        )
        return [ClaimedRow(*r) for r in await cur.fetchall()]


async def extend_leases(
    pool: AsyncConnectionPool, worker_id: str, ids: list[uuid.UUID], lease_seconds: int
) -> set[uuid.UUID]:
    """Ids this worker still holds. A missing id is a lost claim."""
    if not ids:
        return set()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "select * from public.extend_opportunity_leases(%s, %s::uuid[], %s)",
            (worker_id, ids, lease_seconds),
        )
        return {r[0] for r in await cur.fetchall()}


async def release_claims(pool: AsyncConnectionPool, worker_id: str) -> int:
    async with pool.connection() as conn:
        cur = await conn.execute("select public.release_opportunity_claims(%s)", (worker_id,))
        row = await cur.fetchone()
    return int(row[0]) if row else 0


async def reap_expired(
    pool: AsyncConnectionPool, max_attempts: int, limit: int = 500
) -> tuple[int, int]:
    """Returns (requeued, failed)."""
    async with pool.connection() as conn:
        cur = await conn.execute(
            "select requeued, failed from public.reap_expired_leases(%s, %s)",
            (max_attempts, limit),
        )
        row = await cur.fetchone()
    return (int(row[0]), int(row[1])) if row else (0, 0)
