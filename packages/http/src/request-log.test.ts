// SPDX-License-Identifier: AGPL-3.0-only
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachHttpRequestLogging, type HttpRequestLogOptions } from './request-log.ts';

function fakeResponse(statusCode: number) {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    end: (chunk?: unknown) => void;
  };
  res.statusCode = statusCode;
  res.end = () => {};
  return res;
}

function failDetail(body: string, options?: HttpRequestLogOptions): unknown {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = fakeResponse(400);
  attachHttpRequestLogging(
    {} as never,
    res as never,
    { method: 'GET', pathname: '/x' },
    undefined,
    options,
  );
  res.end(body);
  res.emit('finish');
  return (error.mock.calls[0]?.[1] as { detail?: unknown } | undefined)?.detail;
}

describe('attachHttpRequestLogging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the error field by default (service bodies)', () => {
    expect(failDetail('{"error":"bad input","message":"ignored"}')).toBe('bad input');
  });

  it('honours the host key preference (backend envelope)', () => {
    const body = '{"error":"KEY","message":"Readable failure"}';
    expect(failDetail(body, { errorBodyKeys: ['message', 'error'] })).toBe('Readable failure');
  });

  it('skips CORS preflight', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = fakeResponse(204);
    attachHttpRequestLogging({} as never, res as never, { method: 'OPTIONS', pathname: '/x' });
    res.emit('finish');
    expect(info).not.toHaveBeenCalled();
  });
});
