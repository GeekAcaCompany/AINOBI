// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AI_TEACHER,
  defaultTtsVoiceId,
  isPlatformTtsRecordId,
  normalizeTeacherList,
  normalizeTtsProvider,
  resolveTeacherTtsProvider,
  resolveTeacherTtsSettings,
  resolveTeacherTtsVoiceId,
  type AITeacher,
} from "./ai-teachers.ts";
import { isTtsVoiceNotFoundError, normalizeFishAudioModel } from "./tts.ts";

const platformTeacher: AITeacher = {
  ai_teacher_id: "23f35e13-192a-4300-a807-d076c2eccf8f",
  ai_teacher_name: "AI教师A",
  runtime: "live2d",
  model_url: "https://example.com/model.model3.json",
  ai_teacher_avatar_url: "",
  ai_teacher_live2d_model_url: "https://example.com/model.model3.json",
  ai_teacher_live2d_model_image_url: "https://example.com/model.model3.json",
  ai_teacher_tts_id: "d1238bb5-0732-4df9-910c-b3febeafb43b",
};

test("isPlatformTtsRecordId detects UUID catalog ids", () => {
  assert.equal(isPlatformTtsRecordId("d1238bb5-0732-4df9-910c-b3febeafb43b"), true);
  assert.equal(isPlatformTtsRecordId("Chinese (Mandarin)_Gentleman"), false);
  assert.equal(isPlatformTtsRecordId(undefined), false);
});

test("normalizeTtsProvider accepts fishaudio aliases", () => {
  assert.equal(normalizeTtsProvider("fishaudio"), "fishaudio");
  assert.equal(normalizeTtsProvider("Fish.Audio"), "fishaudio");
  assert.equal(normalizeTtsProvider("minimax"), "minimax");
});

test("normalizeTeacherList parses nested ai_teacher_tts", () => {
  const [teacher] = normalizeTeacherList([
    {
      ai_teacher_id: "addbcdc1-6c2c-4aab-8e6b-652ec856e23a",
      ai_teacher_name: "Piko",
      ai_teacher_live2d_model_url: "https://example.com/Aka.inx",
      ai_teacher_tts_id: "bf7d69e1-75fb-496c-b90d-2f46abb99ba6",
      ai_teacher_tts: {
        tts_provider: "fishaudio",
        tts_model: "S1",
        tts_voice: "32ea6ed2f793439da52685ac910534ac",
      },
    },
  ]);
  assert.ok(teacher);
  assert.equal(teacher.ai_teacher_tts_provider, "fishaudio");
  assert.equal(teacher.ai_teacher_tts_model, "S1");
  assert.equal(teacher.ai_teacher_tts_voice, "32ea6ed2f793439da52685ac910534ac");
  const settings = resolveTeacherTtsSettings(teacher);
  assert.equal(settings.provider, "fishaudio");
  assert.equal(settings.model, "S1");
  assert.equal(settings.voice_id, "32ea6ed2f793439da52685ac910534ac");
});

test("normalizeTeacherList keeps teachers without live2d model url", () => {
  const [teacher] = normalizeTeacherList([
    {
      ai_teacher_id: "addbcdc1-6c2c-4aab-8e6b-652ec856e23a",
      ai_teacher_name: "NoModelUrlTeacher",
      ai_teacher_live2d_model_image_url: "https://example.com/preview.png",
    },
  ]);
  assert.ok(teacher);
  assert.equal(teacher.ai_teacher_id, "addbcdc1-6c2c-4aab-8e6b-652ec856e23a");
  assert.equal(teacher.ai_teacher_name, "NoModelUrlTeacher");
  assert.equal(teacher.ai_teacher_live2d_model_url, DEFAULT_AI_TEACHER.ai_teacher_live2d_model_url);
  assert.equal(teacher.ai_teacher_avatar_url, DEFAULT_AI_TEACHER.ai_teacher_avatar_url);
  assert.equal(teacher.ai_teacher_live2d_model_image_url, DEFAULT_AI_TEACHER.ai_teacher_live2d_model_image_url);
});

test("normalizeTeacherList falls back live2d model url when missing", () => {
  const [teacher] = normalizeTeacherList([
    {
      ai_teacher_id: "8f4e1f3e-1111-2222-3333-444455556666",
      ai_teacher_name: "NoLive2dFieldsTeacher",
    },
  ]);
  assert.ok(teacher);
  assert.equal(teacher.ai_teacher_live2d_model_url, DEFAULT_AI_TEACHER.ai_teacher_live2d_model_url);
  assert.equal(teacher.model_url, DEFAULT_AI_TEACHER.ai_teacher_live2d_model_url);
  assert.equal(teacher.ai_teacher_avatar_url, DEFAULT_AI_TEACHER.ai_teacher_avatar_url);
  assert.equal(teacher.ai_teacher_live2d_model_image_url, DEFAULT_AI_TEACHER.ai_teacher_live2d_model_image_url);
});

test("resolveTeacherTtsVoiceId substitutes platform UUID with default voice", () => {
  const prev = process.env.GEMINI_TTS_VOICE_ID;
  process.env.GEMINI_TTS_VOICE_ID = "test-default-voice";
  try {
    assert.equal(resolveTeacherTtsVoiceId(platformTeacher), "test-default-voice");
    assert.equal(resolveTeacherTtsSettings(platformTeacher).provider, "google");
    assert.equal(resolveTeacherTtsSettings(platformTeacher).voice_id, "test-default-voice");
  } finally {
    if (prev === undefined) delete process.env.GEMINI_TTS_VOICE_ID;
    else process.env.GEMINI_TTS_VOICE_ID = prev;
  }
});

test("Google is the default TTS provider with a multilingual default voice", () => {
  const prevVoice = process.env.GEMINI_TTS_VOICE_ID;
  const prevModel = process.env.GEMINI_TTS_MODEL;
  delete process.env.GEMINI_TTS_VOICE_ID;
  delete process.env.GEMINI_TTS_MODEL;
  try {
    const settings = resolveTeacherTtsSettings(platformTeacher);
    assert.equal(settings.provider, "google");
    assert.equal(settings.voice_id, "kore");
    assert.equal(settings.model, "gemini-3.8-flash-tts");
    assert.equal(normalizeTtsProvider("Google"), "google");
    assert.equal(normalizeTtsProvider("gemini"), "google");
  } finally {
    if (prevVoice !== undefined) process.env.GEMINI_TTS_VOICE_ID = prevVoice;
    if (prevModel !== undefined) process.env.GEMINI_TTS_MODEL = prevModel;
  }
});

test("resolveTeacherTtsVoiceId keeps provider-native voice ids", () => {
  const teacher: AITeacher = {
    ...platformTeacher,
    ai_teacher_tts_id: "Chinese (Mandarin)_Gentleman",
  };
  assert.equal(resolveTeacherTtsVoiceId(teacher), "Chinese (Mandarin)_Gentleman");
});

test("isTtsVoiceNotFoundError recognizes provider voice-missing responses", () => {
  assert.equal(
    isTtsVoiceNotFoundError(
      new Error(
        'TTS synthesis failed: {"base_resp":{"status_code":2054,"status_msg":"voice id not exist"}}',
      ),
    ),
    true,
  );
  assert.equal(
    isTtsVoiceNotFoundError(new Error("reference_id not found for voice model")),
    true,
  );
  assert.equal(isTtsVoiceNotFoundError(new Error("network timeout")), false);
});

test("defaultTtsVoiceId falls back to built-in default", () => {
  const prev = process.env.MINIMAX_TTS_VOICE_ID;
  delete process.env.MINIMAX_TTS_VOICE_ID;
  try {
    assert.equal(defaultTtsVoiceId("minimax"), "Chinese (Mandarin)_Gentleman");
  } finally {
    if (prev !== undefined) process.env.MINIMAX_TTS_VOICE_ID = prev;
  }
});

test("normalizeFishAudioModel maps platform model codes", () => {
  assert.equal(normalizeFishAudioModel("S1"), "s1");
  assert.equal(normalizeFishAudioModel("s2-pro"), "s2-pro");
});

test("provider-less legacy teachers with a native voice id stay on MiniMax", () => {
  const legacy: AITeacher = {
    ...platformTeacher,
    ai_teacher_tts_provider: undefined,
    ai_teacher_tts_voice: undefined,
    ai_teacher_tts_id: "Chinese (Mandarin)_Gentleman",
  };
  assert.equal(resolveTeacherTtsProvider(legacy), "minimax");
  const settings = resolveTeacherTtsSettings(legacy);
  assert.equal(settings.provider, "minimax");
  assert.equal(settings.voice_id, "Chinese (Mandarin)_Gentleman");
  assert.equal(settings.model, "speech-2.8-hd");

  // No voice at all → Google default.
  const bare: AITeacher = { ...platformTeacher, ai_teacher_tts_provider: undefined, ai_teacher_tts_voice: undefined };
  assert.equal(resolveTeacherTtsProvider(bare), "google");
  // An explicit provider always wins.
  assert.equal(resolveTeacherTtsProvider({ ...legacy, ai_teacher_tts_provider: "google" }), "google");
});
