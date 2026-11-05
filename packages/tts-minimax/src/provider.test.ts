// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, test } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { MiniMaxProvider, buildMiniMaxTaskStart, outboundWs, synthesizeMiniMaxSpeech } from "./provider.ts";

const realConnect = outboundWs.connect;
afterEach(() => {
  outboundWs.connect = realConnect;
});

/** A scripted MiniMax server: answers each client event with the given messages. */
const fakeServer = (script: {
  handshake?: unknown;
  started?: unknown;
  audio?: unknown[];
}) => {
  const sent: Array<Record<string, unknown>> = [];
  let connectedWith: { url: string; headers: Record<string, string> } | null = null;
  outboundWs.connect = ((url: string, options: { headers?: Record<string, string> }) => {
    connectedWith = { url, headers: options.headers ?? {} };
    const ws = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const emit = (message: unknown) => setImmediate(() => ws.emit("message", Buffer.from(JSON.stringify(message))));
    ws.readyState = 1;
    ws.send = (data: string, callback?: (error?: Error) => void) => {
      const message = JSON.parse(data) as Record<string, unknown>;
      sent.push(message);
      if (message.event === "task_start") emit(script.started ?? { event: "task_started" });
      if (message.event === "task_continue") for (const part of script.audio ?? []) emit(part);
      callback?.();
    };
    ws.close = () => {
      ws.readyState = 3;
    };
    ws.terminate = () => {};
    emit(script.handshake ?? { event: "connected_success" });
    return ws;
  }) as unknown as typeof outboundWs.connect;
  return { sent, connection: () => connectedWith };
};

test("task_start carries the voice, audio and pronunciation settings", () => {
  assert.deepEqual(
    buildMiniMaxTaskStart({
      apiKey: "k",
      model: "speech-2.8-hd",
      text: "x",
      voiceId: "v",
      speed: 1.1,
      volume: 0.9,
      pitch: 1.6,
      languageBoost: "ja",
      pronunciationTone: [" 处理/(chu3)(li3) ", ""],
    }),
    {
      event: "task_start",
      model: "speech-2.8-hd",
      voice_setting: { voice_id: "v", speed: 1.1, vol: 0.9, pitch: 2, language_boost: "Japanese", english_normalization: false },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      pronunciation_dict: { tone: ["处理/(chu3)(li3)"] },
    },
  );
});

test("synthesis collects the hex audio of every message and the final duration", async () => {
  const server = fakeServer({
    audio: [{ data: { audio: "0102" } }, { data: { audio: "03" }, is_final: true, extra_info: { audio_length: 1234 } }],
  });
  const result = await synthesizeMiniMaxSpeech({ apiKey: "secret", model: "m", text: "你好", voiceId: "v" });
  assert.deepEqual(result.audio, Buffer.from([1, 2, 3]));
  assert.equal(result.durationMs, 1234);
  assert.deepEqual(server.sent.map((m) => m.event), ["task_start", "task_continue", "task_finish"]);
  assert.equal(server.sent[1]?.text, "你好");
  assert.equal(server.connection()?.url, "wss://api.minimax.io/ws/v1/t2a_v2");
  assert.equal(server.connection()?.headers.Authorization, "Bearer secret");
});

test("server failures surface with the server message (unknown voices are recognizable)", async () => {
  fakeServer({ audio: [{ event: "task_failed", base_resp: { status_code: 2054, status_msg: "voice id not exist" } }] });
  await assert.rejects(
    synthesizeMiniMaxSpeech({ apiKey: "k", model: "m", text: "x", voiceId: "nope" }),
    /TTS synthesis failed: .*2054/,
  );
  fakeServer({ handshake: { event: "error", message: "unauthorized" } });
  await assert.rejects(synthesizeMiniMaxSpeech({ apiKey: "k", model: "m", text: "x", voiceId: "v" }), /TTS connection failed/);
});

test("invalid hex audio is rejected instead of being truncated", async () => {
  fakeServer({ audio: [{ data: { audio: "0102zz" }, is_final: true }] });
  await assert.rejects(synthesizeMiniMaxSpeech({ apiKey: "k", model: "m", text: "x", voiceId: "v" }), /invalid hex audio/);
});

test("provider: textToSpeech returns the audio, synthesize also the duration, billing by code points", async () => {
  fakeServer({ audio: [{ data: { audio: "0a0b" }, is_final: true, extra_info: { audio_length: 500 } }] });
  const provider = new MiniMaxProvider({ model: "speech-2.8-hd", settings: { api_key: "k" } });
  const audio = await provider.textToSpeech({ text: "x", voice_id: "v", speed: 1, temperature: 0.7, top_p: 0.7, format: "mp3", volume: 1, language: "zh" });
  assert.deepEqual(audio, Buffer.from([0x0a, 0x0b]));
  fakeServer({ audio: [{ data: { audio: "0c" }, is_final: true, extra_info: { audio_length: 700 } }] });
  assert.equal((await provider.synthesize({ text: "x", voice_id: "v" })).durationMs, 700);
  assert.equal(provider.get_billable_units("恭喜你🎉🎉"), 5);
  assert.equal(provider.get_service_code(), "speech-2.8-hd");
});
