"""M4-S3: everything the reader needs to know about a file, in one call.

detect_csv_format() combines encoding, delimiter and header detection. The
result is stored on csv_uploads.file_info (see to_file_info) and is the input
to the streaming reader.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from worker.io.csv_delimiter import DelimiterResult, detect_delimiter, read_text_sample
from worker.io.csv_encoding import SAMPLE_BYTES, CsvEncoding, detect_file_encoding
from worker.io.csv_header import CsvHeader, detect_header


@dataclass(frozen=True, slots=True)
class CsvFormat:
    encoding: CsvEncoding
    delimiter: DelimiterResult
    header: CsvHeader

    def to_file_info(self) -> dict[str, Any]:
        """JSON-safe summary for csv_uploads.file_info."""
        return {
            "encoding": self.encoding.name,
            "bom": self.encoding.bom,
            "encoding_method": self.encoding.method,
            "delimiter": self.delimiter.delimiter,
            "delimiter_method": self.delimiter.method,
            "agreement": round(self.delimiter.agreement, 3),
            "header_line": self.header.header_line,
            "headers": list(self.header.names),
            "looks_like_data": self.header.looks_like_data,
        }


def detect_csv_format(path: Path, *, sample_bytes: int = SAMPLE_BYTES) -> CsvFormat:
    encoding = detect_file_encoding(path, sample_bytes=sample_bytes)
    text, is_complete = read_text_sample(path, encoding, sample_bytes=sample_bytes)
    delimiter = detect_delimiter(text, is_complete=is_complete)
    header = detect_header(text, delimiter.delimiter, width=delimiter.width)
    return CsvFormat(encoding, delimiter, header)
