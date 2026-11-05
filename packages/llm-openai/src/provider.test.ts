// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "vitest";
import assert from "node:assert/strict";
import { OpenAIProvider, outboundHttp } from "./provider.ts";

test("openai provider: SDK 超时按毫秒传入（秒配置 ×1000）", () => {
  // Default 3600 seconds → 3_600_000 ms (the SDK constructor argument is stored as-is in client.timeout)
  const provider = new OpenAIProvider({ model: "gpt-4o", api_key: "k" });
  assert.equal(provider.client.timeout, 3_600_000);

  // The ASR path passes timeout=300 (seconds, WHISPER_TIMEOUT) → 300_000 ms
  const asrProvider = new OpenAIProvider({
    model: "whisper-1",
    api_key: "k",
    timeout: 300,
  });
  assert.equal(asrProvider.client.timeout, 300_000);
});

test("openai provider: proxy 配置注入 undici dispatcher（fetch 与 ProxyAgent 同源）", () => {
  // Stub the ProxyAgent constructor: assert the dispatcher is the instance created from the proxy URL
  const created: string[] = [];
  const sentinel = { dispatch: "stub" };
  const original = outboundHttp.proxyAgent;
  outboundHttp.proxyAgent = (uri: string) => {
    created.push(uri);
    return sentinel;
  };
  try {
    const provider = new OpenAIProvider({
      model: "gpt-4o",
      api_key: "k",
      proxy: "http://proxy.example:8080",
    });
    assert.deepEqual(created, ["http://proxy.example:8080"]);
    const fetchOptions = provider.client.fetchOptions as { dispatcher?: unknown };
    assert.equal(fetchOptions?.dispatcher, sentinel, "SDK fetchOptions 应携带注入的 dispatcher");
    // fetch is an SDK private field (at the TS level) but readable at runtime: assert it comes from the same source as ProxyAgent
    const clientFetch = (provider.client as unknown as { fetch: unknown }).fetch;
    assert.equal(clientFetch, outboundHttp.fetch, "fetch 须与 ProxyAgent 同源（undici 版本配对）");
  } finally {
    outboundHttp.proxyAgent = original;
  }

  // Without a proxy, no dispatcher is injected and fetch is not replaced
  const plain = new OpenAIProvider({ model: "gpt-4o", api_key: "k" });
  assert.equal(plain.client.fetchOptions, undefined);
  const plainFetch = (plain.client as unknown as { fetch: unknown }).fetch;
  assert.notEqual(plainFetch, outboundHttp.fetch);
});
