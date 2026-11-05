// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import { coursewareOrgIdFromEnv } from "./courseware-persistence-org.ts";
import { isDesignTemplateHostFlush } from "./runtime.ts";
import { cliEnv } from "./env.ts";

type HostJson = Record<string, unknown>;

const designTemplateHostBase = (): string => {
  const raw = cliEnv().AINOBI_DESIGN_TEMPLATE_HOST_BASE?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent design-template requires `AINOBI_DESIGN_TEMPLATE_HOST_BASE` (set by the AINOBI host).",
    );
  }
  return raw.replace(/\/$/, "");
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const hostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_DESIGN_TEMPLATE_HOST_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
};

async function hostJsonRequest(
  method: string,
  url: string,
  body?: unknown,
): Promise<HostJson> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...uploadAuthHeaders(),
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(hostTimeoutMs()),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Design template host request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: `${method} ${url}` },
    );
  }

  const text = await response.text();
  let parsed: HostJson;
  try {
    parsed = JSON.parse(text) as HostJson;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Design template host returned non-JSON (HTTP ${response.status}).`,
      { hint: `${method} ${url}` },
    );
  }

  if (!response.ok || parsed.ok === false) {
    throw new AinobiCliError(
      "IO_ERROR",
      (typeof parsed.error === "string" && parsed.error) ||
        `Design template host failed (HTTP ${response.status}).`,
      { hint: `${method} ${url}` },
    );
  }

  return parsed;
}

function resolveOrgId(explicit?: string): string {
  const orgId = explicit?.trim() || coursewareOrgIdFromEnv()?.trim();
  if (!orgId) {
    throw new AinobiCliError(
      "USAGE",
      "Organization id is required (--org-id or AINOBI_COURSEWARE_ORG_ID).",
    );
  }
  return orgId;
}

export async function listDesignTemplatesViaHost(args: {
  orgId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<HostJson> {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError("INTERNAL", "listDesignTemplatesViaHost called without host flush.");
  }
  const orgId = resolveOrgId(args.orgId);
  const params = new URLSearchParams({ orgId });
  if (args.q?.trim()) params.set("q", args.q.trim());
  if (args.page) params.set("page", String(args.page));
  if (args.pageSize) params.set("pageSize", String(args.pageSize));
  return hostJsonRequest("GET", `${designTemplateHostBase()}?${params.toString()}`);
}

export async function getDesignTemplateViaHost(args: {
  id: string;
  orgId?: string;
}): Promise<HostJson> {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError("INTERNAL", "getDesignTemplateViaHost called without host flush.");
  }
  const orgId = resolveOrgId(args.orgId);
  const id = args.id.trim();
  if (!id) {
    throw new AinobiCliError("USAGE", "Template id is required.");
  }
  const params = new URLSearchParams({ orgId });
  return hostJsonRequest("GET", `${designTemplateHostBase()}/${encodeURIComponent(id)}?${params.toString()}`);
}

export async function saveDesignTemplateViaHost(args: {
  orgId?: string;
  name: string;
  content: string;
  description?: string;
  sourceType?: string;
}): Promise<HostJson> {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError("INTERNAL", "saveDesignTemplateViaHost called without host flush.");
  }
  const orgId = resolveOrgId(args.orgId);
  const name = args.name.trim();
  const content = args.content.trim();
  if (!name || !content) {
    throw new AinobiCliError("USAGE", "Both --name and --content (or --content-file) are required.");
  }
  return hostJsonRequest("POST", designTemplateHostBase(), {
    orgId,
    name,
    content,
    description: args.description?.trim() || null,
    sourceType: args.sourceType?.trim() || "manual",
    pretty: true,
  });
}

export async function extractDesignTemplateViaHost(args: {
  orgId?: string;
  name: string;
  sourceType: "courseware" | "asset";
  coursewareId?: string;
  assetId?: string;
  description?: string;
  language?: string;
}): Promise<HostJson> {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError("INTERNAL", "extractDesignTemplateViaHost called without host flush.");
  }
  const orgId = resolveOrgId(args.orgId);
  return hostJsonRequest("POST", `${designTemplateHostBase()}/extract`, {
    orgId,
    name: args.name.trim(),
    sourceType: args.sourceType,
    coursewareId: args.coursewareId?.trim() || undefined,
    assetId: args.assetId?.trim() || undefined,
    description: args.description?.trim() || null,
    language: args.language?.trim() || "auto",
    pretty: true,
  });
}

export async function deleteDesignTemplateViaHost(args: {
  id: string;
  orgId?: string;
}): Promise<HostJson> {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError("INTERNAL", "deleteDesignTemplateViaHost called without host flush.");
  }
  const orgId = resolveOrgId(args.orgId);
  const id = args.id.trim();
  if (!id) {
    throw new AinobiCliError("USAGE", "Template id is required.");
  }
  const params = new URLSearchParams({ orgId });
  return hostJsonRequest(
    "DELETE",
    `${designTemplateHostBase()}/${encodeURIComponent(id)}?${params.toString()}`,
  );
}
