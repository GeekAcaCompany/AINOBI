// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createCoursewareRequester, CoursewareRequestError } from './simple-requester.ts';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const requesterWith = (response: Response, token: string | null = 'tok') => {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  return {
    fetchMock,
    requester: createCoursewareRequester({ baseUrl: 'http://x/', getAccessToken: () => token, fetch: fetchMock }),
  };
};

describe('createCoursewareRequester', () => {
  it('unwraps the platform envelope and sends the token and query', async () => {
    const { requester, fetchMock } = requesterWith(jsonResponse({ code: 0, data: { a: 1 } }));
    await expect(requester.get('/p', { q: 'v', skip: undefined })).resolves.toEqual({ a: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://x/p?q=v');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer tok');
  });

  it('throws the code and data of a failed platform envelope', async () => {
    const { requester } = requesterWith(jsonResponse({ code: 42, message: 'no', data: { retry: 1 } }, 400));
    const error = await requester.get('/p').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CoursewareRequestError);
    expect(error).toMatchObject({ message: 'no', code: 42, data: { retry: 1 } });
  });

  it('returns the whole agent envelope, and throws on ok: false unless told not to', async () => {
    const success = requesterWith(jsonResponse({ ok: true, data: 1 }));
    await expect(success.requester.get('/p', undefined, { responseShape: 'agent' })).resolves.toEqual({ ok: true, data: 1 });
    const failure = requesterWith(jsonResponse({ ok: false, error: 'conflict' }, 409));
    await expect(failure.requester.get('/p', undefined, { responseShape: 'agent' })).rejects.toThrow('conflict');
    const asResult = requesterWith(jsonResponse({ ok: false, error: 'conflict' }, 409));
    await expect(asResult.requester.get('/p', undefined, { responseShape: 'agent', agentErrorAsResult: true })).resolves.toEqual({ ok: false, error: 'conflict' });
  });

  it('treats 204 as success with no body, sends JSON, and leaves FormData to the browser', async () => {
    const empty = requesterWith(new Response(null, { status: 204 }));
    await expect(empty.requester.post('/p', { a: 1 })).resolves.toBeUndefined();
    const [, init] = empty.fetchMock.mock.calls[0]!;
    expect(init!.body).toBe('{"a":1}');
    expect(new Headers(init!.headers).get('content-type')).toBe('application/json');

    const form = requesterWith(new Response(null, { status: 204 }));
    const data = new FormData();
    await form.requester.post('/p', data);
    const [, formInit] = form.fetchMock.mock.calls[0]!;
    expect(formInit!.body).toBe(data);
    expect(new Headers(formInit!.headers).has('content-type')).toBe(false);
  });

  it('sends no token when the call needs none', async () => {
    const { requester, fetchMock } = requesterWith(jsonResponse({ code: 0, data: 1 }));
    await requester.get('/p', undefined, { authRequired: false });
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).has('authorization')).toBe(false);
  });
});
