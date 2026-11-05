// SPDX-License-Identifier: AGPL-3.0-only
/** Claude Code runtime binary resolution — implemented in @ainobi/agent-runtime; this service provides the override and the resolution base. */
import { fileURLToPath } from "node:url";
import { resolveClaudeCodeExecutable as resolveForHost } from "@ainobi/agent-runtime";

/** Linux FC runtime: bundled claude binary from agent-sdk optional packages. */
export function resolveClaudeCodeExecutable(): string | undefined {
  return resolveForHost({
    override: process.env.CLAUDE_CODE_EXECUTABLE,
    resolveFrom: fileURLToPath(import.meta.url),
  });
}
