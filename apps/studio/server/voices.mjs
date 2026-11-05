// SPDX-License-Identifier: AGPL-3.0-only
// The voice catalog, read from the same seed file the platform backend uses, so narration offers the same voices.
// Synthesis itself is the courseware service's own; it only needs to be told which voice an id means.
import { createHash } from 'node:crypto';

export const DEFAULT_VOICE = { provider: 'google', voice: 'charon', language: 'zh' };

/** A stable UUID from a voice and language, so saved narration keeps its voice across restarts. */
export function voiceId(voice, language) {
  const hash = createHash('sha1').update(`${voice}\0${language ?? ''}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function loadVoices(entries) {
  return entries.map((entry) => ({
    tts_id: voiceId(entry.tts_voice, entry.tts_language),
    tts_name: entry.tts_name,
    tts_status: entry.tts_status ?? 'active',
    tts_provider: entry.tts_provider,
    tts_model: entry.tts_model,
    tts_voice: entry.tts_voice,
    tts_speed: entry.tts_speed ?? 1,
    tts_volume: entry.tts_volume ?? 1,
    tts_pitch: entry.tts_pitch ?? 1,
    tts_language: entry.tts_language ?? null,
    remark: entry.remark ?? null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

export const findDefaultVoice = (voices) =>
  voices.find(
    (voice) => voice.tts_provider === DEFAULT_VOICE.provider && voice.tts_voice === DEFAULT_VOICE.voice && voice.tts_language === DEFAULT_VOICE.language,
  ) ?? null;

/** One page of the catalog, filtered as the platform's list endpoint is. */
export function voicePage(voices, query) {
  const filters = [
    ['tts_status', (voice) => voice.tts_status],
    ['tts_provider', (voice) => voice.tts_provider],
    ['tts_language', (voice) => voice.tts_language],
  ];
  const matching = voices.filter((voice) => filters.every(([name, read]) => !query.get(name) || read(voice) === query.get(name)));
  const pageNumber = Math.max(1, Number(query.get('page_number')) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(query.get('page_size')) || 100));
  return {
    data: matching.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
    page_number: pageNumber,
    page_size: pageSize,
    total_count: matching.length,
    total_pages: Math.ceil(matching.length / pageSize),
  };
}
