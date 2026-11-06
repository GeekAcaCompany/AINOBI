// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, test } from "vitest";
import assert from "node:assert/strict";

import { GoogleTTSProvider } from "./provider.ts";
import {
  applyPcmGain,
  buildGoogleSpeedStyle,
  buildGoogleTtsPayload,
  concatPcm,
  decodeGooglePcm,
  encodePcmToMp3,
  encodePcmToMp3Async,
  encodePcmToWav,
  extractGoogleInteractionAudio,
  mapWithConcurrency,
  outboundHttp,
  pcmDurationMs,
  splitGoogleTtsText,
} from "./speech.ts";

const realFetch = outboundHttp.fetch;
afterEach(() => {
  outboundHttp.fetch = realFetch;
});

const wavBytes = (samples: number[], sampleRate = 24000): Buffer =>
  encodePcmToWav({ samples: Int16Array.from(samples), sampleRate, channels: 1 });

const interaction = (audio: Buffer) =>
  JSON.stringify({
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: audio.toString("base64") }] }],
  });

test("buildGoogleSpeedStyle only hints when speed differs from 1.0", () => {
  assert.equal(buildGoogleSpeedStyle(1), undefined);
  assert.equal(buildGoogleSpeedStyle(1.02), undefined);
  assert.equal(buildGoogleSpeedStyle(undefined), undefined);
  assert.match(buildGoogleSpeedStyle(1.3) ?? "", /faster.*1\.30x/);
  assert.match(buildGoogleSpeedStyle(0.8) ?? "", /slower.*0\.80x/);
});

test("buildGoogleTtsPayload targets the Interactions API shape", () => {
  const payload = buildGoogleTtsPayload({ model: "gemini-3.8-flash-tts", text: "你好", voiceId: "kore", speed: 1.2, style: "warm" }) as {
    input: Array<{ type: string; content: Array<{ text: string; annotations?: Array<{ type: string; style: string }> }> }>;
    response_format: unknown;
    generation_config: { speech_config: unknown };
  };
  assert.equal(payload.input[0]?.type, "user_input");
  assert.equal(payload.input[0]?.content[0]?.text, "你好");
  assert.match(payload.input[0]?.content[0]?.annotations?.[0]?.style ?? "", /^warm; Speak faster/);
  assert.deepEqual(payload.response_format, { type: "audio" });
  assert.deepEqual(payload.generation_config.speech_config, [{ voice: "kore" }]);
  const plain = buildGoogleTtsPayload({ model: "m", text: "hi", voiceId: "kore", speed: 1 }) as {
    input: Array<{ content: Array<Record<string, unknown>> }>;
  };
  assert.equal("annotations" in (plain.input[0]?.content[0] ?? {}), false);
});

test("extractGoogleInteractionAudio returns the last audio output and reports errors", () => {
  const audio = wavBytes([1, 2, 3]);
  const out = extractGoogleInteractionAudio(JSON.parse(interaction(audio)));
  assert.equal(out.mimeType, "audio/wav");
  assert.deepEqual(out.audio, audio);
  assert.throws(() => extractGoogleInteractionAudio({ error: { message: "quota" } }), /quota/);
  assert.throws(() => extractGoogleInteractionAudio({ status: "completed", steps: [] }), /no audio/);
});

test("decodeGooglePcm reads WAV (skipping trailing chunks) and little-endian L16", () => {
  const extra = Buffer.concat([Buffer.from("c2pa", "ascii"), Buffer.from([4, 0, 0, 0]), Buffer.from("meta")]);
  const wav = decodeGooglePcm(Buffer.concat([wavBytes([5, -6, 7]), extra]), "audio/wav");
  assert.deepEqual(Array.from(wav.samples), [5, -6, 7]);
  assert.equal(wav.sampleRate, 24000);
  const l16 = Buffer.alloc(4);
  l16.writeInt16LE(256, 0);
  l16.writeInt16LE(-1, 2);
  const raw = decodeGooglePcm(l16, "audio/l16; rate=16000");
  assert.deepEqual(Array.from(raw.samples), [256, -1]);
  assert.equal(raw.sampleRate, 16000);
  assert.throws(() => decodeGooglePcm(Buffer.from("not audio"), "audio/wav"), /neither WAV nor L16/);
});

test("applyPcmGain scales and clips; 0 silences, negative or invalid leaves it unchanged", () => {
  const samples = Int16Array.from([1000, -1000, 30000]);
  assert.equal(applyPcmGain(samples, 1), samples);
  assert.deepEqual(Array.from(applyPcmGain(samples, 0.5)), [500, -500, 15000]);
  assert.deepEqual(Array.from(applyPcmGain(samples, 2)), [2000, -2000, 32767]);
  assert.deepEqual(Array.from(applyPcmGain(samples, 0)), [0, 0, 0]);
  assert.equal(applyPcmGain(samples, -1), samples);
  assert.equal(applyPcmGain(samples, Number.NaN), samples);
});

test("splitGoogleTtsText splits at sentences, then clauses, then hard cuts on code points", () => {
  assert.deepEqual(splitGoogleTtsText("短文本。", 10), ["短文本。"]);
  assert.deepEqual(splitGoogleTtsText("第一句话。第二句话！第三句话？", 10), ["第一句话。第二句话！", "第三句话？"]);
  const clauses = "甲甲甲，乙乙乙，丙丙丙。";
  const chunks = splitGoogleTtsText(clauses, 8);
  assert.equal(chunks.join(""), clauses);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 8));
  assert.deepEqual(splitGoogleTtsText("字".repeat(25), 10), ["字".repeat(10), "字".repeat(10), "字".repeat(5)]);
  const emoji = "😀".repeat(5);
  assert.equal(splitGoogleTtsText(emoji, 2).join(""), emoji);
});

test("mapWithConcurrency preserves order, caps parallelism, and drains after a failure", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, index) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, ms));
    running -= 1;
    return index;
  });
  assert.deepEqual(out, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);

  const started: number[] = [];
  let inFlight = 0;
  await assert.rejects(
    mapWithConcurrency([0, 1, 2, 3], 2, async (_item, index) => {
      started.push(index);
      inFlight += 1;
      try {
        if (index === 0) throw new Error("chunk 0 failed");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return index;
      } finally {
        inFlight -= 1;
      }
    }),
    /chunk 0 failed/,
  );
  assert.equal(inFlight, 0);
  assert.deepEqual(started, [0, 1]);
});

test("concatPcm joins chunks and rejects mismatched formats", () => {
  const joined = concatPcm([
    { samples: Int16Array.from([1, 2]), sampleRate: 24000, channels: 1 },
    { samples: Int16Array.from([3]), sampleRate: 24000, channels: 1 },
  ]);
  assert.deepEqual(Array.from(joined.samples), [1, 2, 3]);
  assert.throws(
    () =>
      concatPcm([
        { samples: Int16Array.from([1]), sampleRate: 24000, channels: 1 },
        { samples: Int16Array.from([1]), sampleRate: 16000, channels: 1 },
      ]),
    /mismatched/,
  );
});

test("MP3 encoding: sync and async agree, frames are valid, stereo is split into L/R", async () => {
  const sampleRate = 24000;
  const samples = new Int16Array(sampleRate);
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  const pcm = { samples, sampleRate, channels: 1 };
  assert.equal(pcmDurationMs(pcm), 1000);
  const mp3 = encodePcmToMp3(pcm, 128);
  assert.equal(mp3[0], 0xff);
  assert.deepEqual(await encodePcmToMp3Async(pcm, 128), mp3);

  const stereo = new Int16Array(1152 * 3 * 2);
  for (let i = 0; i < stereo.length / 2; i += 1) {
    stereo[i * 2] = Math.round(8000 * Math.sin(i / 10));
    stereo[i * 2 + 1] = Math.round(8000 * Math.sin(i / 10 + Math.PI / 2));
  }
  const stereoMp3 = encodePcmToMp3({ samples: stereo, sampleRate, channels: 2 }, 128);
  assert.equal(stereoMp3[0], 0xff);
  assert.equal((stereoMp3[1] ?? 0) & 0xe0, 0xe0);
});

test("WAV encoding round-trips stereo PCM", () => {
  const samples = Int16Array.from([1000, -1000, 1000, -1000]);
  const decoded = decodeGooglePcm(encodePcmToWav({ samples, sampleRate: 24000, channels: 2 }), "audio/wav");
  assert.equal(decoded.channels, 2);
  assert.deepEqual(Array.from(decoded.samples), Array.from(samples));
});

test("provider: sends one Vertex AI Interactions request per chunk, with a bearer token, and encodes the requested format", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const sent: Array<{ url: string; auth: string }> = [];
  outboundHttp.fetch = (async (url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    sent.push({ url, auth: (init.headers as Record<string, string>).authorization });
    return new Response(interaction(wavBytes([100, 200, 300])), { status: 200 });
  }) as unknown as typeof fetch;
  const provider = new GoogleTTSProvider({ settings: { access_token: "tok", project: "proj" } });
  const wav = await provider.textToSpeech({ text: "你好。", voice_id: "kore", speed: 1, temperature: 0.7, top_p: 0.7, format: "wav", volume: 2 });
  assert.equal(bodies.length, 1);
  assert.deepEqual(sent[0], { url: "https://aiplatform.googleapis.com/v1beta1/projects/proj/locations/global/interactions", auth: "Bearer tok" });
  // The AI Studio body, unchanged: the style travels apart from the text.
  assert.equal(bodies[0]?.model, "gemini-3.8-flash-tts");
  assert.deepEqual(Array.from(decodeGooglePcm(wav, "audio/wav").samples), [200, 400, 600]);
  const mp3 = await provider.textToSpeech({ text: "你好。", voice_id: "kore", speed: 1, temperature: 0.7, top_p: 0.7, format: "mp3" });
  assert.equal(mp3[0], 0xff);
  await assert.rejects(
    provider.textToSpeech({ text: "x", voice_id: "kore", speed: 1, temperature: 0.7, top_p: 0.7, format: "ogg" }),
    /Unsupported Google TTS format/,
  );
});

test("provider: retries transient failures up to chunk_attempts, never client errors", async () => {
  let calls = 0;
  outboundHttp.fetch = (async () => {
    calls += 1;
    return calls < 3
      ? new Response("busy", { status: 503 })
      : new Response(interaction(wavBytes([1, 2])), { status: 200 });
  }) as unknown as typeof fetch;
  const provider = new GoogleTTSProvider({ settings: { access_token: "tok", project: "proj", chunk_attempts: 3, retry_delay_ms: 0 } });
  await provider.textToSpeech({ text: "x", voice_id: "kore", speed: 1, temperature: 0.7, top_p: 0.7, format: "wav" });
  assert.equal(calls, 3);

  calls = 0;
  outboundHttp.fetch = (async () => {
    calls += 1;
    return new Response('{"error":"bad voice"}', { status: 400 });
  }) as unknown as typeof fetch;
  await assert.rejects(
    provider.textToSpeech({ text: "x", voice_id: "nope", speed: 1, temperature: 0.7, top_p: 0.7, format: "wav" }),
    /TTS synthesis failed \(HTTP 400\)/,
  );
  assert.equal(calls, 1);
});

test("provider: bills by Unicode code points", () => {
  const provider = new GoogleTTSProvider({ settings: { access_token: "tok", project: "proj" } });
  assert.equal(provider.get_billable_units("恭喜你🎉🎉"), 5);
});
