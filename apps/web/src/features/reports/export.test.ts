import { expect, it } from "vitest";
import { reportCsv } from "./export";

it("exports every report table and protects labels from spreadsheet formulas", () => {
  const csv = reportCsv({
    metrics: [
      {
        dimension: "query_template",
        dimension_key: "=unsafe",
        approved_count: 1,
        used_count: 0,
        rejected_count: 1,
        undecided_count: 2,
        decided_count: 2,
        approval_rate: 0.5,
        low_sample: true,
      },
    ],
    reasons: [{ reject_reason: "spam", rejected_count: 1 }],
    throughput: [
      {
        day: "2026-10-30",
        approved_count: 1,
        rejected_count: 1,
        decided_count: 2,
      },
    ],
    delivery: [
      {
        dimension: "client",
        dimension_key: "client.com",
        submitted_count: 1,
        verified_count: 1,
        unverified_count: 0,
        unknown_count: 0,
        credits_used: 2,
        credits_per_verified: 2,
      },
    ],
  });
  expect(csv).toContain(
    '"query_template","\'=unsafe","1","0","1","2","2","0.5","true"',
  );
  expect(csv).toContain('"reject_reason","spam"');
  expect(csv).toContain('"throughput_utc_day","2026-10-30"');
  expect(csv).toContain('"delivery_client","client.com"');
});
