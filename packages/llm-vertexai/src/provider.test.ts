// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "vitest";
import assert from "node:assert/strict";
import { VertexAIProvider } from "./provider.ts";

const SETTINGS = { api_key: "test-key" };
const EXPRESS_SETTINGS = { api_key: "test-key", vertex_express: true };

function geminiResponse(finishReason: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "partial answer" }] },
          finishReason,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function createCompletionWithFinishReason(
  finishReason: string,
): Promise<{ finish_reason: string | null; content: string }> {
  const provider = new VertexAIProvider({ model: "gemini-3.1-pro-preview", settings: SETTINGS });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => geminiResponse(finishReason)) as typeof fetch;
  try {
    const result = await provider.create_completion({
      messages: [{ role: "user", content: "hello" }] as never,
    });
    return { finish_reason: result.finish_reason ?? null, content: result.content };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("vertexai provider: 结束原因恒归一为 stop（枚举字符串化前缀不命中映射表）", async () => {
  // The upstream SDK parses finishReason into an enum and then stringifies it for the lookup — "FinishReason.STOP"
  // never equals the bare-name keys in the table, so every finish reason falls through to the default "stop".
  // That behavior is the production contract: callers relying on the length/content_filter branches never receive
  // those values. The three finish reasons below all lock that behavior.
  for (const reason of ["STOP", "MAX_TOKENS", "SAFETY"]) {
    const { finish_reason } = await createCompletionWithFinishReason(reason);
    assert.equal(finish_reason, "stop", `finishReason=${reason} 应归一为 stop`);
  }

  // Without a finishReason field the initial "stop" stays
  const { finish_reason } = await createCompletionWithFinishReason("STOP");
  assert.equal(finish_reason, "stop");
  // The body text is extracted as usual
  const provider = new VertexAIProvider({ model: "gemini-3.1-pro-preview", settings: SETTINGS });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => geminiResponse("MAX_TOKENS")) as typeof fetch;
  try {
    const result = await provider.create_completion({
      messages: [{ role: "user", content: "hello" }] as never,
    });
    assert.equal(result.content, "partial answer");
    assert.deepEqual(result.usage, {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Vertex express mode (GOOGLE_GENAI_USE_VERTEXAI=true): the aiplatform path form
// (the REST equivalent of SDK Client(vertexai=True, api_key=...) — base
// aiplatform.googleapis.com + the /v1beta1/publishers/google/models/ prefix +
// the x-goog-api-key header)
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

async function captureRequest(
  build: () => Promise<void>,
  response: Response,
): Promise<CapturedRequest> {
  const originalFetch = globalThis.fetch;
  let captured = null as CapturedRequest | null;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    return response;
  }) as typeof fetch;
  try {
    await build();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return captured as CapturedRequest;
}

test("vertexai provider: express 模式非流式请求形态（aiplatform + publishers 路径 + api-key 头）", async () => {
  const provider = new VertexAIProvider({ model: "gemini-3.1-pro-preview", settings: EXPRESS_SETTINGS });
  const captured = await captureRequest(
    () =>
      provider.create_completion({
        messages: [{ role: "user", content: "hello" }] as never,
      }) as unknown as Promise<void>,
    geminiResponse("STOP"),
  );
  assert.equal(
    captured.url,
    "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3.1-pro-preview:generateContent",
  );
  assert.equal(captured.headers["x-goog-api-key"], provider.api_key);
  assert.equal(captured.headers["Content-Type"], "application/json");
  // The request body has the same shape as the Gemini API (contents/generationConfig/safetySettings)
  assert.ok(Array.isArray((captured.body as Record<string, unknown>).contents));
});

test("vertexai provider: express 模式流式请求形态（streamGenerateContent?alt=sse）", async () => {
  const provider = new VertexAIProvider({ model: "gemini-2.5-flash", settings: EXPRESS_SETTINGS });
  const sseBody =
    'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}],"usageMetadata":{"totalTokenCount":3}}\n\n';
  const captured = await captureRequest(
    async () => {
      for await (const _chunk of provider.create_completion_stream({
        messages: [{ role: "user", content: "hello" }] as never,
      })) {
        void _chunk;
      }
    },
    new Response(sseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  );
  assert.equal(
    captured.url,
    "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
  );
  assert.equal(captured.headers["x-goog-api-key"], provider.api_key);
});

test("vertexai provider: express 模式模型名带资源前缀原样保留", async () => {
  const provider = new VertexAIProvider({ model: "publishers/google/models/gemini-2.5-flash", settings: EXPRESS_SETTINGS });
  const captured = await captureRequest(
    () =>
      provider.create_completion({
        messages: [{ role: "user", content: "hello" }] as never,
      }) as unknown as Promise<void>,
    geminiResponse("STOP"),
  );
  assert.equal(
    captured.url,
    "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-2.5-flash:generateContent",
  );
});

test("vertexai provider: 默认模式路径形态不变（generativelanguage + /v1beta/models/）", async () => {
  const provider = new VertexAIProvider({ model: "gemini-3.1-pro-preview", settings: SETTINGS });
  const captured = await captureRequest(
    () =>
      provider.create_completion({
        messages: [{ role: "user", content: "hello" }] as never,
      }) as unknown as Promise<void>,
    geminiResponse("STOP"),
  );
  assert.equal(
    captured.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
  );
});
