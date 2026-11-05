// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Agent domain schemas.
 *
 * An agent is an automated identity on an ordinary user row (user_type='agent'); its owner/org binding
 * lives in the agent_credential table. The plaintext api_key is returned once, in the create/rotate response (the server stores only
 * a bcrypt hash).
 */

import { z } from "zod";
import { pyUuid } from "./helpers.ts";

/**
 * Required int (body): z.coerce.number() would silently turn null into 0,
 * while production reports invalid_type for null — so nullable+refine rejects it first.
 */
function pyRequiredInt<T extends z.ZodType<number>>(schema: T) {
  return schema
    .nullable()
    .refine((value) => value !== null, {
      message: "Input should be a valid integer",
    }) as unknown as z.ZodType<number>;
}

/** Create an agent (owner view, org_id in the body) */
export const AgentCreateRequestSchema = z.object({
  /** Display name (management list + audit log) */
  name: z.string().min(1).max(128),
  /** Organization the agent acts in (the owner must be a member) */
  org_id: pyUuid,
  /** Note shown in the management UI */
  remark: z.string().max(512).nullable().optional(),
  /** Credential hard-expiry in days (default 90; 0 = never expires) */
  credential_expires_in_days: pyRequiredInt(
    z.coerce.number().int().min(0).max(365),
  ).default(90),
});

/** Create an agent (org view: org_id comes from the URL path, deliberately omitted from the body) */
export const AgentCreateInOrgRequestSchema = z.object({
  name: z.string().min(1).max(128),
  remark: z.string().max(512).nullable().optional(),
  credential_expires_in_days: pyRequiredInt(
    z.coerce.number().int().min(0).max(365),
  ).default(90),
});

/** Rotate the credential (single-credential model: rotating revokes the current active credential) */
export const AgentCredentialRotateRequestSchema = z.object({
  credential_expires_in_days: pyRequiredInt(
    z.coerce.number().int().min(0).max(365),
  ).default(90),
});

/** Rename an agent (shared by console inline rename and the agent's own rename MCP tool) */
export const AgentRenameRequestSchema = z.object({
  name: z.string().min(1).max(128),
});

/** Exchange an api_key for an access_token (the credential id is embedded in the api_key string) */
export const AgentTokenRequestSchema = z.object({
  api_key: z.string().min(10),
  /** Optionally raise the session TTL (clamped to the human ACCESS_TOKEN_EXPIRE_MINUTES ceiling) */
  expires_in_minutes: z.coerce.number().int().min(1).nullable().optional(),
});

export type AgentCreateRequest = z.infer<typeof AgentCreateRequestSchema>;
export type AgentCreateInOrgRequest = z.infer<typeof AgentCreateInOrgRequestSchema>;
export type AgentCredentialRotateRequest = z.infer<typeof AgentCredentialRotateRequestSchema>;
export type AgentRenameRequest = z.infer<typeof AgentRenameRequestSchema>;
export type AgentTokenRequest = z.infer<typeof AgentTokenRequestSchema>;

// ---------------------------------------------------------------------------
// Response DTOs (fields in declaration order; datetime/UUID serialized as strings)
// ---------------------------------------------------------------------------

/** Agent info visible to the owner (owner list / self-rename response) */
export interface AgentInfo {
  agent_user_id: string;
  name: string;
  owner_user_id: string;
  /** Issuer display identity (console list renders "username(account)"); paths that don't backfill keep null */
  owner_name: string | null;
  owner_account_name: string | null;
  org_id: string;
  user_status: string;
  has_active_credential: boolean;
  credential_id: string | null;
  credential_expires_at: string | null;
  credential_last_used_at: string | null;
  created_at: string;
}

/** POST /v1/user/me/agents response (the plaintext api_key is returned only this once) */
export interface AgentCreatedResponse {
  agent: AgentInfo;
  credential_id: string;
  api_key: string;
  expires_at: string | null;
}

/** POST .../credentials rotation response */
export interface AgentCredentialRotatedResponse {
  credential_id: string;
  api_key: string;
  expires_at: string | null;
}

/** POST /v1/agent/token response (deliberately does not echo refresh_token) */
export interface AgentTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  agent_user_id: string;
  owner_user_id: string;
  current_org_id: string;
}
