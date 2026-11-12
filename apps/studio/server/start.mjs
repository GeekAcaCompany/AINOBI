#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Runs Studio on one machine with Node.js alone: the embedded stores, the local host, the courseware service, and
// the web app. State lives in .ainobi/ at the repository root. Video export is the one optional piece: it runs in a
// container started separately (docs/video-export.md), and everything else works without it.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, extname, join, normalize, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import {
  BUILT_IN_TEACHER_AVATAR_URL,
  BUILT_IN_TEACHER_ID,
  BUILT_IN_TEACHER_MODEL_URL,
  BUILT_IN_TEACHER_NAME,
  createAiTeacherStore,
  generatorFromEnv,
  teacherFilePath,
} from './ai-teachers.mjs';
import { isLoopbackHost, LOCAL_ORG_ID, startLocalHost } from './local-host.mjs';
import { findDefaultVoice, loadVoices } from './voices.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const studioDir = join(here, '..');
const repositoryRoot = join(studioDir, '../..');
const STORAGE_BUCKET = 'ainobi-local';
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';

const portFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`${name} is not a port: ${raw}`);
  return port;
};

/** Every port Studio uses, moved together by AINOBI_PORT_OFFSET or one at a time. */
export function studioPorts(env = process.env) {
  const offset = env.AINOBI_PORT_OFFSET ? Number(env.AINOBI_PORT_OFFSET) : 0;
  const pick = (name, base) => (env[name] ? Number(env[name]) : base + offset);
  return {
    web: pick('AINOBI_STUDIO_PORT', 5600),
    courseware: pick('AINOBI_COURSEWARE_PORT', 5633),
    host: pick('AINOBI_HOST_PORT', 5601),
    pg: pick('AINOBI_PG_PORT', 55432),
    redis: pick('AINOBI_REDIS_PORT', 56379),
    storage: pick('AINOBI_STORAGE_PORT', 56390),
  };
}

/** A service account key path written relative to the repository, made absolute for the service and its children. */
export function googleCredentialsEnv(settings, root = repositoryRoot) {
  const path = settings.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  return path ? { GOOGLE_APPLICATION_CREDENTIALS: resolvePath(root, path) } : {};
}

/** Whether a Google Cloud service account is configured: inline, or a key file that exists. */
export function googleCredentialsStatus(settings, root = repositoryRoot) {
  if (settings.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim()) return 'on';
  const path = googleCredentialsEnv(settings, root).GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) return 'missing';
  return existsSync(path) ? 'on' : 'no-file';
}

/**
 * Where narration and AI scoring run, and whether its credential is there. AI Studio with GEMINI_API_KEY by default;
 * Google Cloud Vertex AI with GEMINI_TTS_VERTEXAI=true, or when only a service account is configured
 * (docs/google-cloud.md). The same rule as @ainobi/tts-google's chooseGoogleTtsBackend.
 */
export function googleBackend(settings, root = repositoryRoot) {
  const apiKey = ['GEMINI_TTS_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_CLOUD_API_KEY'].some((key) => settings[key]?.trim());
  const credentials = googleCredentialsStatus(settings, root);
  const choice = settings.GEMINI_TTS_VERTEXAI?.trim().toLowerCase();
  const vertex = choice === 'true' || choice === '1' ? true : choice === 'false' || choice === '0' ? false : !apiKey && credentials !== 'missing';
  if (vertex) return { backend: 'vertexai', status: credentials };
  return { backend: 'gemini_api', status: apiKey ? 'on' : 'missing' };
}

/**
 * Where the optional document converters listen: PDF on 5636 and PowerPoint on 5637, unless the settings move them.
 * They run in containers started separately (docs/document-conversion.md).
 */
export function documentConverterUrls(settings) {
  return {
    pdf: settings.PDF2HTML_SERVICE_URL?.trim() || 'http://127.0.0.1:5636',
    pptx: settings.PPTX2HTML_SERVICE_URL?.trim() || 'http://127.0.0.1:5637',
  };
}

/** The courseware service's environment. Connection settings always win over the user's file. */
export function coursewareEnv({ ports, token, internalToken, storageEndpoint, userEnv, baseEnv, videoRenderUrl }) {
  const web = `http://127.0.0.1:${ports.web}`;
  const converters = documentConverterUrls({ ...baseEnv, ...userEnv });
  const google = googleBackend({ ...baseEnv, ...userEnv }).backend;
  return {
    PDF2HTML_SERVICE_URL: converters.pdf,
    PPTX2HTML_SERVICE_URL: converters.pptx,
    AINOBI_CREDITS_DISABLED: 'true',
    AINOBI_ORG_STORAGE_DISABLED: 'true',
    AINOBI_ORG_STORAGE_QUOTA_CHECK: 'false',
    // Scoring runs on Gemini, where narration does: AI Studio or Vertex AI (googleBackend).
    COURSEWARE_QUIZ_TEXT_SCORING_PROVIDER: google,
    COURSEWARE_QUIZ_TEXT_SCORING_MODEL: 'gemini-3.6-flash',
    COURSEWARE_QUIZ_AUDIO_SCORING_PROVIDER: google,
    COURSEWARE_QUIZ_AUDIO_SCORING_MODEL: 'gemini-3.5-flash',
    CORS_ALLOW_ORIGIN: web,
    STORAGE_BACKEND: 'oci_s3',
    OCI_S3_ENDPOINT: storageEndpoint,
    OCI_S3_ACCESS_KEY_ID: 'lite',
    OCI_S3_SECRET_KEY: 'lite',
    OCI_S3_REGION: 'local',
    OCI_S3_BUCKET: STORAGE_BUCKET,
    OCI_S3_NAMESPACE: 'local',
    OSS_BUCKET: STORAGE_BUCKET,
    AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS: 'true',
    AINOBI_MANAGE_VIEW_DISABLED: 'true',
    // Agents run on this machine, so they may hand over media they made by path.
    AINOBI_MCP_LOCAL_FILES: 'true',
    // An element that names no teacher gets the built-in one, not the platform's.
    AINOBI_DEFAULT_AI_TEACHER_ID: BUILT_IN_TEACHER_ID,
    AINOBI_DEFAULT_AI_TEACHER_NAME: BUILT_IN_TEACHER_NAME,
    AINOBI_DEFAULT_AI_TEACHER_MODEL_URL: BUILT_IN_TEACHER_MODEL_URL,
    AINOBI_DEFAULT_AI_TEACHER_AVATAR_URL: BUILT_IN_TEACHER_AVATAR_URL,
    ...baseEnv,
    ...userEnv,
    ...googleCredentialsEnv({ ...baseEnv, ...userEnv }),
    GEMINI_TTS_VERTEXAI: String(google === 'vertexai'),
    DB_TYPE: 'postgres',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(ports.pg),
    DB_USER: 'postgres',
    DB_PASSWORD: 'lite',
    DB_DATABASE: 'postgres',
    AINOBI_DB_JOIN_NESTED_TRANSACTIONS: 'true',
    AINOBI_STORAGE_LOCAL_ENDPOINT: 'true',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(ports.redis),
    REDIS_DB: '0',
    REDIS_LAZY_CONNECT: 'false',
    PORT: String(ports.courseware),
    HOST: '127.0.0.1',
    AINOBI_BACKEND_API_BASE: `http://127.0.0.1:${ports.host}/v1`,
    AINOBI_STUDENT_VIEW_BASE_URL: web,
    AINOBI_LOCAL_TOKEN: token,
    COURSEWARE_SERVICE_INTERNAL_TOKEN: internalToken,
    ...(videoRenderUrl ? { AINOBI_VIDEO_RENDER_SERVICE_URL: videoRenderUrl } : {}),
  };
}

/** The agent's MCP connection, written where Claude Code finds it; the token stays out of version control. */
export function mcpConfig({ ports, token }) {
  return {
    mcpServers: {
      ainobi: {
        type: 'http',
        url: `http://127.0.0.1:${ports.courseware}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
}

/** The origins named in AINOBI_EMBED_ORIGINS; a value that is not an http(s) URL is dropped, not guessed at. */
export function embedOrigins(value) {
  return (value ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        return url.protocol === 'http:' || url.protocol === 'https:' ? [url.origin] : [];
      } catch {
        return [];
      }
    });
}

/**
 * What the home page says about this copy, from the root manifest: its version and license, where its source is, and
 * the commit it runs when that is known. Null when the manifest names no repository.
 */
export function aboutStudio(root = repositoryRoot) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const sourceUrl = repository?.replace(/^git\+/, '').replace(/\.git$/, '');
  if (!sourceUrl?.startsWith('https://')) return null;
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    // Not a git checkout, or no git: the link goes to the repository itself.
  }
  return {
    version: manifest.version ?? null,
    license: manifest.license ?? null,
    sourceUrl: commit ? `${sourceUrl}/tree/${commit}` : sourceUrl,
    commit,
    notices: existsSync(join(root, NOTICES_FILE)),
  };
}

/** Who may frame Studio. Its pages hold the local access token, so nobody may by default. */
export const frameAncestors = (origins) => ["frame-ancestors 'self'", ...origins].join(' ');

/** Resolves a request path inside the built web app, or null if it leaves that directory. */
export function resolveStatic(distDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = normalize(join(distDir, decoded));
  return file === distDir || file.startsWith(distDir + sep) ? file : null;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.moc3': 'application/octet-stream',
  '.woff2': 'font/woff2',
};

function startWeb({ port, distDir, session, teachersDir, framing, noticesFile }) {
  const server = createServer((req, res) => {
    const host = req.headers.host ?? '';
    if (!isLoopbackHost(host, port)) {
      res.writeHead(403).end('unexpected Host header');
      return;
    }
    const pathname = new URL(req.url ?? '/', 'http://local').pathname;
    if (pathname === '/local/session') {
      // The access token goes only to this app's own pages: no CORS headers, and other origins are refused.
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) {
        res.writeHead(403).end('forbidden');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(session()));
      return;
    }
    if (pathname === '/local/third-party-notices') {
      if (!existsSync(noticesFile)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      createReadStream(noticesFile).pipe(res);
      return;
    }
    if (pathname.startsWith('/local/ai-teachers/')) {
      const file = teacherFilePath(teachersDir, pathname);
      if (!file || !existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
      return;
    }
    const candidate = resolveStatic(distDir, pathname);
    if (!candidate) {
      res.writeHead(404).end('not found');
      return;
    }
    const isFile = existsSync(candidate) && statSync(candidate).isFile();
    // Client-side routes all serve the app; a missing asset is a real 404.
    const file = isFile ? candidate : extname(pathname) ? null : join(distDir, 'index.html');
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': framing });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const assertPortFree = (port, purpose) =>
  new Promise((resolve, reject) => {
    const probe = connect(port, '127.0.0.1');
    probe.once('connect', () => {
      probe.destroy();
      reject(new Error(`port ${port} (${purpose}) is in use. Stop that process, or move Studio by adding AINOBI_PORT_OFFSET=100 to .env.local`));
    });
    probe.once('error', () => resolve());
  });

async function applySchema(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("select to_regclass('public.courseware') as present");
    if (!rows[0].present) {
      console.log('[studio] creating the database');
      await client.query(readFileSync(join(here, 'schema.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

const isReachable = async (url) => {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
};

/** Whether the courseware service found a model for the editor's assistant. */
const readEditorAssistant = async (url) => {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    return (await response.json()).editorAssistant === true;
  } catch {
    return false;
  }
};

/** Whether a document converter answers its health check. */
const converterUp = async (url) => {
  try {
    return (await fetch(`${url.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
};

/** Resolves true once the service answers, false if it exits or does not answer in time. */
const waitUntilHealthy = async (url, child, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    if (await isReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

async function main() {
  const stateDir = join(repositoryRoot, '.ainobi');
  mkdirSync(join(stateDir, 'pg'), { recursive: true });
  const userEnvPath = join(repositoryRoot, '.env.local');
  const userEnv = existsSync(userEnvPath) ? parseEnv(readFileSync(userEnvPath, 'utf8')) : {};
  const ports = studioPorts({ ...userEnv, ...process.env });
  for (const [name, port] of Object.entries(ports)) await assertPortFree(port, name);

  const secretsPath = join(stateDir, 'secrets.json');
  const stored = existsSync(secretsPath) ? JSON.parse(readFileSync(secretsPath, 'utf8')) : {};
  const secrets = {
    token: stored.token ?? randomBytes(32).toString('hex'),
    internalToken: stored.internalToken ?? randomBytes(32).toString('hex'),
  };
  writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(repositoryRoot, '.mcp.json'), `${JSON.stringify(mcpConfig({ ports, token: secrets.token }), null, 2)}\n`, { mode: 0o600 });

  const { startDiskStorage, startMemoryRedis, startPgliteServer } = await import(
    pathToFileURL(join(repositoryRoot, 'packages/lite-stores/dist/index.js')).href
  );
  const pgServer = await startPgliteServer({ dataDir: join(stateDir, 'pg'), port: ports.pg });
  await applySchema(`postgres://postgres:lite@127.0.0.1:${ports.pg}/postgres`);
  const redis = await startMemoryRedis({ port: ports.redis });
  const storageDir = process.env.AINOBI_STORAGE_DIR || userEnv.AINOBI_STORAGE_DIR;
  const storage = await startDiskStorage({
    dir: storageDir ? resolvePath(repositoryRoot, storageDir) : join(stateDir, 'storage'),
    port: ports.storage,
  });
  // The exported tree keeps the catalog here; in the monorepo it is the backend's seed file.
  const voiceFile = [join(here, 'tts_models.json'), join(studioDir, '../backend/configs/tts_models.json')].find((path) => existsSync(path));
  const voices = loadVoices(JSON.parse(readFileSync(voiceFile, 'utf8')));
  const { DEFAULT_TTS_STYLE_KEY, RECOMMENDED_TTS_STYLES, getStylePrompt } = await import(
    pathToFileURL(join(repositoryRoot, 'packages/tts/dist/styles.js')).href
  );
  const teachersDir = join(stateDir, 'ai-teachers');
  const generatorPath = pathToFileURL(join(repositoryRoot, 'packages/avatar-generator/dist/index.js')).href;
  // The settings module alone, so the pipeline loads only when someone generates.
  const { avatarApiKeyFromEnv } = await import(pathToFileURL(join(repositoryRoot, 'packages/avatar-generator/dist/config.js')).href);
  const teachers = createAiTeacherStore({
    dir: teachersDir,
    orgId: LOCAL_ORG_ID,
    loadGenerator: generatorFromEnv({ ...process.env, ...userEnv }, () => import(generatorPath), avatarApiKeyFromEnv),
    // An agent that can draw generates teachers itself, through the same pipeline, with no key.
    loadAgentPipeline: () => import(generatorPath),
    speech: { voice: findDefaultVoice(voices), style: DEFAULT_TTS_STYLE_KEY, stylePrompt: getStylePrompt(DEFAULT_TTS_STYLE_KEY) },
    log: (line) => console.log(line),
  });
  const localHost = await startLocalHost({
    port: ports.host,
    token: secrets.token,
    teachers,
    voices,
    styles: { default_style_key: DEFAULT_TTS_STYLE_KEY, recommended: RECOMMENDED_TTS_STYLES },
    webOrigin: `http://127.0.0.1:${ports.web}`,
    log: (line) => console.log(line),
  });

  const videoRenderUrl = process.env.AINOBI_VIDEO_RENDER_SERVICE_URL || userEnv.AINOBI_VIDEO_RENDER_SERVICE_URL || 'http://127.0.0.1:5635';
  const child = spawn(process.execPath, ['--enable-source-maps', '--no-node-snapshot', 'dist/index.js'], {
    cwd: join(repositoryRoot, 'apps/courseware-service'),
    env: coursewareEnv({ ports, token: secrets.token, internalToken: secrets.internalToken, storageEndpoint: storage.endpoint, userEnv, baseEnv: process.env, videoRenderUrl }),
    stdio: 'inherit',
  });
  const allowedEmbedders = embedOrigins(process.env.AINOBI_EMBED_ORIGINS || userEnv.AINOBI_EMBED_ORIGINS);
  let videoRender = await isReachable(videoRenderUrl);
  const videoProbe = setInterval(() => void isReachable(videoRenderUrl).then((up) => { videoRender = up; }), 15_000);
  videoProbe.unref();

  let editorAssistant = false;
  const about = aboutStudio();
  const web = await startWeb({
    port: ports.web,
    distDir: join(studioDir, 'dist'),
    teachersDir,
    framing: frameAncestors(allowedEmbedders),
    noticesFile: join(repositoryRoot, NOTICES_FILE),
    session: () => ({
      accessToken: secrets.token,
      orgId: LOCAL_ORG_ID,
      coursewareApi: `http://127.0.0.1:${ports.courseware}`,
      platformApi: `http://127.0.0.1:${ports.host}/v1`,
      videoRender,
      teacherGeneration: teachers.canGenerate(),
      editorAssistant,
      embedOrigins: allowedEmbedders,
      defaultModelUrl: BUILT_IN_TEACHER_MODEL_URL,
      about,
    }),
  });

  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    child.kill();
    web.close();
    await Promise.allSettled([localHost.close(), redis.close(), storage.close(), pgServer.close()]);
    process.exit(code);
  };
  child.on('exit', (code) => {
    if (!stopping) console.error(`[studio] the courseware service exited (${code})`);
    void stop(code ?? 1);
  });
  process.on('SIGINT', () => void stop(0));
  process.on('SIGTERM', () => void stop(0));
  // The line below tells people and agents that everything is ready, so it waits for the service behind the agent connection.
  if (!(await waitUntilHealthy(`http://127.0.0.1:${ports.courseware}`, child))) {
    if (!stopping) console.error('[studio] the courseware service did not become ready');
    await stop(1);
    return;
  }
  editorAssistant = await readEditorAssistant(`http://127.0.0.1:${ports.courseware}`);
  console.log(`\n  AINOBI Studio   http://127.0.0.1:${ports.web}`);
  console.log(`  Agent (MCP)     http://127.0.0.1:${ports.courseware}/mcp   configured in .mcp.json`);
  const google = googleBackend({ ...process.env, ...userEnv });
  const vertex = google.backend === 'vertexai';
  console.log(
    `  Narration       ${google.status === 'on' ? `on, with AI scoring${vertex ? ', on Google Cloud' : ''}` : `NOT CONFIGURED: ${vertex ? 'a Google Cloud service account' : 'GEMINI_API_KEY'} is required, see below`}`,
  );
  console.log(`  Editor AI       ${editorAssistant ? 'on' : 'off (set ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL in .env.local)'}`);
  const converters = documentConverterUrls({ ...process.env, ...userEnv });
  const [pdfUp, pptxUp] = await Promise.all([converterUp(converters.pdf), converterUp(converters.pptx)]);
  console.log(
    `  Documents       ${pdfUp || pptxUp ? `PDF ${pdfUp ? 'on' : 'off'}, PowerPoint ${pptxUp ? 'on' : 'off'}` : 'off (optional, see docs/document-conversion.md)'}`,
  );
  console.log(`  Video export    ${videoRender ? videoRenderUrl : 'off (optional, see docs/video-export.md)'}\n`);
  if (google.status !== 'on') {
    console.warn(
      (vertex
        ? [
            google.status === 'no-file'
              ? '  !! GOOGLE_APPLICATION_CREDENTIALS points at a file that does not exist.'
              : '  !! GEMINI_TTS_VERTEXAI=true needs GOOGLE_APPLICATION_CREDENTIALS, a Google Cloud service account key file.',
            '  !! Without it, narration and AI scoring of essays and recordings fail when used.',
            '  !! Add GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json to .env.local in this folder, then restart.',
            '  !! See docs/google-cloud.md.\n',
          ]
        : [
            '  !! GEMINI_API_KEY is required and not set.',
            '  !! Without it, narration and AI scoring of essays and recordings fail when used.',
            '  !! Add GEMINI_API_KEY=your-key to .env.local in this folder, then restart.\n',
          ]
      ).join('\n'),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[studio] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
