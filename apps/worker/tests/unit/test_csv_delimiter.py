"""M4-S3: CSV delimiter detection. Fixture truth lives in fixtures/csv/manifest.json."""

import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from worker.io import (
    CANDIDATES,
    CsvEncoding,
    detect_delimiter,
    detect_file_encoding,
    read_text_sample,
)

FIXTURE_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "csv"
MANIFEST: dict[str, dict[str, Any]] = json.loads(
    (FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8")
)["files"]
DETECTABLE = {n: m for n, m in MANIFEST.items() if m["encoding"] != "n/a"}
# Clean files where every record has the same width.
UNIFORM = [
    "ahrefs-like_utf8-bom.csv",
    "ahrefs-like_utf16le-tab.csv",
    "semrush-like_quoted.csv",
    "gsc-like_latest-links.csv",
    "gsc-like_top-linking-sites.csv",
    "edge_semicolon_cp1252.csv",
]

pytestmark = pytest.mark.unit


def _detect_fixture(name: str) -> Any:
    path = FIXTURE_DIR / name
    text, complete = read_text_sample(path, detect_file_encoding(path))
    return detect_delimiter(text, is_complete=complete)


@pytest.mark.parametrize("name", sorted(DETECTABLE))
def test_fixture_delimiter_matches_manifest(name: str) -> None:
    assert _detect_fixture(name).delimiter == DETECTABLE[name]["delimiter"]


@pytest.mark.parametrize("name", UNIFORM)
def test_uniform_fixture_has_full_agreement(name: str) -> None:
    result = _detect_fixture(name)
    assert result.agreement == 1.0
    assert result.method == "consistent_width"


def test_wide_export_width() -> None:
    assert _detect_fixture("ahrefs-like_utf8-bom.csv").width == 23
    assert _detect_fixture("semrush-like_quoted.csv").width == 19


def test_preamble_lowers_agreement_not_answer() -> None:
    result = _detect_fixture("edge_preamble_header.csv")
    assert result.delimiter == ","
    assert result.width == 3
    assert 0.5 < result.agreement < 1.0


def test_ragged_rows_do_not_change_answer() -> None:
    result = _detect_fixture("edge_messy.csv")
    assert result.delimiter == ","
    assert result.width == 3
    assert result.agreement < 1.0


def test_empty_file_defaults_to_comma() -> None:
    path = FIXTURE_DIR / "edge_empty.csv"
    text, complete = read_text_sample(path, detect_file_encoding(path))
    result = detect_delimiter(text, is_complete=complete)
    assert (result.delimiter, result.method) == (",", "default")


def test_single_column_defaults_to_comma() -> None:
    result = detect_delimiter("url\nhttps://a.com/x\nhttps://b.com/y\n")
    assert (result.delimiter, result.width, result.method) == (",", 0, "default")


@pytest.mark.parametrize("delimiter", list(CANDIDATES))
def test_each_candidate_is_found(delimiter: str) -> None:
    rows = ["url", "title", "date"]
    text = "\n".join(
        delimiter.join(r) for r in [rows] + [[f"https://x.com/{i}", f"T{i}", "d"] for i in range(5)]
    )
    assert detect_delimiter(text + "\n").delimiter == delimiter


def test_tab_wins_over_commas_in_text() -> None:
    lines = ["url\ttitle\tnote"] + [f"https://x.com/{i}\tHello, world, again\tn" for i in range(6)]
    assert detect_delimiter("\n".join(lines) + "\n").delimiter == "\t"


def test_delimiter_inside_quotes_is_ignored() -> None:
    lines = ["url;title;note"] + [f'https://x.com/{i};"a;b;c;d";n' for i in range(6)]
    result = detect_delimiter("\n".join(lines) + "\n")
    assert (result.delimiter, result.width) == (";", 3)


def test_stray_semicolon_in_url_does_not_beat_comma() -> None:
    text = "url,title\n" + "https://x.com/p;1,T\n" * 5
    assert detect_delimiter(text).delimiter == ","


def test_unbalanced_quote_does_not_raise() -> None:
    result = detect_delimiter('url,title\n"https://x.com,T\nmore,text\n')
    assert result.delimiter in CANDIDATES


def test_oversized_field_does_not_raise() -> None:
    result = detect_delimiter('a,"' + "x" * 300_000 + '"\n')
    assert result.delimiter in CANDIDATES


def test_read_text_sample_cut_mid_character(tmp_path: Path) -> None:
    path = tmp_path / "cut.csv"
    path.write_bytes(("é" * 50).encode("utf-8"))
    enc = CsvEncoding("utf-8", False, "utf8")
    text, complete = read_text_sample(path, enc, sample_bytes=5)
    assert complete is False
    assert text == "éé"  # 5 bytes = 2 full characters, the half character is held back


def test_read_text_sample_bad_bytes_are_replaced(tmp_path: Path) -> None:
    path = tmp_path / "bad.csv"
    path.write_bytes(b"a,b\n\xff\xfe,x\n")
    enc = CsvEncoding("utf-8", False, "utf8")
    text, complete = read_text_sample(path, enc)
    assert complete is True
    assert "\ufffd" in text


@settings(max_examples=300, deadline=None)
@given(st.text(max_size=400), st.booleans())
def test_arbitrary_text_never_raises(text: str, complete: bool) -> None:
    result = detect_delimiter(text, is_complete=complete)
    assert result.delimiter in CANDIDATES
    assert 0.0 <= result.agreement <= 1.0
