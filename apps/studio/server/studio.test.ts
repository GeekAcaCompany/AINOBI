// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answer, isLoopbackHost, LOCAL_ORG_ID } from './local-host.mjs';
import { BUILT_IN_TEACHER_ID } from './ai-teachers.mjs';
import { aboutStudio, coursewareEnv, documentConverterUrls, embedOrigins, frameAncestors, googleBackend, googleCredentialsEnv, googleCredentialsStatus, mcpConfig, resolveStatic, studioPorts } from './start.mjs';
import { findDefaultVoice, loadVoices, voicePage } from './voices.mjs';

describe('local host', () => {
  const call = (method: string, path: string, bearer = 'tok') => answer({ method, path, bearer, token: 'tok' });

  it('answers check_session in the shape the courseware service maps', () => {
    const { status, body } = call('POST', '/v1/user/check_session')!;
    expect(status).toBe(200);
    expect(body).toMatchObject({ code: 0, success: true, data: { current_org_id: LOCAL_ORG_ID, access_token: 'tok', permissions: ['manage_login'] } });
  });

  it('refuses a wrong or missing token on every path', () => {
    expect(call('POST', '/v1/user/check_session', 'other')!.status).toBe(401);
    expect(answer({ method: 'GET', path: '/v1/agent/orgs', bearer: undefined, token: 'tok' })!.status).toBe(401);
  });

  it('has empty lists and no details for what does not exist here, and does not invent other paths', () => {
    expect(call('GET', `/v1/organization/${LOCAL_ORG_ID}/ai_teacher/list`)!.body).toMatchObject({ code: 0, data: { data: [] } });
    expect(call('GET', '/v1/course_section/x/info')!.status).toBe(404);
    expect(call('POST', '/v1/credits/consume')).toBeNull();
  });

  it('accepts only loopback names on its own port', () => {
    expect(isLoopbackHost('127.0.0.1:5601', 5601)).toBe(true);
    expect(isLoopbackHost('localhost:5601', 5601)).toBe(true);
    expect(isLoopbackHost('evil.example:5601', 5601)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:1', 5601)).toBe(false);
  });
});

describe('studioPorts', () => {
  it('moves every port by the offset, and an explicit port wins', () => {
    expect(studioPorts({ AINOBI_PORT_OFFSET: '10', AINOBI_PG_PORT: '1' })).toMatchObject({ web: 5610, courseware: 5643, pg: 1 });
  });
});

describe('coursewareEnv', () => {
  const env = (userEnv: Record<string, string>) =>
    coursewareEnv({ ports: studioPorts({}), token: 't', internalToken: 'i', storageEndpoint: 'http://s', userEnv, baseEnv: {}, videoRenderUrl: undefined });

  it('does not let the user file move the service off the local stores', () => {
    const result = env({ DB_HOST: 'prod.example', REDIS_HOST: 'prod.example', AINOBI_BACKEND_API_BASE: 'https://prod.example' });
    expect(result.DB_HOST).toBe('127.0.0.1');
    expect(result.REDIS_HOST).toBe('127.0.0.1');
    expect(result.AINOBI_BACKEND_API_BASE).toBe('http://127.0.0.1:5601/v1');
  });

  it('gives an element that names no teacher the built-in Inochi2D teacher', () => {
    const result = env({});
    expect(result.AINOBI_DEFAULT_AI_TEACHER_ID).toBe(BUILT_IN_TEACHER_ID);
    expect(result.AINOBI_DEFAULT_AI_TEACHER_MODEL_URL).toMatch(/.inx$/);
  });

  it('tells the service there is no manage app, so agents get no dead links', () => {
    expect(env({}).AINOBI_MANAGE_VIEW_DISABLED).toBe('true');
  });

  it('keeps the service on loopback whatever the user file says', () => {
    expect(env({ HOST: '0.0.0.0' }).HOST).toBe('127.0.0.1');
  });

  it('keeps billing off and lets the user file add provider keys', () => {
    const result = env({ ANTHROPIC_API_KEY: 'k' });
    expect(result.AINOBI_CREDITS_DISABLED).toBe('true');
    expect(result.COURSEWARE_QUIZ_TEXT_SCORING_PROVIDER).toBe('gemini_api');
    expect(result.COURSEWARE_QUIZ_AUDIO_SCORING_PROVIDER).toBe('gemini_api');
    expect(result.GEMINI_TTS_VERTEXAI).toBe('false');
    expect(result.ANTHROPIC_API_KEY).toBe('k');
    expect(result.AINOBI_DB_JOIN_NESTED_TRANSACTIONS).toBe('true');
  });

  it('runs narration and scoring on AI Studio by default, and on Vertex AI when chosen or with a service account alone', () => {
    const root = join(sep, 'repo');
    const sa = { GOOGLE_APPLICATION_CREDENTIALS_JSON: '{}' };
    expect(googleBackend({}, root)).toEqual({ backend: 'gemini_api', status: 'missing' });
    expect(googleBackend({ GEMINI_API_KEY: 'k', ...sa }, root)).toEqual({ backend: 'gemini_api', status: 'on' });
    expect(googleBackend(sa, root)).toEqual({ backend: 'vertexai', status: 'on' });
    expect(googleBackend({ GOOGLE_APPLICATION_CREDENTIALS: 'nope.json' }, root)).toEqual({ backend: 'vertexai', status: 'no-file' });
    expect(googleBackend({ GEMINI_API_KEY: 'k', GEMINI_TTS_VERTEXAI: 'true' }, root)).toEqual({ backend: 'vertexai', status: 'missing' });
    const vertex = env({ GEMINI_API_KEY: 'k', GEMINI_TTS_VERTEXAI: 'true', ...sa });
    expect(vertex.COURSEWARE_QUIZ_TEXT_SCORING_PROVIDER).toBe('vertexai');
    expect(vertex.COURSEWARE_QUIZ_AUDIO_SCORING_PROVIDER).toBe('vertexai');
    expect(vertex.GEMINI_TTS_VERTEXAI).toBe('true');
  });

  it('points the service at the document converters, on their usual ports unless the user file moves them', () => {
    expect(documentConverterUrls({})).toEqual({ pdf: 'http://127.0.0.1:5636', pptx: 'http://127.0.0.1:5637' });
    expect(env({}).PDF2HTML_SERVICE_URL).toBe('http://127.0.0.1:5636');
    expect(env({ PPTX2HTML_SERVICE_URL: 'http://127.0.0.1:9000' }).PPTX2HTML_SERVICE_URL).toBe('http://127.0.0.1:9000');
  });

  it('makes a service account key path absolute, and tells a missing key from a missing file', () => {
    const root = join(sep, 'repo');
    expect(googleCredentialsEnv({ GOOGLE_APPLICATION_CREDENTIALS: '.ainobi/gcp-key.json' }, root)).toEqual({
      GOOGLE_APPLICATION_CREDENTIALS: resolve(root, '.ainobi', 'gcp-key.json'),
    });
    expect(googleCredentialsEnv({}, root)).toEqual({});
    expect(googleCredentialsStatus({}, root)).toBe('missing');
    expect(googleCredentialsStatus({ GOOGLE_APPLICATION_CREDENTIALS: 'nope.json' }, root)).toBe('no-file');
    expect(googleCredentialsStatus({ GOOGLE_APPLICATION_CREDENTIALS_JSON: '{}' }, root)).toBe('on');
    expect(googleCredentialsStatus({ GOOGLE_APPLICATION_CREDENTIALS: __filename }, root)).toBe('on');
    expect(env({ GOOGLE_APPLICATION_CREDENTIALS: 'key.json' }).GOOGLE_APPLICATION_CREDENTIALS).toMatch(/[\\/]key\.json$/);
  });
});

describe('mcpConfig', () => {
  it('points at the local service with the token', () => {
    expect(mcpConfig({ ports: studioPorts({}), token: 't' }).mcpServers.ainobi).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:5633/mcp',
      headers: { Authorization: 'Bearer t' },
    });
  });
});

describe('aboutStudio', () => {
  const withManifest = (manifest: object, run: (root: string) => void) => {
    const root = mkdtempSync(join(tmpdir(), 'studio-about-'));
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it('says nothing when the manifest names no repository', () => {
    withManifest({ version: '1.0.0', license: 'X-1' }, (root) => expect(aboutStudio(root)).toBeNull());
  });

  it('gives the license and the source address, and offers the notices only when the file is there', () => {
    withManifest({ version: '1.0.0', license: 'X-1', repository: { type: 'git', url: 'git+https://git.example/a/b.git' } }, (root) => {
      expect(aboutStudio(root)).toEqual({ version: '1.0.0', license: 'X-1', sourceUrl: 'https://git.example/a/b', commit: null, modified: false, notices: false });
      writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'notices');
      expect(aboutStudio(root)?.notices).toBe(true);
    });
  });
});

describe('resolveStatic', () => {
  const dist = join(sep, 'app', 'dist');

  it('stays inside the built app', () => {
    expect(resolveStatic(dist, '/assets/a.js')).toBe(join(dist, 'assets', 'a.js'));
    expect(resolveStatic(dist, '/../secrets.json')).toBeNull();
    expect(resolveStatic(dist, '/%2e%2e/secrets.json')).toBeNull();
    expect(resolveStatic(dist, '/%zz')).toBeNull();
  });
});

describe('voice catalog', () => {
  const entries = [
    { tts_name: 'Kore', tts_provider: 'google', tts_model: 'm', tts_voice: 'charon', tts_language: 'zh', tts_status: 'active' },
    { tts_name: 'Kore', tts_provider: 'google', tts_model: 'm', tts_voice: 'charon', tts_language: 'en', tts_status: 'active' },
    { tts_name: 'Old', tts_provider: 'minimax', tts_model: 'n', tts_voice: 'old', tts_language: 'zh', tts_status: 'inactive' },
  ];
  const voices = loadVoices(entries);

  it('gives each voice and language a stable, distinct UUID', () => {
    expect(voices[0].tts_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(voices[0].tts_id).not.toBe(voices[1].tts_id);
    expect(loadVoices(entries)[0].tts_id).toBe(voices[0].tts_id);
  });

  it('filters and pages like the platform list', () => {
    expect(voicePage(voices, new URLSearchParams('tts_status=active')).total_count).toBe(2);
    expect(voicePage(voices, new URLSearchParams('tts_status=active&tts_language=en')).data[0].tts_language).toBe('en');
    expect(voicePage(voices, new URLSearchParams('page_size=1&page_number=2'))).toMatchObject({ total_pages: 3, page_number: 2 });
  });

  it('finds the default voice, and answers through the local host', () => {
    expect(findDefaultVoice(voices)?.tts_language).toBe('zh');
    const call = (path: string, query = new URLSearchParams()) => answer({ method: 'GET', path, bearer: 't', token: 't', voices: voices as never, styles: { default_style_key: 'a' } as never, query: query as never });
    expect(call('/v1/organization/o/tts/list', new URLSearchParams('tts_status=inactive'))!.body).toMatchObject({ data: { total_count: 1 } });
    expect(call('/v1/organization/o/tts/styles')!.body).toMatchObject({ data: { default_style_key: 'a' } });
    expect(call(`/v1/organization/o/tts/${voices[0].tts_id}/info`)!.status).toBe(200);
    expect(call('/v1/organization/o/tts/nope/info')!.status).toBe(404);
  });
});

describe('embedding', () => {
  it('keeps exact origins and drops anything else', () => {
    expect(embedOrigins('https://a.example, http://localhost:3000/path nonsense ftp://x')).toEqual(['https://a.example', 'http://localhost:3000']);
    expect(embedOrigins(undefined)).toEqual([]);
  });

  it('lets only this site and the listed origins frame Studio', () => {
    expect(frameAncestors([])).toBe("frame-ancestors 'self'");
    expect(frameAncestors(['https://a.example'])).toBe("frame-ancestors 'self' https://a.example");
  });
});
