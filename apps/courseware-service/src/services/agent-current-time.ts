// SPDX-License-Identifier: AGPL-3.0-only
/** Agent current-time context — implemented in @ainobi/agent-runtime; the timezone comes from the host TZ (Asia/Shanghai by default). */
import {
  formatAgentCurrentTime as formatForHost,
  type AgentCurrentTime,
} from "@ainobi/agent-runtime";

export type { AgentCurrentTime };

const defaultAgentTimeZone = (): string => process.env.TZ?.trim() || "Asia/Shanghai";

/** Host clock context injected into each agent turn (system prompt + env). */
export function formatAgentCurrentTime(now = new Date()): AgentCurrentTime {
  return formatForHost(now, { timeZone: defaultAgentTimeZone(), subject: "courseware content" });
}
