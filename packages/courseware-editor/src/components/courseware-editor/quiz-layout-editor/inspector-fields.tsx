// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";

/** Coerce an AST style value (number or "12px"/"#fff"/…) to a number, else null. */
const parsePx = (value: string | number | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
    if (m) return Number(m[1]);
  }
  return null;
};

/** Expand `#abc` → `#aabbcc`; return null if not a usable hex for <input type=color>. */
const toPickerHex = (value: string | number | undefined): string | null => {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  return null;
};

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: string | number | undefined;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | null) => void;
}) {
  const numeric = parsePx(value);
  const [draft, setDraft] = useState(numeric === null ? "" : String(numeric));
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value;
      const n = parsePx(value);
      setDraft(n === null ? "" : String(n));
    }
  }, [value]);

  const commit = (raw: string, allowEmpty: boolean): void => {
    if (raw.trim() === "") {
      if (allowEmpty) onChange(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    if (min !== undefined && n < min) return;
    if (max !== undefined && n > max) return;
    onChange(n);
  };

  return (
    <label className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 truncate text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          commit(raw, false);
        }}
        onBlur={(e) => commit(e.target.value, true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400"
      />
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string | null) => void;
}) {
  const raw = typeof value === "string" ? value : "";
  const pickerHex = toPickerHex(value) ?? "#000000";
  const [textDraft, setTextDraft] = useState(raw);
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value;
      setTextDraft(typeof value === "string" ? value : "");
    }
  }, [value]);

  return (
    <label className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 truncate text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type="color"
        value={pickerHex}
        onChange={(e) => {
          setTextDraft(e.target.value);
          onChange(e.target.value);
        }}
        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0 dark:border-slate-600 dark:bg-slate-800"
      />
      <input
        type="text"
        value={textDraft}
        placeholder="—"
        onChange={(e) => {
          const next = e.target.value;
          setTextDraft(next);
          const trimmed = next.trim();
          if (trimmed !== "") onChange(trimmed);
        }}
        onBlur={(e) => onChange(e.target.value.trim() === "" ? null : e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400"
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const current = value === undefined || value === null ? "" : String(value);
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 truncate text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
      <select
        value={options.some((o) => o.value === current) ? current : ""}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-1 text-[11px] text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value;
      setDraft(value);
    }
  }, [value]);
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 truncate text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          onCommit(next);
        }}
        className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400"
      />
    </label>
  );
}
