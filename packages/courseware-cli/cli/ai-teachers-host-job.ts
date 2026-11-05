// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import type { OutputOptions } from "./output.ts";
import { isAiTeachersHostFlush } from "./runtime.ts";
import type { AITeacher } from "./ai-teachers.ts";
import { normalizeTeacherList } from "./ai-teachers.ts";
import { cliEnv } from "./env.ts";

export type HostAiTeachersListResult = {
  source: "platform" | "builtin";
  org_id: string | null;
  teachers: AITeacher[];
  count: number;
  total_count: number;
};

const aiTeachersHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_AI_TEACHERS_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent AI teacher list requires `AINOBI_AI_TEACHERS_HOST_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi ai-teachers list` from the courseware agent chat environment, or configure the host to inject the AI teachers URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const aiTeachersHostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_AI_TEACHERS_HOST_TIMEOUT_MS ?? 60_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

export const fetchAiTeachersViaHost = async (options: {
  orgId?: string;
  pageSize?: number;
}): Promise<HostAiTeachersListResult> => {
  if (!isAiTeachersHostFlush()) {
    throw new AinobiCliError("INTERNAL", "fetchAiTeachersViaHost called without host flush enabled.");
  }

  const endpoint = aiTeachersHostEndpoint();
  const orgId =
    options.orgId?.trim() ||
    cliEnv().AINOBI_COURSEWARE_ORG_ID?.trim() ||
    undefined;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...uploadAuthHeaders(),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        org_id: orgId,
        page_size: options.pageSize,
        fetch_all_pages: true,
        ai_teacher_status: "active",
      }),
      signal: AbortSignal.timeout(aiTeachersHostTimeoutMs()),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `AI teachers host request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        hint: `POST ${endpoint}. Ensure the courseware agent service is running.`,
      },
    );
  }

  const text = await response.text();
  let parsed: { ok?: boolean; error?: string; data?: unknown };
  try {
    parsed = JSON.parse(text) as { ok?: boolean; error?: string; data?: unknown };
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `AI teachers host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  if (!response.ok || parsed.ok === false) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error?.trim() || `AI teachers host failed (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  const data =
    typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : {};
  const teachers = normalizeTeacherList(data.teachers ?? data.ai_teachers);
  const source = data.source === "platform" ? "platform" : "builtin";
  const count = typeof data.count === "number" ? data.count : teachers.length;
  const totalCount =
    typeof data.total_count === "number" ? data.total_count : count;
  const resolvedOrgId =
    typeof data.org_id === "string" && data.org_id.trim() ? data.org_id.trim() : orgId ?? null;

  return {
    source,
    org_id: resolvedOrgId,
    teachers,
    count,
    total_count: totalCount,
  };
};

/** @deprecated Use {@link fetchAiTeachersViaHost}; kept for symmetry with search host job naming. */
export const runAiTeachersListViaHost = async (
  _output: OutputOptions,
  options: { orgId?: string; pageSize?: number },
): Promise<HostAiTeachersListResult> => fetchAiTeachersViaHost(options);
