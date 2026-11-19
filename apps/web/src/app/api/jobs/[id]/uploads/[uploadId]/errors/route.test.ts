import { afterEach, expect, it, vi } from "vitest";

const { row } = vi.hoisted(() => ({
  row: { raw_url: "", purged: false, saved: false },
}));

afterEach(() => {
  row.purged = false;
  row.saved = false;
});

vi.mock("@/lib/auth/session", () => ({
  AuthError: class AuthError extends Error {},
  requirePermission: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) =>
      table === "csv_uploads"
        ? {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      filename: "errors.csv",
                      error_report_path: row.saved ? "report.csv" : null,
                      invalid_rows: 1,
                      empty_rows: 0,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({
                    data: row.purged
                      ? []
                      : [
                          {
                            row_no: 1,
                            raw_url: row.raw_url,
                            error_code: "bad_url",
                          },
                        ],
                    error: null,
                  }),
                }),
              }),
            }),
          },
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob(["row_no,raw_url,error_reason\n1,bad,bad_url"]),
          error: null,
        }),
      }),
    },
  }),
}));
vi.mock("@/features/csv/limits", () => ({ CSV_BUCKET: "csv-uploads" }));
vi.mock(
  "@/features/results/export",
  async () => import("../../../../../../../features/results/export"),
);

import { GET } from "./route";

it.each([
  '=HYPERLINK("https://example.com","go")',
  "+SUM(1,2)",
  "-SUM(1,2)",
  "@SUM(1,2)",
  "\t=SUM(1,2)",
  "\r=SUM(1,2)",
  "  =SUM(1,2)",
])("neutralizes the fallback CSV cell %j", async (value) => {
  row.raw_url = value;
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: "job", uploadId: "upload" }),
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  const record = /^row_no,raw_url,error_reason\n1,("(?:[^"]|"")*"),/.exec(body);
  expect(record).not.toBeNull();
  const decoded = record![1].slice(1, -1).replaceAll('""', '"');
  expect(decoded).toBe(`'${value}`);
  expect(body).toContain("bad_url");
});

it("reports when staged errors and the saved report are unavailable", async () => {
  row.purged = true;
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: "job", uploadId: "upload" }),
  });
  expect(response.status).toBe(410);
  expect(await response.text()).toContain("purged after import");
});

it("downloads the saved error report after staging is purged", async () => {
  row.purged = true;
  row.saved = true;
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: "job", uploadId: "upload" }),
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(
    "row_no,raw_url,error_reason\n1,bad,bad_url",
  );
});
