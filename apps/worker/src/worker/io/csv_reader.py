"""M4-S3: streaming CSV reader.

iter_csv_rows() yields one CsvRow at a time, so memory stays flat on a
500,000-row file. It never validates URLs. That is M4-S5.

Row numbering (matches the csv_rows primary key):
  * row_no is the 1-based DATA record number. The header and any preamble
    are not counted. Blank lines ARE counted, as blank rows, so that
    total = valid + invalid + empty holds.
  * line is the 1-based physical line where the record starts. A quoted cell
    with a line break makes line differ from row_no + header_line.

Limits (documented, not hidden):
  * Python's csv module cannot recover after a broken quote. A field over
    csv.field_size_limit (131072 characters) raises CsvReadError
    ("malformed_csv"). Rows before it were already yielded. The caller must
    fail the upload with a visible reason.
  * Bad bytes are replaced by U+FFFD and flagged, never raised.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from worker.io.csv_format import CsvFormat

ReadErrorCode = Literal["empty_file", "no_header", "malformed_csv"]

_REPLACEMENT = "\ufffd"


class CsvReadError(Exception):
    def __init__(self, code: ReadErrorCode, message: str, *, line: int | None = None) -> None:
        super().__init__(message)
        self.code: ReadErrorCode = code
        self.line = line


@dataclass(frozen=True, slots=True)
class CsvRow:
    row_no: int
    line: int
    cells: tuple[str, ...]
    has_decode_errors: bool

    @property
    def is_blank(self) -> bool:
        return not any(cell.strip() for cell in self.cells)


def iter_csv_rows(
    path: Path, fmt: CsvFormat, *, header_line: int | None = None
) -> Iterator[CsvRow]:
    """Stream the data rows of a file, header and preamble excluded.

    ``header_line`` overrides the detected header (1-based physical line), for
    the mapping screen. File problems that stop all reading are raised here,
    at call time, not on the first row.
    """
    line = header_line if header_line is not None else fmt.header.header_line
    if line is None:
        if fmt.encoding.method == "empty":
            raise CsvReadError("empty_file", "file has no content")
        raise CsvReadError("no_header", "no header row found")
    return _stream(path, fmt.encoding.codec, fmt.delimiter.delimiter, line)


def _stream(path: Path, codec: str, delimiter: str, header_line: int) -> Iterator[CsvRow]:
    with (
        path.open("rb") as raw,
        io.TextIOWrapper(raw, encoding=codec, errors="replace", newline="") as text,
    ):
        reader = csv.reader(text, delimiter=delimiter)
        previous_end = 0
        row_no = 0
        try:
            for cells in reader:
                start = previous_end + 1
                previous_end = reader.line_num
                if start <= header_line:
                    continue  # preamble and the header itself
                row_no += 1
                yield CsvRow(
                    row_no,
                    start,
                    tuple(cells),
                    any(_REPLACEMENT in cell for cell in cells),
                )
        except csv.Error as exc:
            raise CsvReadError(
                "malformed_csv",
                f"unreadable CSV near line {previous_end + 1}: {exc}",
                line=previous_end + 1,
            ) from exc
