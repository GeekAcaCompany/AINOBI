// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import { isTtsHostFlush as isTtsHostFlushFromRuntime } from "./runtime.ts";
import {
  normalizeTtsVoiceList,
  type PlatformTtsVoice,
} from "./tts-catalog.ts";
import { cliEnv } from "./env.ts";

export type HostTtsListResult = {
  source: "platform";
  org_id: string | null;
  voices: PlatformTtsVoice[];
  count: number;
  total_count: number;
};

const ttsHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_TTS_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent TTS list requires `AINOBI_TTS_HOST_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi tts list` from the courseware agent chat environment, or configure the host to inject the TTS list URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const ttsHostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_TTS_HOST_TIMEOUT_MS ?? 60_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

export const isTtsHostFlush = isTtsHostFlushFromRuntime;

export const fetchTtsListViaHost = async (options: {
  orgId?: string;
  provider?: string;
  language?: string;
  pageSize?: number;
  /** Active by default (for the agent to choose from); inactive (hidden old voices) can be queried for older coursewares. */
  status?: "active" | "inactive";
}): Promise<HostTtsListResult> => {
  if (!isTtsHostFlush()) {
    throw new AinobiCliError("INTERNAL", "fetchTtsListViaHost called without host flush enabled.");
  }

  const endpoint = ttsHostEndpoint();
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
        tts_provider: options.provider?.trim() || undefined,
        tts_language: options.language?.trim() || undefined,
        tts_status: options.status ?? "active",
      }),
      signal: AbortSignal.timeout(ttsHostTimeoutMs()),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `TTS list host request failed: ${error instanceof Error ? error.message : String(error)}`,
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
      `TTS list host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  if (!response.ok || parsed.ok === false) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error?.trim() || `TTS list host failed (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  const data =
    typeof parsed.data === "object" && parsed.data !== null
      ? (parsed.data as Record<string, unknown>)
      : {};
  const voices = normalizeTtsVoiceList(data.voices ?? data.tts_list ?? data.data);
  const count = typeof data.count === "number" ? data.count : voices.length;
  const totalCount =
    typeof data.total_count === "number" ? data.total_count : count;
  const resolvedOrgId =
    typeof data.org_id === "string" && data.org_id.trim() ? data.org_id.trim() : orgId ?? null;

  return {
    source: "platform",
    org_id: resolvedOrgId,
    voices,
    count,
    total_count: totalCount,
  };
};
