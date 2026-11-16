"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { saveCsvMappingAction } from "./actions";
import {
  applyMappingTemplate,
  buildDefaultMapping,
  guessUrlColumn,
  templateHeaderScore,
} from "./rules";
import { parseCsvPreview } from "./sample";
import type {
  ColumnMapping,
  ColumnType,
  CsvMapping,
  CsvUploadKind,
  MappingTemplateItem,
} from "./types";
import { COLUMN_TYPES, COLUMN_TYPE_LABEL } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** More columns than this are windowed to keep the mapping form lightweight. */
const VIRTUALIZE_AFTER = 100;
const COLUMN_ROW_HEIGHT = 64;
const COLUMN_VIEWPORT_HEIGHT = 352;
const COLUMN_OVERSCAN = 6;

/** Auto-suggest threshold for templates. */
const TEMPLATE_SUGGEST_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CsvMappingScreen({
  jobId,
  uploadId,
  kind,
  filename,
  sampleText,
  delimiter,
  headerLine,
  detectedHeaders,
  existingMapping,
  templates,
  onDone,
}: {
  jobId: string;
  uploadId: string;
  kind: CsvUploadKind;
  filename: string;
  sampleText: string;
  delimiter?: string;
  headerLine?: number | null;
  detectedHeaders?: string[];
  existingMapping: CsvMapping | null;
  templates: MappingTemplateItem[];
  onDone: () => void;
}) {
  const { headers, rows } = useMemo(
    () =>
      parseCsvPreview(sampleText, {
        delimiter,
        headerLine,
        detectedHeaders,
        maxRows: 1,
      }),
    [sampleText, delimiter, headerLine, detectedHeaders],
  );

  // --- State: URL column ---
  const defaultGuess = useMemo(
    () =>
      existingMapping
        ? existingMapping.url_index
        : guessUrlColumn(headers, rows[0]),
    [existingMapping, headers, rows],
  );
  const [urlIndex, setUrlIndex] = useState(defaultGuess);

  // --- State: other columns ---
  const defaultCols = useMemo(() => {
    if (existingMapping) return existingMapping.columns;
    return buildDefaultMapping(headers, rows[0]).columns;
  }, [existingMapping, headers, rows]);
  const [columns, setColumns] = useState<ColumnMapping[]>(defaultCols);

  // --- State: template ---
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // --- Auto-suggested template ---
  const suggestedTemplate = useMemo(() => {
    if (templates.length === 0 || headers.length === 0) return null;
    let best: MappingTemplateItem | null = null;
    let bestScore = 0;
    for (const t of templates) {
      const score = templateHeaderScore(
        t.mapping.columns,
        t.mapping.url_column,
        headers,
      );
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best && bestScore >= TEMPLATE_SUGGEST_THRESHOLD ? best : null;
  }, [templates, headers]);

  // --- Submit ---
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const urlColumn = urlIndex >= 0 ? (headers[urlIndex] ?? "") : "";
  const urlOptions = useMemo(
    () =>
      headers.map((h, i) => (
        <option key={i} value={String(i)}>
          {h || `Column ${i + 1}`}
        </option>
      )),
    [headers],
  );

  const handleSave = useCallback(() => {
    if (urlIndex < 0) {
      setError("Choose the URL column.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveCsvMappingAction({
        job_id: jobId,
        upload_id: uploadId,
        url_index: urlIndex,
        url_column: urlColumn || `Column ${urlIndex + 1}`,
        columns: columns.filter((c) => c.index !== urlIndex),
        template_id: selectedTemplateId,
        save_as_template: saveAsTemplate,
        template_name: templateName,
      });
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
      } else {
        toast.success(result.message ?? "Mapping saved.");
        onDone();
      }
    });
  }, [
    jobId,
    uploadId,
    urlIndex,
    urlColumn,
    columns,
    selectedTemplateId,
    saveAsTemplate,
    templateName,
    onDone,
  ]);

  // --- Apply a template ---
  function applyTemplate(templateId: string) {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setSelectedTemplateId(templateId);
    const resolved = applyMappingTemplate(tpl.mapping, headers, rows[0]);
    setUrlIndex(resolved.urlIndex);
    setColumns(resolved.columns);
  }

  // --- Update a single column ---
  function updateColumn(index: number, field: "label" | "type", value: string) {
    setColumns((prev) =>
      prev.map((c) => (c.index === index ? { ...c, [field]: value } : c)),
    );
  }

  // When URL column changes, rebuild the columns list
  function changeUrlIndex(newIndex: number) {
    setUrlIndex(newIndex);
    const columnsByIndex = new Map(
      columns.map((column) => [column.index, column]),
    );
    setColumns(
      headers
        .map((h, i) => {
          const existing = columnsByIndex.get(i);
          return {
            index: i,
            source: h,
            label: existing?.label ?? (h || `Column ${i + 1}`),
            type: existing?.type ?? ("text" as ColumnType),
          };
        })
        .filter((c) => c.index !== newIndex),
    );
  }

  if (headers.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          This file appears to be empty or unreadable.
        </p>
        <Button variant="outline" onClick={onDone}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Map columns</h2>
          <p className="text-muted-foreground text-sm">
            {filename} · {headers.length} columns · {rows.length} preview row
            {rows.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>

      {/* Template picker */}
      {templates.length > 0 && (
        <div className="space-y-2">
          <label htmlFor="csv-mapping-template" className="text-sm font-medium">
            Apply a saved template
            {suggestedTemplate && (
              <span className="text-muted-foreground ml-1 font-normal">
                — suggested: {suggestedTemplate.name}
              </span>
            )}
          </label>
          <div className="flex gap-2">
            <NativeSelect
              id="csv-mapping-template"
              value={selectedTemplateId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                if (id) applyTemplate(id);
                else setSelectedTemplateId(null);
              }}
              wrapperClassName="max-w-xs"
            >
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === suggestedTemplate?.id ? " ★" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}

      {/* URL column */}
      <div className="space-y-2">
        <label htmlFor="csv-url-column" className="text-sm font-medium">
          URL column <span className="text-destructive">*</span>
        </label>
        <NativeSelect
          id="csv-url-column"
          value={String(urlIndex)}
          onChange={(e) => changeUrlIndex(Number(e.target.value))}
          wrapperClassName="max-w-xs"
          aria-required
        >
          <option value="-1" disabled>
            Choose the URL column…
          </option>
          {urlOptions}
        </NativeSelect>
        {urlIndex >= 0 && (
          <p className="text-muted-foreground max-w-xl truncate text-xs">
            Sample: {rows[0]?.[urlIndex] || "—"}
          </p>
        )}
        {urlIndex < 0 && error && (
          <p className="text-destructive text-sm">{error}</p>
        )}
      </div>

      {/* Column mapping */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Other columns</h3>
        <p className="text-muted-foreground text-xs">
          Give each column a label and choose how to treat it. Set columns you
          don&apos;t need to <strong>Ignore</strong>.
        </p>
        {columns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No extra columns (single-column file).
          </p>
        ) : (
          <VirtualizedColumnMappings
            columns={columns}
            sampleRow={rows[0] ?? []}
            onChange={updateColumn}
          />
        )}
      </div>

      {/* Save as template */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={saveAsTemplate}
            onChange={(e) => setSaveAsTemplate(e.target.checked)}
            className="accent-primary size-4 rounded"
          />
          Save this mapping as a reusable template
        </label>
        {saveAsTemplate && (
          <Input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={`e.g. Ahrefs ${kind}`}
            className="max-w-xs"
            aria-label="Template name"
            maxLength={100}
          />
        )}
      </div>

      {/* Error + save */}
      {error && urlIndex >= 0 && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={pending || urlIndex < 0}>
          {pending ? "Saving…" : "Save mapping"}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function VirtualizedColumnMappings({
  columns,
  sampleRow,
  onChange,
}: {
  columns: ColumnMapping[];
  sampleRow: string[];
  onChange: (index: number, field: "label" | "type", value: string) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const virtualized = columns.length > VIRTUALIZE_AFTER;
  const start = virtualized
    ? Math.max(0, Math.floor(scrollTop / COLUMN_ROW_HEIGHT) - COLUMN_OVERSCAN)
    : 0;
  const end = virtualized
    ? Math.min(
        columns.length,
        Math.ceil((scrollTop + COLUMN_VIEWPORT_HEIGHT) / COLUMN_ROW_HEIGHT) +
          COLUMN_OVERSCAN,
      )
    : columns.length;
  const visibleColumns = columns.slice(start, end);

  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border",
        virtualized && "max-h-[22rem]",
      )}
      onScroll={
        virtualized
          ? (event) => setScrollTop(event.currentTarget.scrollTop)
          : undefined
      }
      tabIndex={virtualized ? 0 : undefined}
      role={virtualized ? "region" : undefined}
      aria-label={
        virtualized ? "Column mappings; scroll to see all columns" : undefined
      }
    >
      <Table aria-rowcount={columns.length + 1}>
        <TableHeader
          className={
            virtualized ? "bg-background sticky top-0 z-10" : undefined
          }
        >
          <TableRow>
            <TableHead>Header</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Sample</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {start > 0 && (
            <tr aria-hidden="true" className="border-0">
              <td
                colSpan={4}
                className="p-0"
                style={{ height: start * COLUMN_ROW_HEIGHT }}
              />
            </tr>
          )}
          {visibleColumns.map((col, offset) => {
            const rowIndex = start + offset + 2;
            return (
              <TableRow
                key={col.index}
                aria-rowindex={virtualized ? rowIndex : undefined}
                className="h-16"
              >
                <TableCell className="text-muted-foreground max-w-[16rem] truncate text-xs">
                  {col.source || `Column ${col.index + 1}`}
                </TableCell>
                <TableCell>
                  <Input
                    value={col.label}
                    onChange={(e) =>
                      onChange(col.index, "label", e.target.value)
                    }
                    className="h-8 min-w-[8rem] text-sm"
                    aria-label={`Label for ${col.source || `Column ${col.index + 1}`}`}
                    disabled={col.type === "ignore"}
                  />
                </TableCell>
                <TableCell>
                  <NativeSelect
                    value={col.type}
                    onChange={(e) =>
                      onChange(col.index, "type", e.target.value)
                    }
                    aria-label={`Type for ${col.source || `Column ${col.index + 1}`}`}
                    wrapperClassName="min-w-[6rem]"
                  >
                    {COLUMN_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {COLUMN_TYPE_LABEL[type]}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[12rem] truncate text-xs">
                  {sampleRow[col.index] || "—"}
                </TableCell>
              </TableRow>
            );
          })}
          {end < columns.length && (
            <tr aria-hidden="true" className="border-0">
              <td
                colSpan={4}
                className="p-0"
                style={{ height: (columns.length - end) * COLUMN_ROW_HEIGHT }}
              />
            </tr>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
