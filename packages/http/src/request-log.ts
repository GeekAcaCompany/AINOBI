// SPDX-License-Identifier: AGPL-3.0-only
// HTTP access log shared by the platform's Node services: 2xx/3xx at info, 4xx/5xx at
// error with the response body or thrown detail, in the `[http] OK/FAIL` structured style.
// Logs are not part of any API contract.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpRequestLogContext } from './types.ts';

const MAX_ERROR_BODY_CHARS = 4096;

export type HttpRequestLogExtra = {
  error?: unknown;
};

export type HttpRequestLogOptions = {
  /**
   * Which JSON field of an error body names the failure, in order of preference. The
   * services' bodies are `{ error }`; the backend envelope is `{ code, message }`.
   */
  errorBodyKeys?: readonly ('error' | 'message')[];
};

const DEFAULT_ERROR_BODY_KEYS = ['error', 'message'] as const;

/** Format an unknown error into a detailed loggable string (with stack / cause). */
export function formatErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message];
    if (error.stack) {
      parts.push(error.stack);
    }
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      parts.push(`cause: ${formatErrorDetail(cause)}`);
    }
    return parts.join('\n');
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function parseJsonErrorFromBody(
  body: string,
  keys: readonly ('error' | 'message')[],
): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return trimmed.slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    return trimmed.slice(0, MAX_ERROR_BODY_CHARS);
  }
}

/**
 * Write the HTTP access log when `res` finishes: 2xx/3xx as info, 4xx/5xx as error with the response body or exception details.
 * OPTIONS (CORS preflight) is not logged.
 */
export function attachHttpRequestLogging(
  req: IncomingMessage,
  res: ServerResponse,
  baseContext: HttpRequestLogContext,
  getExtra?: () => HttpRequestLogExtra,
  options: HttpRequestLogOptions = {},
): void {
  if (baseContext.method === 'OPTIONS') {
    return;
  }
  const errorBodyKeys = options.errorBodyKeys ?? DEFAULT_ERROR_BODY_KEYS;

  const startedAt = Date.now();
  let capturedBody = '';

  const originalEnd = res.end.bind(res);
  res.end = function endWithCapture(
    chunk?: Parameters<typeof res.end>[0],
    encodingOrCb?: Parameters<typeof res.end>[1],
    cb?: Parameters<typeof res.end>[2],
  ) {
    const status = res.statusCode || 200;
    if (status >= 400 && chunk != null) {
      const piece = Buffer.isBuffer(chunk)
        ? chunk.toString(typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8')
        : String(chunk);
      if (capturedBody.length < MAX_ERROR_BODY_CHARS) {
        capturedBody += piece;
      }
    }
    return originalEnd(chunk, encodingOrCb as never, cb as never);
  } as typeof res.end;

  res.on('finish', () => {
    const statusCode = res.statusCode || 200;
    const durationMs = Date.now() - startedAt;
    const extra = getExtra?.();
    const context = {
      method: baseContext.method,
      pathname: baseContext.pathname,
      url: baseContext.url,
      userId: baseContext.userId,
      orgId: baseContext.orgId,
      statusCode,
      durationMs,
    };

    if (statusCode < 400 && !extra?.error) {
      console.info('[http] OK', context);
      return;
    }

    const responseError = capturedBody
      ? parseJsonErrorFromBody(capturedBody, errorBodyKeys)
      : undefined;
    const thrownDetail = extra?.error ? formatErrorDetail(extra.error) : undefined;
    const detail = thrownDetail ?? responseError ?? `HTTP ${statusCode}`;

    console.error('[http] FAIL', {
      ...context,
      detail,
      ...(extra?.error instanceof Error && extra.error.stack ? { stack: extra.error.stack } : {}),
      ...(responseError && responseError !== detail ? { responseError } : {}),
    });
  });
}

export function requestLogContext(req: IncomingMessage, pathname: string): HttpRequestLogContext {
  return {
    method: req.method ?? 'GET',
    pathname,
    url: req.url,
  };
}
