// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Google Cloud access tokens for a service account, the credential Vertex AI's Interactions API requires (it refuses
 * API keys). Shared by Gemini TTS and the courseware service's quiz scoring. Nothing here reads the environment: the
 * host passes the credential in.
 */
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

/** Where a token comes from: a ready access token, or a service account given inline or as a key file. */
export interface GoogleCredentialSource {
  accessToken?: string | null;
  credentialsJson?: string | null;
  credentialsPath?: string | null;
}

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

const base64Url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const hasGoogleCredentials = (source: GoogleCredentialSource): boolean =>
  Boolean(source.accessToken?.trim() || source.credentialsJson?.trim() || source.credentialsPath?.trim());

/** The service account behind a source, or null when the source is a bare access token. */
export async function readGoogleServiceAccount(source: GoogleCredentialSource): Promise<GoogleServiceAccount | null> {
  const inline = source.credentialsJson?.trim();
  const raw = inline || (source.credentialsPath?.trim() ? await readFile(source.credentialsPath.trim(), "utf8") : null);
  if (!raw) return null;
  const account = JSON.parse(raw) as GoogleServiceAccount;
  if (!account.client_email || !account.private_key) {
    throw new Error("The Google credential is not a service account key (client_email and private_key are missing).");
  }
  return account;
}

/**
 * A function returning a valid access token: the given token as is, or one minted from the service account (JWT
 * bearer grant) and cached until a minute before it expires.
 */
export function createGoogleAccessToken(
  source: GoogleCredentialSource,
  deps: { fetch?: typeof fetch; now?: () => number } = {},
): () => Promise<string> {
  const direct = source.accessToken?.trim();
  if (direct) return async () => direct;
  if (!hasGoogleCredentials(source)) {
    return async () => {
      throw new Error("No Google Cloud credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service account key file.");
    };
  }
  const now = deps.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  const mint = async (): Promise<string> => {
    const account = (await readGoogleServiceAccount(source))!;
    const issuedAt = Math.floor(now() / 1000);
    const tokenUri = account.token_uri || DEFAULT_TOKEN_URI;
    const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
      JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: tokenUri, iat: issuedAt, exp: issuedAt + 3600 }),
    )}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${base64Url(signer.sign(account.private_key))}`;
    const response = await (deps.fetch ?? fetch)(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    const payload = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (!response.ok || !payload?.access_token) {
      throw new Error(`Google Cloud token exchange failed (${response.status}): ${payload?.error_description ?? payload?.error ?? "no token"}`);
    }
    cached = { token: payload.access_token, expiresAt: now() + Math.max(60, payload.expires_in ?? 3600) * 1000 };
    return payload.access_token;
  };
  return async () => {
    if (cached && cached.expiresAt - now() > 60_000) return cached.token;
    pending ??= mint().finally(() => {
      pending = null;
    });
    return pending;
  };
}
