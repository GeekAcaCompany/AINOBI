// SPDX-License-Identifier: AGPL-3.0-only
import { Loader2 } from "lucide-react";

interface VtuberModelLoadingPlaceholderProps {
  label?: string;
  /** When false, fills a flex parent instead of absolute overlay. */
  overlay?: boolean;
  /** Dashed frame (editor slot chrome); default off for overlay spinner-only. */
  showBorder?: boolean;
}

/** Spinner while model assets load. Transparent background only. */
export function VtuberModelLoadingPlaceholder({
  label,
  overlay = true,
  showBorder = false,
}: VtuberModelLoadingPlaceholderProps) {
  const borderClass = showBorder
    ? "rounded-md border border-dashed border-slate-400/60 dark:border-slate-500/60"
    : "";
  const className = overlay
    ? `pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-transparent ${borderClass}`
    : `pointer-events-none flex h-full w-full flex-col items-center justify-center gap-2 bg-transparent ${borderClass}`;

  return (
    <div className={className} aria-busy="true" aria-live="polite">
      <Loader2
        className="h-7 w-7 animate-spin text-slate-400 dark:text-slate-500"
        aria-hidden
      />
      {label ? (
        <span className="text-[11px] text-slate-400 dark:text-slate-500">{label}</span>
      ) : null}
    </div>
  );
}
