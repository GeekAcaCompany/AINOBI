// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareRequester } from './host.ts';

type RequestOptions = {
  query?: Record<string, unknown>;
  headers?: HeadersInit;
  token?: string;
  authRequired?: boolean;
  responseType?: 'blob' | 'json' | 'text';
  /** `agent`: the courseware service's `{ ok, error, ... }` envelope, returned whole on success. */
  responseShape?: 'standard' | 'agent';
  /** With `agent` and `ok: false`, return the body instead of throwing (a version conflict carries data). */
  agentErrorAsResult?: boolean;
  signal?: AbortSignal;
};

export class CoursewareRequestError extends Error {
  constructor(
    message: string,
    readonly code: number | string | undefined,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'CoursewareRequestError';
  }
}

const queryString = (query: Record<string, unknown> = {}): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

const encodeBody = (data: unknown, headers: Headers): BodyInit | undefined => {
  if (data === undefined) return undefined;
  if (
    data instanceof FormData ||
    data instanceof URLSearchParams ||
    data instanceof Blob ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data) ||
    typeof data === 'string'
  ) {
    return data as BodyInit;
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return JSON.stringify(data);
};

const readBody = async (response: Response, responseType: RequestOptions['responseType']): Promise<any> => {
  if (responseType === 'blob') return response.blob();
  if (responseType === 'text') return response.text();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** A ready-made `coursewareApi` or `api` for configureCoursewareHost, for hosts with no HTTP client of their own. */
export function createCoursewareRequester(options: {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  fetch?: typeof fetch;
}): CoursewareRequester {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const run = async (method: string, url: string, data: unknown, request: RequestOptions = {}): Promise<any> => {
    const { query, headers: givenHeaders, token, authRequired = true, responseType, responseShape, agentErrorAsResult, signal } = request;
    const headers = new Headers(givenHeaders);
    const bearer = token ?? (authRequired ? await options.getAccessToken?.() : undefined);
    if (bearer) headers.set('authorization', `Bearer ${bearer}`);
    const send = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await send(`${baseUrl}${url}${queryString(query)}`, {
      method,
      headers,
      signal,
      body: method === 'GET' || method === 'HEAD' ? undefined : encodeBody(data, headers),
    });
    if (response.status === 204 || response.status === 205) return undefined;
    const body = await readBody(response, responseType);
    if (responseType === 'blob' || responseType === 'text') return body;
    if (responseShape === 'agent') {
      if (body && typeof body === 'object' && body.ok === false) {
        if (agentErrorAsResult) return body;
        throw new CoursewareRequestError(String(body.error ?? 'request failed').trim(), body.code, body);
      }
      return body;
    }
    if (body?.code !== 0) {
      throw new CoursewareRequestError(String(body?.message ?? body?.error ?? response.statusText), body?.code ?? response.status, body?.data);
    }
    return body.data;
  };
  return {
    baseUrl,
    get: (url, query, request) => run('GET', url, undefined, { ...request, query }),
    post: (url, data, request) => run('POST', url, data ?? {}, request),
    put: (url, data, request) => run('PUT', url, data ?? {}, request),
    delete: (url, data, request) => run('DELETE', url, data ?? {}, request),
    request: ({ method = 'GET', url, data, ...request }: RequestOptions & { method?: string; url: string; data?: unknown }) =>
      run(method.toUpperCase(), url, data, request),
  };
}
