"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { discardCsvUploadAction } from "./actions";

export function DiscardUploadButton({
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
        `Discard ${filename}? Its rows will no longer count toward the gap.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const data = new FormData();
      data.set("job_id", jobId);
      data.set("upload_id", uploadId);
      const result = await discardCsvUploadAction(data);
      if (result.error) toast.error(result.error);
      else toast.success(result.message ?? "File discarded.");
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || pending}
      onClick={onClick}
      aria-label={`Discard ${filename}`}
    >
      {pending ? "Discarding…" : "Discard"}
    </Button>
  );
}
