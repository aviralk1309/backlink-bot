"""M4-S3: CSV encoding detection. Fixture truth lives in fixtures/csv/manifest.json."""

import codecs
import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from worker.io import detect_encoding, detect_file_encoding

FIXTURE_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "csv"
MANIFEST: dict[str, dict[str, Any]] = json.loads(
    (FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8")
)["files"]
DETECTABLE = {n: m for n, m in MANIFEST.items() if m["encoding"] != "n/a"}

pytestmark = pytest.mark.unit

TEXT = "url,title\nhttps://example.com/a,Hello\n" * 10


@pytest.mark.parametrize("name", sorted(DETECTABLE))
def test_fixture_encoding_matches_manifest(name: str) -> None:
    meta = DETECTABLE[name]
    found = detect_file_encoding(FIXTURE_DIR / name)
    assert found.name == meta["encoding"]
    assert found.bom == meta["bom"]


@pytest.mark.parametrize("name", sorted(DETECTABLE))
def test_fixture_decodes_without_bom_character(name: str) -> None:
    raw = (FIXTURE_DIR / name).read_bytes()
    text = raw.decode(detect_file_encoding(FIXTURE_DIR / name).codec)
    assert not text.startswith("\ufeff")
    assert text.strip()


def test_cp1252_fixture_text_is_correct() -> None:
    path = FIXTURE_DIR / "edge_semicolon_cp1252.csv"
    text = path.read_bytes().decode(detect_file_encoding(path).codec)
    assert "Café Müller – Übersicht €1" in text


def test_empty_fixture_is_handled() -> None:
    found = detect_file_encoding(FIXTURE_DIR / "edge_empty.csv")
    assert found.method == "empty"
    assert found.bom is False


def test_empty_bytes() -> None:
    assert detect_encoding(b"").method == "empty"


def test_plain_ascii_is_utf8() -> None:
    found = detect_encoding(TEXT.encode("ascii"), is_complete=True)
    assert (found.name, found.bom, found.method) == ("utf-8", False, "utf8")


@pytest.mark.parametrize(
    ("encoding", "name"),
    [("utf-16-le", "utf-16-le"), ("utf-16-be", "utf-16-be")],
)
def test_bomless_utf16(encoding: str, name: str) -> None:
    found = detect_encoding(TEXT.encode(encoding), is_complete=True)
    assert (found.name, found.bom, found.method) == (name, False, "nul_pattern")
    assert TEXT.encode(encoding).decode(found.codec) == TEXT


def test_utf32_bom_is_not_mistaken_for_utf16() -> None:
    raw = codecs.BOM_UTF32_LE + TEXT.encode("utf-32-le")
    found = detect_encoding(raw, is_complete=True)
    assert (found.name, found.bom) == ("utf-32-le", True)
    assert raw.decode(found.codec) == TEXT


def test_sample_cut_mid_character_is_still_utf8() -> None:
    raw = ("é" * 1000).encode("utf-8")[:-1]
    assert detect_encoding(raw, is_complete=False).name == "utf-8"


def test_half_character_in_complete_file_is_not_utf8() -> None:
    raw = ("é" * 1000).encode("utf-8")[:-1]
    assert detect_encoding(raw, is_complete=True).name != "utf-8"


def test_western_text_is_cp1252() -> None:
    raw = ("url;Titel\nhttps://example.com/a;Café Müller – Übersicht €\n" * 20).encode("cp1252")
    assert detect_encoding(raw, is_complete=True).name == "cp1252"


def test_undefined_cp1252_bytes_still_decode() -> None:
    raw = b"url,title\nhttps://example.com/\x81\x8d\x8f\x90\x9d\n" * 5
    found = detect_encoding(raw, is_complete=True)
    raw.decode(found.codec)  # must not raise


@settings(max_examples=300, deadline=None)
@given(st.binary(max_size=2000), st.booleans())
def test_arbitrary_bytes_never_raise(raw: bytes, complete: bool) -> None:
    found = detect_encoding(raw, is_complete=complete)
    codecs.lookup(found.codec)
