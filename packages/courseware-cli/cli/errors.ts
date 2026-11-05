// SPDX-License-Identifier: AGPL-3.0-only
import * as yup from "yup";

export interface CliIssue {
  path: string;
  message: string;
  value?: unknown;
}

export type CliErrorCode =
  | "USAGE"
  | "NOT_LOADED"
  | "ALREADY_LOADED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "VALIDATION_ERROR"
  | "IO_ERROR"
  | "UNSUPPORTED"
  | "INTERNAL";

export class AinobiCliError extends Error {
  public readonly code: CliErrorCode;
  public readonly issues: CliIssue[];
  public readonly hint?: string;

  public constructor(
    code: CliErrorCode,
    message: string,
    options: { issues?: CliIssue[]; hint?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.code = code;
    this.issues = options.issues ?? [];
    this.hint = options.hint;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

const truncate = (value: unknown): unknown => {
  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  return value;
};

/**
 * Convert a yup.ValidationError into a flat list of issues that AI agents can act on.
 * Each issue contains the failing path (dot/bracket notation) and the actual value.
 */
export const issuesFromYupError = (error: unknown, prefix = ""): CliIssue[] => {
  const join = (path: string): string => {
    if (!prefix) return path || "(root)";
    if (!path) return prefix;
    return path.startsWith("[") ? `${prefix}${path}` : `${prefix}.${path}`;
  };
  if (!(error instanceof yup.ValidationError)) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ path: prefix || "(root)", message }];
  }
  if (error.inner.length === 0) {
    return [
      {
        path: join(error.path ?? ""),
        message: error.message,
        value: truncate(error.value),
      },
    ];
  }
  return error.inner.map((inner) => ({
    path: join(inner.path ?? ""),
    message: inner.message,
    value: truncate(inner.value),
  }));
};

/**
 * Errors thrown by `deserializeElement` / `deserializeScene` are plain Error objects
 * shaped like `${path}: ${message}`. Convert them back into structured issues
 * so the JSON envelope keeps its `path/message` invariants.
 */
export const issuesFromString = (message: string, fallbackPath = "(root)"): CliIssue[] => {
  const colonIdx = message.indexOf(": ");
  if (colonIdx <= 0) return [{ path: fallbackPath, message }];
  const rawPath = message.slice(0, colonIdx).trim();
  const path = rawPath === "root" && fallbackPath !== "(root)" ? fallbackPath : rawPath;
  const detail = message.slice(colonIdx + 2).trim();
  if (!detail) return [{ path: fallbackPath, message }];
  const segments = detail
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) {
    const innerColon = detail.indexOf(": ");
    if (innerColon > 0) {
      const innerPath = detail.slice(0, innerColon).trim();
      const innerMessage = detail.slice(innerColon + 2).trim();
      return [
        {
          path: innerPath ? `${path}.${innerPath}` : path || fallbackPath,
          message: innerMessage || detail,
        },
      ];
    }
    return [{ path: path || fallbackPath, message: detail }];
  }
  return segments.map((segment) => {
    const innerColon = segment.indexOf(": ");
    if (innerColon <= 0) {
      return { path: path || fallbackPath, message: segment };
    }
    const innerPath = segment.slice(0, innerColon).trim();
    const innerMessage = segment.slice(innerColon + 2).trim();
    return {
      path: innerPath ? `${path}.${innerPath}` : path || fallbackPath,
      message: innerMessage,
    };
  });
};
