// SPDX-License-Identifier: AGPL-3.0-only
// TTS capability port. The interface mirrors the platform backend's provider
// abstraction one-to-one (model/api_key/api_base fields, textToSpeech, close,
// billing hooks) so that lifting the implementations into @ainobi/tts-* packages
// or repointing the backend at this port is mechanical. Cross-cutting concerns
// (billing, audit) wrap the interface as decorators and never live inside an
// implementation.

import { createProviderRegistry, PortNotConfiguredError, type ProviderRegistry } from '@ainobi/port-kit';

/**
 * Kinds of the built-in implementations (@ainobi/tts-*). The registry accepts any string, so a
 * third party registers its own kind without extending this list.
 */
export const TTSProviderKind = {
  FISHAUDIO: 'fishaudio',
  MINIMAX: 'minimax',
  GOOGLE: 'google',
} as const;
export type TTSProviderKind = (typeof TTSProviderKind)[keyof typeof TTSProviderKind];

export interface TextToSpeechParams {
  text: string;
  voice_id: string;
  speed: number;
  temperature: number;
  top_p: number;
  format: string;
  [key: string]: unknown;
}

/** The TTS provider contract. */
export interface TTSProvider {
  model: string;
  api_key?: string | null;
  api_base?: string | null;

  textToSpeech(params: TextToSpeechParams): Promise<Buffer>;

  close(): Promise<void>;

  /** Billing service code (provider-specific override). */
  get_service_code(): string;

  /** Billing units for a text (default: Unicode code points; Fish Audio: UTF-8 bytes). */
  get_billable_units(text: string): number;
}

/**
 * Default billing units: Unicode code points. Rate tables are calibrated per
 * million characters and the courseware service bills the same way — count code
 * points, not UTF-16 code units (an emoji occupies two units but is one character).
 */
export function countBillableCodePoints(text: string): number {
  return [...text].length;
}

/** Thrown by the default provider and by registry misses. */
export { PROVIDER_NOT_CONFIGURED } from '@ainobi/port-kit';
export { PortNotConfiguredError };
export type { ProviderRegistry };

/** This port's not-configured error; `instanceof PortNotConfiguredError` catches every port's. */
export class ProviderNotConfiguredError extends PortNotConfiguredError {
  constructor(kind: string) {
    super('TTS provider', kind);
  }
}

/** The throwing default: unregistered kinds fail loudly at call time, not silently. */
export class UnconfiguredTTSProvider implements TTSProvider {
  model = 'unconfigured';
  constructor(private readonly kind: string) {}
  async textToSpeech(): Promise<Buffer> {
    throw new ProviderNotConfiguredError(this.kind);
  }
  async close(): Promise<void> {}
  get_service_code(): string {
    throw new ProviderNotConfiguredError(this.kind);
  }
  get_billable_units(): number {
    throw new ProviderNotConfiguredError(this.kind);
  }
}

/**
 * Creates a provider registry owned by the caller — for hosts that keep several configurations
 * in one process, or that avoid module-level state. Unregistered kinds resolve to the throwing
 * default.
 */
export function createTTSProviderRegistry(): ProviderRegistry<TTSProvider> {
  return createProviderRegistry<TTSProvider>((kind) => new UnconfiguredTTSProvider(kind));
}

/** The process-wide default registry behind the functions below. */
const defaultRegistry = createTTSProviderRegistry();

/** Register an implementation for a kind at the composition root. */
export function registerTTSProvider(kind: string, provider: TTSProvider): void {
  defaultRegistry.register(kind, provider);
}

/** Test hook: drop one kind (or the whole registry). */
export function unregisterTTSProvider(kind?: string): void {
  defaultRegistry.unregister(kind);
}

/** Resolve a provider; an unregistered kind yields the throwing default. */
export function getTTSProvider(kind: string): TTSProvider {
  return defaultRegistry.get(kind);
}

/** @deprecated Use {@link TTSProvider}; kept for the backend's original naming. */
export type BaseTTSProvider = TTSProvider;
/** @deprecated Use {@link TTSProviderKind}; kept for the backend's original naming. */
export const TTSProviderType = TTSProviderKind;
/** @deprecated Use {@link TTSProviderKind}; kept for the backend's original naming. */
export type TTSProviderType = TTSProviderKind;
