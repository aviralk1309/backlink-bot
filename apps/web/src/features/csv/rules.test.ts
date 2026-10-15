import { describe, expect, it } from "vitest";
import { MAX_CSV_BYTES } from "./limits";
import {
  checkCsvFile,
  csvStoragePath,
  formatBytes,
  normalizeCompetitorLabel,
} from "./rules";

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
