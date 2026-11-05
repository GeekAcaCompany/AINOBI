// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Host-side loader: mounts an AINOBI page in an iframe and speaks the embed protocol.
 * Framework-agnostic (plain DOM); the custom elements and any Vue/React host use it.
 * The frame is built with DOM APIs (never innerHTML), so attribute values cannot inject
 * markup into the host page.
 */

import {
  envelope,
  readGuestMessage,
  type EmbedErrorCode,
  type EmbedSurface,
  type GuestMessage,
} from './protocol.ts';

export type EmbedOptions = {
  /** Base URL of the AINOBI web app (e.g. https://app.example.com). */
  baseUrl: string;
  surface: EmbedSurface;
  /** Courseware to open (editor / player). */
  coursewareId?: string;
  /** Extra query parameters for the page (e.g. slide, lang). */
  params?: Record<string, string>;
  /**
   * Supplies a one-time handoff code when the page asks for auth (see the platform's
   * POST /embed/handoff). Called after the frame is ready, so codes are never in a URL.
   */
  getHandoff?: () => Promise<string | null>;
  /** Follow the page's content height instead of a fixed height. */
  autoResize?: boolean;
  /** Fixed or minimum height (CSS length), default by surface. */
  height?: string;
  title?: string;
};

export type EmbedEvents = {
  ready: { needsAuth: boolean };
  resize: { height: number };
  saved: { coursewareId: string };
  signedIn: { handoff: string };
  error: { code: EmbedErrorCode; message: string };
  close: Record<string, never>;
};

export type EmbedController = {
  readonly iframe: HTMLIFrameElement;
  on<K extends keyof EmbedEvents>(event: K, listener: (detail: EmbedEvents[K]) => void): () => void;
  destroy(): void;
};

const SURFACE_PATH: Record<EmbedSurface, string> = {
  editor: '/courseware-editor',
  player: '/courseware-preview',
  avatar: '/embed/avatar',
  login: '/login',
};

const SURFACE_HEIGHT: Record<EmbedSurface, string> = {
  editor: '720px',
  player: '540px',
  avatar: '520px',
  login: '560px',
};

const SURFACE_ALLOW: Record<EmbedSurface, string> = {
  editor: 'clipboard-read; clipboard-write; fullscreen',
  player: 'fullscreen; autoplay',
  avatar: 'microphone; autoplay',
  login: '',
};

/** The frame URL for a surface: only http(s) bases are accepted. */
export function buildEmbedUrl(options: Pick<EmbedOptions, 'baseUrl' | 'surface' | 'coursewareId' | 'params'>): URL {
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error(`AINOBI embed: unsupported base URL protocol ${base.protocol}`);
  }
  const url = new URL(SURFACE_PATH[options.surface], base);
  url.searchParams.set('embed', '1');
  if (options.coursewareId) url.searchParams.set('courseware_id', options.coursewareId);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (key !== 'session' && key !== 'handoff') url.searchParams.set(key, value);
  }
  return url;
}

export function mountEmbed(container: HTMLElement | ShadowRoot, options: EmbedOptions): EmbedController {
  const url = buildEmbedUrl(options);
  const frameOrigin = url.origin;
  const iframe = document.createElement('iframe');
  iframe.src = url.href;
  iframe.title = options.title ?? `AINOBI ${options.surface}`;
  iframe.setAttribute('allow', SURFACE_ALLOW[options.surface]);
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.style.cssText = `display:block;width:100%;border:0;height:${options.height ?? SURFACE_HEIGHT[options.surface]}`;
  container.appendChild(iframe);

  const listeners = new Map<keyof EmbedEvents, Set<(detail: never) => void>>();
  const emit = <K extends keyof EmbedEvents>(event: K, detail: EmbedEvents[K]) => {
    for (const listener of listeners.get(event) ?? []) (listener as (d: EmbedEvents[K]) => void)(detail);
  };

  const sendAuth = async () => {
    const handoff = await options.getHandoff?.();
    if (handoff && iframe.contentWindow) {
      iframe.contentWindow.postMessage(envelope({ type: 'auth', handoff }), frameOrigin);
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== frameOrigin) return;
    const message: GuestMessage | null = readGuestMessage(event.data);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        emit('ready', { needsAuth: message.needsAuth });
        if (message.needsAuth) void sendAuth();
        break;
      case 'resize':
        if (options.autoResize) iframe.style.height = `${Math.ceil(message.height)}px`;
        emit('resize', { height: message.height });
        break;
      case 'saved':
        emit('saved', { coursewareId: message.coursewareId });
        break;
      case 'signed-in':
        emit('signedIn', { handoff: message.handoff });
        break;
      case 'error':
        emit('error', { code: message.code, message: message.message });
        break;
      case 'close':
        emit('close', {});
        break;
    }
  };
  window.addEventListener('message', onMessage);

  return {
    iframe,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (detail: never) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (detail: never) => void);
    },
    destroy() {
      window.removeEventListener('message', onMessage);
      listeners.clear();
      iframe.remove();
    },
  };
}
