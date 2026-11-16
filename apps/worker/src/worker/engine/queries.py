"""Generate bounded, diverse Serper queries when a job is picked up."""

from __future__ import annotations

import re
import uuid
from collections import deque
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass
from itertools import product
from math import prod
from typing import Any

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb

# shortcut: pickup holds at most 10,000 rows in memory; raise after larger jobs are validated.
MAX_QUERIES = 10_000
PLACEHOLDERS = {"keyword", "niche", "brand", "country", "city"}
TOKEN = re.compile(r"\{([^{}]*)\}")


class QueryPlanError(ValueError):
    """The saved job or activity templates cannot produce a search plan."""


@dataclass(frozen=True, slots=True)
class QueryRow:
    activity_key: str
    template_id: str
    template_version: int
    query_text: str
    gl: str | None
    hl: str | None
    location: str | None
    num: int
    page: int
    priority: int


@dataclass(frozen=True, slots=True)
class QueryPlan:
    rows: tuple[QueryRow, ...]
    potential_calls: int
    capped: bool


def _values(raw: object) -> tuple[str, ...]:
    if raw is None:
        return ()
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        raise QueryPlanError("invalid_targeting")
    seen: set[str] = set()
    values: list[str] = []
    for item in raw:
        if item is None:
            continue
        if not isinstance(item, str):
            raise QueryPlanError("invalid_targeting")
        value = " ".join(item.split())
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            values.append(value)
    return tuple(values)


def _variants(
    template: str,
    names: tuple[str, ...],
    values: Mapping[str, tuple[str, ...]],
    regions: tuple[str, ...],
) -> Iterator[tuple[str, str | None]]:
    for combination in product(*(values[name] for name in names)):
        selected = dict(zip(names, combination, strict=True))
        locations: Sequence[str | None] = (
            (selected["city"],) if "city" in names else regions or (None,)
        )
        for location in locations:
            rendered = template
            for name, value in selected.items():
                rendered = rendered.replace("{" + name + "}", value)
            query = " ".join(rendered.split())
            if query:
                yield query, location


def plan_queries(job: Mapping[str, Any], profiles: Sequence[Mapping[str, Any]]) -> QueryPlan:
    budget = job["budget_credits"]
    pages = job["pages_per_query"]
    if type(budget) is not int or budget < 0 or type(pages) is not int or not 1 <= pages <= 10:
        raise QueryPlanError("invalid_limits")
    if budget == 0:
        return QueryPlan((), 0, False)

    country = job.get("country")
    language = job.get("language")
    if (
        not isinstance(country, str)
        or not re.fullmatch(r"[A-Z]{2}", country)
        or not isinstance(language, str)
        or not re.fullmatch(r"[a-z]{2}", language)
    ):
        raise QueryPlanError("invalid_locale")
    regions = _values(job.get("regions"))
    values = {
        "keyword": _values(job.get("seed_keywords")),
        "niche": _values([job.get("sub_niche"), job.get("business_type")]),
        "brand": _values([job.get("client"), *_values(job.get("brand_variants"))]),
        "country": (country,),
        "city": regions,
    }
    gl = country.lower()
    hl = language
    cap = min(budget, MAX_QUERIES)
    by_key = {profile["key"]: profile for profile in profiles}
    streams: list[tuple[int, int, int, str, str, int, Iterator[tuple[str, str | None]]]] = []
    potential = 0
    for activity_index, key in enumerate(job["activity_keys"]):
        profile = by_key.get(key)
        if profile is None:
            raise QueryPlanError("missing_activity")
        version = profile.get("version")
        if type(version) is not int or version < 1:
            raise QueryPlanError("invalid_templates")
        templates = profile["footprint_templates"]
        if not isinstance(templates, list):
            raise QueryPlanError("invalid_templates")
        for template_index, template in enumerate(templates):
            if not isinstance(template, dict) or type(template.get("enabled")) is not bool:
                raise QueryPlanError("invalid_templates")
            if not template["enabled"]:
                continue
            template_language = template.get("language")
            if not isinstance(template_language, str):
                raise QueryPlanError("invalid_templates")
            if template_language not in ("*", hl):
                continue
            text = template.get("template")
            template_id = template.get("id")
            template_priority = template.get("priority")
            if (
                not isinstance(text, str)
                or not isinstance(template_id, str)
                or type(template_priority) is not int
                or template_priority < 1
            ):
                raise QueryPlanError("invalid_templates")
            names = tuple(dict.fromkeys(TOKEN.findall(text)))
            if (
                not names
                or any(name not in PLACEHOLDERS for name in names)
                or "{" in TOKEN.sub("", text)
                or "}" in TOKEN.sub("", text)
            ):
                raise QueryPlanError("invalid_templates")
            if any(not values[name] for name in names):
                continue
            count = prod(len(values[name]) for name in names)
            if "city" not in names:
                count *= max(1, len(regions))
            potential += count * pages
            # Spread a small budget across keywords before revisiting one template.
            keywords: Sequence[str | None] = values["keyword"] if "keyword" in names else (None,)
            for keyword_index, keyword in enumerate(keywords):
                offset = (
                    (keyword_index + activity_index + template_index) % len(regions)
                    if regions
                    else 0
                )
                ordered_regions = regions[offset:] + regions[:offset]
                variant_values = values if keyword is None else {**values, "keyword": (keyword,)}
                if "city" in names:
                    variant_values = {**variant_values, "city": ordered_regions}
                streams.append(
                    (
                        template_priority,
                        keyword_index,
                        activity_index,
                        key,
                        template_id,
                        version,
                        _variants(text, names, variant_values, ordered_regions),
                    )
                )

    queue = deque(sorted(streams, key=lambda stream: (stream[0], stream[1], stream[2])))
    seen: set[tuple[str, str | None]] = set()
    first_pages: list[QueryRow] = []
    while queue and len(first_pages) < cap:
        template_priority, keyword_index, activity_index, key, template_id, version, variants = (
            queue.popleft()
        )
        try:
            query, location = next(variants)
        except StopIteration:
            continue
        queue.append(
            (template_priority, keyword_index, activity_index, key, template_id, version, variants)
        )
        identity = (query.casefold(), location.casefold() if location else None)
        if identity in seen:
            continue
        seen.add(identity)
        if len(query) > 1000:
            raise QueryPlanError("query_too_long")
        first_pages.append(QueryRow(key, template_id, version, query, gl, hl, location, 10, 1, 0))

    # Deeper pages are added only after the previous page discovers a new domain.
    rows = [
        QueryRow(
            base.activity_key,
            base.template_id,
            base.template_version,
            base.query_text,
            gl,
            hl,
            base.location,
            10,
            1,
            priority,
        )
        for priority, base in enumerate(first_pages, 1)
    ]
    if not rows:
        raise QueryPlanError("no_search_queries")
    return QueryPlan(tuple(rows), potential, potential > cap and len(rows) == cap)


async def create_job_queries(conn: AsyncConnection[Any], job_id: uuid.UUID) -> QueryPlan:
    cur = await conn.execute(
        "select client,business_type,sub_niche,activity_keys,country,language,regions,"
        " seed_keywords,brand_variants,budget_credits,pages_per_query,config_version "
        "from public.jobs where id=%s",
        (job_id,),
    )
    row = await cur.fetchone()
    if row is None:
        raise QueryPlanError("missing_job")
    fields = (
        "client",
        "business_type",
        "sub_niche",
        "activity_keys",
        "country",
        "language",
        "regions",
        "seed_keywords",
        "brand_variants",
        "budget_credits",
        "pages_per_query",
        "config_version",
    )
    job = dict(zip(fields, row, strict=True))
    if job["budget_credits"] == 0:
        return QueryPlan((), 0, False)
    cur = await conn.execute(
        "select key,version,footprint_templates from public.activity_profiles where key=any(%s)",
        (job["activity_keys"],),
    )
    profiles = [
        dict(zip(("key", "version", "footprint_templates"), p, strict=True))
        for p in await cur.fetchall()
    ]
    plan = plan_queries(job, profiles)
    payload = [asdict(query) for query in plan.rows]
    cur = await conn.execute(
        "with inserted as (insert into public.job_queries "
        "(job_id,activity_key,template_id,template_version,query_text,gl,hl,location,"
        "num,page,priority) "
        "select %s,q.activity_key,q.template_id,q.template_version,q.query_text,"
        "q.gl,q.hl,q.location,q.num,q.page,q.priority "
        "from jsonb_to_recordset(%s::jsonb) as q(activity_key text,template_id text,"
        "template_version integer,query_text text,gl text,hl text,location text,"
        "num integer,page integer,priority integer) "
        "on conflict do nothing returning id) select count(*) from inserted",
        (job_id, Jsonb(payload)),
    )
    count_row = await cur.fetchone()
    assert count_row is not None
    inserted = count_row[0]
    if inserted:
        await conn.execute("select public.job_stats_add(%s,0,0,%s)", (job_id, inserted))
    if plan.capped and inserted:
        await conn.execute(
            "insert into public.job_events(job_id,type,payload,config_version) "
            "values (%s,'query_plan_capped',jsonb_build_object('generated',%s,'potential',%s),%s)",
            (job_id, len(plan.rows), plan.potential_calls, job["config_version"]),
        )
    return plan
