// SPDX-License-Identifier: AGPL-3.0-only
export type CoursewareAgentChatModelId =
  | "deepseek-v4.1-flash"
  | "gpt-6-astra"
  | "gpt-6-sol"
  | "grok-4.6";

export type CoursewareAgentChatModelOption = {
  id: CoursewareAgentChatModelId;
  label: string;
  subtitle: string;
  apiModel: string;
  /** Not shown to users for now (e.g. the upstream isn't ready); history sessions / local storage can still parse it, falling back to the default model on read */
  hidden?: boolean;
};

export const DEFAULT_COURSEWARE_AGENT_CHAT_MODEL_ID: CoursewareAgentChatModelId =
  "deepseek-v4.1-flash";

const ALL_COURSEWARE_AGENT_CHAT_MODEL_OPTIONS: readonly CoursewareAgentChatModelOption[] = [
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek-V4.1",
    subtitle: "Flash",
    apiModel: "deepseek-v4.1-flash",
  },
  {
    id: "gpt-6-astra",
    label: "GPT-6",
    subtitle: "Astra",
    apiModel: "gpt-6-astra",
  },
  {
    id: "gpt-6-sol",
    label: "GPT-6",
    subtitle: "Sol",
    apiModel: "gpt-6-sol",
  },
  {
    id: "grok-4.6",
    label: "Grok-4.6",
    subtitle: "",
    apiModel: "grok-4.6",
  },
] as const;

/**
 * Optional deployment-side restriction: `VITE_COURSEWARE_AGENT_MODELS` is a
 * comma-separated allowlist of ids, so a deployment with credentials for only one
 * upstream does not offer the others (the demo build sets `deepseek-v4.1-flash`).
 * Unset, or matching no known id, keeps every model.
 */
function restrictAgentChatModels(
  options: readonly CoursewareAgentChatModelOption[],
): readonly CoursewareAgentChatModelOption[] {
  const configured = (import.meta.env.VITE_COURSEWARE_AGENT_MODELS as string | undefined)
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!configured || configured.length === 0) return options;
  const allowed = options.filter((option) => configured.includes(option.id));
  return allowed.length > 0 ? allowed : options;
}

export const COURSEWARE_AGENT_CHAT_MODEL_OPTIONS: readonly CoursewareAgentChatModelOption[] =
  restrictAgentChatModels(ALL_COURSEWARE_AGENT_CHAT_MODEL_OPTIONS);

const MODEL_BY_ID = new Map(COURSEWARE_AGENT_CHAT_MODEL_OPTIONS.map((m) => [m.id, m]));

/** The default model, unless a deployment allowlist excluded it. */
const DEFAULT_MODEL =
  MODEL_BY_ID.get(DEFAULT_COURSEWARE_AGENT_CHAT_MODEL_ID) ??
  COURSEWARE_AGENT_CHAT_MODEL_OPTIONS[0]!;

const AGENT_MODEL_STORAGE_KEY = "courseware-editor-agent-model:v1";

export function resolveCoursewareAgentChatModel(
  input?: string | null,
): CoursewareAgentChatModelOption {
  const raw = input?.trim();
  if (raw) {
    const byId = MODEL_BY_ID.get(raw as CoursewareAgentChatModelId);
    if (byId) return byId;
    const byApi = COURSEWARE_AGENT_CHAT_MODEL_OPTIONS.find((m) => m.apiModel === raw);
    if (byApi) return byApi;
  }
  return DEFAULT_MODEL;
}

export function readStoredCoursewareAgentChatModelId(): CoursewareAgentChatModelId {
  if (typeof window === "undefined") return DEFAULT_MODEL.id;
  try {
    const raw = localStorage.getItem(AGENT_MODEL_STORAGE_KEY)?.trim();
    if (!raw) return DEFAULT_MODEL.id;
    const resolved = resolveCoursewareAgentChatModel(raw);
    // A model chosen earlier that is now hidden (e.g. GLM-5.3): fall back to the default, so the user doesn't keep using a model that isn't ready without noticing
    return resolved.hidden ? DEFAULT_MODEL.id : resolved.id;
  } catch {
    return DEFAULT_MODEL.id;
  }
}

export function writeStoredCoursewareAgentChatModelId(id: CoursewareAgentChatModelId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AGENT_MODEL_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
