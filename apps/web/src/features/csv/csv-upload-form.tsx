"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { registerCsvUploadAction } from "./actions";
import {
  ACCEPTED_EXTENSIONS,
  CSV_BUCKET,
  CSV_CONTENT_TYPE,
  MAX_CSV_BYTES,
} from "./limits";
import {
  checkCsvFile,
  csvStoragePath,
  formatBytes,
  normalizeCompetitorLabel,
} from "./rules";
import type { CsvUploadKind } from "./types";

/**
 * Two steps. 1) The browser uploads straight to Storage with the user's own
 * session, so big files never pass through a server action. 2) The server
 * action confirms the file and records it.
 */
export function CsvUploadForm({ jobId }: { jobId: string }) {
  const [kind, setKind] = useState<CsvUploadKind>("competitor");
  const [competitor, setCompetitor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const working = busy || pending;

  function reset() {
    setCompetitor("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a file first.");
    const fileProblem = checkCsvFile(file);
    if (fileProblem) return setError(fileProblem);

    let label = "";
    if (kind === "competitor") {
      const normalized = normalizeCompetitorLabel(competitor);
      if (!normalized) {
        return setError("Enter the competitor's website, like example.com.");
      }
      label = normalized;
    }

    const uploadId = crypto.randomUUID();
    setBusy(true);
    startTransition(async () => {
      try {
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from(CSV_BUCKET)
          .upload(csvStoragePath(jobId, uploadId), file, {
            contentType: CSV_CONTENT_TYPE,
            upsert: false,
          });
        if (uploadError) {
          setError(
            "The upload failed. Check your connection and that the job is still a Draft, then try again.",
          );
          return;
        }

        const data = new FormData();
        data.set("job_id", jobId);
        data.set("upload_id", uploadId);
        data.set("kind", kind);
        data.set("competitor", label);
        data.set("filename", file.name);
        const result = await registerCsvUploadAction(data);
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(result.message ?? "File uploaded.");
        reset();
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <fieldset className="grid gap-2" disabled={working}>
        <legend className="text-sm font-medium">What is this file?</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ["competitor", "A competitor's backlinks"],
              ["client", "Our client's backlinks"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
              />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      {kind === "competitor" && (
        <div className="grid gap-1.5">
          <label htmlFor="csv-competitor" className="text-sm font-medium">
            Competitor website
          </label>
          <Input
            id="csv-competitor"
            value={competitor}
            onChange={(e) => setCompetitor(e.target.value)}
            placeholder="example.com"
            autoComplete="off"
            disabled={working}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <label htmlFor="csv-file" className="text-sm font-medium">
          File
        </label>
        <Input
          id="csv-file"
          ref={fileRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          disabled={working}
          aria-describedby="csv-file-help"
        />
        <p id="csv-file-help" className="text-muted-foreground text-xs">
          {ACCEPTED_EXTENSIONS.join(", ")} up to {formatBytes(MAX_CSV_BYTES)}.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" disabled={working}>
          {working ? "Uploading…" : "Upload file"}
        </Button>
      </div>
    </form>
  );
}
