// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { requireRequestSession } from "../api-auth.ts";
import { actorFromSession } from "../auth/ainobi-org-access.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { readJsonBody } from "../http/request.ts";
import { CoursewareOrgAccessError } from "./courseware-org-guard.ts";
import { runDesignTemplateExtract } from "./courseware-design-template-extract-service.ts";
import { billDesignTemplateExtractCredits } from "./courseware-template-extract-credits.ts";
import {
  assertOrgIdAccess,
  assertOrgIdManageAccess,
  createDesignTemplate,
  deleteDesignTemplate,
  getDesignTemplateById,
  listDesignTemplates,
  updateDesignTemplate,
} from "./courseware-design-templates-service.ts";

const orgIdSchema = z.uuid();
const idSchema = z.uuid();

function orgAccessStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
}

function formatCliEnvelope(data: unknown, pretty: boolean): string {
  const envelope = { ok: true, data };
  return pretty ? `${JSON.stringify(envelope, null, 2)}\n` : `${JSON.stringify(envelope)}\n`;
}

function parseQueryOrgId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const orgId = new URL(url, "http://localhost").searchParams.get("orgId")?.trim();
    return orgId || null;
  } catch {
    return null;
  }
}

function parseQueryString(url: string | undefined, key: string): string | null {
  if (!url) return null;
  try {
    const value = new URL(url, "http://localhost").searchParams.get(key)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

const createBodySchema = z.object({
  orgId: orgIdSchema,
  name: z.string().min(1).max(128),
  content: z.string().min(1),
  description: z.string().max(512).optional().nullable(),
  sourceType: z.enum(["courseware", "asset", "manual", "extracted"]).optional(),
  sourceMeta: z.record(z.string(), z.unknown()).optional().nullable(),
  pretty: z.boolean().optional(),
});

const updateBodySchema = z.object({
  orgId: orgIdSchema,
  name: z.string().min(1).max(128).optional(),
  content: z.string().min(1).optional(),
  description: z.string().max(512).optional().nullable(),
  sourceType: z.enum(["courseware", "asset", "manual", "extracted"]).optional(),
  sourceMeta: z.record(z.string(), z.unknown()).optional().nullable(),
  pretty: z.boolean().optional(),
});

const extractBodySchema = z.object({
  orgId: orgIdSchema,
  name: z.string().min(1).max(128),
  sourceType: z.enum(["courseware", "asset"]),
  coursewareId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  description: z.string().max(512).optional().nullable(),
  language: z.enum(["auto", "zh", "en", "ja"]).optional(),
  pretty: z.boolean().optional(),
});

const deleteBodySchema = z.object({
  orgId: orgIdSchema,
});

async function resolveOrgId(req: IncomingMessage): Promise<string | null> {
  const fromQuery = parseQueryOrgId(req.url);
  if (fromQuery && orgIdSchema.safeParse(fromQuery).success) {
    return fromQuery;
  }
  const parsed = deleteBodySchema.safeParse(await readJsonBody<unknown>(req));
  return parsed.success ? parsed.data.orgId : null;
}

function formatTemplateExtractCreditsBilling(
  billing: Awaited<ReturnType<typeof billDesignTemplateExtractCredits>>,
): Record<string, unknown> | undefined {
  if (billing.kind === "charged") {
    return {
      creditsTemplateExtract: {
        serviceCode: billing.result.serviceCode,
        inputTokens: billing.usage.inputTokens,
        outputTokens: billing.usage.outputTokens,
        totalTokens: billing.usage.totalTokens,
        creditsConsumed: billing.result.creditsConsumed,
        remainingCredits: billing.result.remainingCredits,
      },
    };
  }
  if (billing.kind === "failed") {
    return { creditsTemplateExtractError: billing.error };
  }
  return undefined;
}

export function isDesignTemplatePath(pathname: string): boolean {
  return (
    pathname === "/courseware/design-templates" ||
    pathname === "/courseware/design-templates/extract" ||
    /^\/courseware\/design-templates\/[^/]+$/.test(pathname)
  );
}

export async function handleCoursewareDesignTemplates(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const pathname = req.url ? new URL(req.url, "http://localhost").pathname.replace(/\/$/, "") || "/" : "/";
  if (!isDesignTemplatePath(pathname)) {
    return false;
  }

  const session = await (async () => {
    try {
      return await requireRequestSession(req);
    } catch {
      return null;
    }
  })();
  if (!session) {
    sendJsonWithCors(res, 401, { ok: false, error: "Unauthorized" });
    return true;
  }

  const method = req.method ?? "GET";

  try {
    if (method === "GET" && pathname === "/courseware/design-templates") {
      const orgId = parseQueryOrgId(req.url);
      if (!orgId || !orgIdSchema.safeParse(orgId).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Valid orgId query is required." });
        return true;
      }
      await assertOrgIdAccess(session, orgId);
      const q = parseQueryString(req.url, "q") ?? undefined;
      const page = Number(parseQueryString(req.url, "page") ?? "1");
      const pageSize = Number(parseQueryString(req.url, "pageSize") ?? "50");
      const result = await listDesignTemplates({ orgId, q, page, pageSize });
      sendJsonWithCors(res, 200, { ok: true, ...result });
      return true;
    }

    if (method === "GET" && pathname.startsWith("/courseware/design-templates/")) {
      const id = pathname.slice("/courseware/design-templates/".length);
      if (!idSchema.safeParse(id).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Invalid template id." });
        return true;
      }
      const orgId = parseQueryOrgId(req.url);
      if (!orgId || !orgIdSchema.safeParse(orgId).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Valid orgId query is required." });
        return true;
      }
      await assertOrgIdAccess(session, orgId);
      const entity = await getDesignTemplateById(id, orgId);
      if (!entity) {
        sendJsonWithCors(res, 404, { ok: false, error: "Design template not found." });
        return true;
      }
      sendJsonWithCors(res, 200, {
        ok: true,
        template: {
          id: entity.id,
          orgId: entity.orgId,
          name: entity.name,
          description: entity.description,
          content: entity.content,
          sourceType: entity.sourceType,
          sourceMeta: entity.sourceMeta,
          createdAt: entity.createdAt.toISOString(),
          updatedAt: entity.updatedAt.toISOString(),
        },
      });
      return true;
    }

    if (method === "POST" && pathname === "/courseware/design-templates/extract") {
      const raw = await readJsonBody<unknown>(req);
      const parsed = extractBodySchema.safeParse(raw);
      if (!parsed.success) {
        sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
        return true;
      }
      const body = parsed.data;
      const extracted = await runDesignTemplateExtract(req, session, {
        orgId: body.orgId,
        name: body.name,
        sourceType: body.sourceType,
        coursewareId: body.coursewareId,
        assetId: body.assetId,
        description: body.description ?? null,
        language: body.language,
      });
      const billing = await billDesignTemplateExtractCredits({
        session,
        usage: extracted.usage,
        model: extracted.model,
        orgId: body.orgId,
        templateName: body.name,
        sourceType: body.sourceType,
        coursewareId: body.coursewareId,
        assetId: body.assetId,
      });
      const pretty = body.pretty === true;
      sendJsonWithCors(res, 200, {
        ok: true,
        template: extracted.template,
        usage: extracted.usage,
        model: extracted.model,
        stdout: formatCliEnvelope(extracted.template, pretty),
        ...formatTemplateExtractCreditsBilling(billing),
      });
      return true;
    }

    if (method === "POST" && pathname === "/courseware/design-templates") {
      const raw = await readJsonBody<unknown>(req);
      const parsed = createBodySchema.safeParse(raw);
      if (!parsed.success) {
        sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
        return true;
      }
      const body = parsed.data;
      await assertOrgIdManageAccess(session, body.orgId);
      const actor = actorFromSession(session);
      const template = await createDesignTemplate({
        orgId: body.orgId,
        name: body.name,
        content: body.content,
        description: body.description ?? null,
        sourceType: body.sourceType ?? "manual",
        sourceMeta: body.sourceMeta ?? null,
        createdBy: actor.userId,
      });
      sendJsonWithCors(res, 201, {
        ok: true,
        template,
        stdout: formatCliEnvelope(template, body.pretty === true),
      });
      return true;
    }

    if (method === "PUT" && pathname.startsWith("/courseware/design-templates/")) {
      const id = pathname.slice("/courseware/design-templates/".length);
      if (!idSchema.safeParse(id).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Invalid template id." });
        return true;
      }
      const raw = await readJsonBody<unknown>(req);
      const parsed = updateBodySchema.safeParse(raw);
      if (!parsed.success) {
        sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
        return true;
      }
      const body = parsed.data;
      await assertOrgIdManageAccess(session, body.orgId);
      const actor = actorFromSession(session);
      const template = await updateDesignTemplate({
        id,
        orgId: body.orgId,
        name: body.name,
        content: body.content,
        description: body.description,
        sourceType: body.sourceType,
        sourceMeta: body.sourceMeta,
        updatedBy: actor.userId,
      });
      if (!template) {
        sendJsonWithCors(res, 404, { ok: false, error: "Design template not found." });
        return true;
      }
      sendJsonWithCors(res, 200, {
        ok: true,
        template,
        stdout: formatCliEnvelope(template, body.pretty === true),
      });
      return true;
    }

    if (method === "DELETE" && pathname.startsWith("/courseware/design-templates/")) {
      const id = pathname.slice("/courseware/design-templates/".length);
      if (!idSchema.safeParse(id).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Invalid template id." });
        return true;
      }
      const orgId = await resolveOrgId(req);
      if (!orgId) {
        sendJsonWithCors(res, 400, { ok: false, error: "Valid orgId is required." });
        return true;
      }
      await assertOrgIdManageAccess(session, orgId);
      const deleted = await deleteDesignTemplate(id, orgId);
      if (!deleted) {
        sendJsonWithCors(res, 404, { ok: false, error: "Design template not found." });
        return true;
      }
      sendJsonWithCors(res, 200, { ok: true });
      return true;
    }

    sendJsonWithCors(res, 405, { ok: false, error: "Method not allowed." });
    return true;
  } catch (error) {
    const status = orgAccessStatus(error) ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return true;
  }
}
