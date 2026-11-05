// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Table-driven route registry — this service's core routing infrastructure.
 *
 * Design points (aligned with the production contract):
 * - every route's `operationId` must equal the handler name (orval derives hook names from it)
 * - path is the "router-level full path" (with the router prefix, without the service mount prefix),
 *   e.g. "/organization/:org_id/user/list"; matching always prepends servicePrefix (host config)
 * - mount order is match order (first registered, first matched); src/routes/v1/index.ts assembles the table
 * - trailing slash → 307 redirect (redirect_slashes semantics)
 * - HEAD matches GET routes automatically (HEAD added automatically), sending headers only
 * - 404/405 return the production-style error envelope (host handlers)
 *
 * The session type S is bound by the host (guards return the full session; handlers access it through ctx.session).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { z } from "zod";
import type { HttpRequestLogContext, UploadedFile } from "./types.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/** multipart form declaration (equivalent to File()/Form() semantics) */
export interface FormSpec {
  /** zod schema for the non-file fields */
  fields?: z.ZodTypeAny;
  /** File field name → whether it takes multiple files */
  files: Record<string, { multiple?: boolean }>;
}

export interface RouteDef<S = unknown> {
  method: HttpMethod;
  /** Router-level full path, with ":param"-style path parameters */
  path: string;
  /**
   * Mount location: "v1" (default, prefixed with servicePrefix, e.g. /v1/user/login)
   * or "root" (the root path, e.g. /health, /openapi.json — mounted at the root)
   */
  mount?: "root" | "v1";
  /**
   * Handler name (e.g. get_current_user_info) — the final OpenAPI operationId
   * is synthesized by fullOperationId() with a fixed rule:
   *   {handler name}_{path with leading/trailing slashes stripped, /{} → _}_{lowercase method}
   * e.g. get_current_user_info + /v1/user/me + GET → get_current_user_info_v1_user_me_get
   * orval derives hook names from it, so it must not drift.
   */
  operationId: string;
  summary?: string;
  tags?: string[];
  /** Auth guard (a factory product); omitted = public route */
  auth?: (ctx: RequestContext<S>) => Promise<S>;
  /** Path parameter schema (UUID validation etc.) */
  params?: z.ZodTypeAny;
  /** query schema (query model) */
  query?: z.ZodTypeAny;
  /** JSON body schema (body model) */
  body?: z.ZodTypeAny;
  /**
   * Optional body (`Optional[Model] = None` semantics): empty body / JSON null
   * → body=null (no validation error); a given body is validated as usual.
   */
  bodyOptional?: boolean;
  /** multipart declaration */
  form?: FormSpec;
  /**
   * Success envelope switch: true by default ({code:0,message:"OK",success:true,data}).
   * Set to false only by bare-JSON modules such as agent_token / agent_management.
   */
  wrap?: boolean;
  /** Success status code override (e.g. 201 for creates) */
  status?: number;
  /** Response schema (only for OpenAPI generation, not validated at runtime — same as production) */
  response?: z.ZodTypeAny;
  /** Whether it goes into the OpenAPI document (default true; /openapi.json itself does not) */
  includeInSchema?: boolean;
  handler: (ctx: RequestContext<S>) => Promise<unknown>;
}

/** Marker for raw responses that bypass the envelope (streams/files/redirects etc.) */
export class RawResponse {
  constructor(public readonly send: (res: ServerResponse) => void) {}
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  /** Expiry in seconds relative to now (http.cookies semantics: 0 means now) */
  expiresSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  path?: string;
}

/** Request context: the handler's only argument (the equivalent of Request/Depends/Response injection) */
export interface RequestContext<S = unknown> {
  req: IncomingMessage;
  res: ServerResponse;
  route: RouteDef<S>;
  /** Path parameters (raw strings before schema decoding) */
  rawParams: Record<string, string>;
  /** Path parameters after route.params schema validation */
  params: Record<string, unknown>;
  /** Raw query (repeated keys → arrays) */
  rawQuery: Record<string, string | string[]>;
  /** query after route.query schema validation */
  query: Record<string, unknown>;
  /** JSON body (after route.body schema validation; undefined for multipart) */
  body: unknown;
  /** Raw JSON body bytes (needed for e.g. Stripe webhook signature verification) */
  rawBody: Buffer | undefined;
  /** multipart files (when route.form is declared) */
  files: Record<string, UploadedFile[]>;
  /** multipart non-file fields */
  formFields: Record<string, string | string[]> | undefined;
  /** Session filled by the auth guard */
  session: S | undefined;
  log: HttpRequestLogContext;

  // ---- response injection equivalents ----
  responseStatus: number | undefined;
  responseHeaders: Record<string, string>;
  setCookieDirectives: string[];
  setStatus(status: number): void;
  setHeader(name: string, value: string): void;
  setCookie(name: string, value: string, options?: CookieOptions): void;
  deleteCookie(name: string, options?: Pick<CookieOptions, "path" | "sameSite">): void;
  /** Whether the handler set Content-Disposition (one of the envelope bypass conditions) */
  hasContentDisposition(): boolean;
  /** Whether the handler explicitly set a non-JSON content-type (one of the envelope bypass conditions) */
  hasNonJsonContentType(): boolean;
}

/** zod validation failure wrapper (core/handlers.ts turns it into the 422 RequestValidationError envelope) */
export class RequestSchemaValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super("Request validation failed");
    this.name = "RequestSchemaValidationError";
  }
}

export interface CompiledRoute<S = unknown> {
  def: RouteDef<S>;
  regex: RegExp;
  paramNames: string[];
}

/** Normalize the mount location (v1 by default) */
function mountOf(def: Pick<RouteDef, "mount">): "root" | "v1" {
  return def.mount === "root" ? "root" : "v1";
}

function compilePath(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = path
    .replace(/[.+*?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
      paramNames.push(name);
      return `(?<${name}>[^/]+)`;
    });
  return { regex: new RegExp(`^${pattern}$`), paramNames };
}

/** Mount prefix (v1-domain paths need the host's servicePrefix, e.g. "/v1") */
export function mountPrefix(mount: "root" | "v1", servicePrefix: string): string {
  return mount === "root" ? "" : servicePrefix;
}

/**
 * operationId synthesis rule:
 *   handler name + "_" + path (leading/trailing slashes stripped, / { } → _) + "_" + lowercase method
 * Matches golden/openapi.json verbatim (the orval contract).
 */
export function fullOperationId(
  functionName: string,
  fullPath: string,
  method: HttpMethod,
): string {
  const pathPart = fullPath
    // ":param" style becomes "{param}" style first
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    // generate_unique_id rule: every character outside [0-9a-zA-Z_] in the path (including - and .) becomes _
    .replace(/[^0-9a-zA-Z_]/g, "_");
  return `${functionName}_${pathPart}_${method.toLowerCase()}`;
}

function extractParams<S>(compiled: CompiledRoute<S>, pathname: string): Record<string, string> | null {
  const match = compiled.regex.exec(pathname);
  if (!match) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const name of compiled.paramNames) {
    const raw = match.groups?.[name];
    if (raw === undefined) {
      return null;
    }
    try {
      params[name] = decodeURIComponent(raw);
    } catch {
      params[name] = raw;
    }
  }
  return params;
}

export interface RouteMatch<S = unknown> {
  route: CompiledRoute<S>;
  params: Record<string, string>;
}

/** Route table: matched in registration order, with 405/trailing-slash redirect probing. */
export class RouteRegistry<S = unknown> {
  private routes: CompiledRoute<S>[] = [];

  add(defs: RouteDef<S>[]): void {
    for (const def of defs) {
      this.routes.push({ def, ...compilePath(def.path) });
    }
  }

  /** Exact match (with HEAD → GET fallback). mountPath is the router-level path within the mount domain. */
  match(method: string, mount: "root" | "v1", mountPath: string): RouteMatch<S> | null {
    for (const route of this.routes) {
      if (mountOf(route.def) !== mount) {
        continue;
      }
      if (route.def.method !== method && !(method === "HEAD" && route.def.method === "GET")) {
        continue;
      }
      const params = extractParams(route, mountPath);
      if (params) {
        return { route, params };
      }
    }
    return null;
  }

  /** Whether the same path pattern in the same mount domain has a route with another method (405 decision) */
  matchesAnyMethod(mount: "root" | "v1", mountPath: string): boolean {
    return this.routes.some(
      (route) => mountOf(route.def) === mount && extractParams(route, mountPath) !== null,
    );
  }

  /** Trailing-slash redirect target (redirect_slashes semantics: probes both directions) */
  redirectTarget(mount: "root" | "v1", mountPath: string, search: string): string | null {
    let candidate: string | null = null;
    if (mountPath.length > 1 && mountPath.endsWith("/")) {
      candidate = mountPath.slice(0, -1);
    } else if (!mountPath.endsWith("/")) {
      candidate = `${mountPath}/`;
    }
    if (candidate && this.matchesAnyMethod(mount, candidate)) {
      return candidate + search;
    }
    return null;
  }

  all(): CompiledRoute<S>[] {
    return this.routes;
  }
}

export { mountOf };
