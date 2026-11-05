// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Guest-side runtime for an AINOBI page running inside a host's iframe. It talks only to
 * `window.parent`, and only when the parent's origin is on the page's allowlist: the
 * first message is `ready` to the allowed origins, after which the host's origin is pinned.
 */

import {
  envelope,
  readHostMessage,
  type EmbedErrorCode,
  type EmbedSurface,
  type GuestMessage,
} from './protocol.ts';

export type EmbedGuestOptions = {
  surface: EmbedSurface;
  /** Origins allowed to embed and talk to this page (exact origins). */
  allowedOrigins: readonly string[];
  /** Whether the page lacks a session and wants a handoff code from the host. */
  needsAuth: boolean;
  /** Called with a validated one-time handoff code from the pinned host. */
  onHandoff?: (code: string) => void;
  /** Report content height changes (default: document.documentElement). */
  observeHeightOf?: Element | null;
};

export type EmbedGuest = {
  /** The host origin once pinned (the origin that answered, or the only allowed one). */
  readonly hostOrigin: string | null;
  saved(coursewareId: string): void;
  /** Hand the host a one-time code for the session this page just signed in. */
  signedIn(handoff: string): void;
  error(code: EmbedErrorCode, message: string): void;
  close(): void;
  stop(): void;
};

/** True when this page is framed (and not by itself). */
export function isEmbedded(win: Window = window): boolean {
  try {
    return win.parent !== win;
  } catch {
    return true;
  }
}

export function startEmbedGuest(options: EmbedGuestOptions): EmbedGuest | null {
  if (typeof window === 'undefined' || !isEmbedded() || options.allowedOrigins.length === 0) {
    return null;
  }
  const allowed = new Set(options.allowedOrigins);
  // With one allowed origin it is the host; with several, the first valid reply pins it.
  let hostOrigin: string | null = allowed.size === 1 ? [...allowed][0]! : null;

  const post = (message: GuestMessage) => {
    const targets = hostOrigin ? [hostOrigin] : [...allowed];
    for (const origin of targets) window.parent.postMessage(envelope(message), origin);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || !allowed.has(event.origin)) return;
    if (hostOrigin && event.origin !== hostOrigin) return;
    const message = readHostMessage(event.data);
    if (!message) return;
    hostOrigin = event.origin;
    options.onHandoff?.(message.handoff);
  };
  window.addEventListener('message', onMessage);

  let observer: ResizeObserver | null = null;
  const target = options.observeHeightOf ?? document.documentElement;
  if (target && typeof ResizeObserver !== 'undefined') {
    let last = -1;
    observer = new ResizeObserver(() => {
      const height = Math.ceil(target.scrollHeight);
      if (height !== last) {
        last = height;
        post({ type: 'resize', height });
      }
    });
    observer.observe(target);
  }

  post({ type: 'ready', surface: options.surface, needsAuth: options.needsAuth });

  return {
    get hostOrigin() {
      return hostOrigin;
    },
    saved: (coursewareId) => post({ type: 'saved', coursewareId }),
    signedIn: (handoff) => post({ type: 'signed-in', handoff }),
    error: (code, message) => post({ type: 'error', code, message }),
    close: () => post({ type: 'close' }),
    stop: () => {
      window.removeEventListener('message', onMessage);
      observer?.disconnect();
    },
  };
}
