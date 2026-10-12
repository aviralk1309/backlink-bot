/** One row of the blocklist, with the names the page shows. */
export type BlocklistEntry = {
  id: string;
  domain: string;
  reason: string | null;
  /** Null when nobody is recorded, or the viewer may not read that profile. */
  added_by_name: string | null;
  source_job_id: string | null;
  /** Null when the job is gone or the viewer lacks jobs.view. */
  source_job_name: string | null;
  created_at: string;
};
