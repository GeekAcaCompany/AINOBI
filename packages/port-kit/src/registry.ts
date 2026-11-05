// SPDX-License-Identifier: AGPL-3.0-only
/** Error code of every "no implementation registered for this kind" failure. */
export const PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED';

/**
 * Base of the ports' not-configured errors: `instanceof PortNotConfiguredError` catches the
 * failure of any port, while each port keeps its own subclass and message.
 */
export class PortNotConfiguredError extends Error {
  readonly code = PROVIDER_NOT_CONFIGURED;
  /** What the port calls its implementations, e.g. "TTS provider". */
  readonly subject: string;
  /** The kind that was requested but never registered. */
  readonly kind: string;

  constructor(subject: string, kind: string) {
    super(`${subject} ${JSON.stringify(kind)} is not configured; register an implementation at the composition root`);
    this.name = 'ProviderNotConfiguredError';
    this.subject = subject;
    this.kind = kind;
  }
}

/** Kind → implementation map of one port. */
export interface ProviderRegistry<P> {
  /** Register (or replace) the implementation of a kind. */
  register(kind: string, provider: P): void;
  /** Drop one kind, or every kind when called without an argument. */
  unregister(kind?: string): void;
  /** The registered implementation, or the port's fallback for an unregistered kind. */
  get(kind: string): P;
  /** Whether an implementation is registered for the kind. */
  has(kind: string): boolean;
  /** The registered kinds, in registration order. */
  kinds(): string[];
}

/**
 * Creates a registry. `fallback` builds what `get` returns for an unregistered kind; ports
 * use a throwing implementation so a missing registration fails loudly at call time.
 */
export function createProviderRegistry<P>(fallback: (kind: string) => P): ProviderRegistry<P> {
  const providers = new Map<string, P>();
  return {
    register(kind, provider) {
      providers.set(kind, provider);
    },
    unregister(kind) {
      if (kind === undefined) {
        providers.clear();
      } else {
        providers.delete(kind);
      }
    },
    get(kind) {
      return providers.get(kind) ?? fallback(kind);
    },
    has(kind) {
      return providers.has(kind);
    },
    kinds() {
      return [...providers.keys()];
    },
  };
}
