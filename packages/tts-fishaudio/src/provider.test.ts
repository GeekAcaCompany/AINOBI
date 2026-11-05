// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, test } from "vitest";
import assert from "node:assert/strict";

import {
  FishAudioHttpError,
  FishAudioProvider,
  buildFishAudioRequest,
  fishAudioVolumeDb,
  normalizeFishAudioModel,
  outboundHttp,
  synthesizeFishAudioSpeech,
} from "./provider.ts";

const realFetch = outboundHttp.fetch;
afterEach(() => {
  outboundHttp.fetch = realFetch;
});

const capture = () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  outboundHttp.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Uint8Array([0x01, 0x02, 0x03]), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
};

test("the request is JSON with normalized loudness and the volume as prosody gain", () => {
  assert.deepEqual(
    buildFishAudioRequest({ apiKey: "k", model: "s1", text: "你好", voiceId: "ref", speed: 1.2, volume: 1.5, mp3Bitrate: 192 }),
    {
      text: "你好",
      reference_id: "ref",
      format: "mp3",
      normalize: true,
      mp3_bitrate: 192,
      prosody: { speed: 1.2, volume: 6, normalize_loudness: true },
    },
  );
  assert.equal(fishAudioVolumeDb(1), 0);
  assert.equal(fishAudioVolumeDb(5), 12);
  assert.equal(fishAudioVolumeDb(0), -12);
  assert.equal(normalizeFishAudioModel("S1"), "s1");
  assert.equal(normalizeFishAudioModel("s2"), "s2-pro");
  assert.equal(normalizeFishAudioModel("s2.1-pro"), "s2.1-pro");
});

test("provider: posts to {service_url}/v1/tts without a timeout and passes the sampling parameters", async () => {
  const calls = capture();
  const provider = new FishAudioProvider({ model: "s2.1-pro", settings: { api_key: "test-key" } });
  const audio = await provider.textToSpeech({ text: "长文本合成", voice_id: "v1", speed: 1.0, temperature: 0.7, top_p: 0.8, format: "mp3" });
  assert.deepEqual(audio, Buffer.from([0x01, 0x02, 0x03]));
  const [call] = calls;
  assert.equal(call?.url, "https://api.fish.audio/v1/tts");
  assert.equal(call?.init.method, "POST");
  // No abort signal: synthesis time grows with the text, and the caller controls interruption
  assert.equal(call?.init.signal, undefined);
  const headers = call?.init.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers.model, "s2.1-pro");
  assert.equal(headers.Authorization, "Bearer test-key");
  const body = JSON.parse(String(call?.init.body));
  assert.equal(body.reference_id, "v1");
  assert.equal(body.temperature, 0.7);
  assert.equal(body.top_p, 0.8);
  assert.equal(body.prosody.normalize_loudness, true);
});

test("synthesizeFishAudioSpeech: timeout and endpoint are options; sampling parameters are optional", async () => {
  const calls = capture();
  await synthesizeFishAudioSpeech({ apiKey: "k", endpoint: "https://relay.test/v1/tts", model: "s1", text: "x", voiceId: "v", timeoutMs: 5000 });
  assert.equal(calls[0]?.url, "https://relay.test/v1/tts");
  assert.ok(calls[0]?.init.signal instanceof AbortSignal);
  const body = JSON.parse(String(calls[0]?.init.body));
  assert.equal("temperature" in body, false);
  assert.equal("top_p" in body, false);
});

test("non-2xx responses raise FishAudioHttpError with the API message, raw body and HTTP status", async () => {
  outboundHttp.fetch = (async () =>
    new Response(JSON.stringify({ status: 402, message: "reference_id not found" }), { status: 400 })) as unknown as typeof fetch;
  const error = await synthesizeFishAudioSpeech({ apiKey: "k", model: "s1", text: "x", voiceId: "v" }).catch((e: unknown) => e);
  assert.ok(error instanceof FishAudioHttpError);
  assert.equal(error.status, 402);
  assert.equal(error.httpStatus, 400);
  assert.equal(error.apiMessage, "reference_id not found");
  assert.match(error.body, /reference_id not found/);
});

test("provider: bills by UTF-8 bytes and names the service code after the model", () => {
  const provider = new FishAudioProvider({ model: "S2.1-Pro", settings: { api_key: "k" } });
  assert.equal(provider.get_billable_units("你好a"), 7);
  assert.equal(provider.get_service_code(), "fishaudio-s2.1-pro");
});
