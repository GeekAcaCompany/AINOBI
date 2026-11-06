// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generating an AI teacher from an agent. An agent that can draw and see does the drawing and the checks itself
 * (drawn_by "agent"): the host runs the same pipeline and hands it each image and vision request in turn. One that
 * cannot asks the host to draw (drawn_by "host"), which needs the host's image provider.
 */
import { assertOrgIdManageAccess, normalizeOrgId } from '../auth/ainobi-org-access.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { resolveStudentWebOrigin } from '../config/agent-web-origins.ts';
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';
import { toolError } from './codex-mcp-tool-shared.ts';

type Fetch = typeof fetch;
export type TeacherToolDeps = { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; waitMs?: number; env?: NodeJS.ProcessEnv };

type HostTask = {
  task_id: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  drawn_by?: 'agent' | 'host';
  result: { model_url: string; preview_url: string } | null;
  error: string | null;
  agent_request?: { request_id: string; kind: 'draw' | 'look'; instructions: string; input_images: string[]; answer_with: string } | null;
};

const DEFAULT_WAIT_MS = 90_000;
const POLL_MS = 1000;

async function orgFor(caller: AinobiAuthorizedSession): Promise<string | ReturnType<typeof toolError>> {
  const orgId = normalizeOrgId(caller.currentOrgId);
  if (!orgId) return toolError('org_id is required', 'ORG_REQUIRED');
  try {
    await assertOrgIdManageAccess(caller, orgId);
  } catch {
    return toolError('Forbidden: cannot manage AI teachers for this organization', 'FORBIDDEN');
  }
  return orgId;
}

async function host<T>(caller: AinobiAuthorizedSession, orgId: string, method: 'GET' | 'POST', path: string, body: unknown, deps: TeacherToolDeps) {
  const response = await (deps.fetch ?? fetch)(ainobiBackendApiUrl(`/organization/${encodeURIComponent(orgId)}/ai_teacher${path}`), {
    method,
    headers: { authorization: `Bearer ${caller.accessToken}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => null)) as { success?: boolean; message?: string; data?: T } | null;
  if (!response.ok || payload?.success === false) {
    return { ok: false as const, status: response.status, message: payload?.message ?? `the host answered ${response.status}` };
  }
  return { ok: true as const, data: payload?.data as T };
}

/** What the agent should do next, from where the generation is. */
function turn(task: HostTask) {
  const request = task.agent_request ?? null;
  const preview = task.result?.preview_url ? new URL(task.result.preview_url, `${resolveStudentWebOrigin()}/`).href : null;
  let next: string;
  if (task.status === 'succeeded') {
    next = 'The teacher passed every check. Show the user the preview, ask for a name, then call ai_teacher_save with task_id and name.';
  } else if (task.status === 'failed') {
    next = 'The generation did not pass the quality checks. Tell the user why, in plain words, and offer to try again, possibly with a clearer description.';
  } else if (request?.kind === 'draw') {
    next = 'Draw the image yourself as the instructions say (edit the input image when one is given), save it as a square 1024×1024 PNG, then call ai_teacher_answer with task_id, request_id, and image_path. Follow the instructions exactly: the host checks the result.';
  } else if (request?.kind === 'look') {
    next = 'Look at every input image yourself, judge strictly as the instructions say, then call ai_teacher_answer with task_id, request_id, and answer (only the JSON object). Report what you see, not what would pass: a wrong verdict produces a broken teacher.';
  } else {
    next = 'The host is still working on this generation. Call ai_teacher_status with task_id to keep waiting.';
  }
  return {
    ok: true,
    data: {
      task_id: task.task_id,
      status: task.status,
      drawn_by: task.drawn_by ?? 'host',
      agent_request: request,
      preview_url: preview,
      error: task.error,
      next,
    },
  };
}

/** Polls until the agent has something to do, the generation ends, or the wait runs out. */
async function waitForTurn(caller: AinobiAuthorizedSession, orgId: string, taskId: string, answered: string | null, deps: TeacherToolDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (deps.waitMs ?? DEFAULT_WAIT_MS);
  for (;;) {
    const got = await host<HostTask>(caller, orgId, 'GET', `/generate_avatar_temp/${encodeURIComponent(taskId)}`, null, deps);
    if (!got.ok) return toolError(got.message, got.status === 404 ? 'NOT_FOUND' : 'AI_TEACHER_FAILED');
    const task = got.data;
    const fresh = task.agent_request && task.agent_request.request_id !== answered;
    if (task.status === 'succeeded' || task.status === 'failed' || fresh || Date.now() >= deadline) {
      return turn(task);
    }
    await sleep(POLL_MS);
  }
}

export async function aiTeacherGenerateTool(
  caller: AinobiAuthorizedSession,
  args: { prompt?: string; drawn_by?: string },
  deps: TeacherToolDeps = {},
): Promise<Record<string, unknown>> {
  const env = deps.env ?? process.env;
  const drawnBy = args.drawn_by === 'agent' ? 'agent' : args.drawn_by === 'host' ? 'host' : null;
  if (!drawnBy) return toolError('drawn_by is "agent" when you can generate images yourself, otherwise "host".', 'USAGE');
  if (drawnBy === 'agent' && env.AINOBI_MCP_LOCAL_FILES?.trim().toLowerCase() !== 'true') {
    return toolError('Drawing by the agent needs a local AINOBI Studio, where you and the host share files. Use drawn_by "host" here.', 'USAGE');
  }
  const orgId = await orgFor(caller);
  if (typeof orgId !== 'string') return orgId;
  const started = await host<{ task_id: string }>(caller, orgId, 'POST', '/generate_avatar_temp', { prompt: args.prompt, drawn_by: drawnBy }, deps);
  if (!started.ok) {
    return toolError(started.message, started.status === 409 && drawnBy === 'host' ? 'NOT_CONFIGURED' : 'AI_TEACHER_FAILED');
  }
  return waitForTurn(caller, orgId, started.data.task_id, null, deps);
}

export async function aiTeacherAnswerTool(
  caller: AinobiAuthorizedSession,
  args: { task_id?: string; request_id?: string; image_path?: string; answer?: string },
  deps: TeacherToolDeps = {},
): Promise<Record<string, unknown>> {
  const taskId = args.task_id?.trim();
  const requestId = args.request_id?.trim();
  if (!taskId || !requestId) return toolError('task_id and request_id are required', 'USAGE');
  const orgId = await orgFor(caller);
  if (typeof orgId !== 'string') return orgId;
  const sent = await host(caller, orgId, 'POST', `/generate_avatar_temp/${encodeURIComponent(taskId)}/agent_answer`, {
    request_id: requestId,
    image_path: args.image_path,
    answer: args.answer,
  }, deps);
  // A fixable answer: the same request stays open, so say what to fix.
  if (!sent.ok) return toolError(sent.message, sent.status === 422 ? 'ANSWER_REFUSED' : 'AI_TEACHER_FAILED');
  return waitForTurn(caller, orgId, taskId, requestId, deps);
}

export async function aiTeacherStatusTool(
  caller: AinobiAuthorizedSession,
  args: { task_id?: string },
  deps: TeacherToolDeps = {},
): Promise<Record<string, unknown>> {
  const taskId = args.task_id?.trim();
  if (!taskId) return toolError('task_id is required', 'USAGE');
  const orgId = await orgFor(caller);
  if (typeof orgId !== 'string') return orgId;
  return waitForTurn(caller, orgId, taskId, null, deps);
}

export async function aiTeacherSaveTool(
  caller: AinobiAuthorizedSession,
  args: { task_id?: string; name?: string },
  deps: TeacherToolDeps = {},
): Promise<Record<string, unknown>> {
  const taskId = args.task_id?.trim();
  if (!taskId || !args.name?.trim()) return toolError('task_id and name are required', 'USAGE');
  const orgId = await orgFor(caller);
  if (typeof orgId !== 'string') return orgId;
  const saved = await host<{ ai_teacher_id: string; ai_teacher_name: string }>(caller, orgId, 'POST', '/create', { ai_teacher_name: args.name.trim(), task_id: taskId }, deps);
  if (!saved.ok) return toolError(saved.message, 'AI_TEACHER_FAILED');
  return {
    ok: true,
    data: {
      ai_teacher_id: saved.data.ai_teacher_id,
      ai_teacher_name: saved.data.ai_teacher_name,
      next: 'The teacher is saved. It appears in courseware_ai_teachers and can narrate once it is on a slide.',
    },
  };
}
