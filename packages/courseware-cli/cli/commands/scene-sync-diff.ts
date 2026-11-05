// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ParsedArgs } from "../args.ts";
import { flagNumber } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import {
  formatSceneDiffReportPage,
  SCENE_SYNC_DIFF_REPORT_FILENAME,
  type SceneSyncDiffReport,
} from "../scene-sync-diff.ts";
import { cliEnv } from "../env.ts";

const sessionRoot = (): string => {
  const dir = cliEnv().AINOBI_STATE_DIR?.trim();
  if (!dir) {
    throw new AinobiCliError(
      "NOT_LOADED",
      "AINOBI_STATE_DIR is not set; scene-sync diff is only available in an agent workspace after host reload.",
    );
  }
  return resolve(dir);
};

const readReport = (): SceneSyncDiffReport => {
  const path = join(sessionRoot(), SCENE_SYNC_DIFF_REPORT_FILENAME);
  if (!existsSync(path)) {
    throw new AinobiCliError(
      "NOT_FOUND",
      `No scene-sync diff report at ${path}. The host writes this when reloading a stale CLI session from the database.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new AinobiCliError("INVALID_INPUT", `Could not parse ${path} as JSON.`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new AinobiCliError("INVALID_INPUT", "Scene-sync diff report is not an object.");
  }
  const report = parsed as Partial<SceneSyncDiffReport>;
  if (report.version !== 1 || !Array.isArray(report.lines)) {
    throw new AinobiCliError("INVALID_INPUT", "Scene-sync diff report has an unsupported shape.");
  }
  return report as SceneSyncDiffReport;
};

export const handleInspectSceneSync = (args: ParsedArgs, output: OutputOptions): void => {
  const report = readReport();
  const page = Math.max(1, flagNumber(args, "page") ?? 1);
  const pageSizeOverride = flagNumber(args, "page-size");
  const effectiveReport =
    pageSizeOverride != null && pageSizeOverride > 0
      ? {
          ...report,
          page_size: pageSizeOverride,
          total_pages: Math.max(1, Math.ceil(report.total_changes / pageSizeOverride)),
        }
      : report;

  const totalPages = effectiveReport.total_pages;
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * effectiveReport.page_size;
  const end = Math.min(start + effectiveReport.page_size, report.lines.length);
  const lines = report.lines.slice(start, end);

  printSuccess(
    {
      report_path: join(sessionRoot(), SCENE_SYNC_DIFF_REPORT_FILENAME),
      before_label: report.before_label,
      after_label: report.after_label,
      generated_at: report.generated_at,
      total_changes: report.total_changes,
      page: safePage,
      total_pages: totalPages,
      page_size: effectiveReport.page_size,
      lines,
      summary_text: formatSceneDiffReportPage(effectiveReport, safePage),
      next_page:
        safePage < totalPages ? { page: safePage + 1, command: `ainobi inspect scene-sync --page ${safePage + 1}` } : null,
    },
    output,
  );
};
