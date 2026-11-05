// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";

interface CoursewareInternalEditHintProps {
  title?: string;
  children: ReactNode;
}

/** Shown above a stage element during inline SVG / rich internal editing. */
export function CoursewareInternalEditHint({ title, children }: CoursewareInternalEditHintProps) {
  return (
    <div
      className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 max-w-[min(100%,24rem)] rounded bg-slate-900/85 px-2 py-0.5 text-[10px] leading-snug text-slate-200 shadow-sm"
      title={title}
    >
      {children}
    </div>
  );
}
