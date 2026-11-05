// SPDX-License-Identifier: AGPL-3.0-only
import {
  actorFromSession,
  CoursewareOrgAccessError,
  normalizeOrgId,
} from '../auth/ainobi-org-access.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { resolveHandoffAccessToken } from '../auth/ainobi-user-session.ts';
import { dataSource } from '../db/db.ts';
import { ensureDataSource } from '../db/ensure-data-source.ts';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, sep } from 'node:path';
import { listAinobiCoursesForOrg } from '../services/ainobi-course-catalog.ts';
import { fetchOrgAiTeachersFromPlatform } from '../services/ainobi-ai-teachers.ts';
import { runHostNarration } from '../services/agent-narration-host-run.ts';
import { invalidateAgentWorkspaceSessionCache, readAgentWorkspaceSession } from '../services/agent-live-preview-flush.ts';
import { clearAgentWorkspaceCliSession } from '../services/agent-courseware-scene-sync.ts';
import { flushAgentWorkspacePersistenceWhenIdle } from '../services/agent-persistence-flush.ts';
import { recallToolResultBlob } from '../services/agent-tool-result-archive.ts';
import { writeSceneJsonAndAinobiLoad } from '../services/courseware-cli-preload.ts';
import {
  assertOrgIdAccess,
  assertOrgIdManageAccess,
} from '../services/courseware-design-templates-service.ts';
import { assertCoursewareRequestAccess } from '../services/courseware-org-guard.ts';
import { CoursewareVersionConflictError, getCoursewareEntityById, listCoursewareForOrg, saveCourseware } from '../services/courseware-service.ts';
import { createBlankCoursewareScene, newCoursewareBusinessKey } from './codex-mcp-blank-scene.ts';
import { resolveWorkspaceRelativePath } from './codex-mcp-media-tools.ts';
import { CONTENT_LANGUAGES, isContentLanguage } from '@ainobi/courseware-core/content-language.ts';
import { billNarrationTtsCredits } from '../services/narration-tts-billing.ts';
import {
  ensureCoursewareSectionBinding,
  unbindCoursewareFromSection,
} from '../services/courseware-section-binding-service.ts';
import { loadCoursewareAndAssertOrgAccess } from '../services/courseware-org-guard.ts';
import { mintAgentHandoff } from '../services/agent-handoff.ts';
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import { findLatestSectionBindingForCourseware } from '../services/courseware-section-binding-service.ts';
import {
  createAinobiCourse,
  getAinobiCourseInfo,
  updateAinobiCourse,
} from '../services/ainobi-course-catalog.ts';
import {
  ensureCoursewareCourseBinding,
  unbindCoursewareFromCourse,
} from '../services/courseware-course-binding-service.ts';
import {
  resolveManageWebOrigin,
  resolveStudentWebOrigin,
} from '../config/agent-web-origins.ts';
import { fetchOrgTtsFromPlatform } from '../services/ainobi-tts.ts';
import {
  type NarrationTtsBillingOutcome,
  findBlockedNarrationCatalogFileFlag,
  logNarrationTtsPreauthChargedButWorkFailed,
  narrationArgvFlagValue,
  resolveNarrationTtsBillingFailureResponse,
} from '../services/narration-tts-credits.ts';
import {
  patchSessionNarrationCatalogs,
  resolveNarrationTtsProviderForPreauth,
  resolveSessionJsonPath,
} from '../services/narration-tts-preauth.ts';
import { billTavilySearchCredits } from '../services/tavily-search-credits.ts';
import { resolveNarrationPronunciationDictJson } from '../services/narration-pronunciation-dict-env.ts';
import {
  resolveNarrationJaKanaLinesJsonForJob,
  resolveNarrationLanguagesForJob,
} from '../services/tts-japanese-auto-kana.ts';
import { parseSearchRunBody } from '../services/courseware-search-http.ts';
import {
  runTavilySearch,
  type TavilySearchDepth,
  type TavilySearchTopic,
  type TavilyTimeRange,
} from '../services/tavily-search.ts';
import { runCodexMcpAinobiExec } from './codex-mcp-ainobi-exec.ts';
import { assertSafeAinobiExecArgv, assertSafeMcpArgvTokens } from './codex-mcp-ainobi-policy.ts';
import {
  buildCodexMcpAinobiEnv,
  createCodexMcpWorkspaceBinding,
  deleteCodexMcpSession,
  getCodexMcpSession,
  isCodexMcpWorkspaceReady,
  isSafeCodexMcpSessionId,
  registerCodexMcpSession,
  syncOpenCodexMcpWorkspaceTitles,
  type CodexMcpWorkspaceSession,
} from './codex-mcp-session.ts';
import {
  ensureHydratedWorkspace,
  isToolError,
  requireOwnedSession,
  resolveCatalogOrgIdForMcpSession,
  toolError,
  type CodexMcpToolError,
} from './codex-mcp-tool-shared.ts';

export type { CodexMcpToolError };

function creditsTtsPayload(
  billing: Extract<NarrationTtsBillingOutcome, { kind: 'charged' }>,
): Record<string, unknown> {
  return {
    creditsTts: {
      provider: billing.provider,
      serviceCode: billing.result.serviceCode,
      characters: billing.characterCount,
      creditsConsumed: billing.result.creditsConsumed,
      remainingCredits: billing.result.remainingCredits,
    },
  };
}

/** List education courses in one authorized org (proxies backend course/list). */
export async function courseListTool(
  caller: AinobiAuthorizedSession,
  args: {
    org_id?: string;
    course_name?: string;
    page_number?: number;
    page_size?: number;
  },
): Promise<Record<string, unknown>> {
  const requestedOrgId = args.org_id?.trim() || caller.currentOrgId?.trim();
  if (!requestedOrgId) {
    return toolError(
      'org_id is required (session has no current org; pass org_id or use an org-bound Agent key)',
      'ORG_REQUIRED',
    );
  }

  try {
    await assertOrgIdAccess(caller, requestedOrgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot list courses for this organization', 'FORBIDDEN');
    }
    throw error;
  }

  const orgId = normalizeOrgId(requestedOrgId);
  if (!orgId) {
    return toolError(
      'org_id is required (session has no current org; pass org_id or use an org-bound Agent key)',
      'ORG_REQUIRED',
    );
  }

  try {
    const result = await listAinobiCoursesForOrg({
      accessToken: caller.accessToken,
      orgId,
      pageNumber: args.page_number,
      pageSize: args.page_size,
      ...(args.course_name?.trim() ? { courseName: args.course_name.trim() } : {}),
    });
    return {
      ok: true,
      data: {
        org_id: result.org_id,
        items: result.items.map((item) => ({
          course_id: item.course_id,
          course_name: item.course_name,
          course_status: item.course_status,
          course_description: item.course_description,
          chapter_count: item.chapter_count,
          section_count: item.section_count,
          student_count: item.student_count,
        })),
        pagination: result.pagination,
        next: 'Call courseware_list with course_id to see coursewares bound to a course, then courseware_open or courseware_create.',
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolError(message, 'COURSE_LIST_FAILED');
  }
}

/** List courseware in one authorized org (mirrors GET /courseware/list).
 * `org_id` optional: defaults to the Bearer session’s `currentOrgId`
 * (org Agent keys are credential-bound to exactly one org).
 */
export async function coursewareListTool(
  caller: AinobiAuthorizedSession,
  args: {
    org_id?: string;
    title?: string;
    course_id?: string;
    page_number?: number;
    page_size?: number;
    order?: 'asc' | 'desc';
  },
): Promise<Record<string, unknown>> {
  const requestedOrgId = args.org_id?.trim() || caller.currentOrgId?.trim();
  if (!requestedOrgId) {
    return toolError(
      'org_id is required (session has no current org; pass org_id or use an org-bound Agent key)',
      'ORG_REQUIRED',
    );
  }

  await ensureDataSource();
  try {
    await assertOrgIdAccess(caller, requestedOrgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot list this organization', 'FORBIDDEN');
    }
    throw error;
  }

  const orgId = normalizeOrgId(requestedOrgId);
  if (!orgId) {
    return toolError(
      'org_id is required (session has no current org; pass org_id or use an org-bound Agent key)',
      'ORG_REQUIRED',
    );
  }

  const pageNumber = Math.max(1, Math.floor(args.page_number ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(args.page_size ?? 20)));
  const order = args.order === 'asc' ? 'asc' : 'desc';
  const title = args.title?.trim();
  const courseId = args.course_id?.trim();

  const result = await listCoursewareForOrg({
    orgId,
    pageNumber,
    pageSize,
    order,
    withBindingStats: false,
    ...(title ? { title } : {}),
    ...(courseId ? { courseId } : {}),
  });

  return {
    ok: true,
    data: {
      org_id: orgId,
      items: result.data.map((item) => ({
        id: item.id,
        key: item.key,
        title: item.title,
        cover_url: item.coverUrl,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      })),
      pagination: result.pagination,
    },
  };
}

/**
 * Create a new courseware (blank scene) in an authorized org.
 * Optionally bind to an education `course_id` and immediately `courseware_open`.
 */
export async function coursewareCreateTool(
  caller: AinobiAuthorizedSession,
  args: {
    title?: string;
    /** Courseware content language (zh / en / ja); must be confirmed with the user. */
    language?: string;
    org_id?: string;
    course_id?: string;
    key?: string;
    open?: boolean;
  },
): Promise<Record<string, unknown>> {
  const title = args.title?.trim();
  if (!title) {
    return toolError('title is required', 'TITLE_REQUIRED');
  }
  const language = args.language?.trim();
  if (!isContentLanguage(language)) {
    return toolError(
      `language is required (${CONTENT_LANGUAGES.join(' / ')}). Confirm the courseware content language with the user first; do not infer it from the UI locale.`,
      'LANGUAGE_REQUIRED',
    );
  }

  const requestedOrgId = args.org_id?.trim() || caller.currentOrgId?.trim();
  if (!requestedOrgId) {
    return toolError(
      'org_id is required (session has no current org; pass org_id or use an org-bound Agent key)',
      'ORG_REQUIRED',
    );
  }

  await ensureDataSource();
  try {
    // Mirror HTTP PUT create: humans need managed_list; Org Agent same-org only.
    await assertOrgIdManageAccess(caller, requestedOrgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot create courseware in this organization', 'FORBIDDEN');
    }
    throw error;
  }

  const orgId = normalizeOrgId(requestedOrgId);
  if (!orgId) {
    return toolError(
      'org_id is required (session has no current org; pass org_id or use an org-bound Agent key)',
      'ORG_REQUIRED',
    );
  }

  const key = args.key?.trim() || newCoursewareBusinessKey();
  const courseId = args.course_id?.trim();
  const shouldOpen = args.open !== false;

  try {
    const dto = await saveCourseware({
      mode: 'create',
      key,
      orgId,
      title,
      content: createBlankCoursewareScene(title, language),
      ...(courseId ? { courseId } : {}),
      actor: actorFromSession(caller),
    });

    const entity = await getCoursewareEntityById(dto.key);
    const coursewareId = entity?.id || dto.key;

    const created = {
      id: coursewareId,
      key: dto.key,
      title: dto.title,
      org_id: dto.orgId,
      updated_at: dto.updatedAt,
      course_id: courseId || null,
    };

    if (!shouldOpen) {
      return {
        ok: true,
        data: {
          ...created,
          next: 'Call courseware_open with courseware_id to start authoring.',
        },
      };
    }

    const opened = await coursewareOpenTool(caller, { courseware_id: coursewareId });
    if (opened.ok !== true) {
      return {
        ok: true,
        data: {
          ...created,
          open_warning: opened,
          next: 'Courseware created; open failed — retry courseware_open.',
        },
      };
    }

    return {
      ok: true,
      data: {
        ...created,
        ...(typeof opened.data === 'object' && opened.data ? opened.data : {}),
        next:
          'Author with ainobi_exec / dedicated tools, then courseware_save. ' +
          'Call courseware_ui_links to get login-free browser preview URLs for the user.',
      },
    };
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot create courseware in this organization', 'FORBIDDEN');
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|key conflict|collides/i.test(message)) {
      return toolError(message, 'KEY_CONFLICT');
    }
    return toolError(message, 'CREATE_FAILED');
  }
}

/** Rename an existing courseware (title only; preserves content). */
export async function coursewareRenameTool(
  caller: AinobiAuthorizedSession,
  args: { courseware_id?: string; title?: string },
): Promise<Record<string, unknown>> {
  const idOrKey = args.courseware_id?.trim();
  const title = args.title?.trim();
  if (!idOrKey) {
    return toolError('courseware_id is required', 'COURSEWARE_REQUIRED');
  }
  if (!title) {
    return toolError('title is required', 'TITLE_REQUIRED');
  }

  await ensureDataSource();
  const cw = await getCoursewareEntityById(idOrKey);
  if (!cw) {
    return toolError(`Unknown courseware: ${idOrKey}`, 'NOT_FOUND');
  }

  try {
    await assertCoursewareRequestAccess(caller, cw, 'write');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }

  try {
    const content =
      cw.content && typeof cw.content === 'object'
        ? (cw.content as Record<string, unknown>)
        : createBlankCoursewareScene(title);
    if (content && typeof content === 'object' && 'name' in content) {
      content.name = title;
    }

    const dto = await saveCourseware({
      mode: 'update',
      coursewareId: cw.id,
      coursewareKey: cw.key,
      baseUpdatedAt: cw.updatedAt.toISOString(),
      title,
      content,
      actor: actorFromSession(caller),
    });

    // Keep open MCP workspaces' scene name in sync so later save does not revert title.
    syncOpenCodexMcpWorkspaceTitles({
      coursewareId: cw.id,
      coursewareKey: cw.key,
      title: dto.title ?? title,
      previousUpdatedAt: cw.updatedAt.toISOString(),
      updatedAt: dto.updatedAt,
    });

    return {
      ok: true,
      data: {
        id: cw.id,
        key: dto.key,
        title: dto.title,
        updated_at: dto.updatedAt,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolError(message, 'RENAME_FAILED');
  }
}

/** Open courseware into a dedicated Codex MCP workspace and preload scene. */
export async function coursewareOpenTool(
  caller: AinobiAuthorizedSession,
  args: { courseware_id: string; mcp_session_id?: string },
): Promise<Record<string, unknown>> {
  const idOrKey = args.courseware_id?.trim();
  if (!idOrKey) {
    return toolError('courseware_id is required');
  }

  const requestedId = args.mcp_session_id?.trim();
  if (requestedId) {
    if (!isSafeCodexMcpSessionId(requestedId)) {
      return toolError(
        'Invalid mcp_session_id (use 8–128 chars of A-Za-z0-9_-, no path separators)',
        'INVALID_SESSION_ID',
      );
    }
    const existing = await getCodexMcpSession(requestedId);
    if (existing && existing.ownerUserId !== caller.userId) {
      return toolError('Forbidden: mcp_session_id belongs to another user', 'FORBIDDEN');
    }
  }

  await ensureDataSource();
  const cw = await getCoursewareEntityById(idOrKey);
  if (!cw) {
    return toolError(`Unknown courseware: ${idOrKey}`, 'NOT_FOUND');
  }

  try {
    await assertCoursewareRequestAccess(caller, cw, 'write');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }

  const binding = createCodexMcpWorkspaceBinding({
    userSession: caller,
    coursewareId: cw.id,
    coursewareKey: cw.key,
    coursewareOrgId: cw.orgId,
    actor: actorFromSession(caller),
    mcpSessionId: requestedId,
  });

  // Reopening a session reloads it: the CLI refuses a second load while a session is bound.
  await clearAgentWorkspaceCliSession(binding.workspaceDir);

  const load = writeSceneJsonAndAinobiLoad({
    scenePath: binding.scenePath,
    content: cw.content as Record<string, unknown>,
    cwd: binding.workspaceDir,
    env: buildCodexMcpAinobiEnv(binding, caller.accessToken),
    coursewareUpdatedAt: cw.updatedAt.toISOString(),
  });

  if (!load.ok) {
    return {
      ...toolError('ainobi load failed', 'LOAD_FAILED'),
      stdout: load.stdout,
      stderr: load.stderr,
      status: load.status,
    };
  }

  await registerCodexMcpSession(binding);

  return {
    ok: true,
    data: {
      mcp_session_id: binding.mcpSessionId,
      courseware_id: binding.coursewareId,
      courseware_key: binding.coursewareKey,
      courseware_org_id: binding.coursewareOrgId,
      load_stdout: load.stdout.trim() || undefined,
    },
  };
}

export async function coursewareStatusTool(
  caller: AinobiAuthorizedSession,
  args: { mcp_session_id?: string },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }
  return {
    ok: true,
    data: {
      mcp_session_id: session.mcpSessionId,
      courseware_id: session.coursewareId,
      courseware_key: session.coursewareKey,
      courseware_org_id: session.coursewareOrgId,
      local_workspace_ready: await isCodexMcpWorkspaceReady(session),
      created_at: session.createdAt,
    },
  };
}

export async function coursewareCloseTool(
  caller: AinobiAuthorizedSession,
  args: { mcp_session_id?: string },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }
  const existed = await deleteCodexMcpSession(session.mcpSessionId);
  return { ok: true, data: { mcp_session_id: session.mcpSessionId, closed: existed } };
}

export async function ainobiExecTool(
  caller: AinobiAuthorizedSession,
  args: { mcp_session_id?: string; argv: unknown },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }

  const policy = assertSafeAinobiExecArgv(args.argv, { scenePreloaded: true });
  if (!policy.ok) {
    // Convenience: ainobi_exec ["save"] → courseware_save
    if (
      Array.isArray(args.argv) &&
      typeof args.argv[0] === 'string' &&
      args.argv[0].trim().toLowerCase() === 'save'
    ) {
      return coursewareSaveTool(caller, { mcp_session_id: session.mcpSessionId });
    }
    return toolError(policy.reason, 'POLICY');
  }

  const hydrateErr = await ensureHydratedWorkspace(caller, session);
  if (hydrateErr) {
    return hydrateErr;
  }

  const result = await runCodexMcpAinobiExec(session, caller.accessToken, policy.argv);
  return {
    ok: result.ok,
    exit_code: result.exit_code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const WORKSPACE_TEXT_EXTENSIONS = new Set(['.json', '.jsx', '.tsx', '.html', '.css', '.svg', '.md', '.txt']);
const MAX_WORKSPACE_TEXT_BYTES = 5 * 1024 * 1024;

/** Writes one text file inside an MCP workspace. Dot directories hold session state, and the loaded scene is not an input. */
export async function writeWorkspaceTextFile(
  workspace: { workspaceDir: string; scenePath: string },
  path: string | undefined,
  content: string | undefined,
): Promise<Record<string, unknown>> {
  const target = path ? resolveWorkspaceRelativePath(workspace.workspaceDir, path) : null;
  if (!target) {
    return toolError('path must be relative to the workspace and cannot contain ..', 'USAGE');
  }
  const rel = relative(workspace.workspaceDir, target);
  if (!rel || rel.split(sep).some((segment) => segment.startsWith('.')) || target === workspace.scenePath) {
    return toolError('path cannot point at session state or the loaded scene', 'USAGE');
  }
  if (!WORKSPACE_TEXT_EXTENSIONS.has(extname(target).toLowerCase())) {
    return toolError(`Unsupported extension. Supported: ${[...WORKSPACE_TEXT_EXTENSIONS].join(', ')}`, 'USAGE');
  }
  if (typeof content !== 'string') {
    return toolError('content is required', 'USAGE');
  }
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WORKSPACE_TEXT_BYTES) {
    return toolError(`content exceeds ${MAX_WORKSPACE_TEXT_BYTES} bytes`, 'USAGE');
  }
  await mkdir(dirname(target), { recursive: true });
  const root = await realpath(workspace.workspaceDir);
  const parent = await realpath(dirname(target));
  if (parent !== root && !parent.startsWith(root + sep)) {
    return toolError('path resolves outside the workspace', 'USAGE');
  }
  await writeFile(target, content, 'utf8');
  return { ok: true, data: { path: rel.split(sep).join('/'), bytes } };
}

/** Lets a client that shares no filesystem with the service prepare batch plans and quiz layouts. */
export async function coursewareWorkspaceWriteTool(
  caller: AinobiAuthorizedSession,
  args: { mcp_session_id?: string; path?: string; content?: string },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }
  const hydrateErr = await ensureHydratedWorkspace(caller, session);
  if (hydrateErr) {
    return hydrateErr;
  }
  return writeWorkspaceTextFile(session, args.path, args.content);
}

export async function coursewareSaveTool(
  caller: AinobiAuthorizedSession,
  args: { mcp_session_id?: string; force?: boolean },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }
  const hydrateErr = await ensureHydratedWorkspace(caller, session);
  if (hydrateErr) {
    return hydrateErr;
  }

  await ensureDataSource();
  invalidateAgentWorkspaceSessionCache(session.workspaceDir);
  const syncedAt = (await readAgentWorkspaceSession(session.workspaceDir))?.courseware_synced_at?.trim();
  let flushed;
  try {
    flushed = await flushAgentWorkspacePersistenceWhenIdle(
      session.workspaceDir,
      session.coursewareKey,
      actorFromSession(caller),
      session.coursewareOrgId,
      syncedAt && args.force !== true ? { baseUpdatedAt: syncedAt } : undefined,
    );
  } catch (error) {
    if (error instanceof CoursewareVersionConflictError) {
      return toolError(
        'Not saved: this courseware changed elsewhere (for example in the editor) after this session loaded it, and saving would overwrite those changes. ' +
          'Call courseware_open to load the latest version, then reapply your edits. Pass force: true only if the user wants this version to replace theirs.',
        'VERSION_CONFLICT',
      );
    }
    throw error;
  }
  if (!flushed) {
    return toolError('Nothing to save (empty or missing session scene)', 'EMPTY');
  }
  return {
    ok: true,
    data: {
      key: flushed.key,
      title: flushed.title,
      updatedAt: flushed.updatedAt,
      versionCount: flushed.versionCount,
      next: 'Content is saved — call courseware_ui_links and send the user the latest preview link so they can see the result.',
    },
  };
}

/** List org AI teachers for narration (platform catalog; same as host /courseware/ai-teachers/list). */
/**
 * MCP: bind an AI courseware to a course section. The backend
 * course_section.has_courseware_bound flag is synced in the same flow
 * (shared education DB), so the course detail page reflects it immediately.
 */
export async function coursewareBindSectionTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    org_id?: string;
    courseware_id?: string;
    course_id?: string;
    section_id?: string;
    chapter_id?: string;
    is_current?: boolean;
  },
): Promise<Record<string, unknown>> {
  let mcpSession: CodexMcpWorkspaceSession | undefined;
  const mcpSessionId = args.mcp_session_id?.trim();
  if (mcpSessionId) {
    const session = await requireOwnedSession(caller, mcpSessionId);
    if (isToolError(session)) {
      return session;
    }
    mcpSession = session;
  }
  const catalogOrg = resolveCatalogOrgIdForMcpSession({
    mcpSession,
    requestedOrgId: args.org_id,
    callerOrgId: caller.currentOrgId,
  });
  if (!catalogOrg.ok) {
    return catalogOrg.error;
  }
  const orgId = normalizeOrgId(catalogOrg.orgIdRaw);
  if (!orgId) {
    return toolError('org_id is required', 'ORG_REQUIRED');
  }
  const coursewareId =
    args.courseware_id?.trim() || mcpSession?.coursewareId?.trim() || '';
  const courseId = args.course_id?.trim() || '';
  const sectionId = args.section_id?.trim() || '';
  if (!coursewareId) {
    return toolError(
      'courseware_id is required (or open a courseware first)',
      'COURSEWARE_REQUIRED',
    );
  }
  if (!courseId) {
    return toolError('course_id is required', 'COURSE_REQUIRED');
  }
  if (!sectionId) {
    return toolError('section_id is required', 'SECTION_REQUIRED');
  }
  // The same gate as the HTTP bind route: org management permission + courseware access (P0: prevents cross-organization binding rewrites)
  await ensureDataSource();
  await assertOrgIdManageAccess(caller, orgId);
  await loadCoursewareAndAssertOrgAccess(caller, coursewareId);
  const binding = await ensureCoursewareSectionBinding({
    coursewareId,
    sectionId,
    courseId,
    orgId,
    chapterId: args.chapter_id?.trim() || undefined,
    isCurrent: args.is_current ?? true,
    createdBy: caller.userId,
  });
  return {
    ok: true,
    binding: {
      coursewareId: binding.coursewareId,
      sectionId: binding.sectionId,
      courseId: binding.courseId,
      chapterId: binding.chapterId,
      isCurrent: binding.isCurrent,
    },
    note: 'course_section.has_courseware_bound synced',
  };
}

/** MCP: unbind an AI courseware from a course section (flag recalculated). */
export async function coursewareUnbindSectionTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    org_id?: string;
    courseware_id?: string;
    section_id?: string;
  },
): Promise<Record<string, unknown>> {
  let mcpSession: CodexMcpWorkspaceSession | undefined;
  const mcpSessionId = args.mcp_session_id?.trim();
  if (mcpSessionId) {
    const session = await requireOwnedSession(caller, mcpSessionId);
    if (isToolError(session)) {
      return session;
    }
    mcpSession = session;
  }
  const catalogOrg = resolveCatalogOrgIdForMcpSession({
    mcpSession,
    requestedOrgId: args.org_id,
    callerOrgId: caller.currentOrgId,
  });
  if (!catalogOrg.ok) {
    return catalogOrg.error;
  }
  const orgId = normalizeOrgId(catalogOrg.orgIdRaw);
  if (!orgId) {
    return toolError('org_id is required', 'ORG_REQUIRED');
  }
  const coursewareId =
    args.courseware_id?.trim() || mcpSession?.coursewareId?.trim() || '';
  const sectionId = args.section_id?.trim() || '';
  if (!coursewareId) {
    return toolError(
      'courseware_id is required (or open a courseware first)',
      'COURSEWARE_REQUIRED',
    );
  }
  if (!sectionId) {
    return toolError('section_id is required', 'SECTION_REQUIRED');
  }
  // The same gate as the HTTP unbind route: org management permission + courseware access
  await ensureDataSource();
  await assertOrgIdManageAccess(caller, orgId);
  await loadCoursewareAndAssertOrgAccess(caller, coursewareId);
  const unbound = await unbindCoursewareFromSection(coursewareId, sectionId, orgId);
  return { ok: true, unbound, note: 'course_section.has_courseware_bound recalculated' };
}

export async function coursewareAiTeachersTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    org_id?: string;
    status?: string;
  },
): Promise<Record<string, unknown>> {
  let mcpSession: CodexMcpWorkspaceSession | undefined;
  const mcpSessionId = args.mcp_session_id?.trim();
  if (mcpSessionId) {
    const session = await requireOwnedSession(caller, mcpSessionId);
    if (isToolError(session)) {
      return session;
    }
    mcpSession = session;
  }

  const catalogOrg = resolveCatalogOrgIdForMcpSession({
    mcpSession,
    requestedOrgId: args.org_id,
    callerOrgId: caller.currentOrgId,
  });
  if (!catalogOrg.ok) {
    return catalogOrg.error;
  }
  const requestedOrgId = catalogOrg.orgIdRaw;

  const orgId = normalizeOrgId(requestedOrgId);
  if (!orgId) {
    return toolError('org_id is required', 'ORG_REQUIRED');
  }

  try {
    // Catalog read: member org list for humans; same-org for Org Agent (assertOrgIdAccess).
    await assertOrgIdAccess(caller, requestedOrgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot query AI teachers for this organization', 'FORBIDDEN');
    }
    return toolError(
      error instanceof Error ? error.message : String(error),
      'FORBIDDEN',
    );
  }

  try {
    const result = await fetchOrgAiTeachersFromPlatform(caller.accessToken, orgId, {
      fetchAllPages: true,
      aiTeacherStatus: args.status?.trim() || 'active',
    });
    if (mcpSession) {
      const hydrateErr = await ensureHydratedWorkspace(caller, mcpSession);
      if (hydrateErr) {
        return hydrateErr;
      }
      await patchSessionNarrationCatalogs({
        stateDir: mcpSession.stateDir,
        shellSession: mcpSession.shellSession,
        aiTeachers: [...result.teachers],
      });
    }
    const items = result.teachers.map((t) => ({
      ai_teacher_id: t.ai_teacher_id,
      ai_teacher_name: t.ai_teacher_name,
      ai_teacher_language: t.ai_teacher_language ?? null,
      ai_teacher_tts_provider: t.ai_teacher_tts_provider ?? null,
      has_tts: Boolean(t.ai_teacher_tts_id),
    }));
    return {
      ok: true,
      data: {
        source: 'platform',
        org_id: result.orgId,
        count: items.length,
        total_count: result.totalCount,
        empty_catalog: items.length === 0,
        catalog_saved: Boolean(mcpSession),
        items,
        next:
          items.length === 0
            ? 'No AI teachers configured. Ask an admin to add one under Teacher Management > AI Teachers (Chinese UI label “教师管理 > AI 教师”), or continue with silent slides.'
            : 'Show ai_teacher_name (+ language) to the user; keep ai_teacher_id internal. Pass --teacher-id to courseware_narration.',
      },
    };
  } catch (error) {
    return toolError(
      error instanceof Error ? error.message : String(error),
      'AI_TEACHERS_FAILED',
    );
  }
}

/**
 * If argv references --teacher-id / --tts-id but the CLI session catalog is empty/missing,
 * fetch from the platform and persist before preauth so billing uses the correct TTS provider.
 */
async function ensureMcpNarrationCatalogsForBilling(args: {
  caller: AinobiAuthorizedSession;
  session: CodexMcpWorkspaceSession;
  argv: string[];
}): Promise<void> {
  const teacherId = narrationArgvFlagValue(args.argv, '--teacher-id')?.trim();
  const ttsId = narrationArgvFlagValue(args.argv, '--tts-id')?.trim();
  if (!teacherId && !ttsId) {
    return;
  }
  const orgId = normalizeOrgId(args.session.coursewareOrgId?.trim() || '');
  if (!orgId) {
    return;
  }

  let needsTeachers = Boolean(teacherId);
  let needsVoices = Boolean(ttsId);
  const sessionPath = await resolveSessionJsonPath({
    stateDir: args.session.stateDir,
    shellSession: args.session.shellSession,
  });
  if (sessionPath) {
    try {
      const parsed = JSON.parse(await readFile(sessionPath, 'utf8')) as {
        ai_teachers?: unknown;
        tts_voices?: unknown;
      };
      if (teacherId && Array.isArray(parsed.ai_teachers)) {
        const found = parsed.ai_teachers.some((row) => {
          if (!row || typeof row !== 'object') return false;
          const rec = row as Record<string, unknown>;
          return (
            rec.ai_teacher_id === teacherId || rec.ai_teacher_tts_id === teacherId
          );
        });
        if (found) needsTeachers = false;
      }
      if (ttsId && Array.isArray(parsed.tts_voices)) {
        const found = parsed.tts_voices.some((row) => {
          if (!row || typeof row !== 'object') return false;
          return (row as Record<string, unknown>).tts_id === ttsId;
        });
        if (found) needsVoices = false;
      }
    } catch {
      // fetch below
    }
  }

  try {
    if (needsTeachers) {
      const result = await fetchOrgAiTeachersFromPlatform(args.caller.accessToken, orgId, {
        fetchAllPages: true,
        aiTeacherStatus: 'active',
      });
      await patchSessionNarrationCatalogs({
        stateDir: args.session.stateDir,
        shellSession: args.session.shellSession,
        aiTeachers: [...result.teachers],
      });
    }
    if (needsVoices) {
      const result = await fetchOrgTtsFromPlatform(args.caller.accessToken, orgId, {
        fetchAllPages: true,
        ttsStatus: 'active',
      });
      const voices = [...result.voices];
      if (ttsId && !voices.some((voice) => voice.tts_id === ttsId)) {
        // An existing courseware may store an old, hidden (inactive) voice; that entry is added, and billing follows its real provider.
        const inactive = await fetchOrgTtsFromPlatform(args.caller.accessToken, orgId, {
          fetchAllPages: true,
          ttsStatus: 'inactive',
        });
        const legacy = inactive.voices.find((voice) => voice.tts_id === ttsId);
        if (legacy) voices.push(legacy);
      }
      await patchSessionNarrationCatalogs({
        stateDir: args.session.stateDir,
        shellSession: args.session.shellSession,
        ttsVoices: voices,
      });
    }
  } catch (error) {
    console.warn(
      '[mcp] narration catalog hydrate before billing failed:',
      error instanceof Error ? error.message : error,
    );
  }
}

export async function coursewareNarrationTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    argv: unknown;
    pretty?: boolean;
  },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }
  const hydrateErr = await ensureHydratedWorkspace(caller, session);
  if (hydrateErr) {
    return hydrateErr;
  }

  const argvParts = Array.isArray(args.argv)
    ? args.argv.map((p) => String(p).trim()).filter(Boolean)
    : [];
  const narrationArgv =
    argvParts[0]?.toLowerCase() === 'narration' ? argvParts : ['narration', ...argvParts];
  if (narrationArgv.length < 2) {
    return toolError('courseware_narration requires narration argv (e.g. insert …)', 'POLICY');
  }
  const argvSafety = assertSafeMcpArgvTokens(narrationArgv);
  if (!argvSafety.ok) {
    return toolError(argvSafety.reason, 'POLICY');
  }
  // Catalogs must come from courseware_ai_teachers / courseware_tts_list — no host FS reads.
  // Cover both `--flag value` and `--flag=value` forms (CLI accepts both).
  const blockedCatalogFileFlag = findBlockedNarrationCatalogFileFlag(narrationArgv);
  if (blockedCatalogFileFlag) {
    return toolError(
      `${blockedCatalogFileFlag} is not allowed on MCP narration; use courseware_ai_teachers / courseware_tts_list`,
      'POLICY',
    );
  }

  const pretty = args.pretty !== false;
  let creditsBilling: Record<string, unknown> | undefined;
  let charged: Extract<NarrationTtsBillingOutcome, { kind: 'charged' }> | undefined;
  const conversationId = `codex-mcp-${session.mcpSessionId}`;

  const insertIdx = narrationArgv.indexOf('insert');
  const slideRef =
    insertIdx >= 0
      ? narrationArgv.slice(insertIdx + 1).find((arg) => !arg.startsWith('-'))
      : undefined;

  // Ensure session catalogs exist before provider-based billing (Google / MiniMax / FishAudio).
  await ensureMcpNarrationCatalogsForBilling({
    caller,
    session,
    argv: narrationArgv,
  });

  const ttsProvider = await resolveNarrationTtsProviderForPreauth({
    stateDir: session.stateDir,
    shellSession: session.shellSession,
    argv: narrationArgv,
  });
  const billingArgs = {
    session: caller,
    argv: narrationArgv,
    coursewareOrgId: session.coursewareOrgId ?? undefined,
    conversationId,
    slideRef,
  };
  const billing =
    await billNarrationTtsCredits(ttsProvider, billingArgs);
  if (billing?.kind === 'failed') {
    const failure = resolveNarrationTtsBillingFailureResponse(billing);
    return { ok: false, error: failure.body, http_status: failure.status, code: 'CREDITS' };
  }
  if (billing?.kind === 'charged') {
    charged = billing;
    creditsBilling = creditsTtsPayload(billing);
  }

  try {
    // Languages first (same host-side contract as the HTTP narration path): they gate
    // the platform (ja) dict merge and the kana line map.
    const languages = await resolveNarrationLanguagesForJob({
      stateDir: session.stateDir,
      shellSession: session.shellSession,
      argv: narrationArgv,
    });
    const pronunciationDictJson = await resolveNarrationPronunciationDictJson({
      orgId: session.coursewareOrgId,
      ttsProvider,
      includePlatform: languages.japanese,
    });
    // Japanese full-text kana per line.
    const jaKanaLinesJson = await resolveNarrationJaKanaLinesJsonForJob({
      argv: narrationArgv,
      ttsProvider,
      languages,
      pronunciationDictJson,
    });
    const result = await runHostNarration({
      workspace_dir: session.workspaceDir,
      state_dir: session.stateDir,
      argv: narrationArgv,
      shell_session: session.shellSession,
      pretty,
      ...(pronunciationDictJson !== undefined
        ? { pronunciation_dict_json: pronunciationDictJson }
        : {}),
      ...(jaKanaLinesJson !== undefined ? { ja_kana_lines_json: jaKanaLinesJson } : {}),
    });
    if (!result.ok && charged) {
      logNarrationTtsPreauthChargedButWorkFailed({
        phase: 'narration',
        provider: charged.provider,
        characterCount: charged.characterCount,
        ledgerId: charged.result.ledgerId,
        error: result.stderr.trim() || `host narration exit ${result.exit_code}`,
      });
    }
    return {
      ok: result.ok,
      exit_code: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr,
      ...creditsBilling,
    };
  } catch (error) {
    if (charged) {
      logNarrationTtsPreauthChargedButWorkFailed({
        phase: 'narration',
        provider: charged.provider,
        characterCount: charged.characterCount,
        ledgerId: charged.result.ledgerId,
        error,
      });
    }
    return toolError(error instanceof Error ? error.message : String(error), 'NARRATION_FAILED');
  }
}

export async function coursewareSearchTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    query: string;
    search_depth?: TavilySearchDepth;
    max_results?: number;
    topic?: TavilySearchTopic;
    time_range?: TavilyTimeRange;
    include_answer?: boolean | 'basic' | 'advanced';
    include_raw_content?: boolean;
  },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }
  const query = args.query?.trim();
  if (!query) {
    return toolError('query is required');
  }

  const request = parseSearchRunBody({
    query,
    search_depth: args.search_depth,
    topic: args.topic,
    time_range: args.time_range,
    max_results: args.max_results,
    include_answer: args.include_answer,
    include_raw_content: args.include_raw_content,
  });
  if (!request) {
    return toolError(
      'Invalid search args (search_depth/topic/time_range allowlist, or max_results 0–20)',
      'USAGE',
    );
  }

  try {
    const data = await runTavilySearch(request);
    const credits = await billTavilySearchCredits({
      session: caller,
      query,
      coursewareOrgId: session.coursewareOrgId ?? undefined,
      conversationId: `codex-mcp-${session.mcpSessionId}`,
    });
    if (credits?.kind === 'failed') {
      return toolError(
        `Search succeeded but credits charge failed: ${credits.error}`,
        'CREDITS_FAILED',
      );
    }
    return {
      ok: true,
      data,
      ...(credits?.kind === 'charged'
        ? {
            creditsTavily: {
              serviceCode: credits.result.serviceCode,
              searchCount: 1,
              creditsConsumed: credits.result.creditsConsumed,
              remainingCredits: credits.result.remainingCredits,
            },
          }
        : {}),
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error), 'SEARCH_FAILED');
  }
}

export async function coursewareRecallTool(
  caller: AinobiAuthorizedSession,
  args: { mcp_session_id?: string; id: string },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }
  const id = args.id?.trim();
  if (!id) {
    return toolError('id is required');
  }

  // ensureDataSource() initializes the shared singleton and resolves to void.
  await ensureDataSource();
  const recalled = await recallToolResultBlob({
    dataSource,
    id,
    conversationId: null,
    sessionId: session.shellSession,
  });
  if (!recalled) {
    return toolError(`Tool result blob not found: ${id}`, 'NOT_FOUND');
  }
  return {
    ok: true,
    data: {
      id: recalled.id,
      tool_name: recalled.toolName,
      command_summary: recalled.commandSummary,
      truncated: recalled.truncated,
      byte_size: recalled.byteSize,
      content: recalled.content,
    },
  };
}

// ---------------------------------------------------------------------------
// Course domain — course ≠ courseware: a course is a container, and coursewares belong to the course's courseware library
// ---------------------------------------------------------------------------

const COURSE_STATUS_ALLOWLIST = new Set(['draft', 'public', 'private', 'off_shelf']);

function resolveOrgIdForTools(
  caller: AinobiAuthorizedSession,
  argsOrgId?: string,
): string | null {
  return argsOrgId?.trim() || caller.currentOrgId?.trim() || null;
}

/** Create a course (≠ courseware). Use this when the user wants to "create a course"; don't substitute courseware_create. */
export async function courseCreateTool(
  caller: AinobiAuthorizedSession,
  args: {
    title?: string;
    description?: string;
    status?: string;
    is_public?: boolean;
    org_id?: string;
  },
): Promise<Record<string, unknown>> {
  const title = args.title?.trim();
  if (!title) {
    return toolError('title is required (course name)', 'TITLE_REQUIRED');
  }
  const status = args.status?.trim() || 'draft';
  if (!COURSE_STATUS_ALLOWLIST.has(status)) {
    return toolError(
      `Invalid status "${status}". Allowed: ${[...COURSE_STATUS_ALLOWLIST].join(', ')}`,
      'USAGE',
    );
  }
  const orgId = resolveOrgIdForTools(caller, args.org_id);
  if (!orgId) {
    return toolError('org_id is required (session has no current org)', 'ORG_REQUIRED');
  }
  try {
    await assertOrgIdManageAccess(caller, orgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot create courses in this organization', 'FORBIDDEN');
    }
    throw error;
  }
  try {
    const created = await createAinobiCourse({
      orgId,
      accessToken: caller.accessToken,
      courseName: title,
      description: args.description ?? null,
      status,
      isPublic: args.is_public ?? null,
    });
    return {
      ok: true,
      data: {
        course_id: created.course_id,
        course_name: created.course_name,
        course_status: created.course_status,
        org_id: created.org_id,
        next:
          'This is a course container, not courseware. To add courseware to its library: create courseware with courseware_create (optionally with course_id to bind it), or import existing courseware with courseware_import_to_course. Then call courseware_ui_links and send the user the preview / course list links.',
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Free-tier organizations may not have private courses (is_public_course defaults to false): give a deterministic remedy
    if (message.includes('Private courses not allowed')) {
      return toolError(
        'The current org plan does not allow private courses. Two options: ' +
          '(1) call again with is_public=true to create a public course (anyone outside the org can join — confirm with the user first); ' +
          '(2) have an admin upgrade the org plan, then create the private course.',
        'PRIVATE_COURSE_NOT_ALLOWED',
      );
    }
    return toolError(message, 'COURSE_CREATE_FAILED');
  }
}

/** Update course info (name/description/status). */
export async function courseUpdateTool(
  caller: AinobiAuthorizedSession,
  args: {
    course_id?: string;
    title?: string;
    description?: string;
    status?: string;
    is_public?: boolean;
    org_id?: string;
  },
): Promise<Record<string, unknown>> {
  const courseId = args.course_id?.trim();
  if (!courseId) {
    return toolError('course_id is required', 'COURSE_REQUIRED');
  }
  if (!args.title?.trim() && args.description == null && !args.status?.trim()) {
    return toolError('nothing to update (title/description/status)', 'USAGE');
  }
  const status = args.status?.trim();
  if (status && !COURSE_STATUS_ALLOWLIST.has(status)) {
    return toolError(
      `Invalid status "${status}". Allowed: ${[...COURSE_STATUS_ALLOWLIST].join(', ')}`,
      'USAGE',
    );
  }
  const orgId = resolveOrgIdForTools(caller, args.org_id);
  if (!orgId) {
    return toolError('org_id is required (session has no current org)', 'ORG_REQUIRED');
  }
  try {
    await assertOrgIdManageAccess(caller, orgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot update courses in this organization', 'FORBIDDEN');
    }
    throw error;
  }
  try {
    const updated = await updateAinobiCourse({
      orgId,
      courseId,
      accessToken: caller.accessToken,
      courseName: args.title ?? null,
      description: args.description ?? null,
      status: status ?? null,
      isPublic: args.is_public ?? null,
    });
    return {
      ok: true,
      data: {
        course_id: updated.course_id,
        course_name: updated.course_name,
        course_status: updated.course_status,
        course_description: updated.course_description,
      },
    };
  } catch (error) {
    return toolError(
      error instanceof Error ? error.message : String(error),
      'COURSE_UPDATE_FAILED',
    );
  }
}

/** Import a courseware into the course's courseware library (binding, idempotent; the courseware itself is untouched). */
export async function coursewareImportToCourseTool(
  caller: AinobiAuthorizedSession,
  args: {
    courseware_id?: string;
    course_id?: string;
    mcp_session_id?: string;
    org_id?: string;
  },
): Promise<Record<string, unknown>> {
  const coursewareRef = args.courseware_id?.trim();
  const courseId = args.course_id?.trim();
  if (!coursewareRef || !courseId) {
    return toolError('courseware_id and course_id are required', 'USAGE');
  }
  await ensureDataSource();
  const cw = await getCoursewareEntityById(coursewareRef);
  if (!cw) {
    return toolError(`Unknown courseware: ${coursewareRef}`, 'NOT_FOUND');
  }
  try {
    await assertCoursewareRequestAccess(caller, cw, 'write');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }
  const orgId = cw.orgId?.trim() || args.org_id?.trim() || '';
  if (!orgId) {
    return toolError('courseware org_id is not set', 'USAGE');
  }
  // The course must exist and belong to the same org (the backend's org-scoped query also verifies the caller's course read permission)
  const course = await getAinobiCourseInfo({
    orgId,
    courseId,
    accessToken: caller.accessToken,
  });
  if (!course) {
    return toolError(
      `Course not found in this organization: ${courseId} (course and courseware must belong to the same org)`,
      'NOT_FOUND',
    );
  }
  try {
    await ensureCoursewareCourseBinding({
      coursewareId: cw.id,
      courseId,
      orgId,
      createdBy: caller.userId,
    });
  } catch (error) {
    return toolError(
      error instanceof Error ? error.message : String(error),
      'IMPORT_FAILED',
    );
  }
  return {
    ok: true,
    data: {
      courseware_id: cw.id,
      courseware_title: cw.title,
      course_id: courseId,
      course_name: course.course_name,
      imported: true,
      next: 'Courseware imported into the course library (idempotent; re-importing has no side effects). The courseware itself did not move; view it with courseware_list {course_id}. Remove it with courseware_export_from_course. The change is live — call courseware_ui_links and send the user the preview link.',
    },
  };
}

/** Export a courseware out of the course's courseware library (unbinding; the courseware itself stays in the organization library). */
export async function coursewareExportFromCourseTool(
  caller: AinobiAuthorizedSession,
  args: {
    courseware_id?: string;
    course_id?: string;
    mcp_session_id?: string;
    org_id?: string;
  },
): Promise<Record<string, unknown>> {
  const coursewareRef = args.courseware_id?.trim();
  const courseId = args.course_id?.trim();
  if (!coursewareRef || !courseId) {
    return toolError('courseware_id and course_id are required', 'USAGE');
  }
  await ensureDataSource();
  const cw = await getCoursewareEntityById(coursewareRef);
  if (!cw) {
    return toolError(`Unknown courseware: ${coursewareRef}`, 'NOT_FOUND');
  }
  try {
    await assertCoursewareRequestAccess(caller, cw, 'write');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }
  const orgId = cw.orgId?.trim() || args.org_id?.trim() || '';
  if (!orgId) {
    return toolError('courseware org_id is not set', 'USAGE');
  }
  let removed: boolean;
  try {
    removed = await unbindCoursewareFromCourse(cw.id, courseId, orgId);
  } catch (error) {
    return toolError(
      error instanceof Error ? error.message : String(error),
      'EXPORT_FAILED',
    );
  }
  if (!removed) {
    return toolError(
      `Binding not found: courseware ${cw.id} is not in course ${courseId}`,
      'NOT_FOUND',
    );
  }
  return {
    ok: true,
    data: {
      courseware_id: cw.id,
      courseware_title: cw.title,
      course_id: courseId,
      exported: true,
      next: 'Courseware removed from the course library; it stays in the org library (visible via courseware_list without course_id) and was not deleted. The change is live — call courseware_ui_links and send the user the preview link.',
    },
  };
}

// ---------------------------------------------------------------------------
// courseware_ui_links — login-free browser handoff links for Codex
// ---------------------------------------------------------------------------

export type CoursewareUiLinkSpec = {
  studentOrigin: string;
  /** Null when this deployment has no manage app: the manage links are left out. */
  manageOrigin: string | null;
  handoffCode: string;
  coursewareId: string;
  orgId: string | null;
  /** Course id when the courseware is bound to a course section (drives the manage deep link). */
  manageCourseId: string | null;
};

function joinUrl(origin: string, path: string, params: Record<string, string>): string {
  const base = `${origin.replace(/\/+$/, '')}${path}`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

/** Pure URL builder so link shapes stay unit-testable without IO. */
export function buildCoursewareUiLinks(spec: CoursewareUiLinkSpec): {
  links: Record<string, string>;
  paths: Record<string, string>;
} {
  const previewPath = '/courseware-preview';
  const editorPath = '/courseware-editor';
  const manageCoursePath = spec.manageCourseId ? `/course/${spec.manageCourseId}` : '/course';
  const manageCourseListPath = '/course';
  const manageAgentPanelPath = '/agent';

  const previewParams: Record<string, string> = {
    courseware_id: spec.coursewareId,
    handoff: spec.handoffCode,
  };
  const manageParams: Record<string, string> = { handoff: spec.handoffCode };
  if (spec.orgId) {
    manageParams.org_id = spec.orgId;
  }

  return {
    links: {
      courseware_preview: joinUrl(spec.studentOrigin, previewPath, previewParams),
      courseware_editor: joinUrl(spec.studentOrigin, editorPath, previewParams),
      ...(spec.manageOrigin
        ? {
            manage_course: joinUrl(spec.manageOrigin, manageCoursePath, manageParams),
            manage_course_list: joinUrl(spec.manageOrigin, manageCourseListPath, manageParams),
            manage_agent_panel: joinUrl(spec.manageOrigin, manageAgentPanelPath, manageParams),
          }
        : {}),
    },
    paths: {
      courseware_preview: joinUrl('', previewPath, previewParams),
      courseware_editor: joinUrl('', editorPath, previewParams),
      ...(spec.manageOrigin
        ? {
            manage_course: joinUrl('', manageCoursePath, manageParams),
            manage_course_list: joinUrl('', manageCourseListPath, manageParams),
            manage_agent_panel: joinUrl('', manageAgentPanelPath, manageParams),
          }
        : {}),
    },
  };
}

/**
 * Build login-free browser URLs for the current courseware. Each URL carries a
 * `handoff` code that the frontend boot code redeems for the caller's own
 * short-lived access token (the token never appears in any URL), so Codex can
 * open a preview/editor without the user logging in.
 */
export async function coursewareUiLinksTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    courseware_id?: string;
  },
): Promise<Record<string, unknown>> {
  let mcpSession: CodexMcpWorkspaceSession | undefined;
  if (args.mcp_session_id?.trim()) {
    const session = await requireOwnedSession(caller, args.mcp_session_id);
    if (isToolError(session)) {
      return session;
    }
    mcpSession = session;
  }

  const coursewareRef =
    args.courseware_id?.trim() || mcpSession?.coursewareId?.trim() || '';
  if (!coursewareRef) {
    return toolError(
      'courseware_id is required (or pass mcp_session_id of an open courseware)',
      'COURSEWARE_REQUIRED',
    );
  }

  await ensureDataSource();
  const cw = await getCoursewareEntityById(coursewareRef);
  if (!cw) {
    return toolError(`Unknown courseware: ${coursewareRef}`, 'NOT_FOUND');
  }

  try {
    await assertCoursewareRequestAccess(caller, cw, 'read');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no read access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }

  const orgId = cw.orgId?.trim() || mcpSession?.coursewareOrgId?.trim() || null;

  // Manage deep link needs a course binding; failure to resolve must not kill
  // the whole catalog — fall back to the manage course list page.
  let manageCourseId: string | null = null;
  try {
    const binding = await findLatestSectionBindingForCourseware(cw.id);
    manageCourseId = binding?.courseId?.trim() || null;
  } catch (error) {
    console.warn(
      '[mcp] ui_links: section binding lookup failed, using manage course list:',
      error instanceof Error ? error.message : error,
    );
  }

  // Preview refresh case: the same link gets opened again and again, so the TTL and redemption budget are relaxed.
  // The token sealed into the code is a dedicated long ticket with a "human lifetime" (minted on the spot from the org agent credential and
  // cached per credential), so the browser session lives as long as a human login; the MCP working ticket is still 60 minutes.
  const minted = await mintAgentHandoff(
    {
      accessToken: await resolveHandoffAccessToken(caller),
      ownerUserId: caller.userId,
      coursewareId: cw.id,
      orgId,
    },
    { ttlSeconds: 10 * 60, maxRedemptions: 30 },
  );

  const studentOrigin = resolveStudentWebOrigin();
  const manageOrigin = resolveManageWebOrigin();
  const { links, paths } = buildCoursewareUiLinks({
    studentOrigin,
    manageOrigin,
    handoffCode: minted.code,
    coursewareId: cw.id,
    orgId,
    manageCourseId,
  });

  return {
    ok: true,
    data: {
      courseware_id: cw.id,
      courseware_key: cw.key,
      title: cw.title,
      org_id: orgId,
      handoff: {
        expires_at: minted.expiresAt,
        ttl_seconds: minted.ttlSeconds,
        max_opens: minted.maxRedemptions,
      },
      origins: {
        student: studentOrigin,
        manage: manageOrigin,
      },
      links,
      paths,
      usage:
        'Open a link in the user browser: the frontend exchanges the handoff code for a login session automatically (no manual login). ' +
        `The code expires in ${minted.ttlSeconds}s and survives up to ${minted.maxRedemptions} opens/refreshes; call this tool again for a fresh one.`,
    },
  };
}

// ---------------------------------------------------------------------------
// agent_set_name — agent registers its console display name
// ---------------------------------------------------------------------------

/**
 * Rename the CALLING agent itself (console Agent list). Only meaningful for
 * agent sessions (Bearer `ainobi_ak_*` exchanged server-side); human sessions
 * get a guidance error — console users rename via the Agent panel instead.
 */
export async function agentSetNameTool(
  caller: AinobiAuthorizedSession,
  args: { name?: string },
): Promise<Record<string, unknown>> {
  const name = args.name?.trim() || '';
  if (!name) {
    return toolError('name is required', 'NAME_REQUIRED');
  }
  if (name.length > 128) {
    return toolError('name must be at most 128 characters', 'USAGE');
  }
  if (caller.user.user_type !== 'agent') {
    return toolError(
      'agent_set_name renames the calling agent itself; human users should rename agents in the console (Space Management → Agent)',
      'AGENT_ONLY',
    );
  }

  let response: Response;
  try {
    response = await fetch(ainobiBackendApiUrl('/agent/me'), {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${caller.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ name }),
    });
  } catch (error) {
    return toolError(
      `Agent rename request failed: ${error instanceof Error ? error.message : String(error)}`,
      'AGENT_RENAME_FAILED',
    );
  }

  let body: {
    code?: number;
    success?: boolean;
    message?: string;
    // PATCH /v1/agent/me returns a bare AgentInfo (agent_token_router is not
    // SuccessWrapped); tolerate a {data} envelope defensively.
    agent_user_id?: string;
    name?: string;
    data?: { agent_user_id?: string; name?: string };
  };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return toolError('Agent rename returned invalid JSON', 'AGENT_RENAME_FAILED');
  }
  if (!response.ok) {
    return toolError(
      body.message?.trim() || `Agent rename rejected (HTTP ${response.status})`,
      response.status === 403 ? 'FORBIDDEN' : 'AGENT_RENAME_FAILED',
    );
  }
  const renamedUser = body.data ?? body;
  return {
    ok: true,
    data: {
      agent_user_id: renamedUser.agent_user_id ?? null,
      name: renamedUser.name ?? name,
      next: 'Tell the user the name is registered. It now shows in the console Agent list (Space Management → Agent).',
    },
  };
}

/** True when payload should be surfaced as MCP tool error. */
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
