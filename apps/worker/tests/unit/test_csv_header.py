"""M4-S3: CSV header and preamble detection, plus the combined format call."""

import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from worker.io import CANDIDATES, CsvHeader, detect_csv_format, detect_header

FIXTURE_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "csv"
MANIFEST: dict[str, dict[str, Any]] = json.loads(
    (FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8")
)["files"]
NON_EMPTY = {n: m for n, m in MANIFEST.items() if m["encoding"] != "n/a"}
# The manifest url_column for this file is a description, not the literal header.
LITERAL_URL_COLUMN = {n: m for n, m in NON_EMPTY.items() if n != "edge_duplicate_headers.csv"}

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("name", sorted(NON_EMPTY))
def test_fixture_format_matches_manifest(name: str) -> None:
    meta = NON_EMPTY[name]
    fmt = detect_csv_format(FIXTURE_DIR / name)
    assert fmt.encoding.name == meta["encoding"]
    assert fmt.encoding.bom == meta["bom"]
    assert fmt.delimiter.delimiter == meta["delimiter"]
    assert fmt.header.header_line == meta["header_line"]


@pytest.mark.parametrize("name", sorted(LITERAL_URL_COLUMN))
def test_url_column_is_among_the_headers(name: str) -> None:
    fmt = detect_csv_format(FIXTURE_DIR / name)
    assert NON_EMPTY[name]["url_column"] in fmt.header.names


@pytest.mark.parametrize("name", sorted(NON_EMPTY))
def test_fixture_headers_are_not_data(name: str) -> None:
    assert detect_csv_format(FIXTURE_DIR / name).header.looks_like_data is False


def test_bom_does_not_leak_into_first_header() -> None:
    fmt = detect_csv_format(FIXTURE_DIR / "ahrefs-like_utf8-bom.csv")
    assert fmt.header.names[0] == "Referring page title"


def test_preamble_fixture() -> None:
    header = detect_csv_format(FIXTURE_DIR / "edge_preamble_header.csv").header
    assert header.header_line == 4
    assert header.preamble_lines == 3
    assert header.names == ("Source url", "Source title", "Anchor")


def test_duplicate_and_blank_headers_fixture() -> None:
    header = detect_csv_format(FIXTURE_DIR / "edge_duplicate_headers.csv").header
    assert header.names == ("URL", "URL", "Title", "", "Notes")
    assert header.duplicate_names == ("URL",)
    assert header.blank_columns == (3,)
    assert header.labels == ("URL", "URL (2)", "Title", "Column 4", "Notes")


def test_headers_only_fixture() -> None:
    header = detect_csv_format(FIXTURE_DIR / "edge_headers_only.csv").header
    assert header.names == ("url", "title")


def test_empty_fixture_has_no_header() -> None:
    fmt = detect_csv_format(FIXTURE_DIR / "edge_empty.csv")
    assert fmt.header.header_line is None
    assert fmt.header.names == ()
    assert fmt.header.preamble_lines == 0


def test_file_info_is_json_safe_and_complete() -> None:
    info = detect_csv_format(FIXTURE_DIR / "edge_semicolon_cp1252.csv").to_file_info()
    assert json.loads(json.dumps(info)) == info
    assert info["encoding"] == "cp1252"
    assert info["delimiter"] == ";"
    assert info["header_line"] == 1
    assert info["headers"] == ["URL", "Titel", "Datum"]


# ---------------------------------------------------------------------------
# Direct tests on text
# ---------------------------------------------------------------------------


def test_quoted_preamble_spanning_lines_counts_physical_lines() -> None:
    text = '"Report\nline two"\n\nurl,title\nhttps://a.com,T\n'
    header = detect_header(text, ",", width=2)
    assert header.header_line == 4
    assert header.names == ("url", "title")


def test_preamble_with_other_width_is_skipped() -> None:
    text = "Report,generated\nurl,title,note\nhttps://a.com,T,n\n"
    header = detect_header(text, ",", width=3)
    assert header.header_line == 2


def test_single_column_takes_first_non_blank_record() -> None:
    header = detect_header("\n\nurl\nhttps://a.com\n", ",", width=0)
    assert header.header_line == 3
    assert header.names == ("url",)


def test_names_are_stripped() -> None:
    assert detect_header(" url , title \nx,y\n", ",", width=2).names == ("url", "title")


def test_row_of_empty_cells_is_blank() -> None:
    header = detect_header(",,\nurl,title,note\n", ",", width=3)
    assert header.header_line == 2


@pytest.mark.parametrize(
    "first_row",
    ["https://a.com/x,T", "HTTP://a.com/x,T", "//a.com/x,T", "www.a.com,T"],
)
def test_headerless_file_is_flagged(first_row: str) -> None:
    header = detect_header(first_row + "\nhttps://b.com/y,U\n", ",", width=2)
    assert header.header_line == 1
    assert header.looks_like_data is True


def test_no_record_with_winning_width_means_no_header() -> None:
    header = detect_header("only one\nfield here\n", ",", width=3)
    assert header.header_line is None


def test_unbalanced_quote_does_not_raise() -> None:
    header = detect_header('"url,title\nmore,text\n', ",", width=2)
    assert isinstance(header, CsvHeader)


def test_labels_are_unique() -> None:
    header = CsvHeader(1, ("URL", "URL", "URL (2)", "", ""), False)
    assert len(set(header.labels)) == len(header.labels)
    assert header.labels[:2] == ("URL", "URL (2)")


@settings(max_examples=300, deadline=None)
@given(st.text(max_size=400), st.sampled_from(CANDIDATES), st.integers(min_value=0, max_value=6))
def test_arbitrary_text_never_raises(text: str, delimiter: str, width: int) -> None:
    header = detect_header(text, delimiter, width=width)
    assert len(set(header.labels)) == len(header.labels)
    if header.header_line is not None:
        assert header.header_line >= 1
