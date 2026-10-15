import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvUploadForm } from "./csv-upload-form";
import { DiscardUploadButton } from "./discard-upload-button";
import { listCsvUploads } from "./queries";
import { formatBytes } from "./rules";
import { CSV_STATUS_LABEL } from "./types";

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
  const canChange = canUpload && isDraft;

  return (
    <div className="grid gap-8">
      <section aria-labelledby="csv-files-heading" className="grid gap-3">
        <h2 id="csv-files-heading" className="text-base font-semibold">
          Files
        </h2>
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
                {uploads.map((u) => (
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
                      <div>{CSV_STATUS_LABEL[u.status]}</div>
                      {u.status_reason && (
                        <div className="text-muted-foreground text-xs">
                          {u.status_reason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {u.total_rows > 0 ? u.total_rows.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canChange &&
                        u.status !== "discarded" &&
                        u.status !== "processing" && (
                          <DiscardUploadButton
                            jobId={jobId}
                            uploadId={u.id}
                            filename={u.filename}
                          />
                        )}
                    </TableCell>
                  </TableRow>
                ))}
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
