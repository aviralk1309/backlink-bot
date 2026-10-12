"use client";

import {
  useId,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addEntries,
  splitEntries,
  type ChipKind,
  type ChipOptions,
} from "./form-values";

type Props = {
  /**
   * Name of the hidden inputs, one per chip (repeated form entries). Leave
   * it out when the parent keeps the values in state and serializes itself.
   */
  name?: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  options: ChipOptions;
  placeholder?: string;
  hint?: string;
  /** Shown next to the label, for example "(needed to start)". */
  tag?: string;
};

// Domains and URLs never contain spaces, so a space also adds the chip.
const SPACE_ADDS: readonly ChipKind[] = ["domain", "url"];

/**
 * A list of chips with a text box. Enter, comma (and space for domains and
 * URLs) add the typed text, pasting a list adds many at once, Backspace on
 * an empty box removes the last chip, and leaving the box adds what is typed
 * so nothing is lost on Save. Valid entries are cleaned as they are added
 * (domains lose "https://www." and paths); invalid ones stay in the box with
 * a message.
 */
export function ChipInput({
  name,
  label,
  values,
  onChange,
  options,
  placeholder,
  hint,
  tag,
}: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const joiner = options.kind === "url" ? " " : ", ";

  function commit(raw: string) {
    if (!raw.trim()) return;
    const result = addEntries(values, raw, options);
    if (result.values.length !== values.length) onChange(result.values);
    setText(result.rejected.join(joiner));
    setError(result.error);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Enter") {
      // Never submit the whole form from here by accident.
      e.preventDefault();
      commit(text);
      return;
    }
    if (e.key === "," || e.key === ";") {
      if (options.kind === "url" && e.key === ",") return; // commas are valid in URLs
      e.preventDefault();
      commit(text);
      return;
    }
    if (e.key === " " && SPACE_ADDS.includes(options.kind) && text.trim()) {
      e.preventDefault();
      commit(text);
      return;
    }
    if (e.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (splitEntries(pasted, options.kind).length > 1) {
      e.preventDefault();
      commit(text ? `${text}\n${pasted}` : pasted);
    }
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

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

      <div
        className={cn(
          "border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/30 flex max-h-56 min-h-9 flex-wrap items-center gap-1.5 overflow-auto rounded-lg border p-1.5 focus-within:ring-3 pointer-coarse:min-h-11",
          error && "border-destructive",
        )}
      >
        {values.map((v, i) => (
          <span
            key={v}
            className="bg-muted inline-flex max-w-full items-center gap-0.5 rounded-md py-0.5 pr-0.5 pl-2 text-xs"
          >
            <span className="truncate" title={v}>
              {v}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${v}`}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 pointer-coarse:size-8"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit(text)}
          placeholder={values.length === 0 ? placeholder : undefined}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="placeholder:text-muted-foreground min-w-40 flex-1 bg-transparent px-1 py-0.5 text-base outline-none md:text-sm"
        />
      </div>

      {name
        ? values.map((v) => (
            <input key={v} type="hidden" name={name} value={v} />
          ))
        : null}

      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
          {values.length > 0
            ? ` ${values.length} of ${options.max} added.`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
