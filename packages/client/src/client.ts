// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AINOBI platform SDK for host applications.
 *
 * Signing in happens on the platform's own login page (embedded with @ainobi/widgets'
 * <ainobi-login>): it hands back a one-time code that `signInWithHandoff` exchanges for a
 * session. The host then reads the session and its organizations, picks the working
 * organization, lists coursewares, and mints a one-time code for every embedded AINOBI
 * page (editor, player, avatar) so they sign in without a token crossing into a URL.
 *
 * Two platform services back it: the platform API (`apiBase`, e.g. https://api.example.com/v1)
 * and the courseware API (`coursewareApiBase`).
 */

import type { OrganizationInfo, UserSession } from "@ainobi/api-contracts/schemas/user.ts";

export type { OrganizationInfo, UserSession };

export type AinobiClientOptions = {
  apiBase: string;
  coursewareApiBase: string;
  /** Persisted access token to resume with (e.g. from sessionStorage). */
  accessToken?: string | null;
  fetch?: typeof fetch;
};

export type CoursewareSummary = {
  id: string;
  key: string;
  orgId: string | null;
  title: string | null;
  coverUrl?: string | null;
  sceneCount?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Page<T> = {
  items: T[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type StudentCharacterConfig = {
  /** Gemini Live voice override; null uses the platform default. */
  voiceName: string | null;
  personalityPrompt: string | null;
  inochi2dModelFileName: string | null;
  inochi2dModelSize: number | null;
  availableVoices: string[];
};

export class AinobiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number | string,
  ) {
    super(message);
    this.name = "AinobiApiError";
  }
}

type PlatformEnvelope<T> = { code?: number; message?: string; success?: boolean; data?: T };
type CoursewareEnvelope = { ok?: boolean; error?: string; code?: string } & Record<string, unknown>;

export class AinobiClient {
  private readonly apiBase: string;
  private readonly coursewareApiBase: string;
  private readonly fetchImpl: typeof fetch;
  private token: string | null;

  constructor(options: AinobiClientOptions) {
    this.apiBase = options.apiBase.replace(/\/+$/, "");
    this.coursewareApiBase = options.coursewareApiBase.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.token = options.accessToken?.trim() || null;
  }

  /** The current access token (persist it to resume a session; never put it in a URL). */
  get accessToken(): string | null {
    return this.token;
  }

  get isSignedIn(): boolean {
    return this.token !== null;
  }

  /** Exchange the one-time code from <ainobi-login> (`ainobi-signed-in`) for a session. */
  async signInWithHandoff(code: string): Promise<UserSession> {
    const body = await this.courseware<{ data?: { access_token?: string } }>("/agent-handoff/redeem", {
      method: "POST",
      body: { code },
      auth: false,
    });
    const token = body.data?.access_token?.trim();
    if (!token) throw new AinobiApiError("Handoff redeem returned no access token", 502);
    this.token = token;
    return this.getSession();
  }

  /** The validated session (user, roles, current organization). */
  async getSession(): Promise<UserSession> {
    return this.platform<UserSession>("/user/check_session", { method: "POST", body: {} });
  }

  /** Organizations the signed-in user belongs to. */
  async listOrganizations(): Promise<OrganizationInfo[]> {
    const page = await this.platform<{ data?: OrganizationInfo[] }>("/organization/list?page_number=1&page_size=100");
    return page.data ?? [];
  }

  /** Make `orgId` the session's working organization (required before courseware calls). */
  async chooseOrganization(orgId: string): Promise<void> {
    await this.platform("/user/choose_organization", { method: "POST", body: { org_id: orgId } });
  }

  /**
   * Update the signed-in account's personal avatar config. Gemini Live reads the voice from
   * this account-level config, not from the embedded page, so a host that presents different
   * characters sets the matching voice before opening a voice session; `voiceName: null`
   * restores the platform default.
   */
  async updateCharacterConfig(fields: {
    voiceName?: string | null;
    personalityPrompt?: string | null;
  }): Promise<StudentCharacterConfig> {
    const body = await this.platform<{
      voice_name?: string | null;
      personality_prompt?: string | null;
      inochi2d_model_file_name?: string | null;
      inochi2d_model_size?: number | null;
      available_voices?: string[];
    }>("/student/character-config", {
      method: "PUT",
      body: {
        ...(fields.voiceName !== undefined ? { voice_name: fields.voiceName } : {}),
        ...(fields.personalityPrompt !== undefined
          ? { personality_prompt: fields.personalityPrompt }
          : {}),
      },
    });
    return {
      voiceName: body.voice_name ?? null,
      personalityPrompt: body.personality_prompt ?? null,
      inochi2dModelFileName: body.inochi2d_model_file_name ?? null,
      inochi2dModelSize: body.inochi2d_model_size ?? null,
      availableVoices: body.available_voices ?? [],
    };
  }

  /** Coursewares of an organization, newest first. */
  async listCoursewares(options: { orgId: string; pageNumber?: number; pageSize?: number; title?: string }): Promise<Page<CoursewareSummary>> {
    const query = new URLSearchParams({
      orgId: options.orgId,
      pageNumber: String(options.pageNumber ?? 1),
      pageSize: String(options.pageSize ?? 20),
      order: "desc",
      ...(options.title ? { title: options.title } : {}),
    });
    const body = await this.courseware<{
      data?: CoursewareSummary[];
      pagination?: { pageNumber: number; pageSize: number; totalCount: number; totalPages: number };
    }>(`/courseware/list?${query}`);
    const pagination = body.pagination ?? { pageNumber: 1, pageSize: 0, totalCount: 0, totalPages: 0 };
    return { items: body.data ?? [], ...pagination };
  }

  /**
   * A one-time code (60 s, single use) that signs an embedded AINOBI page in with this
   * session — pass it to a widget's `handoffProvider`.
   */
  async mintEmbedHandoff(context: { coursewareId?: string; orgId?: string } = {}): Promise<string> {
    const body = await this.courseware<{ data?: { code?: string } }>("/embed/handoff", {
      method: "POST",
      body: {
        ...(context.coursewareId ? { courseware_id: context.coursewareId } : {}),
        ...(context.orgId ? { org_id: context.orgId } : {}),
      },
    });
    const code = body.data?.code;
    if (!code) throw new AinobiApiError("Embed handoff mint returned no code", 502);
    return code;
  }

  /** End the session on the platform and forget the token. */
  async signOut(): Promise<void> {
    try {
      if (this.token) await this.platform("/user/logout", { method: "POST", body: {} });
    } finally {
      this.token = null;
    }
  }

  // -------------------------------------------------------------------------

  private async request(url: string, init: { method?: string; body?: unknown; auth?: boolean }): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.auth !== false) {
      if (!this.token) throw new AinobiApiError("Not signed in", 401);
      headers.authorization = `Bearer ${this.token}`;
    }
    const response = await this.fetchImpl(url, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  private async platform<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const { status, json } = await this.request(`${this.apiBase}${path}`, init);
    const body = json as PlatformEnvelope<T> | null;
    if (status >= 400 || !body || body.code !== 0) {
      throw new AinobiApiError(body?.message || `Platform request failed (${status})`, status, body?.code);
    }
    return body.data as T;
  }

  private async courseware<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
    const { status, json } = await this.request(`${this.coursewareApiBase}${path}`, init);
    const body = json as CoursewareEnvelope | null;
    if (status >= 400 || !body || body.ok !== true) {
      throw new AinobiApiError(body?.error || `Courseware request failed (${status})`, status, body?.code);
    }
    return body as T;
  }
}

export function createAinobiClient(options: AinobiClientOptions): AinobiClient {
  return new AinobiClient(options);
}
