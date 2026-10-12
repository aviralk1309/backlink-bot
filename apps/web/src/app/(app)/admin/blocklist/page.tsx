import { format } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddBlockedDomains } from "@/features/blocklist/add-form";
import { listBlocklist } from "@/features/blocklist/queries";
import {
  BLOCKLIST_PAGE_SIZE,
  blocklistHref,
  parseBlocklistParams,
} from "@/features/blocklist/rules";
import { BlocklistRowActions } from "@/features/blocklist/row-actions";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = { searchParams: Promise<{ q?: string; page?: string }> };

export default function AdminBlocklistPage({ searchParams }: Props) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <BlocklistContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BlocklistContent({ searchParams }: Props) {
  await requirePagePermission("blocklist.manage");

  const params = parseBlocklistParams(await searchParams);
  const { rows, total } = await listBlocklist(params);

  // A link to a page that no longer exists goes to the last one.
  if (rows.length === 0 && total > 0 && params.page > 1) {
    const last = Math.max(1, Math.ceil(total / BLOCKLIST_PAGE_SIZE));
    redirect(blocklistHref({ ...params, page: last }));
  }

  const from = total === 0 ? 0 : (params.page - 1) * BLOCKLIST_PAGE_SIZE + 1;
  const to = Math.min(params.page * BLOCKLIST_PAGE_SIZE, total);
  const hasPrev = params.page > 1;
  const hasNext = to < total;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Blocklist</h1>
        <p className="text-muted-foreground text-sm">
          Domains no job will ever return results from. This list applies to
          every job, on top of each job&apos;s own blocked domains.
        </p>
      </div>

      <AddBlockedDomains />

      <form
        action="/admin/blocklist"
        method="get"
        role="search"
        className="flex flex-wrap items-center gap-2"
      >
        <Input
          type="search"
          name="q"
          defaultValue={params.q}
          aria-label="Search the blocklist"
          placeholder="Search domain or reason"
          className="max-w-sm"
        />
        <button
          type="submit"
          className={buttonVariants({ variant: "outline" })}
        >
          Search
        </button>
        {params.q ? (
          <Link
            href="/admin/blocklist"
            className={buttonVariants({ variant: "ghost" })}
          >
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {params.q
            ? "No blocked domains match that search."
            : "No blocked domains yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Domain
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Reason
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Added
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3 font-medium break-all">
                    {r.domain}
                  </td>
                  <td className="px-4 py-3">
                    {r.reason ?? (
                      <span className="text-muted-foreground">No reason</span>
                    )}
                    {r.source_job_id ? (
                      <p className="text-muted-foreground text-xs">
                        From job{" "}
                        {r.source_job_name ? (
                          <Link
                            href={`/jobs/${r.source_job_id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {r.source_job_name}
                          </Link>
                        ) : (
                          "(not available)"
                        )}
                      </p>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                    {format(new Date(r.created_at), "d MMM yyyy")}
                    <p className="text-xs">{r.added_by_name ?? ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <BlocklistRowActions
                      key={`${r.id}:${r.reason ?? ""}`}
                      id={r.id}
                      domain={r.domain}
                      reason={r.reason}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Showing {from}–{to} of {total}
          </p>
          <div className="flex items-center gap-2">
            {hasPrev ? (
              <Link
                href={blocklistHref({ ...params, page: params.page - 1 })}
                className={buttonVariants({ variant: "outline" })}
              >
                Previous
              </Link>
            ) : null}
            {hasNext ? (
              <Link
                href={blocklistHref({ ...params, page: params.page + 1 })}
                className={buttonVariants({ variant: "outline" })}
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
