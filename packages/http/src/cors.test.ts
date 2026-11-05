// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createCors, DEFAULT_CORS_ALLOW_HEADERS } from './cors.ts';

describe('createCors', () => {
  it('defaults to any origin and the standard headers', () => {
    const { corsHeaders } = createCors(() => ({}));
    expect(corsHeaders()).toEqual({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
      'access-control-allow-headers': DEFAULT_CORS_ALLOW_HEADERS,
      'access-control-max-age': '86400',
    });
  });

  it('reads the policy on every call', () => {
    let origin = 'https://a.example';
    const { corsHeaders } = createCors(() => ({ allowOrigin: origin, allowHeaders: '  ' }));
    expect(corsHeaders()['access-control-allow-origin']).toBe('https://a.example');
    origin = 'https://b.example';
    expect(corsHeaders()['access-control-allow-origin']).toBe('https://b.example');
    expect(corsHeaders()['access-control-allow-headers']).toBe(DEFAULT_CORS_ALLOW_HEADERS);
  });

  it('sends JSON with CORS and extra headers', () => {
    const written: { status?: number; headers?: Record<string, string>; body?: string } = {};
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        written.status = status;
        written.headers = headers;
      },
      end(body: string) {
        written.body = body;
      },
    };
    createCors(() => ({})).sendJsonWithCors(res as never, 409, { ok: false }, { 'x-extra': '1' });
    expect(written.status).toBe(409);
    expect(written.headers?.['content-type']).toBe('application/json; charset=utf-8');
    expect(written.headers?.['access-control-allow-origin']).toBe('*');
    expect(written.headers?.['x-extra']).toBe('1');
    expect(written.body).toBe('{"ok":false}');
  });
});
