// SPDX-License-Identifier: AGPL-3.0-only
// Permissive CORS for the platform's Node services (editor on localhost, hosted SPA, embeds).
// The host supplies the policy through a getter, read on every response, so a service can
// keep resolving it from its environment per request.

import type { ServerResponse } from 'node:http';

export const DEFAULT_CORS_ALLOW_HEADERS = 'content-type, authorization, accept, x-requested-with';

export type CorsPolicy = {
  /** `access-control-allow-origin`; empty means `*`. */
  allowOrigin?: string;
  /** `access-control-allow-headers`; empty means DEFAULT_CORS_ALLOW_HEADERS. */
  allowHeaders?: string;
};

export type Cors = {
  corsHeaders(extra?: Record<string, string>): Record<string, string>;
  applyCorsHeaders(res: ServerResponse): void;
  sendCorsPreflight(res: ServerResponse): void;
  sendJsonWithCors(
    res: ServerResponse,
    status: number,
    payload: unknown,
    extraHeaders?: Record<string, string>,
  ): void;
};

export function createCors(policy: () => CorsPolicy): Cors {
  function corsHeaders(extra?: Record<string, string>): Record<string, string> {
    const { allowOrigin, allowHeaders } = policy();
    return {
      'access-control-allow-origin': allowOrigin?.trim() || '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
      'access-control-allow-headers': allowHeaders?.trim() || DEFAULT_CORS_ALLOW_HEADERS,
      'access-control-max-age': '86400',
      ...extra,
    };
  }

  return {
    corsHeaders,
    applyCorsHeaders(res) {
      for (const [name, value] of Object.entries(corsHeaders())) {
        res.setHeader(name, value);
      }
    },
    sendCorsPreflight(res) {
      res.writeHead(204, corsHeaders());
      res.end();
    },
    sendJsonWithCors(res, status, payload, extraHeaders) {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        ...corsHeaders(),
        ...extraHeaders,
      });
      res.end(JSON.stringify(payload));
    },
  };
}
