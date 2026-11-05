// SPDX-License-Identifier: AGPL-3.0-only
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { coursewareCliRoot } from '../runtime-paths.ts';

export const AGENT_SCENE_FILENAME = 'db-courseware.scene.json';

/** Section-bound knowledge catalog written for Plan/Agent (summaries only). */
export const SECTION_KNOWLEDGE_CATALOG_FILENAME = 'section-knowledge-catalog.json';

/** Skill tree copied into each isolated agent workspace (not symlinked — avoids repo-root resolution). */
export const AGENT_CLAUDE_SKILL_DIR = '.claude/skills/ainobi-courseware-cli';

/** Relative path agents must Read before any `ainobi` Bash command. */
export const AGENT_SKILL_MD_REL = `${AGENT_CLAUDE_SKILL_DIR}/SKILL.md`;

/** Per-chat CLI session binding + state files (shared by host preload and sandboxed Bash). */
export const AGENT_CLI_STATE_DIRNAME = '.ainobi-cli';

/** Written after the agent successfully reads {@link AGENT_SKILL_MD_REL}. */
export const AGENT_SKILL_MD_READ_MARKER = '.skill-md-read';

export function agentAinobiStateDir(workspaceDir: string): string {
  return resolve(workspaceDir, AGENT_CLI_STATE_DIRNAME);
}

export function resolveAgentWorkspaceDir(args: {
  coursewareCliRoot: string;
  conversationId?: string | null;
  preloadCoursewareId?: string | null;
  ephemeralKey?: string | null;
}): string {
  const conversationId = args.conversationId?.trim();
  if (conversationId) {
    return resolve(args.coursewareCliRoot, 'agent-workspaces', conversationId);
  }

  const preloadId = args.preloadCoursewareId?.trim();
  if (preloadId) {
    return resolve(args.coursewareCliRoot, 'agent-preload', preloadId);
  }

  const ephemeralKey = args.ephemeralKey?.trim() || 'session';
  return resolve(args.coursewareCliRoot, 'agent-preload', `_ephemeral_${ephemeralKey}`);
}

/**
 * Isolated agent cwd: scene JSON + a real copy of the ainobi-courseware-cli skill tree.
 */
export function ensureAgentWorkspaceLayout(args: {
  workspaceDir: string;
  projectRoot: string;
}): void {
  mkdirSync(args.workspaceDir, { recursive: true });
  copyAgentSkillTree(args);
}

/** Copy SKILL.md + references from the CLI package into the workspace skill directory. */
export function copyAgentSkillTree(args: { workspaceDir: string; projectRoot: string }): void {
  // The CLI package root: staged beside the bundle in deploy, the workspace package in dev.
  const pkgRoot = coursewareCliRoot;
  const skillMd = resolve(pkgRoot, 'SKILL.md');
  const skillRefs = resolve(pkgRoot, 'references');
  const skillDest = resolve(args.workspaceDir, AGENT_CLAUDE_SKILL_DIR);

  if (!existsSync(skillMd) || !existsSync(skillRefs)) {
    throw new Error(`Missing ainobi-courseware-cli skill sources under ${pkgRoot}`);
  }

  mkdirSync(resolve(args.workspaceDir, '.claude', 'skills'), { recursive: true });
  rmSync(skillDest, { recursive: true, force: true });
  mkdirSync(skillDest, { recursive: true });
  cpSync(skillMd, resolve(skillDest, 'SKILL.md'));
  cpSync(skillRefs, resolve(skillDest, 'references'), { recursive: true });
}

export function agentScenePath(workspaceDir: string): string {
  return resolve(workspaceDir, AGENT_SCENE_FILENAME);
}

export function hasAgentReadSkillMd(workspaceDir: string): boolean {
  return existsSync(resolve(agentAinobiStateDir(workspaceDir), AGENT_SKILL_MD_READ_MARKER));
}

/**
 * SKILL.md body (YAML frontmatter stripped) from the workspace skill copy, for inlining into the
 * system prompt so the agent does not spend a tool call — or trip the bootstrap gate — reading it.
 */
export function readAgentSkillMdForPrompt(workspaceDir: string): string | null {
  try {
    const raw = readFileSync(resolve(workspaceDir, AGENT_SKILL_MD_REL), 'utf8');
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    return body || null;
  } catch {
    return null;
  }
}

export function markAgentReadSkillMd(workspaceDir: string): void {
  const dir = agentAinobiStateDir(workspaceDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, AGENT_SKILL_MD_READ_MARKER), `${new Date().toISOString()}\n`, 'utf8');
}

/** CLI-managed temp root (`$TMP/ainobi-cli/work/<session-id>/`). */
export function managedCliWorkRoot(): string {
  return resolve(join(tmpdir(), 'ainobi-cli', 'work'));
}

export function isManagedCliWorkDir(dir: string): boolean {
  const root = managedCliWorkRoot();
  const target = resolve(dir.trim());
  return target === root || target.startsWith(`${root}${sep}`);
}
