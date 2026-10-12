import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ActivityListItem, ActivityProfileRow } from "./types";

// Like the jobs queries: described by hand and cast, so a regenerated
// database.types.ts never breaks these files.

type ListRow = Omit<
  ActivityListItem,
  "template_count" | "enabled_template_count"
> & {
  footprint_templates: { enabled?: boolean }[] | null;
};

export async function listActivityProfiles(): Promise<ActivityListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_profiles")
    .select(
      "id, key, name, enabled, per_domain_cap, version, updated_at, footprint_templates",
    )
    .order("name");
  if (error) throw new Error(`listActivityProfiles failed: ${error.message}`);

  return ((data ?? []) as unknown as ListRow[]).map((row) => {
    const { footprint_templates, ...rest } = row;
    const templates = footprint_templates ?? [];
    return {
      ...rest,
      template_count: templates.length,
      enabled_template_count: templates.filter((t) => t.enabled).length,
    };
  });
}

export const getActivityProfile = cache(
  async (id: string): Promise<ActivityProfileRow | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("activity_profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`getActivityProfile failed: ${error.message}`);
    return (data ?? null) as unknown as ActivityProfileRow | null;
  },
);
