"""S9: fetch, check, score and place one claimed opportunity atomically."""

from collections.abc import Mapping
from typing import Any, cast

import structlog
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from pydantic import JsonValue

from worker.checks.auto_filter import publish_checks_and_filter
from worker.checks.catalog import default_registry
from worker.checks.framework import CheckContext
from worker.checks.inputs import ActivityProfile, JobCheckConfig
from worker.checks.store import LostCheckClaim
from worker.crawl.links import crawl_candidates
from worker.engine.claims import ClaimedRow
from worker.fetch.domain_cache import DomainFacts, DomainFactsCache
from worker.fetch.fetcher import PoliteFetcher
from worker.scoring.config import ScoringSnapshot, from_job_snapshot
from worker.scoring.engine import Opportunity, SourceSignals, score
from worker.scoring.store import assign_scored_row, save_score
from worker.urls.normalize import normalize_url


class OpportunityHandler:
    def __init__(
        self,
        pool: AsyncConnectionPool[Any],
        worker_id: str,
        fetcher: PoliteFetcher,
        *,
        site_crawl_enabled: bool = False,
    ) -> None:
        self.pool = pool
        self.worker_id = worker_id
        self.fetcher = fetcher
        self.registry = default_registry()
        self.domain_facts = DomainFactsCache(pool)
        self.log = structlog.get_logger()
        self.site_crawl_enabled = site_crawl_enabled

    async def _inputs(
        self, claim: ClaimedRow
    ) -> tuple[dict[str, JsonValue], tuple[ActivityProfile, ...], ScoringSnapshot]:
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    "select snapshot from public.job_config_history where job_id=%s and version=%s",
                    (claim.job_id, claim.config_version),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise ValueError("pinned_job_config_missing")
                snapshot = cast(dict[str, JsonValue], row["snapshot"])
                raw_profiles = snapshot.get("activity_profiles")
                if isinstance(raw_profiles, Mapping):
                    profiles = tuple(
                        ActivityProfile.model_validate(profile) for profile in raw_profiles.values()
                    )
                else:
                    # Pre-S9 history did not pin check profiles. Keep those rows processable.
                    await cursor.execute(
                        """select key,version,enabled,page_type_signals,relevance_rule
                           from public.activity_profiles where key=any(%s)""",
                        (snapshot.get("activity_keys", []),),
                    )
                    profiles = tuple(
                        ActivityProfile.model_validate(profile)
                        for profile in await cursor.fetchall()
                    )
        JobCheckConfig.model_validate(snapshot)
        scoring = from_job_snapshot(cast(dict[str, object], snapshot))
        return snapshot, profiles, scoring

    async def _save_fetch_summary(
        self, conn: AsyncConnection[Any], claim: ClaimedRow, summary: dict[str, JsonValue]
    ) -> None:
        cursor = await conn.execute(
            "select public.worker_save_fetch_summary(%s,%s,%s,%s,%s)",
            (claim.id, self.worker_id, claim.attempts, claim.config_version, Jsonb(summary)),
        )
        row = await cursor.fetchone()
        if row is None or not row[0]:
            raise LostCheckClaim("Opportunity fetch claim expired or was superseded")

    async def _merge_final_url(
        self, conn: AsyncConnection[Any], claim: ClaimedRow, context: CheckContext
    ) -> bool:
        """Merge a final or canonical URL into an existing row; return when merged."""
        fetch = context.fetch
        if fetch.outcome != "ok":
            return False
        candidates = [fetch.final_url]
        if context.page.canonical:
            candidates.append(context.page.canonical)
        seen: set[str] = set()
        for candidate in candidates:
            normalized = normalize_url(candidate).normalized
            if not normalized or normalized == claim.normalized_url or normalized in seen:
                continue
            seen.add(normalized)
            cursor = await conn.execute(
                "select outcome,canonical_id from public.merge_opportunity_after_fetch(%s,%s)",
                (claim.id, normalized),
            )
            row = await cursor.fetchone()
            if row is None:
                raise RuntimeError("Missing redirect merge response")
            outcome, canonical_id = row
            if outcome in ("merged", "already_merged"):
                self.log.info("opportunity_merged", canonical_id=str(canonical_id))
                return True
            if outcome == "not_mergeable":
                raise LostCheckClaim("Opportunity no longer owns a running check claim")
        return False

    async def __call__(self, claim: ClaimedRow) -> None:
        snapshot, profiles, scoring = await self._inputs(claim)
        fetch = await self.fetcher.fetch(claim.original_url)
        facts = await self.domain_facts.get(claim.domain)
        context = CheckContext(
            fetch=fetch,
            config_version=claim.config_version,
            config=snapshot,
            robots_txt=fetch.robots_txt,
            domain_facts=facts,
            activity_profiles=profiles,
        )
        if fetch.outcome == "ok":
            page = context.page
            if page.contact_link or page.about_link:
                await self.domain_facts.put(
                    claim.domain,
                    DomainFacts(
                        tld_flags={},
                        has_contact_page=True if page.contact_link else None,
                        has_about_page=True if page.about_link else None,
                    ),
                )
        run = await self.registry.run(context)
        async with self.pool.connection() as conn, conn.transaction():
            await self._save_fetch_summary(conn, claim, fetch.to_summary_dict())
            if await self._merge_final_url(conn, claim, context):
                return
            decision = await publish_checks_and_filter(
                conn,
                claim,
                self.worker_id,
                run,
                JobCheckConfig.model_validate(snapshot).check_settings,
            )
            if decision is not None:
                self.log.info("opportunity_auto_filtered", reason=decision.reason_code)
                return
            async with conn.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """select o.overlap_count,
                      (select count(*) from public.opportunity_sources s
                       where s.opportunity_id=o.id and s.source_type='google') as query_count
                    from public.opportunities o where o.id=%s""",
                    (claim.id,),
                )
                signals = await cursor.fetchone()
            if signals is None:
                raise LostCheckClaim("Opportunity disappeared before scoring")
            result = score(
                Opportunity(
                    config_version=claim.config_version,
                    activity_key=claim.activity_key,
                ),
                run,
                SourceSignals.model_validate(signals),
                scoring,
            )
            await save_score(conn, claim, self.worker_id, result)
            queue_group = await assign_scored_row(conn, claim, self.worker_id)
            if self.site_crawl_enabled and fetch.outcome == "ok":
                candidates = crawl_candidates(
                    context.page,
                    fetch.final_url,
                    claim.domain,
                    JobCheckConfig.model_validate(snapshot).seed_keywords,
                )
                if candidates:
                    await conn.execute(
                        "select public.record_site_crawl_candidates(%s,%s,%s)",
                        (claim.job_id, claim.id, Jsonb(candidates)),
                    )
            self.log.info(
                "opportunity_scored",
                score=float(result.score),
                tier=result.tier,
                queue_group=queue_group,
            )
