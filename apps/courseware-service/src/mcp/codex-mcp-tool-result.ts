// SPDX-License-Identifier: AGPL-3.0-only
/** True when MCP tool JSON payload should be surfaced as `isError: true`. */
export function isCodexMcpToolFailure(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const rec = payload as Record<string, unknown>;
  if (rec.ok === false) {
    return true;
  }
  if (typeof rec.exit_code === 'number' && rec.exit_code !== 0) {
    return true;
  }
  return false;
}
