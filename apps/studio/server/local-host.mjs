// SPDX-License-Identifier: AGPL-3.0-only
// The few platform API calls the courseware service and the web app make, answered for one local user and one
// workspace, so they run without the platform backend. It has no accounts, and only AI teachers keep any state; the
// voice catalog is the platform's own seed file. It
// listens on loopback only and refuses other Host headers, so a web page cannot reach it through DNS rebinding.
import { createServer } from 'node:http';
import { AiTeacherError } from './ai-teachers.mjs';
import { voicePage } from './voices.mjs';

export const LOCAL_ORG_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000002';
const EXPIRE_AT = '2099-01-01T00:00:00Z';
const MAX_BODY = 1 << 20;

const USER = {
  user_id: LOCAL_USER_ID,
  user_name: 'Local user',
  account_name: 'local',
  email: null,
  user_status: 'active',
  user_avatar_url: null,
  user_type: 'normal',
};
const ORGANIZATION = {
  org_id: LOCAL_ORG_ID,
  org_name: 'Local workspace',
  org_type: 'personal',
  org_status: 'active',
  org_avatar_url: null,
};

const ok = (data) => ({ code: 0, success: true, message: 'success', data });
const page = (data) => ({ data, page_number: 1, page_size: Math.max(100, data.length), total_count: data.length, total_pages: data.length ? 1 : 0 });
const failure = (status, message) => ({ status, body: { code: status * 1000, success: false, message } });

const sessionData = (token) => ({
  roles: ['manager'],
  user: USER,
  organization: ORGANIZATION,
  permissions: ['manage_login'],
  user_id: LOCAL_USER_ID,
  permission_user_id: LOCAL_USER_ID,
  current_org_id: LOCAL_ORG_ID,
  access_token: token,
  expire_at: EXPIRE_AT,
});

/** AI teacher calls, or null when the path is not one. Throws AiTeacherError for what the caller should fix. */
function answerTeachers({ method, path, body, teachers }) {
  if (!teachers) return null;
  const scoped = /^\/v1\/organization\/[^/]+\/ai_teacher(\/.*)$/.exec(path)?.[1];
  const global = /^\/v1\/ai_teacher\/([^/]+)\/info$/.exec(path)?.[1];
  const info = global ?? (scoped && /^\/([^/]+)\/info$/.exec(scoped)?.[1]);
  if (method === 'GET' && info) {
    const teacher = teachers.get(info);
    return teacher ? { status: 200, body: ok(teacher) } : failure(404, 'That AI teacher does not exist.');
  }
  if (!scoped) return null;
  if (method === 'GET' && scoped === '/list') return { status: 200, body: ok(page(teachers.list())) };
  if (method === 'POST' && scoped === '/generate_avatar_temp') return { status: 202, body: ok(teachers.startGeneration(body?.prompt, body?.drawn_by)) };
  const task = /^\/generate_avatar_temp\/([^/]+)$/.exec(scoped)?.[1];
  if (method === 'GET' && task) return { status: 200, body: ok(teachers.task(task)) };
  const answered = /^\/generate_avatar_temp\/([^/]+)\/agent_answer$/.exec(scoped)?.[1];
  if (method === 'POST' && answered) return teachers.answerAgentRequest(answered, body).then((data) => ({ status: 200, body: ok(data) }));
  if (method === 'POST' && scoped === '/create') return { status: 200, body: ok(teachers.create({ name: body?.ai_teacher_name, taskId: body?.task_id })) };
  const remove = /^\/([^/]+)\/remove$/.exec(scoped)?.[1];
  if (method === 'POST' && remove) {
    teachers.remove(remove);
    return { status: 200, body: ok(null) };
  }
  return null;
}

/**
 * The answer to one API call, or null for a path this host does not know. Needs no server, for tests. The agent's
 * answers to a generation are checked asynchronously, so that one route answers with a promise.
 */
export function answer({ method, path, bearer, token, body = undefined, teachers = undefined, voices = undefined, styles = undefined, query = new URLSearchParams() }) {
  if (bearer !== token) return failure(401, 'invalid token');
  const route = `${method} ${path}`;
  switch (route) {
    case 'POST /v1/user/check_session':
    case 'GET /v1/user/check_session':
      return { status: 200, body: ok(sessionData(token)) };
    case 'POST /v1/user/choose_organization':
      return { status: 200, body: ok(sessionData(token)) };
    case 'GET /v1/agent/orgs':
      return { status: 200, body: [ORGANIZATION] };
    case 'GET /v1/agent/me':
      return { status: 200, body: { user_id: LOCAL_USER_ID, name: USER.user_name, org_id: LOCAL_ORG_ID } };
    case 'GET /v1/organization/list':
    case 'GET /v1/organization/managed_list':
      return { status: 200, body: ok(page([ORGANIZATION])) };
    default:
  }
  if (method === 'GET' && voices) {
    if (/^\/v1\/organization\/[^/]+\/tts\/list$/.test(path)) return { status: 200, body: ok(voicePage(voices, query)) };
    if (/^\/v1\/organization\/[^/]+\/tts\/styles$/.test(path)) return { status: 200, body: ok(styles) };
    const voice = /^\/v1\/organization\/[^/]+\/tts\/([^/]+)\/info$/.exec(path)?.[1];
    if (voice) {
      const found = voices.find((entry) => entry.tts_id === voice);
      return found ? { status: 200, body: ok(found) } : failure(404, 'That voice does not exist.');
    }
  }
  const teacherFailure = (error) => {
    if (error instanceof AiTeacherError) return failure(error.status, error.message);
    throw error;
  };
  try {
    const teacherAnswer = answerTeachers({ method, path, body, teachers });
    if (teacherAnswer instanceof Promise) return teacherAnswer.catch(teacherFailure);
    if (teacherAnswer) return teacherAnswer;
  } catch (error) {
    return teacherFailure(error);
  }
  if (method === 'GET' && /^\/v1\/organization\/[^/]+\/(ai_teacher|course|tts|agent)\/list$/.test(path)) {
    return { status: 200, body: ok(page([])) };
  }
  // Courses do not exist here, as the empty lists above say.
  if (method === 'GET' && /^\/v1\/(course_section|ai_teacher)\/[^/]+\/info$/.test(path)) {
    return failure(404, 'not available in Studio');
  }
  return null;
}

/** Host headers this server answers: a rebinding attack arrives with the attacker's name. */
export const isLoopbackHost = (host, port) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

const readJson = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) reject(new Error('body too large'));
      else chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
  });

export function startLocalHost({ port, token, teachers, voices, styles, webOrigin, log = () => undefined }) {
  const server = createServer(async (req, res) => {
    // The web app calls this host from its own port; no other origin gets a CORS grant.
    const cors = req.headers.origin === webOrigin ? { 'access-control-allow-origin': webOrigin, vary: 'Origin' } : {};
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify(body));
    };
    if (!isLoopbackHost(req.headers.host ?? '', port)) {
      send(403, { code: 403000, success: false, message: 'unexpected Host header' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' });
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    try {
      const body = await readJson(req);
      const result = await answer({ method: req.method ?? 'GET', path, bearer, token, body, teachers, voices, styles, query: url.searchParams });
      if (result) {
        send(result.status, result.body);
        return;
      }
      log(`[local-host] no answer for ${req.method} ${path}`);
      send(404, { code: 404000, success: false, message: `${req.method} ${path} is not available in Studio` });
    } catch (error) {
      log(`[local-host] ${req.method} ${path} failed: ${error instanceof Error ? error.message : error}`);
      send(500, { code: 500000, success: false, message: 'request failed' });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ close: () => new Promise((done) => server.close(done)) });
    });
  });
}
