"""Run the real check and scoring pipeline against a local labelled HTML CSV."""

from __future__ import annotations

import argparse
import asyncio
import csv
from decimal import Decimal
from pathlib import Path
from typing import Any, cast
from urllib.parse import urljoin

from worker.checks.auto_filter import select_auto_filter
from worker.checks.catalog import default_registry
from worker.checks.framework import CheckContext
from worker.checks.inputs import ActivityProfile, JobCheckConfig
from worker.fetch.types import FetchOutcome, FetchResult, RedirectStep
from worker.scoring.config import from_job_snapshot
from worker.scoring.engine import Opportunity, SourceSignals, score

FIXTURES = Path(__file__).resolve().parents[1] / "tests/fixtures"
DEFAULT_CSV = FIXTURES / "calibration.csv"
OUTCOMES = frozenset(
    {
        "ok",
        "could_not_check",
        "http_4xx",
        "http_5xx",
        "timeout",
        "dns_fail",
        "tls_error",
        "blocked_suspected",
        "js_only_suspected",
        "non_html",
        "too_large",
        "ssrf_blocked",
        "too_many_redirects",
    }
)
JOB_CONFIG = JobCheckConfig.model_validate(
    {
        "language": "en",
        "seed_keywords": ["sustainable gardening", "garden soil", "vegetable gardening"],
        "activity_keys": ["guest_post", "resource_page"],
        "banned_categories": ["gambling", "pharma"],
    }
)
PROFILES = (
    ActivityProfile(
        key="guest_post",
        page_type_signals={
            "url_patterns": ["write-for-us", "contribute"],
            "title_phrases": ["write for us"],
            "heading_phrases": ["guest post guidelines"],
            "body_phrases": ["contributors"],
        },
    ),
    ActivityProfile(
        key="resource_page",
        page_type_signals={
            "title_phrases": ["resources"],
            "heading_phrases": ["further reading"],
            "structure": {"link_list": True, "min_outbound_links": 10},
        },
    ),
)


def _number(row: dict[str, str], key: str, default: int = 0) -> int:
    value = row.get(key, "").strip()
    try:
        result = int(value) if value else default
    except ValueError as exc:
        raise ValueError(f"{key} must be an integer") from exc
    if result < 0:
        raise ValueError(f"{key} cannot be negative")
    return result


def _load_cases(path: Path) -> list[dict[str, Any]]:
    required = {"fixture", "label"}
    cases: list[dict[str, Any]] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames or not required <= set(reader.fieldnames):
            raise ValueError("CSV must include fixture,label columns")
        for line, values in enumerate(reader, start=2):
            row = {key: value or "" for key, value in values.items() if key is not None}
            name = row["fixture"].strip()
            label = row["label"].strip().lower()
            if not name or name in seen or label not in {"good", "bad"}:
                raise ValueError(f"invalid or duplicate fixture/label on CSV line {line}")
            seen.add(name)
            fixture = (path.parent / name).resolve()
            if fixture.suffix.lower() != ".html" or not fixture.is_file():
                raise ValueError(f"missing HTML fixture on CSV line {line}: {name}")
            outcome = (row.get("outcome") or "ok").strip()
            if outcome not in OUTCOMES:
                raise ValueError(f"unknown fetch outcome on CSV line {line}: {outcome}")
            redirects = _number(row, "redirect_count")
            if redirects > 20:
                raise ValueError(f"redirect_count exceeds 20 on CSV line {line}")
            status = _number(row, "status_code") if row.get("status_code", "").strip() else None
            overlap = _number(row, "overlap_count")
            queries = _number(row, "query_count")
            index = len(cases)
            url = f"https://calibration-{index}.example.com/source"
            final_url = urljoin(url, row.get("final_path", "").strip() or url)
            chain = [
                RedirectStep(f"{url}/redirect-{step + 1}", 301 if step == 0 else 302)
                for step in range(redirects)
            ]
            cases.append(
                {
                    "fixture": fixture,
                    "label": label,
                    "fetch": FetchResult(
                        url=url,
                        final_url=final_url,
                        outcome=cast(FetchOutcome, outcome),
                        status_code=status,
                        redirect_chain=chain,
                        text=fixture.read_text(encoding="utf-8"),
                        headers={"content-type": "text/html"},
                        robots_txt="",
                    ),
                    "activity_key": row.get("activity_key", "").strip() or None,
                    "overlap_count": overlap,
                    "query_count": queries,
                }
            )
    if not cases:
        raise ValueError("CSV contains no labelled fixtures")
    return cases


async def evaluate(path: Path) -> tuple[int, int, int, int]:
    cases = await asyncio.to_thread(_load_cases, path)
    registry = default_registry()
    scoring = from_job_snapshot({})
    ranked: list[tuple[Decimal, int, str, str]] = []
    filtered = 0
    for case in cases:
        run = await registry.run(
            CheckContext(
                fetch=case["fetch"],
                config_version=1,
                config=JOB_CONFIG.model_dump(mode="json"),
                robots_txt="",
                activity_profiles=PROFILES,
            )
        )
        if select_auto_filter(run, JOB_CONFIG.check_settings) is not None:
            filtered += 1
            continue
        result = score(
            Opportunity(config_version=1, activity_key=case["activity_key"]),
            run,
            SourceSignals(overlap_count=case["overlap_count"], query_count=case["query_count"]),
            scoring,
        )
        ranked.append((result.score, case["overlap_count"], case["fixture"].name, case["label"]))
    ranked.sort(key=lambda item: (-item[0], -item[1], item[2]))
    top = ranked[:50]
    relevant = sum(label == "good" for _, _, _, label in top)
    return len(cases), filtered, relevant, len(top)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", nargs="?", type=Path, default=DEFAULT_CSV)
    args = parser.parse_args()
    loaded, filtered, relevant, top_count = asyncio.run(evaluate(args.csv.resolve()))
    precision = relevant / top_count if top_count else 0.0
    print(f"Fixtures evaluated: {loaded}")
    print(f"Auto-filtered: {filtered}")
    print(f"Ranked: {loaded - filtered}")
    print(f"Precision@50: {precision:.3f} ({relevant}/{top_count}; top {top_count})")


if __name__ == "__main__":
    main()
