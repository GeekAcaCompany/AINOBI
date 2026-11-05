// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { requireRequestSession } from "../api-auth.ts";
import { actorFromSession } from "../auth/ainobi-org-access.ts";
import { sendJsonWithCors } from "../http/cors.ts";
import { readJsonBody } from "../http/request.ts";
import { CoursewareOrgAccessError } from "./courseware-org-guard.ts";
import {
  assertOrgIdAccess,
  assertOrgIdManageAccess,
  convertPronunciationPreview,
  createPronunciationDictEntry,
  deletePronunciationDictEntry,
  getPronunciationDictEntryById,
  listPronunciationDictEntries,
  updatePronunciationDictEntry,
  entryToDto,
} from "./courseware-tts-pronunciation-dict-service.ts";

const orgIdSchema = z.uuid();
const idSchema = z.uuid();
const languageSchema = z.enum(["ja", "zh"]);

function orgAccessStatus(error: unknown): number | null {
  return error instanceof CoursewareOrgAccessError ? error.status : null;
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
  sourceText: z.string().min(1).max(256),
  language: languageSchema,
  pronunciation: z.string().max(512).optional().nullable(),
  enabled: z.boolean().optional(),
  autoConvert: z.boolean().optional(),
});

const updateBodySchema = z.object({
  orgId: orgIdSchema,
  sourceText: z.string().min(1).max(256).optional(),
  language: languageSchema.optional(),
  pronunciation: z.string().max(512).optional(),
  enabled: z.boolean().optional(),
  autoConvert: z.boolean().optional(),
});

const convertBodySchema = z.object({
  orgId: orgIdSchema,
  text: z.string().min(1).max(256),
  language: languageSchema,
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

export function isPronunciationDictPath(pathname: string): boolean {
  return (
    pathname === "/courseware/tts/pronunciation-dict" ||
    pathname === "/courseware/tts/pronunciation-dict/convert" ||
    /^\/courseware\/tts\/pronunciation-dict\/[^/]+$/.test(pathname)
  );
}

export async function handleCoursewareTtsPronunciationDict(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const pathname = req.url
    ? new URL(req.url, "http://localhost").pathname.replace(/\/$/, "") || "/"
    : "/";
  if (!isPronunciationDictPath(pathname)) {
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
    if (method === "GET" && pathname === "/courseware/tts/pronunciation-dict") {
      const orgId = parseQueryOrgId(req.url);
      if (!orgId || !orgIdSchema.safeParse(orgId).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Valid orgId query is required." });
        return true;
      }
      await assertOrgIdAccess(session, orgId);
      const q = parseQueryString(req.url, "q") ?? undefined;
      const languageRaw = parseQueryString(req.url, "language");
      const language =
        languageRaw === "ja" || languageRaw === "zh" ? languageRaw : undefined;
      const enabledRaw = parseQueryString(req.url, "enabled");
      const enabled =
        enabledRaw === "true" ? true : enabledRaw === "false" ? false : undefined;
      const page = Number(parseQueryString(req.url, "page") ?? "1");
      const pageSize = Number(parseQueryString(req.url, "pageSize") ?? "100");
      const result = await listPronunciationDictEntries({
        orgId,
        q,
        language,
        enabled,
        page,
        pageSize,
      });
      sendJsonWithCors(res, 200, { ok: true, ...result });
      return true;
    }

    if (method === "GET" && pathname.startsWith("/courseware/tts/pronunciation-dict/")) {
      const id = pathname.slice("/courseware/tts/pronunciation-dict/".length);
      if (id === "convert" || !idSchema.safeParse(id).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Invalid entry id." });
        return true;
      }
      const orgId = parseQueryOrgId(req.url);
      if (!orgId || !orgIdSchema.safeParse(orgId).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Valid orgId query is required." });
        return true;
      }
      await assertOrgIdAccess(session, orgId);
      const entity = await getPronunciationDictEntryById(id, orgId);
      if (!entity) {
        sendJsonWithCors(res, 404, { ok: false, error: "Pronunciation dict entry not found." });
        return true;
      }
      sendJsonWithCors(res, 200, { ok: true, entry: entryToDto(entity) });
      return true;
    }

    if (method === "POST" && pathname === "/courseware/tts/pronunciation-dict/convert") {
      const raw = await readJsonBody<unknown>(req);
      const parsed = convertBodySchema.safeParse(raw);
      if (!parsed.success) {
        sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
        return true;
      }
      const body = parsed.data;
      await assertOrgIdManageAccess(session, body.orgId);
      const result = await convertPronunciationPreview({
        text: body.text,
        language: body.language,
      });
      sendJsonWithCors(res, 200, { ok: true, ...result });
      return true;
    }

    if (method === "POST" && pathname === "/courseware/tts/pronunciation-dict") {
      const raw = await readJsonBody<unknown>(req);
      const parsed = createBodySchema.safeParse(raw);
      if (!parsed.success) {
        sendJsonWithCors(res, 400, { ok: false, error: parsed.error.message });
        return true;
      }
      const body = parsed.data;
      await assertOrgIdManageAccess(session, body.orgId);
      const actor = actorFromSession(session);
      const entry = await createPronunciationDictEntry({
        orgId: body.orgId,
        sourceText: body.sourceText,
        language: body.language,
        pronunciation: body.pronunciation,
        enabled: body.enabled,
        autoConvert: body.autoConvert ?? !body.pronunciation?.trim(),
        createdBy: actor.userId,
      });
      sendJsonWithCors(res, 201, { ok: true, entry });
      return true;
    }

    if (method === "PUT" && pathname.startsWith("/courseware/tts/pronunciation-dict/")) {
      const id = pathname.slice("/courseware/tts/pronunciation-dict/".length);
      if (!idSchema.safeParse(id).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Invalid entry id." });
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
      const entry = await updatePronunciationDictEntry({
        id,
        orgId: body.orgId,
        sourceText: body.sourceText,
        language: body.language,
        pronunciation: body.pronunciation,
        enabled: body.enabled,
        autoConvert: body.autoConvert,
        updatedBy: actor.userId,
      });
      if (!entry) {
        sendJsonWithCors(res, 404, { ok: false, error: "Pronunciation dict entry not found." });
        return true;
      }
      sendJsonWithCors(res, 200, { ok: true, entry });
      return true;
    }

    if (method === "DELETE" && pathname.startsWith("/courseware/tts/pronunciation-dict/")) {
      const id = pathname.slice("/courseware/tts/pronunciation-dict/".length);
      if (!idSchema.safeParse(id).success) {
        sendJsonWithCors(res, 400, { ok: false, error: "Invalid entry id." });
        return true;
      }
      const orgId = await resolveOrgId(req);
      if (!orgId) {
        sendJsonWithCors(res, 400, { ok: false, error: "Valid orgId is required." });
        return true;
      }
      await assertOrgIdManageAccess(session, orgId);
      const deleted = await deletePronunciationDictEntry(id, orgId);
      if (!deleted) {
        sendJsonWithCors(res, 404, { ok: false, error: "Pronunciation dict entry not found." });
        return true;
      }
      sendJsonWithCors(res, 200, { ok: true });
      return true;
    }

    sendJsonWithCors(res, 405, { ok: false, error: "Method not allowed." });
    return true;
  } catch (error) {
    const status = orgAccessStatus(error) ?? (isClientError(error) ? 400 : 500);
    const message = error instanceof Error ? error.message : String(error);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return true;
  }
}

function isClientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /required|must be|already exists|Unsupported/i.test(message);
}
