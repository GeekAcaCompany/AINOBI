// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "./router.ts";
import { loadSession, pickOrganization, saveSession, type SessionStorageLike } from "./session.ts";
import { createAinobiClient, type OrganizationInfo } from "@ainobi/client";

const memoryStorage = (): SessionStorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

describe("router", () => {
  it("round-trips every route", () => {
    for (const route of [
      { name: "login" as const },
      { name: "home" as const },
      { name: "edit" as const, coursewareId: "a b/c" },
      { name: "play" as const, coursewareId: "k1" },
    ]) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/edit/")).toEqual({ name: "home" });
  });
});

describe("organization choice", () => {
  const org = (org_id: string, org_type: string) => ({ org_id, org_type, org_name: org_id }) as OrganizationInfo;
  it("keeps the current organization, then prefers an enterprise, then the first", () => {
    const orgs = [org("personal", "personal"), org("school", "enterprise")];
    expect(pickOrganization(orgs, "personal")?.org_id).toBe("personal");
    expect(pickOrganization(orgs, "gone")?.org_id).toBe("school");
    expect(pickOrganization([org("personal", "personal")], null)?.org_id).toBe("personal");
    expect(pickOrganization([], null)).toBeNull();
  });
});

describe("session persistence", () => {
  it("stores only the token, organization and name, and restores a client", () => {
    const storage = memoryStorage();
    const client = createAinobiClient({ apiBase: "https://api.example", coursewareApiBase: "https://cw.example", accessToken: "tok" });
    saveSession({ client, orgId: "o1", userName: "Tester" }, storage);
    const restored = loadSession(storage);
    expect(restored?.client.accessToken).toBe("tok");
    expect(restored).toMatchObject({ orgId: "o1", userName: "Tester" });
    expect(loadSession(memoryStorage())).toBeNull();
  });
});
