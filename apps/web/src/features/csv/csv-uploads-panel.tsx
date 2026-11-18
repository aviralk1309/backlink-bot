import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvSummaryModal } from "./csv-summary-modal";
import { CsvUploadForm } from "./csv-upload-form";
import { DeleteUploadButton } from "./delete-upload-button";
import { GapPreviewPanel } from "./gap-preview-panel";
import { MapColumnsButton } from "./map-columns-button";
import {
  countPendingCsvCleanup,
  getCsvUploadSummary,
  getJobGapDomains,
  getJobGapPreview,
  listCsvUploads,
} from "./queries";
import { ReplaceUploadModal } from "./replace-upload-modal";
import { formatBytes } from "./rules";
import { CSV_STATUS_LABEL } from "./types";
import type { CsvUploadKind, CsvUploadSummary } from "./types";

/**
 * The job's "Data" tab. canUpload is a plain boolean computed on the server
 * (csv.upload). It only hides the form: storage and table RLS are the gate.
 */
export async function CsvUploadsPanel({
  jobId,
  isDraft,
  canUpload,
}: {
  jobId: string;
  isDraft: boolean;
  canUpload: boolean;
}) {
  const uploads = await listCsvUploads(jobId);
  const pendingCleanup = canUpload ? await countPendingCsvCleanup(jobId) : 0;
  const canChange = canUpload && isDraft;

  // Fetch summaries for ready / confirmed uploads (M4-S5)
  const reviewableUploads = uploads.filter(
    (u) => u.status === "ready" || u.status === "confirmed",
  );
  const summaryData = new Map<string, CsvUploadSummary | null>();
  await Promise.all(
    reviewableUploads.map(async (u) => {
      const summary = await getCsvUploadSummary(jobId, u.id);
      summaryData.set(u.id, summary);
    }),
  );

  // Pre-start gap preview (M4-S8)
  const confirmedCompetitors = uploads.filter(
    (u) => u.kind === "competitor" && u.status === "confirmed",
  );
  const [gapPreview, gapDomains] =
    confirmedCompetitors.length > 0
      ? await Promise.all([getJobGapPreview(jobId), getJobGapDomains(jobId)])
      : [null, []];

  return (
    <div className="grid gap-8">
      {/* Pre-start Gap Preview (M4-S8) */}
      <section aria-labelledby="gap-preview-heading">
        <h2 id="gap-preview-heading" className="sr-only">
          Gap Preview
        </h2>
        <GapPreviewPanel
          preview={gapPreview}
          domains={gapDomains}
          confirmedCompetitorCount={confirmedCompetitors.length}
        />
      </section>

      <section aria-labelledby="csv-files-heading" className="grid gap-3">
        {pendingCleanup > 0 && (
          <Notice tone="info">
            Storage cleanup pending. Reload to check progress.
          </Notice>
        )}
        <div className="flex items-center justify-between">
          <h2 id="csv-files-heading" className="text-base font-semibold">
            Uploaded Files
          </h2>
          <span className="text-muted-foreground text-xs">
            {uploads.length} {uploads.length === 1 ? "file" : "files"}
          </span>
        </div>
        {uploads.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No files yet.
            {canChange ? " Upload one below." : ""}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploads.map((u) => {
                  const canMap =
                    canChange &&
                    (u.status === "uploaded" || u.status === "mapped");
                  const summary = summaryData.get(u.id);

                  return (
                    <TableRow
                      key={u.id}
                      className={u.status === "discarded" ? "opacity-60" : ""}
                    >
                      <TableCell>
                        <div className="font-medium">{u.filename}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatBytes(u.size_bytes)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.kind === "competitor"
                          ? (u.competitor_label ?? "Competitor")
                          : "Client"}
                      </TableCell>
                      <TableCell>
                        {u.status === "processing" ? (
                          <div className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Reading file…</span>
                          </div>
                        ) : u.status === "ready" ? (
                          <Badge variant="secondary">
                            {u.valid_rows > u.duplicate_rows
                              ? "Ready to confirm"
                              : "No usable rows"}
                          </Badge>
                        ) : u.status === "confirmed" ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">
                            Confirmed
                          </Badge>
                        ) : u.status === "failed" ? (
                          <Badge variant="destructive">Failed</Badge>
                        ) : (
                          <div>{CSV_STATUS_LABEL[u.status]}</div>
                        )}
                        {u.status_reason && (
                          <div className="text-muted-foreground mt-0.5 text-xs">
                            {u.status_reason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.total_rows > 0 ? (
                          <div>
                            <div>{u.total_rows.toLocaleString()}</div>
                            {u.valid_rows > 0 && (
                              <div className="text-muted-foreground text-xs">
                                {u.valid_rows.toLocaleString()} valid
                              </div>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canMap && (
                            <MapColumnsButton
                              jobId={jobId}
                              uploadId={u.id}
                              kind={u.kind as CsvUploadKind}
                              filename={u.filename}
                            />
                          )}
                          {(u.status === "ready" ||
                            u.status === "confirmed") && (
                            <CsvSummaryModal
                              jobId={jobId}
                              uploadId={u.id}
                              filename={u.filename}
                              kind={u.kind as CsvUploadKind}
                              competitorLabel={u.competitor_label}
                              status={u.status}
                              totalRows={u.total_rows}
                              validRows={u.valid_rows}
                              invalidRows={u.invalid_rows}
                              emptyRows={u.empty_rows}
                              duplicateRows={u.duplicate_rows}
                              confirmedAt={u.confirmed_at}
                              canChange={canChange}
                              errorsByReason={summary?.errorsByReason ?? []}
                              sampleErrors={summary?.sampleErrors ?? []}
                            />
                          )}
                          {canChange && u.status !== "processing" && (
                            <>
                              <ReplaceUploadModal
                                jobId={jobId}
                                uploadId={u.id}
                                kind={u.kind as CsvUploadKind}
                                competitorLabel={u.competitor_label}
                                filename={u.filename}
                              />
                              <DeleteUploadButton
                                jobId={jobId}
                                uploadId={u.id}
                                filename={u.filename}
                              />
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {canChange ? (
        <section aria-labelledby="csv-upload-heading" className="grid gap-3">
          <h2 id="csv-upload-heading" className="text-base font-semibold">
            Upload a file
          </h2>
          <CsvUploadForm jobId={jobId} />
        </section>
      ) : (
        canUpload && (
          <p className="text-muted-foreground text-sm">
            Files can only be added or discarded while the job is a Draft.
          </p>
        )
      )}
    </div>
  );
}
