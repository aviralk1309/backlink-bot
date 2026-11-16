"""Seven-day domain facts, independent of crawl permission and moderation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True)
class DomainFacts:
    tld_flags: dict[str, bool]
    has_contact_page: bool | None = None
    has_about_page: bool | None = None


class DomainFactsCache:
    def __init__(self, pool: AsyncConnectionPool[Any]) -> None:
        self.pool = pool

    async def get(self, domain: str) -> DomainFacts | None:
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    """select tld_flags, has_contact_page, has_about_page from public.domains
                    where registered_domain = %s
                    and checked_at > clock_timestamp() - interval '7 days'""",
                    (domain,),
                )
                row = await cur.fetchone()
        return DomainFacts(**row) if row else None

    async def put(self, domain: str, facts: DomainFacts) -> None:
        """Replace a complete facts snapshot without touching moderation fields."""
        async with self.pool.connection() as conn:
            await conn.execute(
                """insert into public.domains
                  (registered_domain, tld_flags, has_contact_page, has_about_page, checked_at)
                values (%s, %s, %s, %s, clock_timestamp())
                on conflict (registered_domain) do update set
                  tld_flags = domains.tld_flags || excluded.tld_flags,
                  has_contact_page = coalesce(domains.has_contact_page, false)
                    or coalesce(excluded.has_contact_page, false),
                  has_about_page = coalesce(domains.has_about_page, false)
                    or coalesce(excluded.has_about_page, false),
                  checked_at = excluded.checked_at""",
                (domain, Jsonb(facts.tld_flags), facts.has_contact_page, facts.has_about_page),
            )
