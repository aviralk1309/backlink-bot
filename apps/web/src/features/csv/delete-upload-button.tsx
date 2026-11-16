"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteCsvUploadAction } from "./actions";

export function DeleteUploadButton({
  jobId,
  uploadId,
  filename,
  disabled,
}: {
  jobId: string;
  uploadId: string;
  filename: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !window.confirm(
        `Delete ${filename}? This removes the file and its staged rows completely.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const data = new FormData();
      data.set("job_id", jobId);
      data.set("upload_id", uploadId);
      const result = await deleteCsvUploadAction(data);
      if (result.error) toast.error(result.error);
      else toast.success(result.message ?? "File deleted.");
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      disabled={disabled || pending}
      onClick={onClick}
      aria-label={`Delete ${filename}`}
      title={`Delete ${filename}`}
    >
      <Trash2 className="h-3.5 w-3.5" />
      <span className="sr-only">Delete</span>
    </Button>
  );
}
