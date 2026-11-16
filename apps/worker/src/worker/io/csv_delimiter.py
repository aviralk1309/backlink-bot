"""M4-S3: delimiter detection for uploaded CSV files.

Rule: for each candidate delimiter, parse the sample with csv.reader (quote
aware) and count how many records share the most common field count. Records
with fewer than 2 fields carry no signal and are ignored. The candidate with
the most agreeing records wins. Ties go to the earlier candidate in
CANDIDATES. No winner means the default comma.

Why not csv.Sniffer: it guesses from character statistics and fails on messy
exports. Consistent field count across records is the real signal.

Limits (documented, not hidden):
  * A single-column file has no delimiter. The default comma is returned and
    the method says so.
  * A preamble before the header lowers ``agreement`` but not the answer,
    because preamble lines have no delimiter.
"""

from __future__ import annotations

import codecs
import csv
import io
from collections import Counter
from dataclasses import dataclass
from itertools import islice
from pathlib import Path
from typing import Literal

from worker.io.csv_encoding import SAMPLE_BYTES, CsvEncoding

CANDIDATES: tuple[str, ...] = (",", "\t", ";", "|")
DEFAULT_DELIMITER = ","
MAX_SAMPLE_RECORDS = 1000

DelimiterMethod = Literal["consistent_width", "default"]


@dataclass(frozen=True, slots=True)
class DelimiterResult:
    delimiter: str
    # Most common field count at the winning delimiter. 0 when defaulted.
    width: int
    # Share of non-blank sample records at that width, 0.0 to 1.0.
    agreement: float
    method: DelimiterMethod


_DEFAULT = DelimiterResult(DEFAULT_DELIMITER, 0, 0.0, "default")


def read_text_sample(
    path: Path, encoding: CsvEncoding, *, sample_bytes: int = SAMPLE_BYTES
) -> tuple[str, bool]:
    """Decode the first ``sample_bytes`` of a file. Returns (text, is_complete).

    Bad bytes become U+FFFD instead of raising. A multi-byte character cut at
    the end of the sample is held back, not an error.
    """
    with path.open("rb") as fh:
        raw = fh.read(sample_bytes)
    is_complete = len(raw) < sample_bytes
    decoder = codecs.getincrementaldecoder(encoding.codec)(errors="replace")
    return decoder.decode(raw, final=is_complete), is_complete


def _field_counts(text: str, delimiter: str, *, is_complete: bool) -> list[int]:
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    counts: list[int] = []
    try:
        for row in islice(reader, MAX_SAMPLE_RECORDS):
            counts.append(len(row))
    except csv.Error:
        # Wrong delimiter can produce an oversized or broken quoted field.
        # Keep the records read so far. Fewer records means a lower score.
        pass
    if not is_complete and counts:
        counts.pop()  # the sample may end in the middle of a record
    return counts


def detect_delimiter(text: str, *, is_complete: bool = True) -> DelimiterResult:
    """Pick the delimiter for a decoded text sample.

    ``is_complete`` is False when the sample is only the start of the file.
    Then the last record is dropped because it may be cut off.
    """
    best: DelimiterResult | None = None
    best_key = (0, 0)

    for delimiter in CANDIDATES:
        counts = _field_counts(text, delimiter, is_complete=is_complete)
        non_blank = sum(1 for c in counts if c > 0)
        wide = Counter(c for c in counts if c >= 2)
        if not wide:
            continue
        # Most common width. Tie: the wider one.
        width, hits = max(wide.items(), key=lambda kv: (kv[1], kv[0]))
        key = (hits, width)
        if key > best_key:
            best_key = key
            best = DelimiterResult(delimiter, width, hits / non_blank, "consistent_width")

    return best if best is not None else _DEFAULT
