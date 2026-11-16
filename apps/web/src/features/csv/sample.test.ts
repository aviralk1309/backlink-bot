import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CSV_SAMPLE_BYTES } from "./limits";
import { decodeCsvSample, parseCsvPreview } from "./sample";

// vitest runs from apps/web
const DIR = resolve(process.cwd(), "../../fixtures/csv");
type Entry = { encoding: string; bom: boolean; url_column: string | null };
const manifest = JSON.parse(
  readFileSync(resolve(DIR, "manifest.json"), "utf8"),
) as {
  files: Record<string, Entry>;
};

// edge_empty: no bytes. edge_duplicate_headers: url_column is a label, not file text.
const SKIP = new Set(["edge_empty.csv", "edge_duplicate_headers.csv"]);
const cases = Object.entries(manifest.files).filter(([n]) => !SKIP.has(n));

describe("decodeCsvSample parity with fixtures/csv/manifest.json", () => {
  it.each(cases)("%s", (name, m) => {
    const all = readFileSync(resolve(DIR, name));
    const bytes = new Uint8Array(all.subarray(0, CSV_SAMPLE_BYTES));
    const out = decodeCsvSample(bytes, all.length > CSV_SAMPLE_BYTES);
    expect(out.encoding).toBe(m.encoding);
    expect(out.bom).toBe(m.bom);
    expect(out.text).toContain(m.url_column as string);
    expect(out.text).not.toMatch(/[\uFFFD\u0000\uFEFF]/);
  });

  it("empty input", () => {
    expect(decodeCsvSample(new Uint8Array(), false)).toEqual({
      text: "",
      encoding: "utf-8",
      bom: false,
    });
  });

  it("holds back a multibyte char cut at the end", () => {
    const bytes = new TextEncoder().encode("é"); // 2 bytes
    const out = decodeCsvSample(bytes.subarray(0, 1), true);
    expect(out.encoding).toBe("utf-8");
    expect(out.text).toBe("");
  });

  it("falls back to cp1252 for invalid UTF-8", () => {
    const out = decodeCsvSample(
      new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]),
      false,
    );
    expect(out).toEqual({ text: "Müller", encoding: "cp1252", bom: false });
  });
});

describe("parseCsvPreview", () => {
  it("handles basic comma-delimited CSV", () => {
    const csv =
      "URL,Title,DR\nhttps://example.com,Home,80\nhttps://example.com/blog,Blog,75";
    const res = parseCsvPreview(csv);
    expect(res.delimiter).toBe(",");
    expect(res.headers).toEqual(["URL", "Title", "DR"]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual(["https://example.com", "Home", "80"]);
  });

  it("handles semicolons and tab delimiters automatically", () => {
    const semi = "URL;Title;Anchor\nhttps://example.com;Home;Brand";
    expect(parseCsvPreview(semi).delimiter).toBe(";");
    expect(parseCsvPreview(semi).headers).toEqual(["URL", "Title", "Anchor"]);

    const tab = "URL\tTitle\tAnchor\nhttps://example.com\tHome\tBrand";
    expect(parseCsvPreview(tab).delimiter).toBe("\t");
    expect(parseCsvPreview(tab).headers).toEqual(["URL", "Title", "Anchor"]);
  });

  it("handles quoted delimiters, escaped quotes, and newlines inside quoted fields", () => {
    const csv =
      'URL,Description,"Anchor, Text"\nhttps://example.com,"Multi-line\ndescription with ""quotes""",Brand';
    const res = parseCsvPreview(csv);
    expect(res.headers).toEqual(["URL", "Description", "Anchor, Text"]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toEqual([
      "https://example.com",
      'Multi-line\ndescription with "quotes"',
      "Brand",
    ]);
  });

  it("skips preamble rows before headerLine matching worker findings", () => {
    const text = readFileSync(resolve(DIR, "edge_preamble_header.csv"), "utf8");
    // Preamble lines 1-3, header is line 4
    const res = parseCsvPreview(text, { headerLine: 4 });
    expect(res.headers).toEqual(["Source url", "Source title", "Anchor"]);
    expect(res.headerLine).toBe(4);
    expect(res.rows.length).toBe(8);
    expect(res.rows[0]).toEqual([
      "https://fixture-guide-07.com/p1",
      "Title 1",
      "anchor 1",
    ]);
  });

  it("auto-skips preamble with single-cell title when subsequent rows have multiple cells", () => {
    const text = readFileSync(resolve(DIR, "edge_preamble_header.csv"), "utf8");
    const res = parseCsvPreview(text);
    expect(res.headers).toEqual(["Source url", "Source title", "Anchor"]);
    expect(res.rows[0][0]).toContain("https://fixture-guide-07.com");
  });

  it("assigns Column N for empty headers", () => {
    const csv = "URL,,Anchor\nhttps://example.com,data,link";
    const res = parseCsvPreview(csv);
    expect(res.headers).toEqual(["URL", "Column 2", "Anchor"]);
  });

  it("handles empty input safely", () => {
    const res = parseCsvPreview("");
    expect(res.headers).toEqual([]);
    expect(res.rows).toEqual([]);
  });
});
