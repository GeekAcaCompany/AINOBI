// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { corsHeaders } from "../http/cors.ts";
import { projectRoot, runtimeDir } from "../runtime-paths.ts";

const ZIP_RELATIVE = "ainobi-courseware-codex-plugin.zip";
const MCP_PLACEHOLDER = "{{MCP_URL}}";
const MCP_HOST_PLACEHOLDER = "https://YOUR_COURSEWARE_HOST/mcp";

const publicRoots = [resolve(projectRoot, "public"), runtimeDir];

const injectCache = new Map<string, Buffer>();

const INJECT_PATHS = [
  "ainobi-courseware/INSTALL.md",
  "ainobi-courseware/README.md",
  "ainobi-courseware/.app.json",
] as const;

/** Resolve this environment’s public courseware origin (no trailing slash). */
export function resolveCoursewarePublicBaseUrl(req?: IncomingMessage): string {
  const fromEnv =
    process.env.AINOBI_PUBLIC_BASE_URL?.trim() ||
    process.env.AINOBI_COURSEWARE_AGENT_BASE_URL?.trim() ||
    "";
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }

  if (req) {
    const xfProto = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      ?.trim();
    const xfHost = String(req.headers["x-forwarded-host"] || "")
      .split(",")[0]
      ?.trim();
    const host = xfHost || String(req.headers.host || "").trim();
    if (host) {
      const isLocal = host.includes("localhost") || host.startsWith("127.");
      const proto = xfProto || (isLocal ? "http" : "https");
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }

  return `http://127.0.0.1:${process.env.PORT ?? 5633}`;
}

export function resolveHostedMcpUrl(req?: IncomingMessage): string {
  return `${resolveCoursewarePublicBaseUrl(req)}/mcp`;
}

function findTemplateZipPath(): string | null {
  for (const root of publicRoots) {
    const filePath = resolve(root, ZIP_RELATIVE);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function injectMcpUrlIntoText(text: string, mcpUrl: string): string {
  return text.split(MCP_PLACEHOLDER).join(mcpUrl).split(MCP_HOST_PLACEHOLDER).join(mcpUrl);
}

/** Rewrite INSTALL.md / README / .app.json inside the plugin zip to the hosted MCP URL. */
export function injectMcpUrlIntoPluginZip(zipBytes: Uint8Array, mcpUrl: string): Buffer {
  const files = unzipSync(zipBytes);
  for (const path of INJECT_PATHS) {
    const entry = files[path];
    if (!entry) {
      continue;
    }
    let text = injectMcpUrlIntoText(strFromU8(entry), mcpUrl);
    if (path.endsWith(".app.json")) {
      try {
        const parsed = JSON.parse(text) as {
          mcpServers?: Record<string, { url?: string; description?: string }>;
        };
        if (parsed?.mcpServers?.["ainobi-courseware"]) {
          parsed.mcpServers["ainobi-courseware"].url = mcpUrl;
          parsed.mcpServers["ainobi-courseware"].description =
            "Hosted AINOBI courseware-agent MCP. Auth: Authorization Bearer <org Agent ainobi_ak_* | teacher access_token>.";
          text = `${JSON.stringify(parsed, null, 2)}\n`;
        }
      } catch {
        // keep text replace result
      }
    }
    files[path] = strToU8(text);
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function getCodexPluginZipForDownload(req?: IncomingMessage): Buffer | null {
  const templatePath = findTemplateZipPath();
  if (!templatePath) {
    return null;
  }
  const mcpUrl = resolveHostedMcpUrl(req);
  // Only cache env-derived origins. Header-derived Host/X-Forwarded-* must not
  // unbounded-grow injectCache (unauthenticated download endpoint).
  const cacheable =
    Boolean(process.env.AINOBI_PUBLIC_BASE_URL?.trim()) ||
    Boolean(process.env.AINOBI_COURSEWARE_AGENT_BASE_URL?.trim());
  if (cacheable) {
    const cached = injectCache.get(mcpUrl);
    if (cached) {
      return cached;
    }
  }
  const template = readFileSync(templatePath);
  const injected = injectMcpUrlIntoPluginZip(template, mcpUrl);
  if (cacheable) {
    injectCache.set(mcpUrl, injected);
  }
  return injected;
}

/** Clear inject cache (tests / after pack refresh). */
export function clearCodexPluginZipCache(): void {
  injectCache.clear();
}

export function sendCodexPluginZip(req: IncomingMessage, res: ServerResponse): boolean {
  const body = getCodexPluginZipForDownload(req);
  if (!body) {
    return false;
  }
  res.writeHead(200, {
    "content-type": "application/zip",
    "content-length": String(body.length),
    "cache-control": "no-cache",
    "content-disposition": 'attachment; filename="ainobi-courseware-codex-plugin.zip"',
    ...corsHeaders(),
  });
  res.end(body);
  return true;
}
