// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The example's session: an @ainobi/client instance plus the chosen organization, kept in
 * sessionStorage so a reload stays signed in. Only the access token and the organization id
 * are stored; the token is never put in a URL.
 */
import { AinobiApiError, createAinobiClient, type AinobiClient, type OrganizationInfo } from "@ainobi/client";
import { config } from "./config.ts";

const STORAGE_KEY = "ainobi-example-session";

type Stored = { accessToken: string; orgId: string; userName: string };

export type AppSession = {
  client: AinobiClient;
  orgId: string;
  userName: string;
};

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const newClient = (accessToken?: string | null) =>
  createAinobiClient({ apiBase: config.apiBase, coursewareApiBase: config.coursewareApiBase, accessToken });

export function loadSession(storage: SessionStorageLike = sessionStorage): AppSession | null {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as Stored | null;
    if (!stored?.accessToken || !stored.orgId) return null;
    return { client: newClient(stored.accessToken), orgId: stored.orgId, userName: stored.userName };
  } catch {
    return null;
  }
}

export function saveSession(session: AppSession, storage: SessionStorageLike = sessionStorage): void {
  const stored: Stored = {
    accessToken: session.client.accessToken ?? "",
    orgId: session.orgId,
    userName: session.userName,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearSession(storage: SessionStorageLike = sessionStorage): void {
  storage.removeItem(STORAGE_KEY);
}

/**
 * Pick the working organization: the session's current one when the user still belongs to
 * it, otherwise an enterprise organization, otherwise the first (the personal workspace).
 */
export function pickOrganization(organizations: OrganizationInfo[], currentOrgId?: string | null): OrganizationInfo | null {
  return (
    organizations.find((org) => org.org_id === currentOrgId) ??
    organizations.find((org) => org.org_type === "enterprise") ??
    organizations[0] ??
    null
  );
}

/** Finish sign-in from the <ainobi-login> hand-back: redeem, choose an organization, persist. */
export async function completeSignIn(handoff: string): Promise<AppSession> {
  const client = newClient();
  const platformSession = await client.signInWithHandoff(handoff);
  const organization = pickOrganization(await client.listOrganizations(), platformSession.current_org_id);
  if (!organization) throw new AinobiApiError("This account belongs to no organization", 403);
  await client.chooseOrganization(organization.org_id);
  const session = { client, orgId: organization.org_id, userName: platformSession.user.user_name };
  saveSession(session);
  return session;
}

/** Switch the working organization. */
export async function switchOrganization(session: AppSession, orgId: string): Promise<AppSession> {
  await session.client.chooseOrganization(orgId);
  const next = { ...session, orgId };
  saveSession(next);
  return next;
}

export const isAuthFailure = (error: unknown) => error instanceof AinobiApiError && error.status === 401;
