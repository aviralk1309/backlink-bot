import { format } from "date-fns";
import Link from "next/link";
import { Suspense } from "react";
import { Layers, Plus } from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { savedNotice } from "@/features/activities/notice";
import { listActivityProfiles } from "@/features/activities/queries";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = { searchParams: Promise<{ saved?: string }> };

export default function AdminActivitiesPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ActivitiesContent searchParams={searchParams} />
    </Suspense>
  );
}

const newActivityLink = (
  <Link href="/admin/activities/new" className={buttonVariants()}>
    <Plus aria-hidden data-icon="inline-start" />
    New activity
  </Link>
);

async function ActivitiesContent({ searchParams }: Props) {
  await requirePagePermission("activities.manage");

  const [activities, params] = await Promise.all([
    listActivityProfiles(),
    searchParams,
  ]);
  const notice = savedNotice(params.saved);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
          <p className="text-muted-foreground max-w-xl text-sm">
            An activity says how to search for one kind of backlink, such as
            guest posts, and how to score what is found. Activities are switched
            off, not deleted.
          </p>
        </div>
        {newActivityLink}
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {activities.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No activities yet"
          description="Create an activity to tell jobs how to search and score."
          action={newActivityLink}
        />
      ) : (
        <div className="bg-card rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Activity</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Templates</TableHead>
                <TableHead scope="col">Cap</TableHead>
                <TableHead scope="col">Version</TableHead>
                <TableHead scope="col">Updated</TableHead>
                <TableHead scope="col">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((a) => (
                <TableRow key={a.id} className="align-top">
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">
                      {a.key}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusBadge tone={a.enabled ? "success" : "neutral"}>
                      {a.enabled ? "Enabled" : "Disabled"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-nowrap">
                    {a.enabled_template_count} of {a.template_count} on
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {a.per_domain_cap}
                  </TableCell>
                  <TableCell className="px-4 py-3">{a.version}</TableCell>
                  <TableCell className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                    {format(new Date(a.updated_at), "d MMM yyyy")}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <Link
                      href={`/admin/activities/${a.id}`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      Edit
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
