// SPDX-License-Identifier: AGPL-3.0-only
import type { CreditsConsumeResult } from './ainobi-credits.ts';

export type NarrationTtsProvider = 'google' | 'minimax' | 'fishaudio';

export type NarrationTtsBillingOutcome =
  | { kind: 'charged'; result: CreditsConsumeResult; characterCount: number; provider: NarrationTtsProvider }
  | { kind: 'failed'; error: string; status?: number; characterCount: number; provider: NarrationTtsProvider }
  | { kind: 'skipped'; reason: 'zero_characters'; characterCount: number; provider: NarrationTtsProvider };

export type NarrationTtsBillingFailureResponse = {
  status: number;
  body: { ok: false; error: string; creditsTtsError: string };
};

/**
 * Map a TTS credits consume failure to an HTTP error response.
 * Callers must not run synthesis / narration when billing fails.
 */
export function resolveNarrationTtsBillingFailureResponse(
  billing: Extract<NarrationTtsBillingOutcome, { kind: 'failed' }>,
): NarrationTtsBillingFailureResponse {
  const status =
    typeof billing.status === 'number' &&
    Number.isFinite(billing.status) &&
    billing.status >= 400 &&
    billing.status < 600
      ? billing.status
      : 503;
  return {
    status,
    body: {
      ok: false,
      error: billing.error,
      creditsTtsError: billing.error,
    },
  };
}

/** Pre-charge succeeded but TTS/narration work failed — no refund API; log for reconciliation. */
export function logNarrationTtsPreauthChargedButWorkFailed(args: {
  phase: 'synthesize' | 'narration';
  provider: NarrationTtsProvider;
  characterCount: number;
  ledgerId?: string | null;
  error: unknown;
}): void {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  console.warn(
    `[credits] TTS preauth charged but ${args.phase} failed ` +
      `provider=${args.provider} chars=${args.characterCount} ` +
      `ledger=${args.ledgerId ?? 'n/a'}: ${message}`,
  );
}

export const narrationArgvFlagValue = (argv: string[], flag: string): string | undefined => {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === flag) {
      const next = argv[i + 1];
      return typeof next === 'string' ? next : undefined;
    }
    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return undefined;
};

/**
 * Catalog-file flags that must never reach host narration (`--teacher-file` /
 * `--teachers` / `--tts-file`). The host resolves teacher / voice language from the
 * session catalog only, so a teacher known just to a client-supplied file would be
 * misclassified (no platform dict / kana map for a Japanese teacher) while the CLI child
 * still synthesized with it. Returns the offending flag name (lower-cased) in either
 * `--flag value` or `--flag=value` form, or null when none is present.
 */
export const findBlockedNarrationCatalogFileFlag = (argv: string[]): string | null => {
  const blocked = new Set(['--teacher-file', '--teachers', '--tts-file']);
  for (const part of argv) {
    const name = part.toLowerCase().split('=')[0]?.trim();
    if (name && blocked.has(name)) {
      return name;
    }
  }
  return null;
};

/** TTS source text from `ainobi narration insert` argv (--transcript, else --script). */
export function resolveNarrationTtsSourceFromArgv(argv: string[]): string {
  const script = narrationArgvFlagValue(argv, '--script')?.trim() ?? '';
  const transcript = narrationArgvFlagValue(argv, '--transcript')?.trim() ?? '';
  return transcript === '' ? script : transcript;
}

/**
 * Billable units for count-based TTS (CountBased on platform): Unicode code points in TTS source.
 * Maps to POST /v1/credits/consume `amount` + `unit_count` (not input/output token ratios).
 */
export function countTtsTextCharacters(text: string): number {
  const source = text.trim();
  if (!source) {
    return 0;
  }
  return Array.from(source).length;
}

export function countNarrationTtsCharacters(argv: string[]): number {
  const source = resolveNarrationTtsSourceFromArgv(argv);
  return countTtsTextCharacters(source);
}

/** Replace `--flag value` or `--flag=value` occurrences in argv (mutates a copy). */
export function replaceNarrationArgvFlagValue(
  argv: readonly string[],
  flag: string,
  nextValue: string,
): string[] {
  const out = [...argv];
  const prefix = `${flag}=`;
  for (let i = 0; i < out.length; i += 1) {
    const arg = out[i];
    if (arg === flag) {
      if (i + 1 < out.length && !out[i + 1].startsWith('-')) {
        out[i + 1] = nextValue;
      }
      return out;
    }
    if (arg.startsWith(prefix)) {
      out[i] = `${prefix}${nextValue}`;
      return out;
    }
  }
  return out;
}

/**
 * Billing provider for a teacher / voice provider value. Unknown or missing values map to
 * the CLI default provider (Google), matching what `resolveTeacherTtsSettings` synthesizes with.
 */
export function normalizeNarrationTtsProvider(value: unknown): NarrationTtsProvider {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'fishaudio' || text === 'fish.audio' || text === 'fish_audio') {
    return 'fishaudio';
  }
  if (text === 'minimax' || text === 'minimaxi') {
    return 'minimax';
  }
  return 'google';
}

/** Provider from narration CLI success envelope (`data.tts_provider`). */
export function resolveNarrationTtsProviderFromHostStdout(stdout: string): NarrationTtsProvider | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const envelope = JSON.parse(trimmed) as { ok?: boolean; data?: { tts_provider?: unknown } };
    if (envelope.ok !== true || !envelope.data) {
      return null;
    }
    return normalizeNarrationTtsProvider(envelope.data.tts_provider);
  } catch {
    return null;
  }
}
