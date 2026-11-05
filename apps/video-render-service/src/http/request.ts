// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import { sendJsonWithCors } from "./cors.ts";

/** Pathname without query string; trailing slash normalized away except root. */
export function requestPathname(url: string | undefined): string {
  if (!url) {
    return "/";
  }

  try {
    const pathname = new URL(url, "http://localhost").pathname;
    return pathname.replace(/\/$/, "") || "/";
  } catch {
    const path = url.split("?")[0] ?? url;
    return path.replace(/\/$/, "") || "/";
  }
}

export class PayloadTooLargeError extends Error {
  readonly status = 413;

  constructor(message = "Request body too large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

const DEFAULT_MAX_BODY_BYTES = 1_000_000; // 1MB — plenty for the JSON render request bodies this API accepts.

function resolveMaxBodyBytes(): number {
  const raw = process.env.AINOBI_HTTP_MAX_BODY_BYTES?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_BODY_BYTES;
}

/** Reads and JSON-parses the request body, enforcing a byte-size cap to bound memory use. */
export function readJsonBody<T>(req: IncomingMessage, maxBytes = resolveMaxBodyBytes()): Promise<T> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let settled = false;

    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.destroy();
      reject(error);
    };

    req.on("data", (chunk) => {
      if (settled) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        settleReject(new PayloadTooLargeError());
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("error", (error) =>
      settleReject(error instanceof Error ? error : new Error(String(error))),
    );
    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): void {
  sendJsonWithCors(res, status, payload, extraHeaders);
}
