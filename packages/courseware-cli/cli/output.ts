// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError, type CliIssue } from "./errors.ts";
import { formatSelected, selectFromData } from "./output-select.ts";

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  warnings?: CliIssue[];
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    issues: CliIssue[];
  };
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface OutputOptions {
  pretty: boolean;
  /**
   * When true (agent runtime default), mutation success payloads should be
   * slimmed to ids/counts/warnings. Callers apply `maybeQuietMutationData`.
   */
  quiet?: boolean;
  /** `--select <path>`: print only that part of `data` (scalars raw). See output-select.ts. */
  select?: string;
}

/** `--select` failure fallback: payloads above this are summarized, not printed. */
export const SELECT_FALLBACK_MAX_CHARS = 2000;

const stringify = (value: unknown, pretty: boolean): string =>
  pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);

export const printSuccess = <T>(
  data: T,
  options: OutputOptions,
  warnings?: CliIssue[],
): void => {
  const envelope: SuccessEnvelope<T> = { ok: true, data };
  if (warnings && warnings.length > 0) envelope.warnings = warnings;
  const select = options.select?.trim();
  if (select) {
    try {
      const selected = selectFromData(data, select);
      process.stdout.write(`${formatSelected(selected, options.pretty)}\n`);
      // Warnings must not vanish just because stdout carries only the selection.
      if (envelope.warnings) {
        process.stderr.write(`${stringify({ warnings: envelope.warnings }, options.pretty)}\n`);
      }
      return;
    } catch (error) {
      // The command itself succeeded (mutations are already saved), so stay ok:true and
      // never look like a failed write to retry. Small payloads are shown in full; large
      // ones (whole slides) only list their top-level keys so a typo does not flood context.
      const message = error instanceof Error ? error.message : String(error);
      const hint = error instanceof AinobiCliError && error.hint ? ` ${error.hint}` : "";
      const fullJson = JSON.stringify(data);
      const showFull = fullJson === undefined || fullJson.length <= SELECT_FALLBACK_MAX_CHARS;
      const fallback: Record<string, unknown> = { ok: true };
      if (showFull) {
        fallback.data = data;
      } else if (data && typeof data === "object" && !Array.isArray(data)) {
        fallback.data_keys = Object.keys(data as Record<string, unknown>);
      }
      fallback.warnings = [
        ...(envelope.warnings ?? []),
        {
          path: "--select",
          message: `${message}${hint} ${showFull ? "Showing the full result instead." : `Result omitted (${fullJson.length} chars); fix the path and re-run.`}`,
        },
      ];
      process.stdout.write(`${stringify(fallback, options.pretty)}\n`);
      return;
    }
  }
  process.stdout.write(`${stringify(envelope, options.pretty)}\n`);
};

export const printError = (
  error: unknown,
  options: OutputOptions,
): void => {
  let envelope: ErrorEnvelope;
  if (error instanceof AinobiCliError) {
    envelope = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        issues: error.issues,
      },
    };
  } else if (error instanceof Error) {
    envelope = {
      ok: false,
      error: {
        code: "INTERNAL",
        message: error.message,
        issues: [],
      },
    };
  } else {
    envelope = {
      ok: false,
      error: {
        code: "INTERNAL",
        message: String(error),
        issues: [],
      },
    };
  }
  process.stderr.write(`${stringify(envelope, options.pretty)}\n`);
};
