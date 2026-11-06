// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { avatarApiKeyFromEnv } from "./config.ts";

describe("avatarApiKeyFromEnv", () => {
  it("is null without a key", () => {
    expect(avatarApiKeyFromEnv({})).toBeNull();
    expect(avatarApiKeyFromEnv({ LLM_API_KEY: " ", OPENAI_API_KEY: " " })).toBeNull();
  });

  it("prefers LLM_API_KEY", () => {
    expect(avatarApiKeyFromEnv({ LLM_API_KEY: "l", OPENAI_API_KEY: "o" })).toBe("l");
    expect(avatarApiKeyFromEnv({ LLM_API_KEY: "l", LLM_API_BASE: "https://other.example/v1" })).toBe("l");
  });

  it("uses the OpenAI key for the default endpoint", () => {
    expect(avatarApiKeyFromEnv({ OPENAI_API_KEY: "o" })).toBe("o");
  });

  it("never sends the OpenAI key to another provider", () => {
    expect(avatarApiKeyFromEnv({ OPENAI_API_KEY: "o", LLM_API_BASE: "https://other.example/v1" })).toBeNull();
  });
});
