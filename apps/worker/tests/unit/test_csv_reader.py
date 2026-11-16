"""M4-S3: streaming CSV reader, including the 500,000-row memory check."""

import csv
import json
import tempfile
import tracemalloc
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from worker.io import (
    CANDIDATES,
    CsvEncoding,
    CsvFormat,
    CsvHeader,
    CsvReadError,
    DelimiterResult,
    detect_csv_format,
    iter_csv_rows,
)

FIXTURE_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "csv"
MANIFEST: dict[str, dict[str, Any]] = json.loads(
    (FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8")
)["files"]
WITH_RECORDS = {n: m for n, m in MANIFEST.items() if "data_records" in m and m["header_line"]}

pytestmark = pytest.mark.unit


def _read(path: Path) -> list[Any]:
    return list(iter_csv_rows(path, detect_csv_format(path)))


def _manual_format(delimiter: str, names: tuple[str, ...], codec: str = "utf-8") -> CsvFormat:
    return CsvFormat(
        CsvEncoding(codec, False, "utf8"),
        DelimiterResult(delimiter, len(names), 1.0, "consistent_width"),
        CsvHeader(1, names, False),
    )


@pytest.mark.parametrize("name", sorted(WITH_RECORDS))
def test_fixture_record_count_matches_manifest(name: str) -> None:
    rows = _read(FIXTURE_DIR / name)
    assert len(rows) == WITH_RECORDS[name]["data_records"]
    assert [r.row_no for r in rows] == list(range(1, len(rows) + 1))
    assert not any(r.has_decode_errors for r in rows)


@pytest.mark.parametrize("name", sorted(WITH_RECORDS))
def test_fixture_rows_are_never_blank(name: str) -> None:
    assert not any(r.is_blank for r in _read(FIXTURE_DIR / name))


def test_multiline_cell_is_one_record() -> None:
    rows = _read(FIXTURE_DIR / "ahrefs-like_utf8-bom.csv")
    assert "\n" in rows[3].cells[13]  # record 4, "Left context"
    assert rows[3].line == 5
    assert rows[4].line == 7  # record 4 spans physical lines 5 and 6


def test_utf16_tab_fixture() -> None:
    rows = _read(FIXTURE_DIR / "ahrefs-like_utf16le-tab.csv")
    assert len(rows) == 30
    assert rows[0].cells[1].startswith("https://")


def test_cp1252_fixture_text() -> None:
    rows = _read(FIXTURE_DIR / "edge_semicolon_cp1252.csv")
    assert rows[0].cells[1] == "Café Müller – Übersicht €1"


def test_preamble_is_skipped_and_lines_are_physical() -> None:
    rows = _read(FIXTURE_DIR / "edge_preamble_header.csv")
    assert (rows[0].row_no, rows[0].line) == (1, 5)
    assert rows[0].cells[0] == "https://fixture-guide-07.com/p1"


def test_duplicate_headers_fixture_keeps_both_url_columns() -> None:
    rows = _read(FIXTURE_DIR / "edge_duplicate_headers.csv")
    assert rows[0].cells[0] == "https://fixture-tech-08.org/a1"
    assert rows[0].cells[1] == "https://alt.example/1"


def test_messy_fixture_counts_blank_and_ragged_rows() -> None:
    rows = _read(FIXTURE_DIR / "edge_messy.csv")
    assert len(rows) == MANIFEST["edge_messy.csv"]["data_lines"] == 29
    assert all(r.row_no == r.line - 1 for r in rows)  # header on line 1, no multi-line cells
    blank = [r.row_no for r in rows if r.is_blank]
    assert blank == [26]  # physical line 27
    assert len(rows[26].cells) == 1  # line 28, ragged: fewer fields
    assert len(rows[27].cells) == 5  # line 29, ragged: more fields


def test_headers_only_fixture_yields_nothing() -> None:
    assert _read(FIXTURE_DIR / "edge_headers_only.csv") == []


def test_empty_file_raises_at_call_time() -> None:
    path = FIXTURE_DIR / "edge_empty.csv"
    with pytest.raises(CsvReadError) as exc:
        iter_csv_rows(path, detect_csv_format(path))
    assert exc.value.code == "empty_file"


def test_whitespace_only_file_has_no_header(tmp_path: Path) -> None:
    path = tmp_path / "blank.csv"
    path.write_bytes(b"\n\n  \n")
    with pytest.raises(CsvReadError) as exc:
        iter_csv_rows(path, detect_csv_format(path))
    assert exc.value.code == "no_header"


def test_blank_lines_are_rows(tmp_path: Path) -> None:
    path = tmp_path / "gaps.csv"
    path.write_bytes(b"url,title\nhttps://a.com,T\n\nhttps://b.com,U\n")
    rows = _read(path)
    assert [(r.row_no, r.line, r.is_blank) for r in rows] == [
        (1, 2, False),
        (2, 3, True),
        (3, 4, False),
    ]


def test_header_line_override(tmp_path: Path) -> None:
    path = tmp_path / "two.csv"
    path.write_bytes(b"a,b\nurl,title\nx,y\n")
    fmt = detect_csv_format(path)
    assert len(list(iter_csv_rows(path, fmt))) == 2
    rows = list(iter_csv_rows(path, fmt, header_line=2))
    assert [r.cells for r in rows] == [("x", "y")]


@pytest.mark.parametrize("eol", [b"\r\n", b"\r", b"\n"])
def test_line_endings(tmp_path: Path, eol: bytes) -> None:
    path = tmp_path / "eol.csv"
    path.write_bytes(eol.join([b"url,title", b"https://a.com,T", b"https://b.com,U"]) + eol)
    rows = _read(path)
    assert [(r.row_no, r.line) for r in rows] == [(1, 2), (2, 3)]
    assert rows[1].cells == ("https://b.com", "U")


def test_bad_bytes_are_flagged_not_raised(tmp_path: Path) -> None:
    path = tmp_path / "bad.csv"
    path.write_bytes(b"url,title\nhttps://a.com/\xff,T\nhttps://b.com,U\n")
    rows = list(iter_csv_rows(path, _manual_format(",", ("url", "title"))))
    assert [r.has_decode_errors for r in rows] == [True, False]
    assert "\ufffd" in rows[0].cells[0]


def test_oversized_field_raises_after_good_rows(tmp_path: Path) -> None:
    path = tmp_path / "huge.csv"
    path.write_bytes(
        b'url,title\nhttps://a.com,T\nhttps://b.com,"' + b"x" * 200_000 + b'"\nhttps://c.com,U\n'
    )
    seen: list[Any] = []
    with pytest.raises(CsvReadError) as exc:
        for row in iter_csv_rows(path, detect_csv_format(path)):
            seen.append(row)
    assert exc.value.code == "malformed_csv"
    assert exc.value.line == 3
    assert len(seen) == 1


def test_early_stop_closes_the_file(tmp_path: Path) -> None:
    path = tmp_path / "many.csv"
    path.write_bytes(b"url,title\n" + b"https://a.com,T\n" * 1000)
    stream = iter_csv_rows(path, detect_csv_format(path))
    next(stream)
    stream.close()  # type: ignore[attr-defined]
    path.unlink()  # would fail on Windows if the handle leaked


_CELL = st.text(
    alphabet=st.characters(codec="utf-8", blacklist_characters="\x00"),
    max_size=12,
)


@settings(max_examples=150, deadline=None)
@given(
    st.sampled_from(CANDIDATES),
    st.integers(min_value=2, max_value=5).flatmap(
        lambda w: st.lists(st.lists(_CELL, min_size=w, max_size=w), min_size=0, max_size=8).map(
            lambda rows: (w, rows)
        )
    ),
)
def test_round_trip(delimiter: str, data: tuple[int, list[list[str]]]) -> None:
    width, rows = data
    names = tuple(f"h{i}" for i in range(width))
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "rt.csv"
        with path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh, delimiter=delimiter, lineterminator="\r\n")
            writer.writerow(names)
            writer.writerows(rows)
        got = [list(r.cells) for r in iter_csv_rows(path, _manual_format(delimiter, names))]
    assert got == rows


def test_streams_500k_rows_in_bounded_memory(tmp_path: Path) -> None:
    path = tmp_path / "big.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(["url", "title"])
        for i in range(500_000):
            writer.writerow([f"https://site{i % 50_000}.fixture-big.com/page/{i}", f"Title {i}"])

    fmt = detect_csv_format(path)
    tracemalloc.start()
    try:
        count = 0
        last_row_no = 0
        for row in iter_csv_rows(path, fmt):
            count += 1
            last_row_no = row.row_no
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert count == 500_000
    assert last_row_no == 500_000
    assert row.row_no == 500_000
    # Holding every row would need well over 100 MB. Streaming stays tiny.
    assert peak < 8 * 1024 * 1024, f"peak {peak / 1_048_576:.1f} MiB"
