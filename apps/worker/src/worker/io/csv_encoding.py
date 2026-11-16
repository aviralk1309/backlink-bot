"""M4-S3: text encoding detection for uploaded CSV files.

Works on a byte sample, not the whole file, so memory stays bounded (M4-S3 done
criteria: no memory growth on a 500,000-row file).

Contract:
  * ``name`` is the encoding in manifest style ("utf-8", "utf-16-le", "cp1252").
  * ``bom`` says whether the file starts with a byte order mark.
  * ``codec`` is the Python codec to decode the whole file with. It strips the
    BOM, so the first header never starts with U+FEFF.

Limits (documented, not hidden):
  * Only the sample is inspected. Bad bytes after the sample are not seen here.
    The streaming reader must decode with errors="replace" and count them.
  * Legacy single-byte detection is a heuristic. Western European text is
    reported as cp1252 (what Excel writes). Cyrillic, Greek and so on rely on
    charset-normalizer and can be wrong on short files.
"""

from __future__ import annotations

import codecs
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import charset_normalizer

SAMPLE_BYTES = 256 * 1024

DetectionMethod = Literal[
    "empty", "bom", "nul_pattern", "utf8", "charset_normalizer", "cp1252", "fallback"
]

# Order matters: the UTF-32 LE BOM (FF FE 00 00) starts with the UTF-16 LE BOM.
_BOMS: tuple[tuple[bytes, str], ...] = (
    (codecs.BOM_UTF32_LE, "utf-32-le"),
    (codecs.BOM_UTF32_BE, "utf-32-be"),
    (codecs.BOM_UTF8, "utf-8"),
    (codecs.BOM_UTF16_LE, "utf-16-le"),
    (codecs.BOM_UTF16_BE, "utf-16-be"),
)

# Codec that consumes the BOM and picks the byte order itself.
_BOM_CODECS: dict[str, str] = {
    "utf-8": "utf-8-sig",
    "utf-16-le": "utf-16",
    "utf-16-be": "utf-16",
    "utf-32-le": "utf-32",
    "utf-32-be": "utf-32",
}

# Single-byte Western encodings that charset-normalizer confuses with each
# other. cp1252 is a superset of the printable part of latin-1, so use it.
_WESTERN = frozenset(
    {
        "cp1252",
        "cp1250",
        "cp1254",
        "cp1257",
        "cp437",
        "cp850",
        "cp852",
        "cp858",
        "iso8859-1",
        "iso8859-2",
        "iso8859-4",
        "iso8859-9",
        "iso8859-10",
        "iso8859-13",
        "iso8859-14",
        "iso8859-15",
        "iso8859-16",
        "mac-roman",
        "mac-latin2",
        "mac-turkish",
        "mac-iceland",
    }
)

# Share of NUL bytes on one byte parity that signals BOM-less UTF-16.
_NUL_HIGH = 0.30
_NUL_LOW = 0.05


@dataclass(frozen=True, slots=True)
class CsvEncoding:
    name: str
    bom: bool
    method: DetectionMethod

    @property
    def codec(self) -> str:
        """Python codec to decode the full file with (BOM stripped)."""
        return _BOM_CODECS[self.name] if self.bom else self.name


def _can_decode(sample: bytes, codec: str, *, is_complete: bool) -> bool:
    decoder = codecs.getincrementaldecoder(codec)()
    try:
        decoder.decode(sample, final=is_complete)
    except UnicodeDecodeError:
        return False
    return True


def _guess_bomless_utf16(sample: bytes) -> str | None:
    n = len(sample) - len(sample) % 2
    if n < 4:
        return None
    half = n / 2
    even_nuls = sample[0:n:2].count(0)
    odd_nuls = sample[1:n:2].count(0)
    if odd_nuls >= _NUL_HIGH * half and even_nuls <= _NUL_LOW * half:
        return "utf-16-le"
    if even_nuls >= _NUL_HIGH * half and odd_nuls <= _NUL_LOW * half:
        return "utf-16-be"
    return None


def _detect_legacy(sample: bytes, *, is_complete: bool) -> CsvEncoding:
    best = charset_normalizer.from_bytes(sample).best()
    if best is not None:
        name = codecs.lookup(best.encoding).name
        if name in _WESTERN:
            if _can_decode(sample, "cp1252", is_complete=is_complete):
                return CsvEncoding("cp1252", False, "charset_normalizer")
        elif name not in ("ascii", "utf-8") and _can_decode(sample, name, is_complete=is_complete):
            return CsvEncoding(name, False, "charset_normalizer")
    if _can_decode(sample, "cp1252", is_complete=is_complete):
        return CsvEncoding("cp1252", False, "cp1252")
    # latin-1 maps every byte, so decoding never fails.
    return CsvEncoding("latin-1", False, "fallback")


def detect_encoding(sample: bytes, *, is_complete: bool = False) -> CsvEncoding:
    """Detect the encoding of a CSV byte sample.

    ``is_complete`` is True when the sample is the whole file. Then a trailing
    half character is an error. Otherwise it is just where the sample was cut.
    """
    if not sample:
        return CsvEncoding("utf-8", False, "empty")

    for bom, name in _BOMS:
        if sample.startswith(bom):
            return CsvEncoding(name, True, "bom")

    wide = _guess_bomless_utf16(sample)
    if wide is not None and _can_decode(sample, wide, is_complete=is_complete):
        return CsvEncoding(wide, False, "nul_pattern")

    if _can_decode(sample, "utf-8", is_complete=is_complete):
        return CsvEncoding("utf-8", False, "utf8")

    return _detect_legacy(sample, is_complete=is_complete)


def detect_file_encoding(path: Path, *, sample_bytes: int = SAMPLE_BYTES) -> CsvEncoding:
    with path.open("rb") as fh:
        sample = fh.read(sample_bytes)
    return detect_encoding(sample, is_complete=len(sample) < sample_bytes)
