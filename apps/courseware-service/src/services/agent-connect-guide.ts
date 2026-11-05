// SPDX-License-Identifier: AGPL-3.0-only
/**
 * English onboarding guide for the connect page (`GET /agent/connect/{code}`).
 * Kept in its own module so the long markdown template stays readable; the
 * server renders it verbatim as text/markdown for AI agents.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatUtcDateTime(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
  );
}

import { resolveCoursewarePublicBaseUrl } from "./codex-plugin-zip.ts";

export type AgentConnectGuideInput = {
  code: string;
  orgId: string;
  orgName: string | null;
  mcpUrl: string;
  credentialExpiresAt: string | null;
  /** Service base URL, e.g. https://courseware-api.example.com (no trailing slash). Defaults to resolveCoursewarePublicBaseUrl(). */
  base?: string;
};

export function buildMarkdownGuide(input: AgentConnectGuideInput): string {
  const { code, orgId, orgName, mcpUrl, credentialExpiresAt, base: baseOverride } = input;
  const base = baseOverride ?? resolveCoursewarePublicBaseUrl();
  const orgLabel = orgName?.trim() || orgId;
  const expiresLabel = credentialExpiresAt
    ? formatUtcDateTime(new Date(credentialExpiresAt))
    : "never (no expiry)";

  return [
    `# AINOBI Agent · ${code}`,
    "",
    `You are connecting the AINOBI courseware tools for "${orgLabel}". Complete the 5 steps in order; report results to the user only — never expose the credential.`,
    "",
    "## What you are connecting to",
    "",
    `- Organization: ${orgLabel} (\`${orgId}\`)`,
    "- Scope: courseware create / edit / save; course view / create; narration / image / search. NO delete, member, or billing management",
    `- This connect code is valid for 15 minutes and single-use; the credential is valid until ${expiresLabel} (90 days from code issuance)`,
    "",
    "## Step 1 · Download the credential to a file (do NOT read it)",
    "",
    "```bash",
    `mkdir -p ~/.ainobi && curl -fsS -X POST ${base}/agent/connect/${code}/credential \\`,
    '  -H "X-AINOBI-Client: claude-code" -o ~/.ainobi/ainobi-agent.env && chmod 600 ~/.ainobi/ainobi-agent.env',
    "```",
    "",
    "Set `X-AINOBI-Client` to your actual client: `claude-code` | `codex` | `chatgpt-desktop` (logging only, does not affect auth).",
    "",
    "The response is a two-line env file (`AINOBI_AGENT_API_KEY`, `AINOBI_MCP_URL`) — write it to disk; the connect code is void immediately. Self-check: file exists, exactly 2 lines, `grep -c '^AINOBI_AGENT_API_KEY='` is 1 — metadata only, never echo the content.",
    "",
    "**RED LINE: do not `cat`, print, or copy its value. Every tool (shell, scripts, MCP config) must reference the credential ONLY through the env var `AINOBI_AGENT_API_KEY` — reading the plaintext is forbidden.**",
    "",
    "- `410 code_expired`: the code expired or never existed — ask the user for a fresh instruction",
    "- `409 code_already_used`: the code was already consumed — ask the user for a fresh instruction",
    "",
    "## Step 2 + 3 · Quick path (Claude Code / Codex — paste a whole block)",
    "",
    "**Claude Code:**",
    "",
    "```bash",
    `curl -fsS -o /tmp/ainobi-plugin.zip ${base}/plugins/ainobi-courseware-codex-plugin.zip && \\`,
    "  mkdir -p /tmp/ainobi-plugin && unzip -oq /tmp/ainobi-plugin.zip -d /tmp/ainobi-plugin && \\",
    "  mkdir -p ~/.claude/skills && cp -R /tmp/ainobi-plugin/ainobi-courseware/skills/ainobi-courseware ~/.claude/skills/ && \\",
    `  claude mcp add --transport http ainobi-courseware ${mcpUrl} --header 'Authorization: Bearer \${AINOBI_AGENT_API_KEY}'`,
    "```",
    "",
    "⚠️ The `--header` value must use SINGLE quotes: double quotes let the shell expand ${…} into the PLAINTEXT key inside ~/.claude.json.",
    "",
    "Also add `source ~/.ainobi/ainobi-agent.env` to your shell profile (`~/.zshrc` / `~/.bashrc`) so new processes can expand the variable.",
    "",
    "**Codex:**",
    "",
    "```bash",
    `curl -fsS -o /tmp/ainobi-plugin.zip ${base}/plugins/ainobi-courseware-codex-plugin.zip && \\`,
    "  mkdir -p /tmp/ainobi-plugin && unzip -oq /tmp/ainobi-plugin.zip -d /tmp/ainobi-plugin && \\",
    "  bash /tmp/ainobi-plugin/ainobi-courseware/install.sh",
    "```",
    "",
    'Then add to `~/.codex/config.toml`: `[mcp_servers.ainobi-courseware]` with `url` = the value of `AINOBI_MCP_URL` from the env file (the URL is not secret, writing it is fine) and `bearer_token_env_var = "AINOBI_AGENT_API_KEY"` (variable NAME only).',
    "- ChatGPT Desktop: no automated onboarding — the user pastes the MCP URL and Bearer themselves; do not read the file for them.",
    "- Any other MCP-capable client: transport = Streamable HTTP, `url` = `${mcpUrl}`, auth header = `Authorization: Bearer \${AINOBI_AGENT_API_KEY}` (env-expanded; adapt to your framework's MCP config format). Any client that supports custom MCP headers works with this credential.",
    "",
    "## Step 4 · Verify (choose one)",
    "",
    `**A. MCP tool direct (preferred)**: in a session that has the MCP server loaded, call \`course_list\`. Success = onboarding complete; tell the user "Connected to ${orgLabel}, ready to start" and report the course count. If the current session has not loaded the new MCP server yet, verify with B first.`,
    "",
    "**B. Session-free equivalent verification (JSON-RPC direct)** — the `Accept` header MUST include `text/event-stream`, otherwise 406:",
    "",
    "```bash",
    "set -a && source ~/.ainobi/ainobi-agent.env && set +a",
    `curl -fsS -X POST ${mcpUrl} \\`,
    '  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\',
    '  -H "authorization: Bearer ${AINOBI_AGENT_API_KEY}" \\',
    '  -d \'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ainobi-agent","version":"1.0"}}}\'',
    "",
    `curl -fsS -X POST ${mcpUrl} \\`,
    '  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\',
    '  -H "authorization: Bearer ${AINOBI_AGENT_API_KEY}" \\',
    '  -d \'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"course_list","arguments":{}}}\'',
    "```",
    "",
    'The service is stateless: every JSON-RPC call is an independent POST; no session id needed. `course_list` returning "ok: true" means verification passed.',
    "",
    "## Step 5 · Register the name",
    "",
    "Ask the user what to name this agent (default: your client name), then register it with the MCP tool `agent_set_name`. The name shows in the console Agent list and can be changed there later.",
    "",
    "## Completion checklist (all must hold)",
    "",
    "- [ ] `~/.ainobi/ainobi-agent.env` exists, 2 lines, permission 600",
    "- [ ] Skill directory in place (Claude: `~/.claude/skills/ainobi-courseware/SKILL.md`; Codex: `~/plugins/ainobi-courseware`)",
    "- [ ] `course_list` call succeeded",
    "- [ ] `agent_set_name` registered",
    '- [ ] Report to the user: org name, course count, what they can ask for now (e.g. "list our courses")',
    "",
    "## Common errors",
    "",
    "| Symptom | Cause | Fix |",
    "|---------|-------|-----|",
    "| `/credential` returns 410 / 409 | Code expired or already used | Ask the user for a fresh connect instruction and restart |",
    "| JSON-RPC returns 406 Not Acceptable | `Accept` header missing `text/event-stream` | Use the exact command from Step 4-B (dual Accept) |",
    "| JSON-RPC returns 401 | Env var not loaded in this shell | Re-run `set -a && source ~/.ainobi/ainobi-agent.env && set +a` and retry |",
    "| ainobi-courseware missing from tools | Session predates the MCP config | Start a new session; or verify first with Step 4-B |",
    "| Connection refused / timeout | Service unreachable | Check the network and retry; if it persists, tell the user to contact their admin |",
    "",
    "## Security notes",
    "",
    "- The credential exists only in `~/.ainobi/ainobi-agent.env` and the environment; it must never appear in chats, logs, repositories, or any config file VALUE (config files reference the variable name only)",
    "- When the credential expires or you switch machines, ask the user for a fresh connect instruction",
    "",
  ].join("\n");
}

