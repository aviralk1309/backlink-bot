"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricRow, ThroughputRow } from "./queries";

export function ReportCharts({
  sources,
  throughput,
}: {
  sources: MetricRow[];
  throughput: ThroughputRow[];
}) {
  const sourceData = sources
    .filter((row) => row.decided_count > 0)
    .map((row) => ({
      name: row.dimension_key?.replaceAll("_", " ") ?? "Unknown",
      rate: Math.round((row.approval_rate ?? 0) * 100),
    }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="bg-card rounded-xl border p-4">
        <h3 className="mb-3 font-medium">Approval rate by source</h3>
        {sourceData.length ? (
          <div aria-hidden="true" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceData} margin={{ left: -20, right: 12 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tickFormatter={(n) => `${n}%`} />
                <Tooltip formatter={(n) => `${n}%`} />
                <Bar
                  dataKey="rate"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No decided results yet.
          </p>
        )}
      </section>
      <section className="bg-card rounded-xl border p-4">
        <h3 className="mb-3 font-medium">Daily review decisions</h3>
        {throughput.length ? (
          <div aria-hidden="true" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={throughput} margin={{ left: -20, right: 12 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line
                  dataKey="decided_count"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No decisions in this period.
          </p>
        )}
      </section>
    </div>
  );
}
