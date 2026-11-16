"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GapDomainItem, GapPreviewSummary } from "./types";

export function GapPreviewPanel({
  preview,
  domains,
  confirmedCompetitorCount,
}: {
  preview: GapPreviewSummary | null;
  domains: GapDomainItem[];
  confirmedCompetitorCount: number;
}) {
  const [showAll, setShowAll] = useState(false);

  if (confirmedCompetitorCount === 0 || !preview) {
    return (
      <Card className="bg-muted/20 border-dashed">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-muted-foreground h-4 w-4" />
            <CardTitle className="text-sm font-medium">
              Pre-start Gap Preview
            </CardTitle>
          </div>
          <CardDescription>
            Confirm at least one competitor backlink export above to compute the
            domain-level gap opportunities and overlap distribution.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Calculate high overlap counts (overlap_count >= 2)
  const dist = preview.overlap_distribution ?? {};
  let multiOverlapCount = 0;
  for (const [k, count] of Object.entries(dist)) {
    const num = Number(k);
    if (num >= 2) multiOverlapCount += count;
  }

  const displayedDomains = showAll ? domains.slice(0, 30) : domains.slice(0, 8);

  return (
    <div className="grid gap-4">
      {/* Warning banner when no client file is confirmed */}
      {!preview.has_client_file && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="grid gap-1 text-sm">
              <span className="font-semibold">
                No client backlink file uploaded
              </span>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Without a confirmed client backlink export, all gap
                opportunities will enter the pipeline with link status{" "}
                <strong>unknown</strong>. Some domains may be false gaps that
                the client already has links from. Upload a client backlinks CSV
                (e.g. from Google Search Console, Ahrefs, or Semrush) to filter
                them out automatically.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="from-card to-muted/30 relative overflow-hidden bg-gradient-to-br">
          <CardHeader className="pb-2">
            <div className="text-muted-foreground flex items-center justify-between">
              <span className="text-xs font-medium tracking-wider uppercase">
                Domains in Gap
              </span>
              <Layers className="h-4 w-4" />
            </div>
            <div className="text-3xl font-bold tabular-nums">
              {preview.total_gap_domains.toLocaleString()}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-muted-foreground text-xs">
              Unique registered domains linking to competitors
            </p>
          </CardContent>
        </Card>

        <Card className="from-card to-muted/30 relative overflow-hidden bg-gradient-to-br">
          <CardHeader className="pb-2">
            <div className="text-muted-foreground flex items-center justify-between">
              <span className="text-xs font-medium tracking-wider uppercase">
                Overlap Boosts
              </span>
              <TrendingUp className="text-primary h-4 w-4" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-primary text-3xl font-bold tabular-nums">
                {multiOverlapCount.toLocaleString()}
              </span>
              <span className="text-muted-foreground text-xs">
                (
                {preview.total_gap_domains > 0
                  ? Math.round(
                      (multiOverlapCount / preview.total_gap_domains) * 100,
                    )
                  : 0}
                %)
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-muted-foreground text-xs">
              Linked by 2 or more competitors (high-priority)
            </p>
          </CardContent>
        </Card>

        <Card className="from-card to-muted/30 relative overflow-hidden bg-gradient-to-br">
          <CardHeader className="pb-2">
            <div className="text-muted-foreground flex items-center justify-between">
              <span className="text-xs font-medium tracking-wider uppercase">
                Client Link Status
              </span>
              {preview.has_client_file ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
            </div>
            <div className="pt-1">
              {preview.has_client_file ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">
                  Known partial
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-amber-500 text-amber-600 dark:text-amber-400"
                >
                  Unknown
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <p className="text-muted-foreground text-xs">
              {preview.has_client_file
                ? "Client file active; existing backlinks excluded"
                : "No client export; status tagged unknown"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Gap Opportunities Table */}
      {domains.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
            <div>
              <CardTitle className="text-base font-semibold">
                Pre-start Gap Preview
              </CardTitle>
              <CardDescription className="text-xs">
                Showing top gap domains ranked by competitor overlap count
              </CardDescription>
            </div>
            {domains.length > 8 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setShowAll(!showAll)}
              >
                {showAll
                  ? "Show less"
                  : `View top ${Math.min(domains.length, 30)}`}
              </Button>
            )}
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead className="w-32">Competitor Overlap</TableHead>
                  <TableHead>Found in Competitors</TableHead>
                  <TableHead className="w-28 text-right">Link Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedDomains.map((item) => (
                  <TableRow key={item.domain}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{item.domain}</span>
                        <a
                          href={`https://${item.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center"
                          aria-label={`Visit ${item.domain}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.overlap_count > 1 ? (
                        <Badge className="bg-primary/90 text-primary-foreground text-xs font-semibold">
                          {item.overlap_count} competitors
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          1 competitor
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.competitor_labels.map((label) => (
                          <span
                            key={label}
                            className="bg-muted text-muted-foreground inline-flex items-center rounded-md px-2 py-0.5 text-xs"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.client_link_status === "known_partial" ? (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          known partial
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                          unknown
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
