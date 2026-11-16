"""Claim and execute durable search queries through the provider and discovery RPC."""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from dataclasses import dataclass
from urllib.parse import urlsplit

import structlog
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from worker.providers.search import (
    SearchAuthError,
    SearchProvider,
    SearchProviderError,
    SearchResponse,
    SearchResponseError,
    SearchTimeoutError,
)
from worker.urls.normalize import NormalizedUrl, normalize_url


def search_result_rejection(url: NormalizedUrl) -> str | None:
    if not url.ok:
        return "invalid_url"
    assert url.host and url.normalized and url.registered_domain
    if (
        url.host == url.registered_domain
        and url.host.startswith("google.")
        and urlsplit(url.normalized).path.lower() in {"/goto", "/url", "/aclk", "/search"}
    ):
        return "search_redirect"
    return None


@dataclass(frozen=True, slots=True)
class ClaimedQuery:
    id: uuid.UUID
    job_id: uuid.UUID
    activity_key: str
    query_text: str
    gl: str | None
    hl: str | None
    location: str | None
    num: int
    page: int
    attempts: int


async def claim_query(
    pool: AsyncConnectionPool, worker_id: str, lease_seconds: int, max_attempts: int
) -> ClaimedQuery | None:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "select id,job_id,activity_key,query_text,gl,hl,location,num,page,attempts "
            "from public.claim_budgeted_query(%s,%s,%s)",
            (worker_id, lease_seconds, max_attempts),
        )
        row = await cur.fetchone()
        return ClaimedQuery(*row) if row else None


async def reap_expired_queries(pool: AsyncConnectionPool, max_attempts: int) -> int:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "with expired as (select q.id from public.job_queries q "
            "where q.status='running' and q.lease_expires_at < now() "
            "order by q.lease_expires_at,q.id limit 500 for update of q skip locked), "
            "moved as (update public.job_queries q set "
            "status=case when q.attempts >= %s then 'failed' else 'pending' end, "
            "locked_by=null,lease_expires_at=null, "
            "error=case when q.attempts >= %s "
            "then 'max_attempts_exceeded' else 'lease_expired' end, "
            "completed_at=case when q.attempts >= %s then now() else null end "
            "from expired where q.id=expired.id returning q.id) select count(*) from moved",
            (max_attempts, max_attempts, max_attempts),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0


class SearchRunner:
    def __init__(
        self,
        pool: AsyncConnectionPool,
        provider: SearchProvider,
        worker_id: str,
        stop: asyncio.Event,
        poll_seconds: float,
        lease_seconds: int,
        max_attempts: int,
    ) -> None:
        self.pool = pool
        self.provider = provider
        self.worker_id = worker_id
        self.stop = stop
        self.poll_seconds = poll_seconds
        self.lease_seconds = lease_seconds
        self.max_attempts = max_attempts
        self.log = structlog.get_logger()

    async def run(self) -> None:
        async with asyncio.TaskGroup() as group:
            for _ in range(2):
                group.create_task(self._run_slot())

    async def _run_slot(self) -> None:
        while not self.stop.is_set():
            try:
                await self.tick()
            except SearchAuthError:
                raise
            except Exception:
                self.log.exception("search_tick_failed")
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=self.poll_seconds)
            except TimeoutError:
                pass

    async def tick(self) -> bool:
        await reap_expired_queries(self.pool, self.max_attempts)
        claim = await claim_query(self.pool, self.worker_id, self.lease_seconds, self.max_attempts)
        if claim is None:
            return False
        renew = asyncio.create_task(self._renew(claim))
        try:
            try:
                response = await self.provider.search(
                    claim.query_text, claim.gl, claim.hl, claim.location, claim.num, claim.page
                )
            except SearchProviderError as exc:
                await self._mark_provider_failure(claim, exc)
                if isinstance(exc, SearchAuthError):
                    raise
                return True
            if await self._save_results(claim, response):
                async with self.pool.connection() as conn:
                    cur = await conn.execute(
                        "select public.evaluate_job_saturation(%s)", (claim.job_id,)
                    )
                    saturated = (await cur.fetchone() or (False,))[0]
                self.log.info(
                    "search_query_done",
                    job_id=str(claim.job_id),
                    query_id=str(claim.id),
                    credits=response.credits_used,
                    results=len(response.results),
                    saturated=saturated,
                )
            return True
        finally:
            renew.cancel()
            await asyncio.gather(renew, return_exceptions=True)

    async def _renew(self, claim: ClaimedQuery) -> None:
        while True:
            await asyncio.sleep(self.lease_seconds / 3)
            try:
                async with self.pool.connection() as conn:
                    cur = await conn.execute(
                        "update public.job_queries "
                        "set lease_expires_at=now()+make_interval(secs => %s) "
                        "where id=%s and status='running' and locked_by=%s and attempts=%s "
                        "and lease_expires_at>now() returning id",
                        (self.lease_seconds, claim.id, self.worker_id, claim.attempts),
                    )
                    if await cur.fetchone() is None:
                        self.log.warning("search_lease_lost", query_id=str(claim.id))
                        return
            except Exception:
                self.log.exception("search_lease_renew_failed", query_id=str(claim.id))

    async def _mark_provider_failure(self, claim: ClaimedQuery, exc: SearchProviderError) -> None:
        uncertain = isinstance(exc, (SearchTimeoutError, SearchResponseError))
        permanent = (
            uncertain or isinstance(exc, SearchAuthError) or claim.attempts >= self.max_attempts
        )
        async with self.pool.connection() as conn, conn.transaction():
            reserved_credits = 0
            if uncertain:
                await conn.execute("select public.worker_lock_search_job(%s)", (claim.job_id,))
                cur = await conn.execute(
                    "select greatest(1,coalesce(max(credits_used),0)) "
                    "from public.job_queries where job_id=%s and status='done'",
                    (claim.job_id,),
                )
                reserved_credits = (await cur.fetchone() or (1,))[0]
            cur = await conn.execute(
                "update public.job_queries set status=%s,locked_by=null,lease_expires_at=null,"
                "error=%s,completed_at=case when %s then now() else null end,"
                "credits_used=case when %s then coalesce(credits_used,0)+%s else credits_used end,"
                "credit_spend_uncertain=credit_spend_uncertain or %s "
                "where id=%s and status='running' and locked_by=%s and attempts=%s "
                "and lease_expires_at>now() returning id",
                (
                    "failed" if permanent else "pending",
                    f"{'spend_uncertain: ' if uncertain else ''}{type(exc).__name__}: {exc}"[:500],
                    permanent,
                    uncertain,
                    reserved_credits,
                    uncertain,
                    claim.id,
                    self.worker_id,
                    claim.attempts,
                ),
            )
            if uncertain and await cur.fetchone():
                await conn.execute(
                    "select public.job_stats_add(%s,%s,0,0)",
                    (claim.job_id, reserved_credits),
                )
                await conn.execute(
                    "update public.job_stats set credits_uncertain=credits_uncertain+%s "
                    "where job_id=%s",
                    (reserved_credits, claim.job_id),
                )
                await conn.execute(
                    "insert into public.job_events(job_id,type,payload) values(%s,%s,%s)",
                    (
                        claim.job_id,
                        "search_spend_uncertain",
                        Jsonb(
                            {
                                "query_id": str(claim.id),
                                "reserved_credits": reserved_credits,
                            }
                        ),
                    ),
                )
        self.log.warning("search_query_failed", query_id=str(claim.id), permanent=permanent)

    async def _save_results(self, claim: ClaimedQuery, response: SearchResponse) -> bool:
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("select public.worker_lock_search_job(%s)", (claim.job_id,))
            if (await cur.fetchone() or (False,))[0] is not True:
                return False
            cur = await conn.execute(
                "select id from public.job_queries where id=%s and status='running' "
                "and locked_by=%s and attempts=%s and lease_expires_at>now() for update",
                (claim.id, self.worker_id, claim.attempts),
            )
            if await cur.fetchone() is None:
                return False
            new_domains = 0
            accepted = 0
            duplicates = 0
            rejected: Counter[str] = Counter()
            for result in response.results:
                url = normalize_url(result.url)
                if reason := search_result_rejection(url):
                    rejected[reason] += 1
                    continue
                accepted += 1
                assert url.normalized and url.host and url.registered_domain
                cur = await conn.execute(
                    "select opp_id,created,domain_added "
                    "from public.record_discovery(%s,%s,%s,%s,%s,'google',%s)",
                    (
                        claim.job_id,
                        result.url,
                        url.normalized,
                        url.host,
                        url.registered_domain,
                        str(claim.id),
                    ),
                )
                row = await cur.fetchone()
                if row is None:
                    raise RuntimeError("Search discovery returned no opportunity")
                if row[1]:
                    await conn.execute(
                        "update public.opportunities set activity_key=%s where id=%s",
                        (claim.activity_key, row[0]),
                    )
                else:
                    duplicates += 1
                new_domains += int(bool(row[2]))
            if rejected:
                await conn.execute(
                    "insert into public.job_events(job_id,type,payload) values(%s,%s,%s)",
                    (
                        claim.job_id,
                        "search_results_rejected",
                        Jsonb(
                            {
                                "query_id": str(claim.id),
                                "rejected": sum(rejected.values()),
                                "reasons": dict(rejected),
                            }
                        ),
                    ),
                )
            await conn.execute(
                "update public.job_queries set status='done',locked_by=null,lease_expires_at=null,"
                "credits_used=coalesce(credits_used,0)+%s,result_count=%s,accepted_result_count=%s,"
                "rejected_result_count=%s,duplicate_result_count=%s,"
                "new_unique_domains=%s,error=null,"
                "completed_at=now() where id=%s",
                (
                    response.credits_used,
                    len(response.results),
                    accepted,
                    sum(rejected.values()),
                    duplicates,
                    new_domains,
                    claim.id,
                ),
            )
            if new_domains:
                cur = await conn.execute(
                    "with next_page as (select q.*,j.budget_credits from public.job_queries q "
                    "join public.jobs j on j.id=q.job_id where q.id=%s "
                    "and q.page < j.pages_per_query and "
                    "(select count(*) from public.job_queries x where x.job_id=q.job_id) "
                    "< j.budget_credits), inserted as (insert into public.job_queries "
                    "(job_id,activity_key,template_id,template_version,query_text,gl,hl,"
                    "location,num,page,priority) select q.job_id,q.activity_key,q.template_id,"
                    "q.template_version,q.query_text,q.gl,q.hl,q.location,q.num,q.page+1,"
                    "(select max(x.priority)+1 from public.job_queries x where x.job_id=q.job_id) "
                    "from next_page q on conflict do nothing returning id) "
                    "select count(*) from inserted",
                    (claim.id,),
                )
                row = await cur.fetchone()
                if row and row[0]:
                    await conn.execute(
                        "select public.job_stats_add(%s,0,0,%s)", (claim.job_id, row[0])
                    )
            await conn.execute(
                "select public.job_stats_add(%s,%s,1,0)",
                (claim.job_id, response.credits_used),
            )
            return True
