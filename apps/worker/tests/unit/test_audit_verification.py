"""Expected-fail regressions for audit findings; no production changes."""

import asyncio
import csv
import io
import ipaddress
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from urllib.parse import urlparse

import pytest
import respx

from worker.fetch.fetcher import FetcherConfig, PoliteFetcher
from worker.fetch.rate_limiter import DomainRateLimiter
from worker.io.csv_validator import validate_and_stage_csv

ROOT = Path(__file__).resolve().parents[4]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_b01_error_report_neutralizes_formula(tmp_path: Path) -> None:
    formula = '=HYPERLINK("https://attacker.test/","Open")'
    source = tmp_path / "input.csv"
    source.write_text('URL\n"' + formula.replace('"', '""') + '"\n', encoding="utf-8")
    conn = MagicMock()
    conn.execute = AsyncMock()
    conn.cursor.return_value.__aenter__.return_value = AsyncMock()
    reports: list[bytes] = []

    async def upload(_path: str, file: Path) -> None:
        reports.append(await asyncio.to_thread(file.read_bytes))

    await validate_and_stage_csv(
        conn=conn,
        upload_id=uuid.uuid4(),
        file_path=source,
        mapping={"url_index": 0, "columns": []},
        storage_uploader=upload,
        job_id=uuid.uuid4(),
    )
    assert reports
    raw_url = list(csv.DictReader(io.StringIO(reports[0].decode())))[0]["raw_url"]
    assert not raw_url.startswith(("=", "+", "-", "@"))


@pytest.mark.unit
@pytest.mark.asyncio
async def test_b07_unexpected_fetch_exception_propagates() -> None:
    config = FetcherConfig(user_agent="AuditBot/1.0", domain_delay_seconds=0)
    resolver = MagicMock()
    resolver.resolve = AsyncMock(return_value=[ipaddress.ip_address("93.184.216.34")])
    fetcher = PoliteFetcher(config=config, rate_limiter=DomainRateLimiter(0), dns_resolver=resolver)
    with respx.mock:
        respx.get("https://example.com/bug").mock(side_effect=RuntimeError("programming defect"))
        with pytest.raises(RuntimeError, match="programming defect"):
            await fetcher.fetch("https://example.com/bug")
        await fetcher.close()


@pytest.mark.unit
@pytest.mark.parametrize("relative", [".env.example", "apps/worker/.env.example"])
@pytest.mark.xfail(strict=True, reason="O-01: worker example credentials use database superuser")
def test_o01_worker_example_does_not_use_postgres_superuser(relative: str) -> None:
    example = ROOT / relative
    line = next(
        line for line in example.read_text().splitlines() if line.startswith("DATABASE_URL=")
    )
    assert urlparse(line.removeprefix("DATABASE_URL=")).username != "postgres", example


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="I-04: manual runbook update bypasses the bounded reaper")
def test_i04_stale_lease_runbook_uses_bounded_reaper() -> None:
    runbook = (ROOT / "docs/runbooks/worker.md").read_text()
    section = runbook.split('### Rows stuck in "running"', 1)[1]
    section = section.split("### Max attempts exceeded", 1)[0]
    assert "reap_expired_leases" in section
    assert "update opportunities" not in section.lower()
