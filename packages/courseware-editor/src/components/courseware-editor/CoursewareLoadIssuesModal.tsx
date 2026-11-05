// SPDX-License-Identifier: AGPL-3.0-only
import { AlertTriangle, X } from "lucide-react";

export type CoursewareLoadIssueRow = {
  path: string;
  message: string;
  action?: string;
};

type CoursewareLoadIssuesModalProps = {
  open: boolean;
  issues: CoursewareLoadIssueRow[];
  title: string;
  description: string;
  closeLabel: string;
  pathLabel: string;
  messageLabel: string;
  actionLabel: string;
  onClose: () => void;
};

/**
 * When field repairs / lenient parsing happen during the initial courseware load, this dialog lists the issues without blocking editing.
 */
export function CoursewareLoadIssuesModal({
  open,
  issues,
  title,
  description,
  closeLabel,
  pathLabel,
  messageLabel,
  actionLabel,
  onClose,
}: CoursewareLoadIssuesModalProps) {
  if (!open || issues.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-80 flex items-center justify-center bg-slate-900/40 p-6 dark:bg-slate-950/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="courseware-load-issues-title"
    >
      <div className="flex max-h-[min(80vh,640px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-amber-200/80 bg-white shadow-2xl dark:border-amber-900/50 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-amber-100 px-4 py-3 dark:border-amber-950/60">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 ring-1 ring-amber-500/25">
              <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <h2
                id="courseware-load-issues-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {title}
              </h2>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <th className="py-1.5 pr-3 font-medium">{pathLabel}</th>
                <th className="py-1.5 pr-3 font-medium">{messageLabel}</th>
                <th className="py-1.5 font-medium">{actionLabel}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue, index) => (
                <tr
                  key={`${issue.path}:${index}`}
                  className="border-b border-slate-100 align-top dark:border-slate-800"
                >
                  <td className="max-w-48 py-2 pr-3 font-mono text-[11px] break-all text-slate-700 dark:text-slate-300">
                    {issue.path}
                  </td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{issue.message}</td>
                  <td className="whitespace-nowrap py-2 text-slate-500 dark:text-slate-500">
                    {issue.action ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
