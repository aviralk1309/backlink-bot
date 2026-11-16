/**
 * Decodes the first bytes of an uploaded CSV for the mapping preview.
 * PREVIEW ONLY. The worker (csv_encoding.py) stays the source of truth (ADR 0008).
 * Same order as the worker: BOM, BOM-less UTF-16 by NUL pattern, strict UTF-8,
 * then cp1252. Names match fixtures/csv/manifest.json.
 *
 * Known limits: no UTF-32 and no non-Latin legacy encodings (worker uses
 * charset-normalizer for those, preview shows cp1252 text instead).
 */
export type SampleEncoding = "utf-8" | "utf-16-le" | "utf-16-be" | "cp1252";

export type DecodedSample = {
  text: string;
  encoding: SampleEncoding;
  bom: boolean;
};

const LABEL: Record<SampleEncoding, string> = {
  "utf-8": "utf-8",
  "utf-16-le": "utf-16le",
  "utf-16-be": "utf-16be",
  cp1252: "windows-1252",
};

// Same thresholds as the worker.
const NUL_HIGH = 0.3;
const NUL_LOW = 0.05;

function guessBomlessUtf16(
  bytes: Uint8Array,
): "utf-16-le" | "utf-16-be" | null {
  const n = bytes.length - (bytes.length % 2);
  if (n < 4) return null;
  const half = n / 2;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) even++;
    if (bytes[i + 1] === 0) odd++;
  }
  if (odd >= NUL_HIGH * half && even <= NUL_LOW * half) return "utf-16-le";
  if (even >= NUL_HIGH * half && odd <= NUL_LOW * half) return "utf-16-be";
  return null;
}

function strictDecode(
  bytes: Uint8Array,
  label: string,
  stream: boolean,
): string | null {
  try {
    return new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(
      bytes,
      { stream },
    );
  } catch {
    return null;
  }
}

/**
 * `truncated` is true when the bytes are only the start of the file. Then a
 * half character at the end is held back instead of counted as an error.
 */
export function decodeCsvSample(
  bytes: Uint8Array,
  truncated: boolean,
): DecodedSample {
  if (bytes.length === 0) return { text: "", encoding: "utf-8", bom: false };

  let encoding: SampleEncoding;
  let bom = false;
  let body = bytes;
  const [a, b, c] = bytes;
  if (a === 0xef && b === 0xbb && c === 0xbf) {
    encoding = "utf-8";
    bom = true;
    body = bytes.subarray(3);
  } else if (a === 0xff && b === 0xfe) {
    encoding = "utf-16-le";
    bom = true;
    body = bytes.subarray(2);
  } else if (a === 0xfe && b === 0xff) {
    encoding = "utf-16-be";
    bom = true;
    body = bytes.subarray(2);
  } else {
    encoding = guessBomlessUtf16(bytes) ?? "utf-8";
  }

  const text = strictDecode(body, LABEL[encoding], truncated);
  if (text !== null) return { text, encoding, bom };

  if (encoding === "utf-8" && !bom) {
    return {
      text: new TextDecoder("windows-1252").decode(body),
      encoding: "cp1252",
      bom: false,
    };
  }
  // Declared or guessed UTF-16 / UTF-8-with-BOM with bad bytes: keep encoding, mark bad bytes.
  return {
    text: new TextDecoder(LABEL[encoding], { ignoreBOM: true }).decode(body, {
      stream: truncated,
    }),
    encoding,
    bom,
  };
}

export type CsvPreviewOptions = {
  delimiter?: string;
  headerLine?: number | null;
  detectedHeaders?: readonly string[];
  maxRows?: number;
};

export type CsvPreviewResult = {
  headers: string[];
  rows: string[][];
  headerLine: number;
  delimiter: string;
};

/**
 * Detects delimiter by counting candidates outside quotes in the sample text.
 */
export function detectDelimiter(text: string): string {
  let inQuotes = false;
  let tabs = 0;
  let semis = 0;
  let commas = 0;
  const len = Math.min(text.length, 16384);

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (ch === "\t") tabs++;
      else if (ch === ";") semis++;
      else if (ch === ",") commas++;
    }
  }

  if (tabs > commas && tabs > semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/**
 * RFC 4180-compliant CSV parser for previewing the first rows.
 * Handles:
 *  - Quoted fields with delimiters and newlines
 *  - Escaped quotes ("")
 *  - Physical line tracking for preamble skipping (e.g. edge_preamble_header.csv)
 *  - Detected header line / detected headers from worker file_info
 */
export function parseCsvPreview(
  text: string,
  options?: CsvPreviewOptions,
): CsvPreviewResult {
  if (!text || text.trim().length === 0) {
    return { headers: [], rows: [], headerLine: 1, delimiter: "," };
  }

  const delimiter = options?.delimiter ?? detectDelimiter(text);
  const maxRows = options?.maxRows ?? 20;

  type RawRecord = { startLine: number; cells: string[] };
  const records: RawRecord[] = [];

  let inQuotes = false;
  let currentCell = "";
  let currentCells: string[] = [];
  let currentLine = 1;
  let recordStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && ch === delimiter) {
      currentCells.push(currentCell.trim());
      currentCell = "";
    } else if (!inQuotes && (ch === "\r" || ch === "\n")) {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
      }
      currentCells.push(currentCell.trim());
      currentCell = "";
      records.push({ startLine: recordStartLine, cells: currentCells });
      currentCells = [];
      currentLine++;
      recordStartLine = currentLine;
    } else {
      if (ch === "\n") {
        currentLine++;
      } else if (ch === "\r") {
        currentLine++;
        if (text[i + 1] === "\n") i++;
      }
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentCells.length > 0) {
    currentCells.push(currentCell.trim());
    records.push({ startLine: recordStartLine, cells: currentCells });
  }

  // Filter out completely blank records
  const nonEmptyRecords = records.filter((r) =>
    r.cells.some((c) => c.length > 0),
  );

  if (nonEmptyRecords.length === 0) {
    return { headers: [], rows: [], headerLine: 1, delimiter };
  }

  // Determine header record
  let headerRecordIdx = -1;

  if (options?.headerLine != null && options.headerLine > 0) {
    headerRecordIdx = nonEmptyRecords.findIndex(
      (r) => r.startLine === options.headerLine,
    );
    if (headerRecordIdx === -1) {
      headerRecordIdx = nonEmptyRecords.findIndex(
        (r) => r.startLine >= options.headerLine!,
      );
    }
  }

  if (headerRecordIdx === -1 && options?.detectedHeaders?.length) {
    const targetNorm = options.detectedHeaders.map((h) =>
      h.trim().toLowerCase(),
    );
    headerRecordIdx = nonEmptyRecords.findIndex((r) => {
      if (r.cells.length !== targetNorm.length) return false;
      const rNorm = r.cells.map((c) => c.trim().toLowerCase());
      return targetNorm.every((th, idx) => th === rNorm[idx]);
    });
  }

  if (headerRecordIdx === -1) {
    // Find most frequent width >= 2 across records
    const widthCounts = new Map<number, number>();
    for (const r of nonEmptyRecords) {
      if (r.cells.length >= 2) {
        widthCounts.set(
          r.cells.length,
          (widthCounts.get(r.cells.length) ?? 0) + 1,
        );
      }
    }

    let winningWidth = 0;
    let maxCount = 0;
    for (const [w, count] of widthCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        winningWidth = w;
      }
    }

    if (winningWidth >= 2) {
      const matchIdx = nonEmptyRecords.findIndex(
        (r) => r.cells.length === winningWidth,
      );
      headerRecordIdx = matchIdx !== -1 ? matchIdx : 0;
    } else {
      headerRecordIdx = 0;
    }
  }

  const chosenHeaderRecord = nonEmptyRecords[headerRecordIdx]!;
  const rawHeaders =
    options?.detectedHeaders?.length &&
    options.detectedHeaders.length === chosenHeaderRecord.cells.length
      ? options.detectedHeaders
      : chosenHeaderRecord.cells;

  const headers = rawHeaders.map((h, i) => h || `Column ${i + 1}`);

  const dataRecords = nonEmptyRecords.slice(
    headerRecordIdx + 1,
    headerRecordIdx + 1 + maxRows,
  );

  const rows = dataRecords.map((r) => {
    const cells = [...r.cells];
    while (cells.length < headers.length) {
      cells.push("");
    }
    return cells.slice(0, headers.length);
  });

  return {
    headers,
    rows,
    headerLine: chosenHeaderRecord.startLine,
    delimiter,
  };
}
