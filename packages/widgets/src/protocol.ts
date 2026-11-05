// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AINOBI embed protocol v1 — the postMessage contract between a host page (the widget
 * loader) and an embedded AINOBI page (the guest runtime). Both sides validate every
 * message: the host accepts only messages whose `source` is its own iframe and whose
 * origin is the frame's origin; the guest accepts only messages from `window.parent`
 * whose origin is on its allowlist.
 *
 * Guest → host:  ready · resize · saved · signed-in · error · close
 * Host  → guest: auth (a one-time handoff code; the access token never crosses)
 */

export const EMBED_PROTOCOL = 'ainobi-embed';
export const EMBED_PROTOCOL_VERSION = 1;

export type EmbedErrorCode = 'auth_failed' | 'not_found' | 'forbidden' | 'internal';

export type GuestMessage =
  | { type: 'ready'; surface: EmbedSurface; needsAuth: boolean }
  | { type: 'resize'; height: number }
  | { type: 'saved'; coursewareId: string }
  /** The login surface signed a user in: a one-time code the host redeems for its own session. */
  | { type: 'signed-in'; handoff: string }
  | { type: 'error'; code: EmbedErrorCode; message: string }
  | { type: 'close' };

export type HostMessage = { type: 'auth'; handoff: string };

/** The AINOBI pages a host can embed. */
export type EmbedSurface = 'editor' | 'player' | 'avatar' | 'login';

export type Envelope<M> = M & { protocol: typeof EMBED_PROTOCOL; version: typeof EMBED_PROTOCOL_VERSION };

export function envelope<M extends GuestMessage | HostMessage>(message: M): Envelope<M> {
  return { ...message, protocol: EMBED_PROTOCOL, version: EMBED_PROTOCOL_VERSION };
}

const GUEST_TYPES = new Set(['ready', 'resize', 'saved', 'signed-in', 'error', 'close']);

/** Narrow untrusted `event.data` to a guest message of this protocol version. */
export function readGuestMessage(data: unknown): GuestMessage | null {
  if (!isEnvelope(data) || !GUEST_TYPES.has(String(data.type))) return null;
  const message = data as unknown as GuestMessage;
  switch (message.type) {
    case 'resize':
      return Number.isFinite(message.height) && message.height >= 0 ? message : null;
    case 'saved':
      return typeof message.coursewareId === 'string' ? message : null;
    case 'signed-in':
      return typeof message.handoff === 'string' && isSafeHandoffCode(message.handoff) ? message : null;
    case 'error':
      return typeof message.code === 'string' && typeof message.message === 'string' ? message : null;
    default:
      return message;
  }
}

/** Narrow untrusted `event.data` to a host message of this protocol version. */
export function readHostMessage(data: unknown): HostMessage | null {
  if (!isEnvelope(data) || data.type !== 'auth') return null;
  return typeof data.handoff === 'string' && isSafeHandoffCode(data.handoff)
    ? { type: 'auth', handoff: data.handoff }
    : null;
}

/** Handoff codes are base64url of 32 random bytes (43 chars) — same guard as the server. */
export function isSafeHandoffCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(code);
}

function isEnvelope(data: unknown): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).protocol === EMBED_PROTOCOL &&
    (data as Record<string, unknown>).version === EMBED_PROTOCOL_VERSION
  );
}

/** Parse an origin list ("https://a.example, https://b.example") into normalized origins. */
export function parseOriginList(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        return [new URL(entry).origin];
      } catch {
        return [];
      }
    });
}
