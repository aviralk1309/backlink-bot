"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { confirmCsvUploadAction, discardCsvUploadAction } from "./actions";
import { ERROR_CODE_LABEL } from "./types";
import type {
  CsvErrorCount,
  CsvErrorSample,
  CsvUploadKind,
  CsvUploadStatus,
} from "./types";

export function CsvSummaryModal({
  jobId,
  uploadId,
  filename,
  kind,
  competitorLabel,
  status,
  totalRows,
  validRows,
  invalidRows,
  emptyRows,
  duplicateRows,
  confirmedAt,
  canChange,
  errorsByReason,
  sampleErrors,
  triggerLabel,
}: {
  jobId: string;
  uploadId: string;
  filename: string;
  kind: CsvUploadKind;
  competitorLabel?: string | null;
  status: CsvUploadStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  emptyRows: number;
  duplicateRows: number;
  confirmedAt?: string | null;
  canChange: boolean;
  errorsByReason: CsvErrorCount[];
  sampleErrors: CsvErrorSample[];
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pendingConfirm, startConfirm] = useTransition();
  const [pendingDiscard, startDiscard] = useTransition();

  const isReady = status === "ready";
  const isConfirmed = status === "confirmed";
  const hasUsableRows = validRows > duplicateRows;
  const hasErrors = invalidRows > 0 || emptyRows > 0;
  const countsAddUp = totalRows === validRows + invalidRows + emptyRows;

  function handleConfirm() {
    startConfirm(async () => {
      const data = new FormData();
      data.set("job_id", jobId);
      data.set("upload_id", uploadId);
      const res = await confirmCsvUploadAction(data);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(res.message ?? "Import confirmed.");
        setOpen(false);
      }
    });
  }

  function handleDiscard() {
    if (
      !window.confirm(
        `Discard ${filename}? Its rows will no longer count toward the gap.`,
      )
    ) {
      return;
    }
    startDiscard(async () => {
      const data = new FormData();
      data.set("job_id", jobId);
      data.set("upload_id", uploadId);
      const res = await discardCsvUploadAction(data);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(res.message ?? "File discarded.");
        setOpen(false);
      }
    });
  }

  const defaultButtonLabel = isReady
    ? "Review summary"
    : isConfirmed
      ? "View summary"
      : "Summary";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={isReady ? "default" : "outline"}
            size="sm"
          >
            {triggerLabel ?? defaultButtonLabel}
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="text-muted-foreground h-5 w-5" />
            <DialogTitle className="truncate text-lg font-semibold">
              {filename}
            </DialogTitle>
            <Badge variant={isConfirmed ? "default" : "secondary"}>
              {kind === "competitor"
                ? `Competitor (${competitorLabel ?? "unlabeled"})`
                : "Client"}
            </Badge>
          </div>
          <DialogDescription className="text-xs">
            {isConfirmed && confirmedAt
              ? `Confirmed on ${new Date(confirmedAt).toLocaleString()}`
              : isReady
                ? hasUsableRows
                  ? "Validation complete. Review the summary and confirm to include in gap analysis."
                  : "This file has no usable rows. Review the errors and upload a corrected file."
                : "Import summary details"}
          </DialogDescription>
        </DialogHeader>

        {/* Counts summary grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="bg-muted/40 rounded-lg border p-3">
            <div className="text-muted-foreground text-xs font-medium">
              Total Rows
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {totalRows.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg border bg-emerald-500/10 p-3 dark:bg-emerald-950/30">
            <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Valid Rows
            </div>
            <div className="mt-1 text-2xl font-bold text-emerald-800 tabular-nums dark:text-emerald-300">
              {validRows.toLocaleString()}
            </div>
            {duplicateRows > 0 && (
              <div className="mt-1 text-[11px] text-emerald-600/80 dark:text-emerald-400/80">
                {duplicateRows.toLocaleString()} internal duplicate
                {duplicateRows === 1 ? "" : "s"}
              </div>
            )}
          </div>
          <div className="rounded-lg border bg-amber-500/10 p-3 dark:bg-amber-950/30">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Invalid Rows
            </div>
            <div className="mt-1 text-2xl font-bold text-amber-800 tabular-nums dark:text-amber-300">
              {invalidRows.toLocaleString()}
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg border p-3">
            <div className="text-muted-foreground text-xs font-medium">
              Empty Rows
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {emptyRows.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Reassurance validation note */}
        {countsAddUp ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              All rows accounted for: {totalRows.toLocaleString()} total ={" "}
              {validRows.toLocaleString()} valid +{" "}
              {invalidRows.toLocaleString()} invalid +{" "}
              {emptyRows.toLocaleString()} empty
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Counts reconciliation in progress</span>
          </div>
        )}

        {/* Invalid reason breakdown */}
        {errorsByReason.length > 0 && (
          <div className="grid gap-2">
            <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Issues by reason
            </h4>
            <div className="divide-y rounded-md border text-xs">
              {errorsByReason.map((eb) => (
                <div
                  key={eb.error_code}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-foreground font-medium">
                    {ERROR_CODE_LABEL[eb.error_code] ?? eb.error_code}
                  </span>
                  <Badge variant="outline" className="tabular-nums">
                    {eb.count.toLocaleString()}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasErrors && sampleErrors.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Per-row errors are unavailable after import. The saved error report
            may still be downloaded below.
          </p>
        )}
        {hasErrors && sampleErrors.length === 0 && (
          <a
            href={`/api/jobs/${jobId}/uploads/${uploadId}/errors`}
            download
            className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            Download full error CSV
          </a>
        )}

        {/* Sample errors table */}
        {sampleErrors.length > 0 && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Sample errors (first {sampleErrors.length})
              </h4>
              <a
                href={`/api/jobs/${jobId}/uploads/${uploadId}/errors`}
                download
                className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download full error CSV
              </a>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead>URL in file</TableHead>
                    <TableHead className="w-36">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sampleErrors.map((err) => (
                    <TableRow key={err.row_no}>
                      <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                        {err.row_no}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate font-mono text-xs">
                        {err.raw_url || (
                          <span className="text-muted-foreground italic">
                            (empty)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-amber-700 dark:text-amber-400">
                        {ERROR_CODE_LABEL[err.error_code ?? ""] ??
                          err.error_code ??
                          "Invalid"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Download error CSV when has errors but no sample rows shown */}
        {hasErrors && sampleErrors.length === 0 && (
          <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
              <Info className="h-4 w-4 shrink-0" />
              <span>Some rows could not be validated.</span>
            </div>
            <a
              href={`/api/jobs/${jobId}/uploads/${uploadId}/errors`}
              download
              className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              <Download className="h-3.5 w-3.5" />
              Download error CSV
            </a>
          </div>
        )}

        <DialogFooter className="flex flex-row items-center justify-between gap-2 border-t pt-2 sm:justify-between">
          <div>
            {canChange && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pendingConfirm || pendingDiscard}
                onClick={handleDiscard}
                className="text-destructive hover:text-destructive"
              >
                {pendingDiscard ? "Discarding…" : "Discard file"}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            {canChange && isReady && hasUsableRows && (
              <Button
                type="button"
                size="sm"
                disabled={pendingConfirm || pendingDiscard}
                onClick={handleConfirm}
              >
                {pendingConfirm ? "Confirming…" : "Confirm import"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
