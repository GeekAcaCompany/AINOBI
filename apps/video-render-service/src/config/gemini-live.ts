// SPDX-License-Identifier: AGPL-3.0-only
/** Gemini Live environment config (matching the original Python backend's app/config.py + gemini_live.py). */

export type GeminiLiveServiceMode = 'conversation' | 'dictation';

/** Developer API (the original Python gemini_live.py used vertexai=False) */
const DEFAULT_DEVELOPER_MODEL = 'gemini-3.1-flash-live-preview';
const DEFAULT_DEVELOPER_API_VERSION = 'v1beta';

/** Vertex AI Live (optional; models and endpoints differ from the Developer API) */
const DEFAULT_VERTEX_MODEL = 'gemini-live-2.5-flash-preview-native-audio';
const DEFAULT_VERTEX_API_VERSION = 'v1beta1';

const DEFAULT_VOICE = 'Zubenelgenubi';
const DEFAULT_VERTEX_LOCATION = 'us-central1';

/**
 * Whether Gemini Live goes through Vertex AI.
 *
 * The original Python backend's `app/routes/v1/gemini_live.py` forces `vertexai=False` (Developer API),
 * regardless of `GOOGLE_GENAI_USE_VERTEXAI`. The default here matches it.
 * Vertex Live is used only with an explicit `GEMINI_LIVE_VERTEXAI=true`.
 */
export function isGeminiLiveVertexAiEnabled(): boolean {
  const explicit = process.env.GEMINI_LIVE_VERTEXAI?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return false;
}

/** GEMINI_API_KEY first, otherwise GOOGLE_CLOUD_API_KEY (the same chain as the backend's GEMINI_API_KEY config). */
export function resolveGeminiLiveApiKey(): string {
  return (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_CLOUD_API_KEY ?? '').trim();
}

export function resolveGoogleCloudProject(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCP_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    ''
  ).trim();
}

export function resolveGoogleCloudLocation(): string {
  return (
    process.env.GOOGLE_CLOUD_LOCATION ??
    process.env.VERTEXAI_LOCATION ??
    process.env.GCP_LOCATION ??
    DEFAULT_VERTEX_LOCATION
  ).trim();
}

export function resolveGeminiLiveModel(): string {
  const configured = process.env.GEMINI_LIVE_MODEL?.trim();
  if (configured) return configured;
  return isGeminiLiveVertexAiEnabled() ? DEFAULT_VERTEX_MODEL : DEFAULT_DEVELOPER_MODEL;
}

export function resolveGeminiLiveVoice(): string {
  return (process.env.GEMINI_LIVE_VOICE ?? DEFAULT_VOICE).trim() || DEFAULT_VOICE;
}

/**
 * The apiVersion of the Live WebSocket must match the backend type:
 * - Developer API → v1beta (the backend's GEMINI_LIVE_API_VERSION default)
 * - Vertex AI → v1beta1 (the @google/genai SDK default; v1beta 404s)
 */
export function resolveGeminiLiveApiVersion(): string {
  if (isGeminiLiveVertexAiEnabled()) {
    return (
      process.env.GEMINI_LIVE_VERTEX_API_VERSION ??
      process.env.GEMINI_LIVE_API_VERSION ??
      DEFAULT_VERTEX_API_VERSION
    ).trim() || DEFAULT_VERTEX_API_VERSION;
  }
  return (process.env.GEMINI_LIVE_API_VERSION ?? DEFAULT_DEVELOPER_API_VERSION).trim() ||
    DEFAULT_DEVELOPER_API_VERSION;
}

export function isGeminiLiveAudioGateEnabled(): boolean {
  const raw = process.env.GEMINI_LIVE_AUDIO_GATE_ENABLED;
  if (raw == null || raw === '') return true;
  return raw !== 'false' && raw !== '0';
}

export function resolveGeminiLiveAudioGatePeakThreshold(): number {
  const n = Number(process.env.GEMINI_LIVE_AUDIO_GATE_PEAK_THRESHOLD ?? 256);
  return Number.isFinite(n) ? Math.floor(n) : 256;
}

export function resolveGeminiLiveAudioGateTailChunks(): number {
  const n = Number(process.env.GEMINI_LIVE_AUDIO_GATE_TAIL_CHUNKS ?? 4);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 4;
}

export function parseGeminiLiveServiceMode(value: string | null | undefined): GeminiLiveServiceMode {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'dictation' ? 'dictation' : 'conversation';
}

export type GeminiLiveGoogleClientInit = {
  vertexai: boolean;
  apiKey?: string;
  project?: string;
  location?: string;
  httpOptions: { apiVersion: string };
};

/** Resolve the @google/genai GoogleGenAI constructor arguments; returns null when not configured. */
export function resolveGeminiLiveGoogleClientInit(): GeminiLiveGoogleClientInit | null {
  const httpOptions = { apiVersion: resolveGeminiLiveApiVersion() };
  const apiKey = resolveGeminiLiveApiKey();

  if (isGeminiLiveVertexAiEnabled()) {
    if (apiKey) {
      return { vertexai: true, apiKey, httpOptions };
    }
    const project = resolveGoogleCloudProject();
    const location = resolveGoogleCloudLocation();
    if (project && location) {
      return { vertexai: true, project, location, httpOptions };
    }
    return null;
  }

  if (!apiKey) return null;
  return { vertexai: false, apiKey, httpOptions };
}

export function isGeminiLiveConfigured(): boolean {
  return resolveGeminiLiveGoogleClientInit() != null;
}
