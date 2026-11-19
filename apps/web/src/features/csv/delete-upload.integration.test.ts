import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  caller: null as unknown,
  admin: null as unknown,
  failRemoval: false,
  userId: "",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  AuthError: class AuthError extends Error {},
  requirePermission: vi
    .fn()
    .mockImplementation(async () => ({ userId: state.userId })),
}));
vi.mock("@/lib/auth/schemas", () => ({ firstIssue: () => "invalid" }));
vi.mock("@/lib/db-errors", () => ({
  describeDbError: (message: string) => message,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.caller,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const admin = state.admin as ReturnType<typeof createSupabaseClient>;
    return {
      from: admin.from.bind(admin),
      storage: {
        from: (bucket: string) => {
          const real = admin.storage.from(bucket);
          return {
            remove: (paths: string[]) =>
              state.failRemoval
                ? Promise.resolve({
                    data: null,
                    error: new Error("forced Storage failure"),
                  })
                : real.remove(paths),
          };
        },
      },
    };
  },
}));
vi.mock("./queries", () => ({}));

import { deleteCsvUploadAction } from "./actions";

const integration = process.env.RUN_LOCAL_STORAGE_TESTS === "1" ? it : it.skip;

integration(
  "AR-02 removes immediately, then retries a forced Storage failure",
  async () => {
    const root = resolve(process.cwd(), "../..");
    const status = Object.fromEntries(
      execFileSync(
        "supabase",
        [
          "--workdir",
          process.env.TEST_SUPABASE_WORKDIR ?? root,
          "status",
          "--output",
          "env",
        ],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [
            line.slice(0, index),
            line.slice(index + 1).replace(/^"|"$/g, ""),
          ];
        }),
    );
    const admin = createSupabaseClient(
      status.API_URL,
      status.SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    state.admin = admin;
    const jobId = randomUUID();
    const uploadIds = [randomUUID(), randomUUID()];
    const paths = uploadIds.map((id) => `${jobId}/${id}.csv`);
    let userId = "";

    try {
      const { data: created, error: userError } =
        await admin.auth.admin.createUser({
          email: `ar02-${randomUUID()}@test.local`,
          password: randomUUID(),
          email_confirm: true,
        });
      if (userError || !created.user)
        throw userError ?? new Error("No test user");
      userId = created.user.id;
      state.userId = userId;
      const { error: profileError } = await admin
        .from("profiles")
        .update({
          status: "active",
          role_id: "a0000000-0000-0000-0000-000000000002",
        })
        .eq("id", userId);
      if (profileError) throw profileError;
      const tokenData = [
        Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
        Buffer.from(
          JSON.stringify({
            sub: userId,
            role: "authenticated",
            aud: "authenticated",
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url"),
      ].join(".");
      const token = `${tokenData}.${createHmac("sha256", status.JWT_SECRET)
        .update(tokenData)
        .digest("base64url")}`;
      state.caller = createSupabaseClient(status.API_URL, status.ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      const { error: jobError } = await admin
        .from("jobs")
        .insert({ id: jobId, name: "AR-02 cleanup" });
      if (jobError) throw jobError;
      for (let index = 0; index < uploadIds.length; index++) {
        const payload = Buffer.from("URL\nhttps://example.com\n");
        const { error: storageError } = await admin.storage
          .from("csv-uploads")
          .upload(paths[index], payload, { contentType: "text/csv" });
        if (storageError) throw storageError;
        const { error: uploadError } = await admin.from("csv_uploads").insert({
          id: uploadIds[index],
          job_id: jobId,
          kind: "client",
          filename: "test.csv",
          storage_path: paths[index],
          size_bytes: payload.length,
        });
        if (uploadError) throw uploadError;
      }

      const pendingCount = async () => {
        const { count, error } = await admin
          .from("csv_storage_cleanup")
          .select("*", { count: "exact", head: true })
          .eq("job_id", jobId);
        if (error) throw error;
        return count;
      };
      const deleteUpload = (uploadId: string) => {
        const form = new FormData();
        form.set("job_id", jobId);
        form.set("upload_id", uploadId);
        return deleteCsvUploadAction(form);
      };

      const healthy = await deleteUpload(uploadIds[0]);
      expect(healthy.message).toBe("File deleted.");
      expect(await pendingCount()).toBe(0);
      expect(
        (await admin.storage.from("csv-uploads").download(paths[0])).error,
      ).not.toBeNull();

      state.failRemoval = true;
      const failed = await deleteUpload(uploadIds[1]);
      state.failRemoval = false;
      expect(failed.message).toMatch(/cleanup pending/i);
      expect(await pendingCount()).toBe(1);
      expect(
        (await admin.storage.from("csv-uploads").download(paths[1])).error,
      ).toBeNull();

      execFileSync(
        "uv",
        [
          "run",
          "--no-sync",
          "python",
          "-c",
          `
import asyncio, os, psycopg
from worker.db.pool import open_pool
from worker.engine.storage_cleanup import StorageCleanupRunner
from worker.io.storage import StorageClient
with psycopg.connect(os.environ["TEST_ADMIN_DATABASE_URL"], autocommit=True) as conn:
    conn.execute("update public.csv_storage_cleanup set created_at = '2000-01-01' where upload_id = %s", (os.environ["TEST_UPLOAD_ID"],))
async def run():
    async with open_pool(os.environ["TEST_WORKER_DATABASE_URL"]) as pool:
        runner = StorageCleanupRunner(pool, StorageClient(os.environ["TEST_STORAGE_URL"], os.environ["TEST_SERVICE_KEY"]), 1, asyncio.Event())
        assert await runner.tick()
asyncio.run(run())
`,
        ],
        {
          cwd: resolve(root, "apps/worker"),
          env: {
            ...process.env,
            TEST_ADMIN_DATABASE_URL: status.DB_URL,
            TEST_WORKER_DATABASE_URL: status.DB_URL.replace(
              "postgres:postgres@",
              "worker:worker@",
            ),
            TEST_STORAGE_URL: status.API_URL,
            TEST_SERVICE_KEY: status.SERVICE_ROLE_KEY,
            TEST_UPLOAD_ID: uploadIds[1],
          },
        },
      );
      expect(await pendingCount()).toBe(0);
      expect(
        (await admin.storage.from("csv-uploads").download(paths[1])).error,
      ).not.toBeNull();
    } finally {
      state.failRemoval = false;
      await admin.storage.from("csv-uploads").remove(paths);
      execFileSync(
        "psql",
        [
          "-h",
          "127.0.0.1",
          "-p",
          "54322",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `
delete from public.jobs where id = '${jobId}';
delete from public.csv_storage_cleanup where job_id = '${jobId}';
delete from public.job_storage_cleanup where job_id = '${jobId}';
${userId ? `delete from public.profile_role_changes where profile_id = '${userId}'; delete from auth.users where id = '${userId}';` : ""}
`,
        ],
        { env: { ...process.env, PGPASSWORD: "postgres" } },
      );
    }
  },
  120_000,
);
