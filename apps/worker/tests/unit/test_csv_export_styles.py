"""M4-S9: Tests for three export styles: Ahrefs, Semrush, and Google Search Console.

Verifies:
  - Header detection and delimiter identification across export formats
  - Codec & BOM handling (UTF-8, UTF-8 BOM, UTF-16LE tab)
  - Target/Source URL column identification and normalization
  - Valid row extraction into normalized URLs and registered domains
"""

from __future__ import annotations

from pathlib import Path

import pytest

from worker.io import detect_csv_format, iter_csv_rows
from worker.urls.domain import registered_domain
from worker.urls.normalize import normalize_url

REPO_FIXTURE_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "csv"
TEST_FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures"

pytestmark = pytest.mark.unit


def test_ahrefs_utf8_bom_style() -> None:
    path = REPO_FIXTURE_DIR / "ahrefs-like_utf8-bom.csv"
    fmt = detect_csv_format(path)

    assert fmt.encoding.codec == "utf-8-sig"
    assert fmt.encoding.bom is True
    assert fmt.delimiter.delimiter == ","
    assert any(h.lower() == "referring page url" for h in fmt.header.names)

    url_idx = next(i for i, h in enumerate(fmt.header.names) if h.lower() == "referring page url")
    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) > 0

    valid_urls = []
    for r in rows:
        val = r.cells[url_idx].strip()
        norm = normalize_url(val)
        if norm:
            valid_urls.append(norm)

    assert len(valid_urls) == len(rows)
    domains = {u.registered_domain for u in valid_urls}
    assert None not in domains


def test_ahrefs_utf16le_tab_style() -> None:
    path = REPO_FIXTURE_DIR / "ahrefs-like_utf16le-tab.csv"
    fmt = detect_csv_format(path)

    assert fmt.encoding.codec in ("utf-16-le", "utf-16")
    assert fmt.encoding.bom is True
    assert fmt.delimiter.delimiter == "\t"
    assert any(h.lower() == "referring page url" for h in fmt.header.names)

    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) > 0


def test_ahrefs_fixture_export_style() -> None:
    path = TEST_FIXTURE_DIR / "ahrefs_export.csv"
    fmt = detect_csv_format(path)

    assert fmt.delimiter.delimiter == ","
    assert "Referring Page URL" in fmt.header.names

    url_idx = fmt.header.names.index("Referring Page URL")
    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) == 4

    extracted_domains = [registered_domain(r.cells[url_idx]) for r in rows]
    assert extracted_domains == [
        "techreview.com",
        "industrydaily.org",
        "partnerhub.io",
        "webmastertalk.net",
    ]


def test_semrush_quoted_style() -> None:
    path = REPO_FIXTURE_DIR / "semrush-like_quoted.csv"
    fmt = detect_csv_format(path)

    assert fmt.delimiter.delimiter == ","
    assert "Source url" in fmt.header.names

    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) > 0


def test_semrush_semicolon_fixture_style() -> None:
    path = TEST_FIXTURE_DIR / "semrush_export.csv"
    fmt = detect_csv_format(path)

    assert fmt.delimiter.delimiter == ";"
    assert "Source url" in fmt.header.names

    url_idx = fmt.header.names.index("Source url")
    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) == 3

    domains = [registered_domain(r.cells[url_idx]) for r in rows]
    assert domains == ["analyticsweekly.com", "techreview.com", "marketingdigest.co"]


def test_gsc_latest_links_style() -> None:
    path = REPO_FIXTURE_DIR / "gsc-like_latest-links.csv"
    fmt = detect_csv_format(path)

    assert fmt.delimiter.delimiter == ","
    assert "Top linking site" in fmt.header.names or "Target page" in fmt.header.names

    # Check that rows parse cleanly
    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) > 0


def test_gsc_fixture_export_style() -> None:
    path = TEST_FIXTURE_DIR / "gsc_export.csv"
    fmt = detect_csv_format(path)

    assert fmt.delimiter.delimiter == ","
    assert "Top linking site" in fmt.header.names

    url_idx = fmt.header.names.index("Top linking site")
    rows = list(iter_csv_rows(path, fmt))
    assert len(rows) == 3

    domains = [registered_domain(r.cells[url_idx]) for r in rows]
    assert domains == ["client-partner.org", "techreview.com", "industrypress.com"]
