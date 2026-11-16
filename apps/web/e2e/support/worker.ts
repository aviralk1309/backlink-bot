import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);

/** Real local worker, using the worker DB role and real Storage credentials. */
export async function runIngestion(
  phase: "csv" | "job" | "review",
  jobId: string,
) {
  await exec(
    "uv",
    ["run", "python", "scripts/e2e_ingestion.py", phase, jobId],
    {
      cwd: resolve(process.cwd(), "../worker"),
      env: process.env,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
}
