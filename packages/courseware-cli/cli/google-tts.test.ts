// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

// The synthesis itself is tested in @ainobi/tts-google; these cover the CLI's side of it.
import { encodePcmToMp3, hasGoogleCredentials, pcmDurationMs, resolveGoogleTtsTarget } from "./google-tts.ts";
import { readMp3DurationMs } from "./mp3-duration.ts";
import { isTtsVoiceNotFoundError, resolveGoogleTtsProxyUrl, resolveTtsProxyUrl } from "./tts.ts";

test("encoded Google TTS audio has the duration the CLI's MP3 parser reads", () => {
  const sampleRate = 24000;
  const samples = new Int16Array(sampleRate); // 1 second
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  }
  const pcm = { samples, sampleRate, channels: 1 };
  assert.equal(pcmDurationMs(pcm), 1000);
  const mp3 = encodePcmToMp3(pcm, 128);
  assert.ok(mp3.length > 1000);
  const duration = readMp3DurationMs(mp3);
  assert.ok(duration != null && Math.abs(duration - 1000) < 150, `duration=${duration}`);
});

test("Google TTS runs on Vertex AI with a service account, never an API key", () => {
  const target = resolveGoogleTtsTarget({ GOOGLE_APPLICATION_CREDENTIALS: " /keys/sa.json ", GOOGLE_CLOUD_PROJECT: "proj", VERTEXAI_BASE_URL: "https://relay.test/vertexai/" });
  assert.deepEqual(target, {
    credentials: { credentialsJson: null, credentialsPath: "/keys/sa.json" },
    project: "proj",
    location: "global",
    apiBase: "https://relay.test/vertexai",
  });
  // Gemini Developer API (AI Studio) and Vertex API keys give no credential for the Interactions API.
  const keysOnly = resolveGoogleTtsTarget({ GEMINI_API_KEY: "a", GEMINI_TTS_API_KEY: "b", GOOGLE_CLOUD_API_KEY: "c" });
  assert.equal(hasGoogleCredentials(keysOnly.credentials), false);
  assert.equal(keysOnly.project, null);
  assert.equal(resolveGoogleTtsTarget({ GEMINI_TTS_LOCATION: "us-central1" }).location, "us-central1");
});

test("isTtsVoiceNotFoundError recognizes Google unknown-voice errors", () => {
  assert.equal(
    isTtsVoiceNotFoundError(
      new Error('TTS synthesis failed (HTTP 400): {"error":{"message":"No matching speaker voice found for name: x and language: "}}'),
    ),
    true,
  );
});

test("GEMINI_TTS_PROXY applies to Google requests only", () => {
  const keys = ["GEMINI_TTS_PROXY", "MINIMAX_PROXY", "FISH_AUDIO_PROXY", "FISH_AUDIO_TTS_PROXY", "MINIMAX_TTS_PROXY", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "OSS_PROXY", "OSS_PROXY_URL"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    process.env.GEMINI_TTS_PROXY = "http://gemini-proxy:1";
    process.env.MINIMAX_PROXY = "http://minimax-proxy:2";
    assert.equal(resolveTtsProxyUrl(), "http://minimax-proxy:2");
    assert.equal(resolveGoogleTtsProxyUrl(), "http://gemini-proxy:1");
    delete process.env.GEMINI_TTS_PROXY;
    assert.equal(resolveGoogleTtsProxyUrl(), "http://minimax-proxy:2");
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});
