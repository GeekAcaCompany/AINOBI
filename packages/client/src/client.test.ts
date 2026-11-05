// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { AinobiApiError, createAinobiClient } from './client.ts';

const API = 'https://api.example/v1';
const CW = 'https://courseware.example';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fetch double answering by "METHOD path" with [status, json]. */
function fakeFetch(routes: Record<string, [number, unknown]>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    const { pathname, search } = new URL(url);
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? routes[`${init.method ?? 'GET'} ${pathname}${search}`];
    if (!route) return new Response(JSON.stringify({ code: 404000 }), { status: 404 });
    return new Response(JSON.stringify(route[1]), { status: route[0] });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const session = { user: { user_id: 'u1', user_name: 'Tester' }, current_org_id: null, access_token: 'tok' };

describe('AinobiClient', () => {
  it('signs in with a handoff and reads the session with the redeemed token', async () => {
    const { impl, calls } = fakeFetch({
      'POST /agent-handoff/redeem': [200, { ok: true, data: { access_token: 'tok' } }],
      'POST /v1/user/check_session': [200, { code: 0, data: session }],
    });
    const client = createAinobiClient({ apiBase: `${API}/`, coursewareApiBase: CW, fetch: impl });
    expect(client.isSignedIn).toBe(false);
    const result = await client.signInWithHandoff('c'.repeat(43));
    expect(result.user.user_name).toBe('Tester');
    expect(client.accessToken).toBe('tok');
    expect(calls[0]).toMatchObject({ url: `${CW}/agent-handoff/redeem`, body: { code: 'c'.repeat(43) } });
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[1]!.headers.authorization).toBe('Bearer tok');
  });

  it('refuses authenticated calls before sign-in', async () => {
    const { impl, calls } = fakeFetch({});
    const client = createAinobiClient({ apiBase: API, coursewareApiBase: CW, fetch: impl });
    await expect(client.listOrganizations()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });

  it('lists organizations, chooses one, lists coursewares and mints embed codes', async () => {
    const { impl, calls } = fakeFetch({
      'GET /v1/organization/list': [200, { code: 0, data: { data: [{ org_id: 'o1', org_name: 'School' }] } }],
      'POST /v1/user/choose_organization': [200, { code: 0, data: {} }],
      'GET /courseware/list': [
        200,
        { ok: true, data: [{ id: '1', key: 'k1', title: 'Intro' }], pagination: { pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1 } },
      ],
      'POST /embed/handoff': [200, { ok: true, data: { code: 'h'.repeat(43) } }],
    });
    const client = createAinobiClient({ apiBase: API, coursewareApiBase: CW, accessToken: 'tok', fetch: impl });
    expect((await client.listOrganizations()).map((o) => o.org_id)).toEqual(['o1']);
    await client.chooseOrganization('o1');
    const page = await client.listCoursewares({ orgId: 'o1', title: 'In' });
    expect(page).toMatchObject({ totalCount: 1, items: [{ key: 'k1', title: 'Intro' }] });
    expect(new URL(calls[2]!.url).searchParams.get('title')).toBe('In');
    expect(await client.mintEmbedHandoff({ coursewareId: 'k1', orgId: 'o1' })).toBe('h'.repeat(43));
    expect(calls[1]!.body).toEqual({ org_id: 'o1' });
    expect(calls[3]!.body).toEqual({ courseware_id: 'k1', org_id: 'o1' });
  });

  it('updates the personal avatar voice with only the provided fields', async () => {
    const { impl, calls } = fakeFetch({
      'PUT /v1/student/character-config': [
        200,
        {
          code: 0,
          data: {
            voice_name: 'Kore',
            personality_prompt: null,
            inochi2d_model_file_name: null,
            inochi2d_model_size: null,
            available_voices: ['Zubenelgenubi', 'Kore'],
          },
        },
      ],
    });
    const client = createAinobiClient({ apiBase: API, coursewareApiBase: CW, accessToken: 'tok', fetch: impl });
    const config = await client.updateCharacterConfig({ voiceName: 'Kore' });
    expect(calls[0]).toMatchObject({ method: 'PUT', headers: { authorization: 'Bearer tok' } });
    expect(calls[0]!.body).toEqual({ voice_name: 'Kore' });
    expect(config).toMatchObject({ voiceName: 'Kore', availableVoices: ['Zubenelgenubi', 'Kore'] });

    await client.updateCharacterConfig({ voiceName: null });
    expect(calls[1]!.body).toEqual({ voice_name: null });
  });

  it('maps platform and courseware failures to AinobiApiError', async () => {
    const { impl } = fakeFetch({
      'POST /v1/user/check_session': [401, { code: 401000, message: 'Authentication required' }],
      'POST /embed/handoff': [401, { ok: false, error: 'Unauthorized' }],
    });
    const client = createAinobiClient({ apiBase: API, coursewareApiBase: CW, accessToken: 'stale', fetch: impl });
    const platform = await client.getSession().catch((e: unknown) => e);
    expect(platform).toBeInstanceOf(AinobiApiError);
    expect(platform).toMatchObject({ status: 401, code: 401000, message: 'Authentication required' });
    await expect(client.mintEmbedHandoff()).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
  });

  it('forgets the token on sign-out even when the platform call fails', async () => {
    const { impl } = fakeFetch({ 'POST /v1/user/logout': [500, { code: 500000 }] });
    const client = createAinobiClient({ apiBase: API, coursewareApiBase: CW, accessToken: 'tok', fetch: impl });
    await expect(client.signOut()).rejects.toBeInstanceOf(AinobiApiError);
    expect(client.isSignedIn).toBe(false);
  });
});
