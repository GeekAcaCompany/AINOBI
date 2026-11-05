// SPDX-License-Identifier: AGPL-3.0-only
// Speaks the embed protocol when another page frames Studio through @ainobi/widgets. Studio signs its own pages in,
// so a frame never needs a handoff code; the server's frame-ancestors header decides who may frame it at all.
import { isEmbedded, startEmbedGuest, type EmbedGuest } from '@ainobi/widgets/guest';
import type { EmbedSurface } from '@ainobi/widgets/protocol';

const SURFACES: Array<[string, EmbedSurface]> = [
  ['/courseware-editor', 'editor'],
  ['/courseware-preview', 'player'],
  ['/embed/avatar', 'avatar'],
];

/** The surface a framed URL asks for, or null if this page was not opened as an embed. */
export function embedSurface(pathname: string, search: string): EmbedSurface | null {
  const flag = new URLSearchParams(search).get('embed');
  if (flag !== '1' && flag !== 'true') return null;
  return SURFACES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? null;
}

export function startStudioEmbed(allowedOrigins: readonly string[]): EmbedGuest | null {
  const surface = embedSurface(window.location.pathname, window.location.search);
  if (!surface || !isEmbedded()) return null;
  return startEmbedGuest({ surface, allowedOrigins, needsAuth: false });
}
