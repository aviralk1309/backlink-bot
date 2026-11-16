"use client";

import { useRef, useState, useTransition } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { deleteCsvUploadAction, registerCsvUploadAction } from "./actions";
import {
  ACCEPTED_EXTENSIONS,
  CSV_BUCKET,
  CSV_CONTENT_TYPE,
  MAX_CSV_BYTES,
} from "./limits";
import { checkCsvFile, csvStoragePath, formatBytes } from "./rules";
import type { CsvUploadKind } from "./types";

export function ReplaceUploadModal({
  jobId,
  uploadId,
  kind,
  competitorLabel,
  filename,
  disabled,
}: {
  jobId: string;
  uploadId: string;
  kind: CsvUploadKind;
  competitorLabel?: string | null;
  filename: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const working = busy || pending;

  function onFileChosen(f: File | undefined) {
    if (!f) return;
    setError(null);
    const problem = checkCsvFile(f);
    if (problem) {
      setError(problem);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(f);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    onFileChosen(e.dataTransfer.files?.[0]);
  }

  async function handleUpload() {
    if (!selectedFile) {
      setError("Choose a replacement file first.");
      return;
    }

    const newUploadId = crypto.randomUUID();
    setBusy(true);
    startTransition(async () => {
      try {
        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from(CSV_BUCKET)
          .upload(csvStoragePath(jobId, newUploadId), selectedFile, {
            contentType: CSV_CONTENT_TYPE,
            upsert: false,
          });
        if (uploadError) {
          setError("Upload failed. Check your connection and try again.");
          return;
        }

        const formData = new FormData();
        formData.set("job_id", jobId);
        formData.set("upload_id", newUploadId);
        formData.set("kind", kind);
        formData.set("competitor", competitorLabel ?? "");
        formData.set("filename", selectedFile.name);

        const result = await registerCsvUploadAction(formData);
        if (result.error) {
          setError(result.error);
        } else {
          const delFormData = new FormData();
          delFormData.set("job_id", jobId);
          delFormData.set("upload_id", uploadId);
          await deleteCsvUploadAction(delFormData);

          toast.success("File replaced successfully.");
          setOpen(false);
        }
      } catch (err) {
        console.error("Replace upload failed", err);
        setError("Could not replace the file. Try again.");
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground"
            title={`Replace ${filename}`}
            aria-label={`Replace ${filename}`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="sr-only">Replace</span>
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Replace File
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload a new CSV to replace <strong>{filename}</strong> (
            {kind === "competitor" ? competitorLabel : "Client Backlinks"}). The
            previous file will be discarded.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {error && (
            <div
              role="alert"
              className="bg-destructive/10 text-destructive rounded-lg p-3 text-xs font-medium"
            >
              {error}
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted hover:border-muted-foreground/50",
            )}
          >
            <Upload className="text-muted-foreground h-6 w-6" />
            <div className="text-xs">
              {selectedFile ? (
                <div className="text-foreground font-medium">
                  {selectedFile.name} ({formatBytes(selectedFile.size)})
                </div>
              ) : (
                <>
                  <span className="text-primary font-medium">
                    Click to browse
                  </span>{" "}
                  or drag and drop replacement CSV
                </>
              )}
            </div>
            <p className="text-muted-foreground text-[10px]">
              Up to {formatBytes(MAX_CSV_BYTES)} · CSV only
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(",")}
              className="sr-only"
              onChange={(e) => onFileChosen(e.target.files?.[0])}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!selectedFile || working}
              onClick={handleUpload}
            >
              {working ? "Replacing…" : "Upload & Replace"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
