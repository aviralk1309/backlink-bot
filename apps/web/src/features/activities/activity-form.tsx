"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/schemas";
import { ChipInput } from "../jobs/chip-input";
import { LANGUAGES } from "../jobs/locales";
import { saveActivityAction } from "./actions";
import {
  FORM_LIMITS,
  formWeightsTotal,
  newTemplateId,
  nextPriority,
  serializeConfig,
  type ActivityFormValues,
  type FormConfig,
} from "./form-values";
import {
  FIELD_WEIGHT_PARTS,
  PLACEHOLDERS,
  PLACEHOLDER_HELP,
  WEIGHT_PARTS,
  renderTemplate,
  suggestKey,
  templateProblem,
} from "./rules";
import { REVIEWER_FIELD_TYPES, type ReviewerFieldType } from "./types";

const initialState: FormState = {};

const selectClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3";

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
    <section aria-label={title} className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ActivityForm({ values }: { values: ActivityFormValues }) {
  const [state, formAction, pending] = useActionState(
    saveActivityAction,
    initialState,
  );

  // Controlled fields: React resets uncontrolled form fields after an action
  // finishes, which would wipe the edits on a server error.
  const [name, setName] = useState(values.name);
  const [key, setKey] = useState(values.key);
  const [keyTouched, setKeyTouched] = useState(false);
  const [enabled, setEnabled] = useState(values.enabled);
  const [cfg, setCfg] = useState<FormConfig>(values.config);

  const creating = values.id === null;
  const set = <K extends keyof FormConfig>(k: K, v: FormConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const total = formWeightsTotal(cfg);

  function updateTemplate(
    index: number,
    patch: Partial<FormConfig["templates"][number]>,
  ) {
    set(
      "templates",
      cfg.templates.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  }

  function updateReviewer(
    index: number,
    patch: Partial<FormConfig["reviewer_fields"][number]>,
  ) {
    set(
      "reviewer_fields",
      cfg.reviewer_fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {values.id ? (
        <>
          <input type="hidden" name="activity_id" value={values.id} />
          <input
            type="hidden"
            name="seen_updated_at"
            value={values.updatedAt}
          />
        </>
      ) : null}
      {/* Everything below the basics travels as one JSON field built from state. */}
      <input type="hidden" name="config" value={serializeConfig(cfg)} />

      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="activity_name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="activity_name"
              name="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (creating && !keyTouched) setKey(suggestKey(e.target.value));
              }}
              required
              maxLength={80}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="activity_key" className="text-sm font-medium">
              Key
            </label>
            {creating ? (
              <Input
                id="activity_key"
                name="key"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyTouched(true);
                }}
                required
                maxLength={50}
                autoComplete="off"
                aria-describedby="activity_key_hint"
              />
            ) : (
              <Input
                id="activity_key"
                value={key}
                readOnly
                aria-describedby="activity_key_hint"
              />
            )}
            <p id="activity_key_hint" className="text-muted-foreground text-xs">
              {creating
                ? "Lowercase letters, digits and underscores. It cannot be changed later."
                : "The key cannot be changed."}
            </p>
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="enabled"
            className="mt-0.5"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>
            <span className="font-medium">Enabled</span>
            <span className="text-muted-foreground block text-xs">
              Disabled activities cannot be chosen for new jobs. Jobs that
              already use one keep it.
            </span>
          </span>
        </label>

        <div className="max-w-xs">
          <NumberField
            id="per_domain_cap"
            label="Per-domain cap"
            hint="Most pages kept per domain for this activity."
            value={cfg.per_domain_cap}
            onChange={(v) => set("per_domain_cap", v)}
          />
        </div>
      </Section>

      <Section
        title="Search templates"
        description="Each template becomes Google queries for a job. Lower priority numbers run first."
      >
        <p className="text-muted-foreground text-xs">
          Placeholders:{" "}
          {PLACEHOLDERS.map((p, i) => (
            <span key={p}>
              {i > 0 ? "; " : ""}
              <code className="bg-muted rounded px-1">{`{${p}}`}</code>{" "}
              {PLACEHOLDER_HELP[p]}
            </span>
          ))}
          .
        </p>

        {cfg.templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No templates yet. Add at least one.
          </p>
        ) : (
          <ul className="space-y-3">
            {cfg.templates.map((t, i) => {
              const problem = t.template.trim()
                ? templateProblem(t.template)
                : null;
              return (
                <li key={t.id} className="space-y-1.5 rounded-md border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_9rem_5rem_auto]">
                    <Input
                      aria-label={`Search text for template ${i + 1}`}
                      value={t.template}
                      onChange={(e) =>
                        updateTemplate(i, { template: e.target.value })
                      }
                      maxLength={300}
                      autoComplete="off"
                      aria-invalid={problem ? true : undefined}
                    />
                    <select
                      aria-label={`Language for template ${i + 1}`}
                      className={selectClass}
                      value={t.language}
                      onChange={(e) =>
                        updateTemplate(i, { language: e.target.value })
                      }
                    >
                      <option value="*">Every language</option>
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={`Priority for template ${i + 1}`}
                      type="number"
                      inputMode="numeric"
                      value={t.priority}
                      onChange={(e) =>
                        updateTemplate(i, { priority: e.target.value })
                      }
                    />
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={t.enabled}
                          onChange={(e) =>
                            updateTemplate(i, { enabled: e.target.checked })
                          }
                        />
                        On
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          set(
                            "templates",
                            cfg.templates.filter((_, n) => n !== i),
                          )
                        }
                        aria-label={`Remove template ${i + 1}`}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  {problem ? (
                    <p role="alert" className="text-destructive text-xs">
                      {problem}
                    </p>
                  ) : t.template.trim() ? (
                    <p className="text-muted-foreground text-xs">
                      Example: {renderTemplate(t.template)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={cfg.templates.length >= 50}
          onClick={() =>
            set("templates", [
              ...cfg.templates,
              {
                id: newTemplateId(),
                template: "",
                language: "*",
                priority: nextPriority(cfg.templates),
                enabled: true,
              },
            ])
          }
        >
          Add template
        </Button>
      </Section>

      <Section
        title="How to recognise the page type"
        description="Signals the checker looks for on a page. Leave a list empty to ignore it."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ChipInput
            label="URL patterns"
            values={cfg.url_patterns}
            onChange={(v) => set("url_patterns", v)}
            options={FORM_LIMITS.phrases}
            placeholder="write-for-us"
            hint="Parts of a web address, such as write-for-us."
          />
          <ChipInput
            label="Title phrases"
            values={cfg.title_phrases}
            onChange={(v) => set("title_phrases", v)}
            options={FORM_LIMITS.phrases}
            placeholder="write for us"
          />
          <ChipInput
            label="Heading phrases"
            values={cfg.heading_phrases}
            onChange={(v) => set("heading_phrases", v)}
            options={FORM_LIMITS.phrases}
            placeholder="submission guidelines"
          />
          <ChipInput
            label="Body phrases"
            values={cfg.body_phrases}
            onChange={(v) => set("body_phrases", v)}
            options={FORM_LIMITS.phrases}
            placeholder="guest post"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={cfg.link_list}
              onChange={(e) => set("link_list", e.target.checked)}
            />
            <span>
              <span className="font-medium">Page is a list of links</span>
              <span className="text-muted-foreground block text-xs">
                Tick for resource pages and directories.
              </span>
            </span>
          </label>
          <NumberField
            id="min_outbound_links"
            label="Minimum outbound links"
            value={cfg.min_outbound_links}
            onChange={(v) => set("min_outbound_links", v)}
          />
        </div>
      </Section>

      <Section
        title="Relevance"
        description="How much each part of a page counts when judging if it fits the job's topic."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FIELD_WEIGHT_PARTS.map(([part, label]) => {
            const field = `fw_${part}` as const;
            return (
              <NumberField
                key={part}
                id={field}
                label={`${label} (0 to 10)`}
                value={cfg[field]}
                onChange={(v) => set(field, v)}
              />
            );
          })}
          <NumberField
            id="min_score"
            label="Minimum relevance (0 to 1)"
            hint="Pages scoring lower are dropped."
            value={cfg.min_score}
            onChange={(v) => set("min_score", v)}
          />
        </div>
      </Section>

      <Section
        title="Scoring"
        description="How a page's final score is made up. The five parts must add up to 100."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {WEIGHT_PARTS.map(([part, label]) => {
            const field = `w_${part}` as const;
            return (
              <NumberField
                key={part}
                id={field}
                label={label}
                value={cfg[field]}
                onChange={(v) => set(field, v)}
              />
            );
          })}
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${total === 100 ? "text-muted-foreground" : "text-destructive font-medium"}`}
        >
          Total: {total} of 100
        </p>
        <div className="max-w-xs">
          <NumberField
            id="w_spam_penalty"
            label="Spam penalty (0 to 100)"
            hint="The most points a spam signal can take off."
            value={cfg.w_spam_penalty}
            onChange={(v) => set("w_spam_penalty", v)}
          />
        </div>
      </Section>

      <Section
        title="Reviewer fields"
        description="Extra details a reviewer can fill in for each result."
      >
        {cfg.reviewer_fields.length === 0 ? (
          <p className="text-muted-foreground text-sm">No extra fields.</p>
        ) : (
          <ul className="space-y-2">
            {cfg.reviewer_fields.map((f, i) => (
              <li
                key={i}
                className="grid gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]"
              >
                <Input
                  aria-label={`Key for field ${i + 1}`}
                  placeholder="key"
                  value={f.key}
                  onChange={(e) =>
                    updateReviewer(i, { key: e.target.value.toLowerCase() })
                  }
                  maxLength={30}
                  autoComplete="off"
                />
                <Input
                  aria-label={`Label for field ${i + 1}`}
                  placeholder="Label"
                  value={f.label}
                  onChange={(e) => updateReviewer(i, { label: e.target.value })}
                  maxLength={40}
                  autoComplete="off"
                />
                <select
                  aria-label={`Type for field ${i + 1}`}
                  className={selectClass}
                  value={f.type}
                  onChange={(e) =>
                    updateReviewer(i, {
                      type: e.target.value as ReviewerFieldType,
                    })
                  }
                >
                  {REVIEWER_FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove field ${i + 1}`}
                  onClick={() =>
                    set(
                      "reviewer_fields",
                      cfg.reviewer_fields.filter((_, n) => n !== i),
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={cfg.reviewer_fields.length >= 12}
          onClick={() =>
            set("reviewer_fields", [
              ...cfg.reviewer_fields,
              { key: "", label: "", type: "text" },
            ])
          }
        >
          Add field
        </Button>
      </Section>

      <div className="bg-background/95 sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t px-1 py-3 backdrop-blur">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save activity"}
        </Button>
        <Link
          href="/admin/activities"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        {values.version ? (
          <span className="text-muted-foreground text-xs">
            Version {values.version}. A change that matters saves as version{" "}
            {values.version + 1}.
          </span>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-destructive min-w-0 flex-1 text-sm">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
