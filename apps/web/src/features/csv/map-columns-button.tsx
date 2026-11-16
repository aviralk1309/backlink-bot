"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loadCsvMappingPreviewAction } from "./actions";
import type { CsvMappingPreview, CsvUploadKind } from "./types";
import { CsvMappingScreen } from "./csv-mapping-screen";

/** Fetch the sample only when this file's mapping screen is opened. */
export function MapColumnsButton({
  jobId,
  uploadId,
  kind,
  filename,
  disabled,
}: {
  jobId: string;
  uploadId: string;
  kind: CsvUploadKind;
  filename: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<CsvMappingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleDone = useCallback(() => {
    setPreview(null);
    router.refresh();
  }, [router]);

  if (preview) {
    return (
      <CsvMappingScreen
        jobId={jobId}
        uploadId={uploadId}
        kind={kind}
        filename={filename}
        sampleText={preview.sampleText}
        delimiter={preview.delimiter}
        headerLine={preview.headerLine}
        detectedHeaders={preview.detectedHeaders}
        existingMapping={preview.existingMapping}
        templates={preview.templates}
        onDone={handleDone}
      />
    );
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await loadCsvMappingPreviewAction(jobId, uploadId);
              if ("error" in result) setError(result.error);
              else setPreview(result.data);
            } catch {
              setError("Could not load the preview. Try again.");
            }
          });
        }}
      >
        {pending ? "Loading preview…" : "Map columns"}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
