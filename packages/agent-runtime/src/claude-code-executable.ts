// SPDX-License-Identifier: AGPL-3.0-only
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';

export type ClaudeCodeExecutableOptions = {
  /** Explicit binary path (the host's CLAUDE_CODE_EXECUTABLE); wins when non-empty. */
  override?: string;
  /**
   * Module path the platform packages resolve from: the host app, which depends on
   * @anthropic-ai/claude-agent-sdk and so carries its optional per-platform binaries.
   */
  resolveFrom: string;
};

/** Linux FC runtime: bundled claude binary from agent-sdk optional packages. */
export function resolveClaudeCodeExecutable(options: ClaudeCodeExecutableOptions): string | undefined {
  const fromHost = options.override?.trim();
  if (fromHost) {
    return fromHost;
  }
  if (process.platform !== 'linux') {
    return undefined;
  }
  const require = createRequire(options.resolveFrom);
  const arch = process.arch;
  const candidates = [
    `@anthropic-ai/claude-agent-sdk-linux-${arch}/claude`,
    `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude`,
  ];
  for (const specifier of candidates) {
    try {
      const resolved = require.resolve(specifier);
      accessSync(resolved, constants.X_OK);
      return resolved;
    } catch {
      /* try next */
    }
  }
  return undefined;
}
