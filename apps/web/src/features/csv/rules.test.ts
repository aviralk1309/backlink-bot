import { describe, expect, it } from "vitest";
import { MAX_CSV_BYTES } from "./limits";
import {
  applyMappingTemplate,
  buildDefaultMapping,
  checkCsvFile,
  competitorFilenameMismatch,
  csvStoragePath,
  formatBytes,
  guessUrlColumn,
  normalizeCompetitorLabel,
  templateHeaderScore,
  validateMapping,
} from "./rules";
import { ColumnType } from "./types";

describe("normalizeCompetitorLabel", () => {
  it.each([
    ["rival.com", "rival.com"],
    ["  Rival.COM  ", "rival.com"],
    ["https://www.rival.com/blog?x=1", "rival.com"],
    ["http://shop.rival.com", "rival.com"],
    ["blog.rival.co.uk", "rival.co.uk"],
    ["rival.com:8080/path", "rival.com"],
    ["bücher.de", "xn--bcher-kva.de"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeCompetitorLabel(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "localhost",
    "192.168.1.1",
    "not a domain",
    "https://",
    "com",
  ])("rejects %j", (input) => {
    expect(normalizeCompetitorLabel(input)).toBeNull();
  });
});

describe("csvStoragePath", () => {
  it("is <job>/<upload>.csv", () => {
    expect(csvStoragePath("j", "u")).toBe("j/u.csv");
  });
});

describe("competitorFilenameMismatch", () => {
  it("catches a backlink export attributed to another competitor", () => {
    expect(
      competitorFilenameMismatch(
        "baliyogaashram.com-backlinks-11282rows.csv",
        "baliyogaschool.com",
      ),
    ).toContain("baliyogaashram.com");
  });

  it("allows matching exports and filenames without a source domain", () => {
    expect(
      competitorFilenameMismatch("rival.co.uk-backlinks.csv", "rival.co.uk"),
    ).toBeNull();
    expect(
      competitorFilenameMismatch("ahrefs-export.csv", "rival.com"),
    ).toBeNull();
  });
});

describe("checkCsvFile", () => {
  it("accepts csv, tsv and txt, any case", () => {
    for (const name of ["a.csv", "A.CSV", "links.tsv", "export.txt"]) {
      expect(checkCsvFile({ name, size: 10 })).toBeNull();
    }
  });
  it("refuses other types", () => {
    expect(checkCsvFile({ name: "a.xlsx", size: 10 })).toMatch(/\.csv/);
    expect(checkCsvFile({ name: "a", size: 10 })).toMatch(/\.csv/);
  });
  it("refuses empty files", () => {
    expect(checkCsvFile({ name: "a.csv", size: 0 })).toMatch(/empty/);
  });
  it("allows exactly the limit and refuses one byte more", () => {
    expect(checkCsvFile({ name: "a.csv", size: MAX_CSV_BYTES })).toBeNull();
    expect(checkCsvFile({ name: "a.csv", size: MAX_CSV_BYTES + 1 })).toMatch(
      /limit/,
    );
  });
});

describe("formatBytes", () => {
  it("formats", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
  });
});

// ---------------------------------------------------------------------------
// M4-S4 mapping rules
// ---------------------------------------------------------------------------

describe("guessUrlColumn", () => {
  it("picks exact header name (case-insensitive)", () => {
    expect(guessUrlColumn(["DR", "Target URL", "Anchor"])).toBe(1);
    expect(guessUrlColumn(["Referring Page", "DR"])).toBe(0);
    expect(guessUrlColumn(["dr", "URL", "type"])).toBe(1);
  });

  it("falls back to header containing 'url'", () => {
    expect(guessUrlColumn(["DR", "Backlink URL (full)", "Anchor"])).toBe(1);
    expect(guessUrlColumn(["PageUrl", "Traffic"])).toBe(0);
  });

  it("falls back to preview row with URL-like value", () => {
    expect(
      guessUrlColumn(
        ["Column A", "Column B"],
        ["42", "https://example.com/page"],
      ),
    ).toBe(1);
  });

  it("returns -1 when nothing matches", () => {
    expect(guessUrlColumn(["DR", "Traffic", "Anchor"])).toBe(-1);
    expect(guessUrlColumn([])).toBe(-1);
  });

  it("prefers exact match over contains", () => {
    // "URL" is an exact match, "Some URL Info" merely contains "url"
    expect(guessUrlColumn(["Some URL Info", "URL"])).toBe(1);
  });
});

describe("templateHeaderScore", () => {
  it("returns 1 for a perfect match", () => {
    const score = templateHeaderScore(
      [{ source: "DR" }, { source: "Anchor" }],
      "Target URL",
      ["Target URL", "DR", "Anchor"],
    );
    expect(score).toBe(1);
  });

  it("returns a partial score", () => {
    const score = templateHeaderScore([{ source: "DR" }], "URL", [
      "URL",
      "DR",
      "Extra Column",
    ]);
    // 2 matches / max(2 template, 3 file) = 2/3
    expect(score).toBeCloseTo(2 / 3);
  });

  it("returns 0 when no headers overlap", () => {
    expect(templateHeaderScore([{ source: "A" }], "B", ["X", "Y"])).toBe(0);
  });

  it("returns 0 for empty file headers", () => {
    expect(templateHeaderScore([{ source: "A" }], "B", [])).toBe(0);
  });
});

describe("buildDefaultMapping", () => {
  it("auto-selects URL column and excludes it from columns", () => {
    const result = buildDefaultMapping(["DR", "URL", "Anchor"]);
    expect(result.urlIndex).toBe(1);
    expect(result.urlColumn).toBe("URL");
    expect(result.columns).toEqual([
      { index: 0, source: "DR", label: "DR", type: "text" },
      { index: 2, source: "Anchor", label: "Anchor", type: "text" },
    ]);
  });

  it("gives blank headers a default label", () => {
    const result = buildDefaultMapping(["URL", "", "Name"]);
    expect(result.columns[0]).toMatchObject({
      index: 1,
      label: "Column 2",
    });
  });

  it("returns urlIndex -1 when no guess", () => {
    const result = buildDefaultMapping(["A", "B"]);
    expect(result.urlIndex).toBe(-1);
    expect(result.urlColumn).toBe("");
    expect(result.columns).toHaveLength(2);
  });
});

describe("validateMapping", () => {
  const col = (index: number, label: string, type: ColumnType = "text") => ({
    index,
    label,
    type,
  });
  it("accepts a clean mapping", () => {
    expect(
      validateMapping({
        url_index: 1,
        columns: [col(0, "title"), col(2, "anchor")],
      }),
    ).toBeNull();
  });
  it("rejects url index reused as extra", () => {
    expect(validateMapping({ url_index: 1, columns: [col(1, "x")] })).toMatch(
      /once/,
    );
  });
  it("rejects duplicate index", () => {
    expect(
      validateMapping({ url_index: 0, columns: [col(1, "a"), col(1, "b")] }),
    ).toMatch(/once/);
  });
  it("rejects duplicate labels ignoring case", () => {
    expect(
      validateMapping({
        url_index: 0,
        columns: [col(1, "Title"), col(2, "title")],
      }),
    ).toMatch(/Rename/);
  });
  it("ignores labels of ignored columns", () => {
    expect(
      validateMapping({
        url_index: 0,
        columns: [col(1, "t", "ignore"), col(2, "t")],
      }),
    ).toBeNull();
  });
  it("rejects reserved label", () => {
    expect(validateMapping({ url_index: 0, columns: [col(1, "URL")] })).toMatch(
      /reserved/,
    );
  });
});

describe("applyMappingTemplate", () => {
  const sampleTemplate = {
    url_index: 0,
    url_column: "Source URL",
    columns: [
      {
        index: 1,
        source: "Domain Rating",
        label: "dr",
        type: "number" as const,
      },
      {
        index: 2,
        source: "Anchor",
        label: "anchor_text",
        type: "text" as const,
      },
      { index: 3, source: "Unneeded", label: "skip", type: "ignore" as const },
    ],
  };

  it("remaps column indexes by header name when file columns are reordered", () => {
    // Target file has Anchor at 0, Source URL at 1, Domain Rating at 2
    const targetHeaders = ["Anchor", "Source URL", "Domain Rating"];
    const result = applyMappingTemplate(sampleTemplate, targetHeaders);

    expect(result.urlIndex).toBe(1);
    expect(result.columns).toEqual([
      { index: 0, source: "Anchor", label: "anchor_text", type: "text" },
      { index: 2, source: "Domain Rating", label: "dr", type: "number" },
    ]);
  });

  it("handles new unrecognized columns gracefully", () => {
    const targetHeaders = ["Source URL", "Extra Column", "Domain Rating"];
    const result = applyMappingTemplate(sampleTemplate, targetHeaders);

    expect(result.urlIndex).toBe(0);
    expect(result.columns).toEqual([
      { index: 1, source: "Extra Column", label: "Extra Column", type: "text" },
      { index: 2, source: "Domain Rating", label: "dr", type: "number" },
    ]);
  });

  it("falls back to guessing or previous index if url_column does not match", () => {
    const targetHeaders = ["Link", "Rating"];
    const result = applyMappingTemplate(
      {
        url_index: 0,
        url_column: "Nonexistent URL",
        columns: [],
      },
      targetHeaders,
    );
    expect(result.urlIndex).toBe(0);
  });
});
