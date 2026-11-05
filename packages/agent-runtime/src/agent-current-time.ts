// SPDX-License-Identifier: AGPL-3.0-only

export type AgentCurrentTime = {
  /** ISO 8601 UTC timestamp from the host clock. */
  isoUtc: string;
  /** IANA timezone used for the local label. */
  timeZone: string;
  /** Human-readable local time for system prompt injection. */
  localLabel: string;
  /** Single-line block for agent system prompt (append as the **last** section for prompt-cache stability). */
  promptLine: string;
};

export type AgentCurrentTimeOptions = {
  /** IANA timezone for the local label (the host's TZ, or its default). */
  timeZone: string;
  /** What the agent works on, closing the prompt line (e.g. "courseware content"). */
  subject: string;
};

/** Host clock context injected into each agent turn (system prompt + env). */
export function formatAgentCurrentTime(now: Date, options: AgentCurrentTimeOptions): AgentCurrentTime {
  const { timeZone } = options;
  const isoUtc = now.toISOString();
  const localLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  })
    .format(now)
    .replace(',', '');

  const promptLine =
    `**Current time (host):** ${localLabel} (${timeZone}). UTC: ${isoUtc}. ` +
    `Treat this as authoritative “today” when judging recency, headlines, policies, versions, statistics, and any time-sensitive ${options.subject}.`;

  return { isoUtc, timeZone, localLabel, promptLine };
}
