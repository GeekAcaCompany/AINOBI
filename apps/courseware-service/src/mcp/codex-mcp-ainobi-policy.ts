// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Policy for Codex MCP `ainobi_exec`: argv-only, no shell, allowlisted subcommands.
 * Privileged host ops (save / narration / search / image / doc / assets / …) must use dedicated MCP tools.
 */

const ALLOWED_ROOT_COMMANDS = new Set([
  'status',
  'help',
  'validate',
  'inspect',
  'recall',
  'scene',
  'slide',
  'element',
  'animation',
  'quiz',
  'batch',
  'reference',
  'highlight',
  'flow-pause',
]);

/** Use dedicated MCP tools instead of ainobi_exec. */
const DEDICATED_TOOL_COMMANDS: Readonly<Record<string, string>> = {
  save: 'courseware_save',
  narration: 'courseware_narration',
  search: 'courseware_search',
  image:
    'Codex image gen → courseware_asset_upload (preferred), or courseware_image_generate only as fallback',
  doc: 'courseware_doc_read',
  knowledge: 'dedicated host knowledge tools (not yet exposed on MCP)',
  'ai-teachers': 'courseware_ai_teachers',
  tts: 'courseware_tts_list',
  asset: 'courseware_asset_list / courseware_asset_upload',
};

/** Blocked when the MCP session already preloaded a scene. */
const BLOCKED_WHEN_PRELOADED = new Set(['init', 'load']);

/**
 * Tokens that only make sense as shell chaining (spawn uses argv arrays — not a shell).
 * Do NOT ban punctuation like `( ) { } $ >` inside courseware text values.
 */
const SHELL_OPERATOR_TOKEN = /^(?:&&|\|\||[|&;])$/;

/** Absolute paths / parent traversal in argv (host filesystem escape risk). */
export function isUnsafePathToken(token: string): boolean {
  if (
    token === '..' ||
    token.includes('/../') ||
    token.includes('\\..\\') ||
    token.startsWith('../') ||
    token.startsWith('..\\')
  ) {
    return true;
  }
  // Allow remote / data URLs used as element sources; still block file:// and FS paths.
  if (/^https?:\/\//i.test(token) || token.startsWith('data:')) {
    return false;
  }
  if (token.startsWith('/') || /^[A-Za-z]:[\\/]/.test(token)) {
    return true;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(token)) {
    return true;
  }
  // `--set key=/abs/path` or `key=/abs/path`
  const eq = token.indexOf('=');
  if (eq > 0) {
    const value = token.slice(eq + 1);
    if (value && isUnsafePathToken(value)) {
      return true;
    }
  }
  return false;
}

export type AinobiExecPolicyResult =
  | { ok: true; argv: string[] }
  | { ok: false; reason: string };

/**
 * Shared argv safety for MCP spawn (ainobi_exec / courseware_narration).
 * Rejects shell operator tokens, newlines/NULs, and filesystem path escapes.
 */
export function assertSafeMcpArgvTokens(parts: string[]): AinobiExecPolicyResult {
  for (const part of parts) {
    if (SHELL_OPERATOR_TOKEN.test(part)) {
      return {
        ok: false,
        reason: `argv token looks like a shell operator: ${JSON.stringify(part)}`,
      };
    }
    if (/[\n\r\0]/.test(part)) {
      return { ok: false, reason: 'argv tokens must not contain newlines or NULs' };
    }
    if (isUnsafePathToken(part)) {
      return {
        ok: false,
        reason: `argv token must be workspace-relative (no absolute paths or ..): ${JSON.stringify(part)}`,
      };
    }
  }
  return { ok: true, argv: parts };
}

/**
 * Validate MCP `ainobi_exec` argv. Rejects shell operator tokens and unknown roots.
 * When `scenePreloaded`, blocks `init` / `load` (host already loaded the scene).
 */
export function assertSafeAinobiExecArgv(
  argv: unknown,
  options?: { scenePreloaded?: boolean },
): AinobiExecPolicyResult {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, reason: 'argv must be a non-empty string array' };
  }
  if (!argv.every((part) => typeof part === 'string')) {
    return { ok: false, reason: 'argv entries must be strings' };
  }

  const parts = argv.map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return { ok: false, reason: 'argv must be a non-empty string array' };
  }

  const tokenCheck = assertSafeMcpArgvTokens(parts);
  if (!tokenCheck.ok) {
    return tokenCheck;
  }

  const root = parts[0]!.toLowerCase();
  if (root === 'ainobi') {
    return {
      ok: false,
      reason: 'Pass argv without the `ainobi` binary name (e.g. ["slide","list"])',
    };
  }

  if (options?.scenePreloaded !== false && BLOCKED_WHEN_PRELOADED.has(root)) {
    return {
      ok: false,
      reason: `\`${root}\` is blocked after courseware_open (scene already preloaded)`,
    };
  }

  const dedicated = DEDICATED_TOOL_COMMANDS[root];
  if (dedicated) {
    return {
      ok: false,
      reason: `\`${root}\` is not allowed via ainobi_exec; use ${dedicated} instead`,
    };
  }

  if (!ALLOWED_ROOT_COMMANDS.has(root) && !BLOCKED_WHEN_PRELOADED.has(root)) {
    return {
      ok: false,
      reason: `Unsupported ainobi command "${root}". Allowed: ${[...ALLOWED_ROOT_COMMANDS].sort().join(', ')}`,
    };
  }

  return { ok: true, argv: parts };
}
