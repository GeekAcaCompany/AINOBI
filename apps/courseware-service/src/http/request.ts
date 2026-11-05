// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { corsHeaders, sendJsonWithCors } from "./cors.ts";
import { projectRoot, runtimeDir } from "../runtime-paths.ts";
import { CoursewareOrgAccessError } from "../services/courseware-org-guard.ts";

const publicRoots = [resolve(projectRoot, "public"), runtimeDir];

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

export function readJsonBody<T>(
  req: IncomingMessage,
  options?: { maxBytes?: number },
): Promise<T> {
  const maxBytes = options?.maxBytes;
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    req.on("data", (chunk) => {
      const buf = Buffer.from(chunk);
      total += buf.length;
      if (typeof maxBytes === "number" && maxBytes > 0 && total > maxBytes) {
        fail(new Error(`Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("error", fail);
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

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  sendJsonWithCors(res, status, payload);
}

export function writeSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** SSE comment line for proxy keep-alive (ignored by EventSource consumers). */
export function writeSseComment(res: ServerResponse, comment = "ping"): void {
  res.write(`: ${comment}\n\n`);
}

export function sendStaticHtml(res: ServerResponse, fileName: string): void {
  for (const root of publicRoots) {
    const filePath = resolve(root, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
      ...corsHeaders(),
    });
    res.end(readFileSync(filePath, "utf8"));
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

/** Serve a file from `public/` or runtime dir (binary-safe). */
export function sendStaticFile(
  res: ServerResponse,
  relativePath: string,
  options?: { contentType?: string; downloadName?: string },
): boolean {
  const rel = relativePath.replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.includes("\0")) {
    return false;
  }
  for (const root of publicRoots) {
    const filePath = resolve(root, rel);
    const normalizedRoot = resolve(root);
    if (
      (filePath !== normalizedRoot && !filePath.startsWith(normalizedRoot + sep)) ||
      !existsSync(filePath)
    ) {
      continue;
    }
    const body = readFileSync(filePath);
    const headers: Record<string, string> = {
      "content-type": options?.contentType || "application/octet-stream",
      "content-length": String(body.length),
      "cache-control": "public, max-age=300",
      ...corsHeaders(),
    };
    if (options?.downloadName) {
      headers["content-disposition"] =
        `attachment; filename="${options.downloadName.replace(/"/g, "")}"`;
    }
    res.writeHead(200, headers);
    res.end(body);
    return true;
  }
  return false;
}

export function chatErrorStatus(error: unknown): number {
  if (error instanceof CoursewareOrgAccessError) {
    return error.status;
  }

  if (!(error instanceof Error)) {
    return 500;
  }

  if (error.message === "Missing prompt" || error.message.startsWith("Missing baseUrl")) {
    return 400;
  }
  if (error.message.startsWith("Unknown conversationId:") || error.message.startsWith("Unknown coursewareId:")) {
    return 400;
  }
  if (error.message.startsWith("ainobi load failed")) {
    return 502;
  }
  return 500;
}
