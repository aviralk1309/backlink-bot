"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import type { FormState } from "@/lib/auth/schemas";
import { saveJobAction } from "./actions";
import { ChipInput } from "./chip-input";
import { FIELD, LIMITS, type JobFormValues } from "./form-values";
import { COUNTRIES, LANGUAGES } from "./locales";
import type { ActivityOption, JobStatus } from "./types";

const initialState: FormState = {};

const START = "(needed to start)";

const CHECKBOX = "accent-primary size-4 shrink-0 pointer-coarse:size-5";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="bg-card space-y-4 rounded-xl border p-5"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border">
      <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="text-muted-foreground size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {summary}
      </summary>
      <div className="border-t px-3 py-3">{children}</div>
    </details>
  );
}

function Field({
  id,
  label,
  tag,
  hint,
  children,
}: {
  id: string;
  label: string;
  tag?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {tag ? (
          <span className="text-muted-foreground ml-1 text-xs font-normal">
            {tag}
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  id,
  name,
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
    </Field>
  );
}

function CheckField({
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        name={name}
        className={`${CHECKBOX} mt-0.5`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The job form (spec section 5), used to create and to edit. Controlled
 * fields: React resets uncontrolled form fields after an action finishes,
 * which would wipe the user's edits on a server error.
 */
export function JobForm({
  values,
  activities,
  status,
}: {
  values: JobFormValues;
  activities: ActivityOption[];
  /** null when creating. */
  status: JobStatus | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveJobAction,
    initialState,
  );
  const [v, setV] = useState(values);
  const set = <K extends keyof JobFormValues>(
    key: K,
    value: JobFormValues[K],
  ) => setV((prev) => ({ ...prev, [key]: value }));

  const editing = values.id !== null;
  const started = status !== null && status !== "draft";

  // A disabled activity stays visible only on a job that already had it.
  const visibleActivities = activities.filter(
    (a) => a.enabled || values.activityKeys.includes(a.key),
  );

  function toggleActivity(key: string, on: boolean) {
    set(
      "activityKeys",
      on
        ? [...new Set([...v.activityKeys, key])]
        : v.activityKeys.filter((k) => k !== key),
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {values.id ? (
        <input type="hidden" name={FIELD.id} value={values.id} />
      ) : null}
      {values.updatedAt ? (
        <input type="hidden" name={FIELD.updatedAt} value={values.updatedAt} />
      ) : null}

      {started ? (
        <Notice tone="info">
          This job has started. Changes apply to future queries and checks only.
          Results that are already stored are never rewritten.
        </Notice>
      ) : null}

      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="job_name" label="Job name">
            <Input
              id="job_name"
              name={FIELD.name}
              value={v.name}
              onChange={(e) => set("name", e.target.value)}
              required
              maxLength={100}
              autoComplete="off"
            />
          </Field>
          <Field id="job_client" label="Client" tag="(optional)">
            <Input
              id="job_client"
              name={FIELD.client}
              value={v.client}
              onChange={(e) => set("client", e.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </Field>
          <Field
            id="job_client_domain"
            label="Client domain"
            tag={START}
            hint="For example yogaban.com. Links and paths are cleaned up for you."
          >
            <Input
              id="job_client_domain"
              name={FIELD.clientDomain}
              value={v.clientDomain}
              onChange={(e) => set("clientDomain", e.target.value)}
              autoComplete="off"
              inputMode="url"
              aria-describedby="job_client_domain-hint"
            />
          </Field>
          <Field id="job_business_type" label="Business type" tag={START}>
            <Input
              id="job_business_type"
              name={FIELD.businessType}
              value={v.businessType}
              onChange={(e) => set("businessType", e.target.value)}
              maxLength={80}
              placeholder="For example yoga retreats"
              autoComplete="off"
            />
          </Field>
          <Field id="job_sub_niche" label="Sub-niche" tag="(optional)">
            <Input
              id="job_sub_niche"
              name={FIELD.subNiche}
              value={v.subNiche}
              onChange={(e) => set("subNiche", e.target.value)}
              maxLength={80}
              placeholder="For example wellness travel"
              autoComplete="off"
            />
          </Field>
        </div>
        <ChipInput
          name={FIELD.targetUrls}
          label="Target URLs"
          tag="(optional)"
          values={v.targetUrls}
          onChange={(next) => set("targetUrls", next)}
          options={LIMITS.targetUrls}
          placeholder="https://client.com/page"
          hint="The pages that should receive links."
        />
      </Section>

      <Section
        title="Activities in scope"
        description="Each activity brings its own search templates, page checks and per-domain cap."
      >
        {visibleActivities.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No activities are enabled. Ask an Admin to enable one.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {visibleActivities.map((a) => (
              <li key={a.key}>
                <label className="hover:bg-muted/50 has-[:checked]:border-primary/40 has-[:checked]:bg-accent/60 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    name={FIELD.activityKeys}
                    value={a.key}
                    className={CHECKBOX}
                    checked={v.activityKeys.includes(a.key)}
                    onChange={(e) => toggleActivity(a.key, e.target.checked)}
                  />
                  <span className="font-medium">{a.name}</span>
                  {!a.enabled ? (
                    <span className="text-muted-foreground text-xs">
                      (disabled)
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          At least one activity is needed to start.
        </p>
      </Section>

      <Section title="Targeting">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="job_country" label="Country" tag={START}>
            <NativeSelect
              id="job_country"
              name={FIELD.country}
              value={v.country}
              onChange={(e) => set("country", e.target.value)}
            >
              <option value="">Choose a country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="job_language" label="Language" tag={START}>
            <NativeSelect
              id="job_language"
              name={FIELD.language}
              value={v.language}
              onChange={(e) => set("language", e.target.value)}
            >
              <option value="">Choose a language</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <ChipInput
          name={FIELD.seedKeywords}
          label="Seed keywords"
          tag={START}
          values={v.seedKeywords}
          onChange={(next) => set("seedKeywords", next)}
          options={LIMITS.seedKeywords}
          placeholder="Type a keyword, press Enter"
          hint="Enter or comma adds one. Paste a list to add many."
        />
        <ChipInput
          name={FIELD.brandVariants}
          label="Brand name and variants"
          tag="(optional)"
          values={v.brandVariants}
          onChange={(next) => set("brandVariants", next)}
          options={LIMITS.brandVariants}
          placeholder="Yogaban, Yoga Ban"
        />
        <ChipInput
          name={FIELD.regions}
          label="Cities or regions"
          tag="(optional)"
          values={v.regions}
          onChange={(next) => set("regions", next)}
          options={LIMITS.regions}
          placeholder="Rishikesh, Goa"
        />
      </Section>

      <Section
        title="Discovery sources"
        description="A job needs at least one source to start: a credit budget above 0, seed list URLs, or competitor domains."
      >
        <ChipInput
          name={FIELD.competitorDomains}
          label="Competitor domains"
          tag="(optional)"
          values={v.competitorDomains}
          onChange={(next) => set("competitorDomains", next)}
          options={LIMITS.competitorDomains}
          placeholder="competitor.com"
          hint="Used to label competitor backlink files and to exclude them from results."
        />
        <ChipInput
          name={FIELD.referenceSites}
          label="Reference sites"
          tag="(optional)"
          values={v.referenceSites}
          onChange={(next) => set("referenceSites", next)}
          options={LIMITS.referenceSites}
          placeholder="example-reference.org"
          hint="Sites that show what a good result looks like. They are stored and excluded from results."
        />
        <ChipInput
          name={FIELD.seedListUrls}
          label="Own seed list URLs"
          tag="(optional)"
          values={v.seedListUrls}
          onChange={(next) => set("seedListUrls", next)}
          options={LIMITS.seedListUrls}
          placeholder="https://example.org/links"
          hint="Pages you already know about. They are imported as opportunities. Paste one per line."
        />
      </Section>

      <Section title="Filters">
        <ChipInput
          name={FIELD.bannedCategories}
          label="Banned categories"
          tag="(optional)"
          values={v.bannedCategories}
          onChange={(next) => set("bannedCategories", next)}
          options={LIMITS.bannedCategories}
          placeholder="casino, adult"
        />
        <ChipInput
          name={FIELD.blockedDomains}
          label="Blocked domains for this job"
          tag="(optional)"
          values={v.blockedDomains}
          onChange={(next) => set("blockedDomains", next)}
          options={LIMITS.blockedDomains}
          placeholder="spam-site.com"
          hint="Added to the global blocklist, which applies to every job."
        />
        <div className="space-y-3">
          <CheckField
            name={FIELD.requireLanguageRegionMatch}
            label="Require language and region match"
            hint="Results in another language or region are filtered out."
            checked={v.requireLanguageRegionMatch}
            onChange={(next) => set("requireLanguageRegionMatch", next)}
          />
          <CheckField
            name={FIELD.skipPreviouslySpamDomains}
            label="Skip domains rejected as spam in earlier jobs"
            hint="Otherwise they are only flagged."
            checked={v.skipPreviouslySpamDomains}
            onChange={(next) => set("skipPreviouslySpamDomains", next)}
          />
        </div>
      </Section>

      <Section title="Limits">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            id="job_budget"
            name={FIELD.budgetCredits}
            label="Serper credit budget"
            hint="0 means no Google search."
            value={v.budgetCredits}
            onChange={(next) => set("budgetCredits", next)}
            min={0}
            max={1_000_000}
          />
          <NumberField
            id="job_pages"
            name={FIELD.pagesPerQuery}
            label="Pages per query"
            value={v.pagesPerQuery}
            onChange={(next) => set("pagesPerQuery", next)}
            min={1}
            max={10}
          />
          <NumberField
            id="job_domain_cap"
            name={FIELD.perDomainCap}
            label="Per-domain cap"
            hint="Most URLs checked per domain."
            value={v.perDomainCap}
            onChange={(next) => set("perDomainCap", next)}
            min={1}
            max={1000}
          />
          <NumberField
            id="job_queue_size"
            name={FIELD.reviewQueueSize}
            label="Review queue size"
            hint="Results shown as ready for review."
            value={v.reviewQueueSize}
            onChange={(next) => set("reviewQueueSize", next)}
            min={1}
            max={500}
          />
          <NumberField
            id="job_sat_n"
            name={FIELD.saturationN}
            label="Saturation window"
            hint="Look at the last N queries."
            value={v.saturationN}
            onChange={(next) => set("saturationN", next)}
            min={1}
            max={1000}
          />
          <NumberField
            id="job_sat_x"
            name={FIELD.saturationX}
            label="Saturation minimum"
            hint="Pause if they found fewer new domains than this."
            value={v.saturationX}
            onChange={(next) => set("saturationX", next)}
            min={0}
            max={1000}
          />
        </div>
        <Disclosure summary="Advanced">
          <div className="max-w-xs">
            <NumberField
              id="job_scrape_cap"
              name={FIELD.scrapeCreditCap}
              label="Scrape fallback credit cap"
              hint="Leave at 0 to keep the scrape fallback off."
              value={v.scrapeCreditCap}
              onChange={(next) => set("scrapeCreditCap", next)}
              min={0}
              max={1_000_000}
            />
          </div>
        </Disclosure>
      </Section>

      <Section
        title="Local business data"
        description="Only if relevant. It is stored with the job and not used by searches yet."
      >
        <Disclosure summary="Business name, address and phone">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="job_lb_name" label="Business name">
              <Input
                id="job_lb_name"
                name={FIELD.localBusinessName}
                value={v.localBusinessName}
                onChange={(e) => set("localBusinessName", e.target.value)}
                maxLength={150}
                autoComplete="off"
              />
            </Field>
            <Field id="job_lb_phone" label="Phone">
              <Input
                id="job_lb_phone"
                name={FIELD.localBusinessPhone}
                value={v.localBusinessPhone}
                onChange={(e) => set("localBusinessPhone", e.target.value)}
                maxLength={25}
                inputMode="tel"
                autoComplete="off"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id="job_lb_address" label="Address">
                <Input
                  id="job_lb_address"
                  name={FIELD.localBusinessAddress}
                  value={v.localBusinessAddress}
                  onChange={(e) => set("localBusinessAddress", e.target.value)}
                  maxLength={300}
                  autoComplete="off"
                />
              </Field>
            </div>
          </div>
        </Disclosure>
      </Section>

      <div className="bg-background/90 sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t px-4 py-3 backdrop-blur-sm md:-mx-8 md:px-8">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2
              aria-hidden
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {pending ? "Saving…" : editing ? "Save changes" : "Save draft"}
        </Button>
        <Link
          href={values.id ? `/jobs/${values.id}` : "/jobs"}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        {state.error ? (
          <Notice tone="error" className="min-w-0 flex-1">
            {state.error}
          </Notice>
        ) : null}
      </div>
    </form>
  );
}
