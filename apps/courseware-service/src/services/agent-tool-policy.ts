// SPDX-License-Identifier: AGPL-3.0-only
import { basename, isAbsolute, relative, resolve } from 'node:path';

import { parseArgs } from '@ainobi/courseware-cli/cli/args.ts';
import type { CoursewareActorContext } from '../auth/ainobi-org-access.ts';
import { AGENT_CLAUDE_SKILL_DIR, AGENT_SKILL_MD_REL } from './agent-workspace.ts';
export type AgentToolPolicyContext = {
  /** Agent SDK cwd — isolated session workspace directory. */
  agentCwd: string;
  /** Host service repo root; used to block absolute reads of service source. */
  serviceRoot: string;
  /** Host already ran `ainobi load` for this chat; block agent `load`/`init`. */
  scenePreloaded: boolean;
  /** Agent has Read `${AGENT_SKILL_MD_REL}` in this workspace (persisted across turns). */
  skillMdRead: boolean;
  /** CLI-managed `work_dir` for transcripts and helper payloads (`ainobi status` → `data.work_dir`). */
  cliWorkDir?: string | null;
  /** Editor live preview session for this chat turn (may differ from CLI session file on resume). */
  livePreviewSessionId?: string | null;
  /** Bound courseware business key for host-side `ainobi save` persistence. */
  coursewareKey?: string | null;
  /** Authenticated user context for host-side persistence / audit. */
  coursewareActor?: CoursewareActorContext | null;
  /** Platform org for new courseware rows (same as agent `AINOBI_COURSEWARE_ORG_ID`). */
  coursewareOrgId?: string | null;
};

type BashBlockedPattern = {
  pattern: RegExp;
  reason: string;
  checkInterpreter?: boolean;
  /** When true (default), skip single/double/$-quoted and backtick literals before matching. */
  outsideQuotesOnly?: boolean;
};

/** Leading shell token boundary (start, separator, or subshell opener). */
const SHELL_CMD_LEAD = String.raw`(?:^|[\s|;&]|&&|\|\|)`;

/** Optional whitespace between a separator and the next command word. */
const SHELL_CMD_GAP = String.raw`\s*`;

/**
 * Tail after `rm`/`rmdir` that indicates a real shell invocation (flags/paths), not prose
 * mentioning "rm" (e.g. unquoted `…不要用 rm 命令` — next token is non-ASCII).
 */
const RM_INVOCATION_TAIL = String.raw`(?:\s+(?:-[a-zA-Z]+|[a-zA-Z0-9./~][a-zA-Z0-9./~_-]*)|\s*$|[|;&])`;

/** Tail after `kill`/`killall`/`pkill` that indicates a real signal/PID/target, not prose. */
const KILL_INVOCATION_TAIL = String.raw`(?:\s+(?:-[a-zA-Z0-9]+|\d{1,10}|SIG[A-Z]+|[a-zA-Z][a-zA-Z0-9._-]*)|\s*$|[|;&])`;

/** Strip quoted literals so policy matches executables, not prose inside ainobi flags. */
function stripShellQuotedStrings(command: string): string {
  return command
    .replace(/\$'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function shellPolicySurface(command: string, outsideQuotesOnly: boolean): string {
  return outsideQuotesOnly ? stripShellQuotedStrings(command) : command;
}

function isBlockedInterpreterCommand(command: string): boolean {
  const anchored = /(?:^|[\s|;&]|&&|\|\|)(?:node|nodejs|npm|npx|python\d*|pip\d*|pipenv|poetry)\b/i;
  if (/^\s*ainobi\b/i.test(command)) {
    return anchored.test(stripShellQuotedStrings(command));
  }
  return /\b(?:node|nodejs|npm|npx|python\d*|pip\d*|pipenv|poetry)\b/i.test(command);
}

const BASH_BLOCKED_PATTERNS: ReadonlyArray<BashBlockedPattern> = [
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:env|printenv)(?:\\s|$|[|;&])`, 'i'),
    reason: 'env dumps process environment',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}export\\s+-p(?:\\s|$|[|;&])`, 'i'),
    reason: 'export -p dumps process environment',
  },
  { pattern: /(?:^|[|;&]\s*)set\s*(?:$|[|;&])/i, reason: 'set dumps environment variables' },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}set\\s+(?:-o\\s+all|-a)(?:\\s|$|[|;&])`, 'i'),
    reason: 'set may dump environment',
  },
  {
    pattern:
      /\.sh\b(?:\s|$|[|;&])|\bchmod\s+[^\n|;&]*\.sh\b|\b(?:bash|sh|zsh|dash|ksh)\s+[^\s|;&]+\.sh\b/i,
    reason: 'shell scripts cannot be executed in the agent workspace; run ainobi commands directly, or put multi-step scene edits in a batch file and run `ainobi batch apply --file "$AINOBI_WORK_DIR/batch/plan.json"`',
  },
  {
    pattern: /\bENVIRON\b/i,
    reason: 'dumping environment via awk is blocked',
    outsideQuotesOnly: false,
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}perl\\b[^\\n|;&]*%ENV`, 'i'),
    reason: 'dumping environment via perl is blocked',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}ruby\\b[^\\n|;&]*\\bENV\\b`, 'i'),
    reason: 'dumping environment via ruby is blocked',
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:psql|mysql|mariadb|mongosh|redis-cli|sqlite3|sqlcmd|sqlplus)(?:\\s|$|[|;&])`,
      'i',
    ),
    reason: 'direct database clients are blocked',
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:telnet|ncat|netcat|nc|socat|ssh|scp|sftp|ftp|lftp|nmap|rlogin|rsh)(?:\\s|$|[|;&])|${SHELL_CMD_LEAD}${SHELL_CMD_GAP}openssl\\s+s_client\\b`,
      'i',
    ),
    reason: 'network tunnel and remote connection tools are not allowed in the agent shell',
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:ifconfig|ipconfig|ip\\s+(?:addr|address|route|link|neigh|neighbor|[ar])|route|netstat|ss|arp|arping|hostname|networksetup|scutil|iwconfig|nmcli|airport|dig|nslookup|host|ping6?|traceroute|tracert|mtr|whois|getent)(?:\\s|$|[|;&])`,
      'i',
    ),
    reason: 'network reconnaissance commands are not allowed in the agent shell',
  },
  {
    pattern: /^/,
    reason: 'node/npm/python are not allowed in the agent shell. To read part of a JSON result add `--select <path>` to the ainobi command (e.g. `ainobi slide get 2 --with-children --select \'slide.children_elements[]{element_id,name,text}\'`); to change text, write it yourself in the ainobi command or a batch file',
    checkInterpreter: true,
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:apt(?:-get|-cache)?|aptitude|dpkg|yum|dnf|rpm|pacman|yay|brew|port|apk|snap|flatpak|zypper|emerge|xbps-install)(?:\\s|$|[|;&])`,
      'i',
    ),
    reason: 'system package managers are not allowed in the agent shell',
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:systemctl|service|launchctl|sudo|su|doas|mount|umount|fdisk|mkfs|useradd|userdel|visudo|crontab|shutdown|reboot|halt|poweroff|docker|podman|kubectl)(?:\\s|$|[|;&])`,
      'i',
    ),
    reason: 'system administration commands are not allowed in the agent shell',
  },
  { pattern: /\/proc\/(?:self|\d+)\/environ\b/i, reason: 'reading /proc/*/environ is blocked' },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}cat\\s+[^\\n|;&]*\\.env\\b`, 'i'),
    reason: 'reading .env files via shell is blocked',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:type|cat|less|more|head|tail)\\s+[^\\n|;&]*\\.env`, 'i'),
    reason: 'reading .env files via shell is blocked',
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:rg|grep|ag|find)\\b[^\\n|;&]*(?:\\.env|\\.git|DB_|REDIS_|ANTHROPIC_)`,
      'i',
    ),
    reason: 'searching credential, .env, or .git metadata via shell is blocked',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}cd(?:\\s|$|[|;&])`, 'i'),
    reason: 'cd is blocked; the agent workspace directory is fixed. Run commands from the current directory and address helper files as "$AINOBI_WORK_DIR/<file>"',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}git\\s+(?:log|show|cat-file|config)(?:\\s|$|[|;&])`, 'i'),
    reason: 'git history and config commands are blocked',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}declare\\s+-p(?:\\s|$|[|;&])`, 'i'),
    reason: 'declare -p dumps environment variables',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}compgen\\s+-v(?:\\s|$|[|;&])`, 'i'),
    reason: 'compgen -v lists environment variable names',
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:rm|rmdir|unlink)${RM_INVOCATION_TAIL}`,
      'i',
    ),
    reason: 'destructive file removal (rm/rmdir/unlink) is blocked in the agent shell; overwrite a helper file instead, and remove scene content with ainobi delete commands',
  },
  {
    pattern: new RegExp(
      `${SHELL_CMD_LEAD}${SHELL_CMD_GAP}(?:kill|killall|pkill)${KILL_INVOCATION_TAIL}`,
      'i',
    ),
    reason: 'process termination commands are blocked in the agent shell',
  },
  {
    pattern: new RegExp(`${SHELL_CMD_LEAD}${SHELL_CMD_GAP}find\\b[^\\n|;&]*\\s-delete`, 'i'),
    reason: 'find -delete is blocked in the agent shell',
  },
];

const SECRET_ENV_VAR_REF_PATTERN =
  /\$(?:\{\s*)?(?:MINIMAX_|FISH_AUDIO_|ANTHROPIC_|AINOBI_(?:TTS_|AGENT_)?|DB_|REDIS_|OSS_|ALIYUN_|AGENT_)[A-Z0-9_]*|\$(?:\{\s*)?[A-Z0-9_]*(?:API_KEY|SECRET|PASSWORD|TOKEN|AUTH)[A-Z0-9_]*\}?/i;

const CREDENTIAL_GREP_PATTERN =
  /(?:^|[\s"'`*(])\.env(?:[\s"'`)*.,]|$)|\bDB_[A-Z0-9_]*\b|\bREDIS_[A-Z0-9_]*\b|\bMINIMAX_[A-Z0-9_]*\b|\bFISH_AUDIO_[A-Z0-9_]*\b|\bANTHROPIC_(?:[A-Z0-9_]+_)?API_KEY\b|\bAGENT_API_KEY\b|\bAINOBI_TTS_[A-Z0-9_]*\b|\bDATABASE_URL\b/i;

const SENSITIVE_GLOB_PATTERN =
  /(?:^|\/)\.env(?:[\s"'*?.,]|$)|\*\.env|\.env\*|\*\*\/\.env|(?:^|\/)\.git(?:\/|$)|\*\*\/\.git(?:\/\*\*)?/i;

const SOURCE_GLOB_PATTERN =
  /(?:^|\/)(?:cli|courseware|bin|node_modules|dist|src)(?:\/|$)|\.test\.tsx?$|\*\.ts$|\*\.tsx$|package\.json|tsconfig\.json|yarn\.lock/i;

const SENSITIVE_PATH_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.git-credentials',
  '.npmrc',
  '.pypirc',
  '.dockerconfig',
  'credentials',
  'secrets.json',
]);

const SENSITIVE_PATH_SUBSTRINGS = [
  '/.aws/',
  '/.config/gcloud/',
  '/.kube/config',
  'service-account.json',
] as const;

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit']);

// Parse the arguments after `ainobi` with the CLI's own parseArgs and take the subcommand it would really dispatch
// (positionals[0]). Guessing flag values ourselves could be bypassed by forms like `--pretty false init` or `--select slide init`
// (Codex review #143 P1 ×2); sharing the CLI's rules can't be.
const AINOBI_BIN_TOKEN = /(?:^|\/)ainobi(?:\.mjs)?$/;

export function isAinobiSceneBootstrapCommand(command: string): boolean {
  for (const segment of command.split(/[\n;&|]+/)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^[$(`'"]+|[)`'"]+$/g, ''))
      .filter(Boolean);
    const binIndex = tokens.findIndex((token) => AINOBI_BIN_TOKEN.test(token));
    if (binIndex < 0) continue;
    let subcommand: string | undefined;
    try {
      subcommand = parseArgs(tokens.slice(binIndex + 1)).positionals[0];
    } catch {
      continue; // the CLI rejects unparsable argv before dispatching anything
    }
    const verb = subcommand?.toLowerCase();
    if (verb === 'load' || verb === 'init') return true;
  }
  return false;
}

function normalizeToolPath(filePath: string, cwd: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return '';
  }
  return resolve(cwd, trimmed);
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function relativeWithinRoot(root: string, absolutePath: string): string | null {
  const rel = toPosixPath(relative(resolve(root), resolve(absolutePath)));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return rel;
}

function isGitMetadataPath(absolutePath: string): boolean {
  return /(?:^|\/)\.git(?:\/|$)/.test(toPosixPath(absolutePath));
}

function isShellScriptPath(cliRel: string): boolean {
  const lower = cliRel.toLowerCase();
  return lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh');
}

function isSensitivePath(absolutePath: string): boolean {
  if (isGitMetadataPath(absolutePath)) {
    return true;
  }
  const base = basename(absolutePath);
  if (SENSITIVE_PATH_BASENAMES.has(base)) {
    return true;
  }
  if (base.startsWith('.env.')) {
    return true;
  }
  const lower = absolutePath.toLowerCase();
  return SENSITIVE_PATH_SUBSTRINGS.some((part) => lower.includes(part));
}

export function isPathWithinRoot(root: string, filePath: string): boolean {
  const base = resolve(root);
  const absolute = isAbsolute(filePath.trim()) ? resolve(filePath.trim()) : resolve(base, filePath.trim());
  const rel = relative(base, absolute);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function isPathWithinAgentWorkspace(filePath: string, workspaceRoot: string): boolean {
  return isPathWithinRoot(workspaceRoot, filePath);
}

function agentFileRootKind(
  filePath: string,
  ctx: AgentToolPolicyContext,
): 'workspace' | 'cli_work_dir' | null {
  if (isPathWithinAgentWorkspace(filePath, ctx.agentCwd)) {
    return 'workspace';
  }
  if (ctx.cliWorkDir && isPathWithinRoot(ctx.cliWorkDir, filePath)) {
    return 'cli_work_dir';
  }
  return null;
}

function isServiceSourcePath(absolutePath: string, serviceRoot: string): boolean {
  const rel = relativeWithinRoot(serviceRoot, absolutePath);
  if (rel === null) {
    return false;
  }
  return rel === 'src' || rel.startsWith('src/') || rel === 'dist' || rel.startsWith('dist/');
}

export function buildAgentToolPolicyContext(args: {
  agentCwd: string;
  serviceRoot: string;
  scenePreloaded?: boolean;
  skillMdRead?: boolean;
  cliWorkDir?: string | null;
  livePreviewSessionId?: string | null;
  coursewareKey?: string | null;
  coursewareActor?: CoursewareActorContext | null;
  coursewareOrgId?: string | null;
}): AgentToolPolicyContext {
  const cliWorkDir = args.cliWorkDir?.trim() || null;
  return {
    agentCwd: resolve(args.agentCwd),
    serviceRoot: resolve(args.serviceRoot),
    scenePreloaded: args.scenePreloaded ?? false,
    skillMdRead: args.skillMdRead ?? false,
    cliWorkDir,
    livePreviewSessionId: args.livePreviewSessionId?.trim() || null,
    coursewareKey: args.coursewareKey?.trim() || null,
    coursewareActor: args.coursewareActor ?? null,
    coursewareOrgId: args.coursewareOrgId?.trim() || null,
  };
}

export function isAinobiCliBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/^\s*ainobi\b/i.test(trimmed)) {
    return true;
  }
  return /\b(?:node|nodejs)\s+[^\s|;&]*ainobi[^\s|;&]*\b/i.test(trimmed);
}

function cliRelWithinAgentWorkspace(
  filePath: string,
  ctx: AgentToolPolicyContext,
): string | null {
  const absolute = normalizeToolPath(filePath, ctx.agentCwd);
  if (!absolute) {
    return null;
  }
  return relativeWithinRoot(ctx.agentCwd, absolute);
}

export function isAgentSkillMdReadPath(filePath: string, ctx: AgentToolPolicyContext): boolean {
  const cliRel = cliRelWithinAgentWorkspace(filePath, ctx);
  return cliRel !== null && toPosixPath(cliRel) === AGENT_SKILL_MD_REL;
}

function isAgentSkillTreeReadPath(filePath: string, ctx: AgentToolPolicyContext): boolean {
  const cliRel = cliRelWithinAgentWorkspace(filePath, ctx);
  if (cliRel === null) {
    return false;
  }
  const posix = toPosixPath(cliRel);
  const skillRoot = AGENT_CLAUDE_SKILL_DIR;
  return posix === skillRoot || posix.startsWith(`${skillRoot}/`);
}

function skillBootstrapReadBlockedReason(): string {
  return `read ${AGENT_SKILL_MD_REL} before other file reads or any ainobi CLI command`;
}

export function isEchoingCredentialEnv(command: string): { blocked: boolean; reason?: string } {
  if (!/\b(echo|printf)\b/i.test(command)) {
    return { blocked: false };
  }
  if (SECRET_ENV_VAR_REF_PATTERN.test(command)) {
    return { blocked: true, reason: 'echoing credential environment variables is blocked' };
  }
  return { blocked: false };
}

/** Ignore `/file.png` fragments produced by `...work_dir')/file.png` — not real absolute paths. */
function isBashScannedAbsolutePath(raw: string): boolean {
  const segments = raw.split('/').filter(Boolean);
  return segments.length >= 2;
}

function isBashAbsolutePathEscape(
  command: string,
  workspaceCwd: string,
  cliWorkDir?: string | null,
): { blocked: boolean; reason?: string } {
  const ws = resolve(workspaceCwd);
  const workDir = cliWorkDir?.trim() ? resolve(cliWorkDir.trim()) : null;
  const pattern = /(?:^|[\s'"=()])(\/[^\s'"`;|&]+)/g;
  for (const match of command.matchAll(pattern)) {
    const raw = match[1];
    if (!raw || !isBashScannedAbsolutePath(raw)) {
      continue;
    }
    if (/^\/tmp(?:\/|$)/.test(raw) || /^\/var\/folders\//.test(raw) || /^\/private\/tmp\//.test(raw)) {
      continue;
    }
    const abs = resolve(raw);
    if (workDir && isPathWithinRoot(workDir, abs)) {
      continue;
    }
    const rel = relative(ws, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { blocked: true, reason: 'shell cannot access paths outside the agent workspace; use relative workspace paths or "$AINOBI_WORK_DIR/<file>" (CLI work_dir)' };
    }
  }
  return { blocked: false };
}

export function isAgentBashCommandBlocked(
  command: string,
  ctx?: AgentToolPolicyContext,
): { blocked: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { blocked: true, reason: 'empty bash command' };
  }

  const echoSecret = isEchoingCredentialEnv(trimmed);
  if (echoSecret.blocked) {
    return echoSecret;
  }

  if (ctx) {
    const pathEscape = isBashAbsolutePathEscape(trimmed, ctx.agentCwd, ctx.cliWorkDir);
    if (pathEscape.blocked) {
      return pathEscape;
    }

    if (!ctx.skillMdRead && isAinobiCliBashCommand(trimmed)) {
      return { blocked: true, reason: skillBootstrapReadBlockedReason() };
    }

    if (ctx.scenePreloaded && isAinobiSceneBootstrapCommand(trimmed)) {
      return {
        blocked: true,
        reason:
          'ainobi load/init are disabled for this chat: the host already loaded the courseware scene. Start with `ainobi status` or `ainobi scene info --verbose`.',
      };
    }
  }

  for (const { pattern, reason, checkInterpreter, outsideQuotesOnly = true } of BASH_BLOCKED_PATTERNS) {
    if (checkInterpreter) {
      if (isBlockedInterpreterCommand(trimmed)) {
        return { blocked: true, reason };
      }
      continue;
    }
    const surface = shellPolicySurface(trimmed, outsideQuotesOnly);
    if (pattern.test(surface)) {
      return { blocked: true, reason };
    }
  }

  return { blocked: false };
}

export function isAgentFilePathBlocked(
  filePath: string,
  ctx: AgentToolPolicyContext,
  mode: 'read' | 'write',
): { blocked: boolean; reason?: string } {
  const absolute = normalizeToolPath(filePath, ctx.agentCwd);
  if (!absolute) {
    return { blocked: false };
  }

  if (isSensitivePath(absolute)) {
    return {
      blocked: true,
      reason: isGitMetadataPath(absolute)
        ? '.git directory access is blocked'
        : 'sensitive credential or env file paths are blocked',
    };
  }

  if (isServiceSourcePath(absolute, ctx.serviceRoot)) {
    return { blocked: true, reason: 'courseware service source and build output are blocked' };
  }

  const fileRoot = agentFileRootKind(filePath, ctx);
  if (!fileRoot) {
    return {
      blocked: true,
      reason: ctx.cliWorkDir
        ? 'path is outside the isolated agent workspace and the CLI work_dir from ainobi status'
        : 'path is outside the isolated agent workspace',
    };
  }

  if (fileRoot === 'cli_work_dir') {
    if (!ctx.skillMdRead) {
      return { blocked: true, reason: skillBootstrapReadBlockedReason() };
    }
    return { blocked: false };
  }

  const cliRel = relativeWithinRoot(ctx.agentCwd, absolute);
  if (cliRel === null) {
    return { blocked: true, reason: 'path is outside the isolated agent workspace' };
  }

  if (mode === 'read' && !ctx.skillMdRead && !isAgentSkillTreeReadPath(filePath, ctx)) {
    return { blocked: true, reason: skillBootstrapReadBlockedReason() };
  }

  if (isShellScriptPath(cliRel)) {
    return { blocked: true, reason: 'shell scripts are not allowed in the agent workspace' };
  }

  if (mode === 'write') {
    if (cliRel.startsWith('.claude/')) {
      return { blocked: true, reason: 'skill and reference files are read-only' };
    }
    return { blocked: false };
  }

  return { blocked: false };
}

function deny(message: string): { allowed: false; message: string } {
  return { allowed: false, message };
}

function allow(): { allowed: true } {
  return { allowed: true };
}

function evaluateGrepTool(
  input: Record<string, unknown>,
  ctx: AgentToolPolicyContext,
): { allowed: boolean; message?: string } {
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  if (pattern && CREDENTIAL_GREP_PATTERN.test(pattern)) {
    return deny('grep patterns that target credentials or .env files are blocked');
  }

  const glob = typeof input.glob === 'string' ? input.glob : '';
  if (glob && (SENSITIVE_GLOB_PATTERN.test(glob) || SOURCE_GLOB_PATTERN.test(glob))) {
    return deny('grep glob may not target credentials or implementation source');
  }

  const path = typeof input.path === 'string' ? input.path.trim() : '';
  if (!path || path === '.') {
    return deny(`grep must target ${AGENT_CLAUDE_SKILL_DIR}/ or a specific file in this workspace`);
  }

  if (!ctx.skillMdRead && !isAgentSkillTreeReadPath(path, ctx)) {
    return deny(skillBootstrapReadBlockedReason());
  }

  const file = isAgentFilePathBlocked(path, ctx, 'read');
  if (file.blocked) {
    return deny(file.reason ?? 'grep path blocked by policy');
  }

  return allow();
}

function evaluateGlobTool(
  input: Record<string, unknown>,
  ctx: AgentToolPolicyContext,
): { allowed: boolean; message?: string } {
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  if (!pattern.trim()) {
    return deny('empty glob pattern');
  }
  if (SENSITIVE_GLOB_PATTERN.test(pattern) || SOURCE_GLOB_PATTERN.test(pattern)) {
    return deny('glob may not target credentials or implementation source');
  }

  const path = typeof input.path === 'string' ? input.path.trim() : '';
  if (!path || path === '.') {
    return deny(`glob must specify ${AGENT_CLAUDE_SKILL_DIR}/ or another allowed path in this workspace`);
  }

  if (!ctx.skillMdRead && !isAgentSkillTreeReadPath(path, ctx)) {
    return deny(skillBootstrapReadBlockedReason());
  }

  const file = isAgentFilePathBlocked(path, ctx, 'read');
  if (file.blocked) {
    return deny(file.reason ?? 'glob path blocked by policy');
  }

  return allow();
}

export function evaluateAgentToolUse(
  toolName: string,
  input: Record<string, unknown>,
  ctx: AgentToolPolicyContext,
): { allowed: boolean; message?: string } {
  if (toolName === 'Bash') {
    if (input.dangerouslyDisableSandbox === true) {
      return deny('unsandboxed bash is not permitted');
    }
    const command = typeof input.command === 'string' ? input.command : '';
    const bash = isAgentBashCommandBlocked(command, ctx);
    if (bash.blocked) {
      return deny(bash.reason ?? 'bash command blocked by policy');
    }
    return allow();
  }

  if (toolName === 'Grep') {
    return evaluateGrepTool(input, ctx);
  }

  if (toolName === 'Glob') {
    return evaluateGlobTool(input, ctx);
  }

  if (FILE_TOOLS.has(toolName)) {
    const mode = toolName === 'Read' ? 'read' : 'write';
    const pathKeys = ['file_path', 'path', 'filePath', 'target_file', 'file'] as const;
    for (const key of pathKeys) {
      const value = input[key];
      if (typeof value !== 'string') {
        continue;
      }
      const file = isAgentFilePathBlocked(value, ctx, mode);
      if (file.blocked) {
        return deny(file.reason ?? 'file path blocked by policy');
      }
    }
    return allow();
  }

  return allow();
}

/** Read-only research commands allowed in Plan mode (no editing the courseware / image generation / narration / uploads and similar actions). */
const PLAN_MODE_AINOBI_RESEARCH_ARGV =
  /^(?:doc(?:\s+read)?|search|asset\s+get|knowledge(?:\s+(?:list|read))?|help|recall)\b/i;

const PLAN_MODE_AINOBI_INVOCATION =
  /\b(?:ainobi(?:\.mjs)?|node\s+[^\s|;&]*ainobi[^\s|;&]*)\b([^\n|;&]*)/gi;

/**
 * Whether a Bash command is limited to Plan-mode research CLIs
 * (`doc read` / `search` / `asset get` / `help` / `recall`).
 */
export function isPlanModeResearchBashCommand(command: string): {
  allowed: boolean;
  reason?: string;
} {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, reason: 'empty bash command' };
  }

  const surface = stripShellQuotedStrings(trimmed);
  const matches = [...surface.matchAll(PLAN_MODE_AINOBI_INVOCATION)];
  if (matches.length === 0) {
    return {
      allowed: false,
      reason:
        'Plan mode Bash only allows research commands: `ainobi doc read`, `ainobi search`, `ainobi asset get`, `ainobi knowledge list|read`, `ainobi help`, `ainobi recall`. Use AskUserQuestion for clarification and Read for markdown outputs.',
    };
  }

  for (const match of matches) {
    const argv = (match[1] ?? '').trim();
    if (!PLAN_MODE_AINOBI_RESEARCH_ARGV.test(argv)) {
      const preview = argv.slice(0, 80) || '(no args)';
      return {
        allowed: false,
        reason:
          `Plan mode is research-only and blocks courseware/mutation actions (save, slide/element edits, narration, image generate, upload, …). Blocked: ainobi ${preview}`,
      };
    }
  }

  return { allowed: true };
}

const PLAN_MODE_ALLOWED_TOOLS = new Set([
  'AskUserQuestion',
  'Bash',
  'Read',
  'Grep',
  'Glob',
]);

/**
 * Plan mode tool policy: allows AskUserQuestion + read-only research (doc/search/asset get) and Read/Grep/Glob;
 * refuses Write/Edit, editing the courseware, image generation, narration and similar action tools.
 */
export function evaluatePlanModeToolUse(
  toolName: string,
  input: Record<string, unknown>,
  ctx: AgentToolPolicyContext,
): { allowed: boolean; message?: string } {
  if (!PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
    return deny(
      `Plan mode blocks tool "${toolName}". Allowed: AskUserQuestion, Bash (doc/search/asset get/knowledge list|read/help/recall only), Read, Grep, Glob.`,
    );
  }

  if (toolName === 'Bash') {
    if (input.dangerouslyDisableSandbox === true) {
      return deny('unsandboxed bash is not permitted');
    }
    const command = typeof input.command === 'string' ? input.command : '';
    const research = isPlanModeResearchBashCommand(command);
    if (!research.allowed) {
      return deny(research.reason ?? 'bash command blocked in plan mode');
    }
    const bash = isAgentBashCommandBlocked(command, ctx);
    if (bash.blocked) {
      return deny(bash.reason ?? 'bash command blocked by policy');
    }
    return allow();
  }

  if (toolName === 'AskUserQuestion') {
    return allow();
  }

  // Read / Grep / Glob — reuse agent path policy (skill bootstrap skipped when skillMdRead=true).
  return evaluateAgentToolUse(toolName, input, ctx);
}
