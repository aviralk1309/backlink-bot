import { describe, expect, it } from "vitest";
import {
  csvCell,
  exportChunks,
  exportLine,
  parseExportForm,
  type ExportRow,
} from "./export";

const row = (id: string): ExportRow => ({
  id,
  normalized_url: "https://example.com/" + id,
  original_url: "https://example.com/" + id,
  domain: "example.com",
  score: 75,
  tier: "high",
  score_breakdown: { top_reasons: [{ text: "=unsafe" }] },
  source_types: ["google", "seed_list"],
  overlap_count: 2,
  activity_key: "guest_post",
  review_status: "approved",
  reject_reason: null,
  notes: "  +SUM(1,1)",
  external_metrics: { dr: 42, traffic: 1200, custom: "@danger" },
  created_at: "2026-10-29T00:00:00Z",
});

describe("results CSV export", () => {
  it("quotes fields and prefixes spreadsheet formulas, including whitespace prefixes", () => {
    for (const value of [
      "=1+1",
      "+1",
      "-1",
      "@SUM(1)",
      " \t=1+1",
      "＝1+1",
      "\ttext",
    ]) {
      expect(csvCell(value)).toBe(`"'${value}"`);
    }
    expect(csvCell('safe,"value"\nnext')).toBe('"safe,""value""\nnext"');
    expect(
      exportLine(row("1"), ["notes", "top_reasons", "external_metrics"]),
    ).toBe(
      `"'  +SUM(1,1)","'=unsafe","{""dr"":42,""traffic"":1200,""custom"":""@danger""}"\r\n`,
    );
  });

  it("exports the current filter or a chosen status across all queues", () => {
    const form = new FormData();
    form.set("queue", "backlog");
    form.set("tier", "high");
    form.set("status", "new");
    form.set("export_status", "approved");
    form.append("column", "normalized_url");
    form.append("column", "dr");
    expect(parseExportForm(form)).toMatchObject({
      columns: ["normalized_url", "dr"],
      params: { queue: "all", tier: null, status: "approved" },
    });
    form.set("export_status", "current");
    expect(parseExportForm(form)?.params).toMatchObject({
      queue: "backlog",
      tier: "high",
      status: "new",
    });
  });

  it("rejects invalid columns and status instead of widening an export", () => {
    const form = new FormData();
    form.set("queue", "ready");
    form.set("export_status", "current");
    form.append("column", "normalized_url");
    form.append("column", "normalized_url");
    expect(parseExportForm(form)).toBeNull();
    form.delete("column");
    form.append("column", "unknown");
    expect(parseExportForm(form)).toBeNull();
    form.delete("column");
    form.append("column", "normalized_url");
    form.set("status", "unknown");
    expect(parseExportForm(form)).toBeNull();
  });

  it("streams another page after a full batch and stops after a short batch", async () => {
    const calls: string[] = [];
    const chunks: string[] = [];
    for await (const chunk of exportChunks(
      [row("1"), row("2")],
      ["normalized_url"],
      2,
      async (after) => {
        calls.push(after);
        return [row("3")];
      },
    )) {
      chunks.push(chunk);
    }
    expect(calls).toEqual(["2"]);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toContain("https://example.com/3");
    expect(chunks.join("")).not.toContain("https://example.com/4");
  });
});
