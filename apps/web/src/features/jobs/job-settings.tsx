import type { ReactNode } from "react";
import type { ActivityOption, JobRow } from "./types";
import { activityNames, countryName, languageName } from "./view";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="bg-card space-y-4 rounded-xl border p-5"
    >
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[14rem_1fr]">
        {children}
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </>
  );
}

const NONE = <span className="text-muted-foreground">Not set</span>;

function text(value: string | null | undefined): ReactNode {
  return value ? value : NONE;
}

function Pills({ items }: { items: readonly string[] }) {
  if (items.length === 0) return NONE;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="bg-muted rounded-md px-2 py-0.5 text-xs break-all"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const num = (v: number) => v.toLocaleString("en");

/** Every setting on the job, read-only. Editing is on the edit page. */
export function JobSettings({
  job,
  activities,
}: {
  job: JobRow;
  activities: readonly ActivityOption[];
}) {
  const lb = job.local_business;
  const hasLocal = Boolean(lb && (lb.name || lb.address || lb.phone));

  return (
    <div className="space-y-4">
      <Group title="Client">
        <Row label="Job name">{job.name}</Row>
        <Row label="Client">{text(job.client)}</Row>
        <Row label="Client domain">{text(job.client_domain)}</Row>
        <Row label="Target URLs">
          <Pills items={job.target_urls} />
        </Row>
        <Row label="Business type">{text(job.business_type)}</Row>
        <Row label="Sub-niche">{text(job.sub_niche)}</Row>
      </Group>

      <Group title="Activities">
        <Row label="Selected activities">
          <Pills items={activityNames(job.activity_keys, activities)} />
        </Row>
      </Group>

      <Group title="Where and what">
        <Row label="Country">{text(countryName(job.country))}</Row>
        <Row label="Language">{text(languageName(job.language))}</Row>
        <Row label="Cities or regions">
          <Pills items={job.regions} />
        </Row>
        <Row label="Seed keywords">
          <Pills items={job.seed_keywords} />
        </Row>
        <Row label="Brand variants">
          <Pills items={job.brand_variants} />
        </Row>
        <Row label="Language and region match">
          {yesNo(job.require_language_region_match)}
        </Row>
      </Group>

      <Group title="Sources">
        <Row label="Competitor domains">
          <Pills items={job.competitor_domains} />
        </Row>
        <Row label="Reference sites">
          <Pills items={job.reference_sites} />
        </Row>
        <Row label="Seed list URLs">
          <Pills items={job.seed_list_urls} />
        </Row>
      </Group>

      <Group title="Exclusions">
        <Row label="Banned categories">
          <Pills items={job.banned_categories} />
        </Row>
        <Row label="Blocked domains">
          <Pills items={job.blocked_domains} />
        </Row>
        <Row label="Skip earlier spam domains">
          {yesNo(job.skip_previously_spam_domains)}
        </Row>
      </Group>

      <Group title="Limits">
        <Row label="Serper credit budget">{num(job.budget_credits)}</Row>
        <Row label="Pages per query">{num(job.pages_per_query)}</Row>
        <Row label="Saturation window">{num(job.saturation_n)} queries</Row>
        <Row label="Saturation minimum">
          {num(job.saturation_x)} new domains
        </Row>
        <Row label="Per-domain cap">{num(job.per_domain_cap)}</Row>
        <Row label="Review queue size">{num(job.review_queue_size)}</Row>
        <Row label="Scrape credit cap">{num(job.scrape_credit_cap)}</Row>
      </Group>

      {hasLocal ? (
        <Group title="Local business">
          <Row label="Business name">{text(lb?.name)}</Row>
          <Row label="Address">{text(lb?.address)}</Row>
          <Row label="Phone">{text(lb?.phone)}</Row>
        </Group>
      ) : null}
    </div>
  );
}
