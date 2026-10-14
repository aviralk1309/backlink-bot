import { format } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Ban, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <Suspense fallback={<PageSkeleton />}>
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
        <p className="text-muted-foreground max-w-xl text-sm">
          Domains no job will ever return results from. This list applies to
          every job, on top of each job&apos;s own blocked domains.
        </p>
      </div>

      <AddBlockedDomains />

      <form
        action="/admin/blocklist"
        method="get"
        role="search"
        className="flex w-full items-center gap-2 sm:max-w-md"
      >
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            name="q"
            defaultValue={params.q}
            aria-label="Search the blocklist"
            placeholder="Search domain or reason"
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
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
        <EmptyState
          icon={<Ban />}
          title={params.q ? "No matches" : "No blocked domains yet"}
          description={
            params.q
              ? "No blocked domains match that search."
              : "Domains you block above appear here."
          }
        />
      ) : (
        <div className="bg-card rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Domain</TableHead>
                <TableHead scope="col">Reason</TableHead>
                <TableHead scope="col">Added</TableHead>
                <TableHead scope="col">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="px-4 py-3 font-medium break-all whitespace-normal">
                    {r.domain}
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    {r.reason ?? (
                      <span className="text-muted-foreground">No reason</span>
                    )}
                    {r.source_job_id ? (
                      <p className="text-muted-foreground text-xs">
                        From job{" "}
                        {r.source_job_name ? (
                          <Link
                            href={`/jobs/${r.source_job_id}`}
                            className="focus-visible:ring-ring rounded underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                          >
                            {r.source_job_name}
                          </Link>
                        ) : (
                          "(not available)"
                        )}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                    {format(new Date(r.created_at), "d MMM yyyy")}
                    <p className="text-xs">{r.added_by_name ?? ""}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <BlocklistRowActions
                      key={`${r.id}:${r.reason ?? ""}`}
                      id={r.id}
                      domain={r.domain}
                      reason={r.reason}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Showing {from}–{to} of {total}
          </p>
          <nav aria-label="Pagination" className="flex items-center gap-2">
            {hasPrev ? (
              <Link
                href={blocklistHref({ ...params, page: params.page - 1 })}
                className={buttonVariants({ variant: "outline" })}
              >
                <ChevronLeft aria-hidden data-icon="inline-start" />
                Previous
              </Link>
            ) : null}
            {hasNext ? (
              <Link
                href={blocklistHref({ ...params, page: params.page + 1 })}
                className={buttonVariants({ variant: "outline" })}
              >
                Next
                <ChevronRight aria-hidden data-icon="inline-end" />
              </Link>
            ) : null}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
