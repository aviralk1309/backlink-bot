import { format } from "date-fns";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { savedNotice } from "@/features/activities/notice";
import { listActivityProfiles } from "@/features/activities/queries";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = { searchParams: Promise<{ saved?: string }> };

export default function AdminActivitiesPage({ searchParams }: Props) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <ActivitiesContent searchParams={searchParams} />
    </Suspense>
  );
}

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
          <p className="text-muted-foreground text-sm">
            An activity says how to search for one kind of backlink, such as
            guest posts, and how to score what is found. Activities are switched
            off, not deleted.
          </p>
        </div>
        <Link href="/admin/activities/new" className={buttonVariants()}>
          New activity
        </Link>
      </div>

      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}

      {activities.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activities yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Activity
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Templates
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Cap
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Version
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Updated
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {activities.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-muted-foreground text-xs">{a.key}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        a.enabled
                          ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
                          : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {a.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {a.enabled_template_count} of {a.template_count} on
                  </td>
                  <td className="px-4 py-3">{a.per_domain_cap}</td>
                  <td className="px-4 py-3">{a.version}</td>
                  <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                    {format(new Date(a.updated_at), "d MMM yyyy")}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/activities/${a.id}`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
