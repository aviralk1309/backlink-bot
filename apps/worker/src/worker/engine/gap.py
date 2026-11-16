"""Domain-level gap calculation with overlap counting (M4-S6).

Rules (G6, G10):
  * Gap domains = domains in competitor files,
    MINUS domains in client files,
    MINUS the client's own domain,
    MINUS competitor domains themselves (and competitor file labels),
    MINUS reference sites.
  * Subdomains are treated as the registered domain (M4-D2).
  * Overlap count = distinct competitor labels linking to the domain.
  * client_link_status = 'known_partial' if at least one client file exists,
    otherwise 'unknown'.
  * Recompute is idempotent.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Literal

from psycopg import AsyncConnection

from worker.urls.domain import registered_domain
from worker.urls.normalize import normalize_domain

ClientLinkStatus = Literal["unknown", "known_partial"]


@dataclass(frozen=True, slots=True)
class GapDomainResult:
    domain: str
    overlap_count: int
    client_link_status: ClientLinkStatus
    competitor_labels: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class GapPreviewResult:
    total_gap_domains: int
    has_client_file: bool
    client_link_status: ClientLinkStatus
    overlap_distribution: dict[str, int]


def _clean_domain(raw: str | None) -> str | None:
    if not raw:
        return None
    # If full URL or host, normalize to registered domain
    reg = normalize_domain(raw)
    if reg:
        return reg
    return registered_domain(raw)


def calculate_domain_gap(
    *,
    competitor_links: list[tuple[str, str]],  # (linking_url_or_domain, competitor_label)
    client_links: list[str],  # linking_url_or_domain in client file(s)
    client_domain: str | None,
    competitor_domains: list[str],
    reference_sites: list[str],
    has_client_file: bool,
) -> list[GapDomainResult]:
    """Pure domain-level gap calculation."""
    client_status: ClientLinkStatus = "known_partial" if has_client_file else "unknown"

    # Build exclusion set of registered domains
    exclusions: set[str] = set()

    # 1. Client own domain
    c_dom = _clean_domain(client_domain)
    if c_dom:
        exclusions.add(c_dom)

    # 2. Competitor domains (configured)
    for cd in competitor_domains:
        d = _clean_domain(cd)
        if d:
            exclusions.add(d)

    # 3. Competitor labels from files
    for _, label in competitor_links:
        d = _clean_domain(label)
        if d:
            exclusions.add(d)

    # 4. Reference sites
    for rs in reference_sites:
        d = _clean_domain(rs)
        if d:
            exclusions.add(d)

    # 5. Domains in client files (if any)
    for cl in client_links:
        d = _clean_domain(cl)
        if d:
            exclusions.add(d)

    # Aggregate candidate competitor links by registered domain
    domain_to_labels: dict[str, set[str]] = {}
    for raw_link, raw_label in competitor_links:
        dom = _clean_domain(raw_link)
        if not dom or dom in exclusions:
            continue
        cleaned_label = _clean_domain(raw_label) or raw_label.strip().lower()
        if not cleaned_label:
            continue
        domain_to_labels.setdefault(dom, set()).add(cleaned_label)

    results: list[GapDomainResult] = []
    for dom, labels in domain_to_labels.items():
        results.append(
            GapDomainResult(
                domain=dom,
                overlap_count=len(labels),
                client_link_status=client_status,
                competitor_labels=tuple(sorted(labels)),
            )
        )

    # Sort by overlap_count desc, then domain asc
    results.sort(key=lambda r: (-r.overlap_count, r.domain))
    return results


async def fetch_job_gap_domains(
    conn: AsyncConnection[Any], job_id: uuid.UUID
) -> list[GapDomainResult]:
    """Queries gap domains directly from Postgres using the SQL function."""
    cur = await conn.execute(
        "select domain, overlap_count, client_link_status, competitor_labels "
        "from public.get_job_gap_domains(%s)",
        (job_id,),
    )
    rows = await cur.fetchall()
    return [
        GapDomainResult(
            domain=r[0],
            overlap_count=r[1],
            client_link_status=r[2],
            competitor_labels=tuple(r[3]),
        )
        for r in rows
    ]


async def fetch_job_gap_preview(conn: AsyncConnection[Any], job_id: uuid.UUID) -> GapPreviewResult:
    """Queries gap preview summary directly from Postgres."""
    cur = await conn.execute(
        "select total_gap_domains, has_client_file, client_link_status, overlap_distribution "
        "from public.get_job_gap_preview(%s)",
        (job_id,),
    )
    row = await cur.fetchone()
    if not row:
        return GapPreviewResult(0, False, "unknown", {})
    return GapPreviewResult(
        total_gap_domains=row[0],
        has_client_file=row[1],
        client_link_status=row[2],
        overlap_distribution=dict(row[3]) if row[3] else {},
    )


@dataclass(frozen=True, slots=True)
class GapAndSeedImportResult:
    gap_candidates: int
    gap_opportunities_created: int
    gap_duplicates_skipped: int
    seed_candidates: int
    seed_opportunities_created: int
    seed_duplicates_skipped: int

    @property
    def total_opportunities_created(self) -> int:
        return self.gap_opportunities_created + self.seed_opportunities_created

    @property
    def total_duplicates_skipped(self) -> int:
        return self.gap_duplicates_skipped + self.seed_duplicates_skipped


def prepare_seed_urls(raw_urls: list[str]) -> list[dict[str, str]]:
    """Normalizes raw seed list URLs, filtering out invalid URLs."""
    from worker.urls.normalize import normalize_url

    seeds: list[dict[str, str]] = []
    for raw in raw_urls:
        if not raw or not raw.strip():
            continue
        norm = normalize_url(raw.strip())
        if norm.ok and norm.normalized and norm.host and norm.registered_domain:
            seeds.append(
                {
                    "original": norm.original,
                    "normalized": norm.normalized,
                    "host": norm.host,
                    "domain": norm.registered_domain,
                }
            )
    return seeds


async def import_job_gap_opportunities(
    conn: AsyncConnection[Any], job_id: uuid.UUID
) -> tuple[int, int, int]:
    """Records linking URLs from confirmed competitor CSV files for all gap domains.

    Returns (total_candidates, opportunities_created, duplicates_skipped).
    """
    cur = await conn.execute(
        "select total_candidates, opportunities_created, duplicates_skipped "
        "from public.import_job_gap_opportunities(%s)",
        (job_id,),
    )
    row = await cur.fetchone()
    if not row:
        return (0, 0, 0)
    return (row[0], row[1], row[2])


async def import_job_seed_opportunities(
    conn: AsyncConnection[Any], job_id: uuid.UUID, seeds: list[dict[str, str]]
) -> tuple[int, int, int]:
    """Records seed list URLs as opportunities (source_type='seed_list', priority 1).

    Returns (total_candidates, opportunities_created, duplicates_skipped).
    """
    import json

    cur = await conn.execute(
        "select total_candidates, opportunities_created, duplicates_skipped "
        "from public.import_job_seed_opportunities(%s, %s::jsonb)",
        (job_id, json.dumps(seeds)),
    )
    row = await cur.fetchone()
    if not row:
        return (0, 0, 0)
    return (row[0], row[1], row[2])


async def import_job_gap_and_seeds(
    conn: AsyncConnection[Any], job_id: uuid.UUID
) -> GapAndSeedImportResult:
    """Orchestrates creation of opportunities from both gap domains and seed list URLs.

    1. Imports gap opportunities from confirmed competitor CSV files.
    2. Fetches and normalizes seed_list_urls from the job and imports them.
    """
    # 1. Gap import
    gap_total, gap_created, gap_dupes = await import_job_gap_opportunities(conn, job_id)

    # 2. Seed URLs from jobs table
    cur = await conn.execute(
        "select seed_list_urls from public.jobs where id = %s",
        (job_id,),
    )
    row = await cur.fetchone()
    raw_seeds: list[str] = row[0] if row and row[0] else []

    prepared = prepare_seed_urls(raw_seeds)
    if prepared:
        seed_total, seed_created, seed_dupes = await import_job_seed_opportunities(
            conn, job_id, prepared
        )
    else:
        seed_total, seed_created, seed_dupes = (0, 0, 0)

    return GapAndSeedImportResult(
        gap_candidates=gap_total,
        gap_opportunities_created=gap_created,
        gap_duplicates_skipped=gap_dupes,
        seed_candidates=seed_total,
        seed_opportunities_created=seed_created,
        seed_duplicates_skipped=seed_dupes,
    )
