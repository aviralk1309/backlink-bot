from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from worker.engine.gap import (
    GapAndSeedImportResult,
    import_job_gap_and_seeds,
    import_job_gap_opportunities,
    import_job_seed_opportunities,
    prepare_seed_urls,
)


def test_prepare_seed_urls_valid() -> None:
    raw = [
        "https://example.com/blog",
        "HTTP://SHOP.SUB.DOMAIN.CO.UK/item?id=123#frag",
        "https://clean-site.org/",
    ]
    seeds = prepare_seed_urls(raw)
    assert len(seeds) == 3

    assert seeds[0] == {
        "original": "https://example.com/blog",
        "normalized": "https://example.com/blog",
        "host": "example.com",
        "domain": "example.com",
    }
    assert seeds[1] == {
        "original": "HTTP://SHOP.SUB.DOMAIN.CO.UK/item?id=123#frag",
        "normalized": "https://shop.sub.domain.co.uk/item?id=123",
        "host": "shop.sub.domain.co.uk",
        "domain": "domain.co.uk",
    }
    assert seeds[2] == {
        "original": "https://clean-site.org/",
        "normalized": "https://clean-site.org/",
        "host": "clean-site.org",
        "domain": "clean-site.org",
    }


def test_prepare_seed_urls_filters_bad_and_empty() -> None:
    raw = [
        "",
        "   ",
        "not-a-url",
        "http://localhost/internal",
        "http://127.0.0.1/admin",
        "https://good.com/page",
    ]
    seeds = prepare_seed_urls(raw)
    assert len(seeds) == 1
    assert seeds[0]["domain"] == "good.com"


def test_gap_and_seed_import_result_totals() -> None:
    res = GapAndSeedImportResult(
        gap_candidates=10,
        gap_opportunities_created=7,
        gap_duplicates_skipped=3,
        seed_candidates=5,
        seed_opportunities_created=4,
        seed_duplicates_skipped=1,
    )
    assert res.total_opportunities_created == 11
    assert res.total_duplicates_skipped == 4


@pytest.mark.asyncio
async def test_import_job_gap_opportunities() -> None:
    conn = AsyncMock()
    cur = AsyncMock()
    cur.fetchone.return_value = (10, 8, 2)
    conn.execute.return_value = cur

    jid = uuid.uuid4()
    total, created, dupes = await import_job_gap_opportunities(conn, jid)
    assert total == 10
    assert created == 8
    assert dupes == 2

    conn.execute.assert_called_once()
    assert "import_job_gap_opportunities" in conn.execute.call_args[0][0]


@pytest.mark.asyncio
async def test_import_job_seed_opportunities() -> None:
    conn = AsyncMock()
    cur = AsyncMock()
    cur.fetchone.return_value = (5, 4, 1)
    conn.execute.return_value = cur

    jid = uuid.uuid4()
    seeds = [
        {
            "original": "https://a.com",
            "normalized": "https://a.com",
            "host": "a.com",
            "domain": "a.com",
        }
    ]
    total, created, dupes = await import_job_seed_opportunities(conn, jid, seeds)
    assert total == 5
    assert created == 4
    assert dupes == 1

    conn.execute.assert_called_once()
    assert "import_job_seed_opportunities" in conn.execute.call_args[0][0]


@pytest.mark.asyncio
async def test_import_job_gap_and_seeds_orchestration() -> None:
    conn = AsyncMock()

    # Gap import returns (4, 3, 1)
    gap_cur = AsyncMock()
    gap_cur.fetchone.return_value = (4, 3, 1)

    # Job query returns seed list
    job_cur = AsyncMock()
    job_cur.fetchone.return_value = (["https://seed1.com/page"],)

    # Seed import returns (1, 1, 0)
    seed_cur = AsyncMock()
    seed_cur.fetchone.return_value = (1, 1, 0)

    conn.execute.side_effect = [gap_cur, job_cur, seed_cur]

    jid = uuid.uuid4()
    res = await import_job_gap_and_seeds(conn, jid)
    assert res.gap_candidates == 4
    assert res.gap_opportunities_created == 3
    assert res.gap_duplicates_skipped == 1
    assert res.seed_candidates == 1
    assert res.seed_opportunities_created == 1
    assert res.seed_duplicates_skipped == 0
    assert res.total_opportunities_created == 4
    assert res.total_duplicates_skipped == 1
