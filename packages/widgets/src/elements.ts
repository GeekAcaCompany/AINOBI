// SPDX-License-Identifier: AGPL-3.0-only
/**
 * <ainobi-editor>, <ainobi-player>, <ainobi-avatar>, <ainobi-login> — custom elements over
 * the loader, for hosts in any framework (or none).
 *
 * Attributes: `base-url` (the AINOBI web app; `src` is accepted as an alias),
 * `courseware-id` (`course-id` alias), `org-id` (the organization the page works in, e.g. where
 * a new courseware is created), `model-url` (avatar only: a model the frame can render, such as an
 * Inochi2D `.inx`; omitted, the frame uses the user's configured model), `height`, `auto-resize`,
 * `handoff` (a one-time code, delivered over postMessage — never placed in the frame URL).
 * Property: `handoffProvider: () => Promise<string | null>` mints a code on demand.
 * Events (bubbling, composed): `ainobi-ready`, `ainobi-resize`, `ainobi-saved`,
 * `ainobi-signed-in` (login: `detail.handoff` to redeem), `ainobi-error`, `ainobi-close`, each with the protocol payload in `detail`.
 */

import { mountEmbed, type EmbedController, type EmbedEvents } from './loader.ts';
import type { EmbedSurface } from './protocol.ts';

const EVENTS: (keyof EmbedEvents)[] = ['ready', 'resize', 'saved', 'signedIn', 'error', 'close'];

/** DOM event name per protocol event (`signedIn` → `ainobi-signed-in`). */
const eventName = (event: keyof EmbedEvents) => `ainobi-${event.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// Custom elements need a DOM; guard the base class so the module also loads under SSR/Node.
const ElementBase = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

export class AinobiEmbedElement extends ElementBase {
  static surface: EmbedSurface = 'player';
  static observedAttributes = ['base-url', 'src', 'courseware-id', 'course-id', 'org-id', 'model-url', 'height', 'auto-resize'];

  /** Mints a one-time handoff code when the embedded page asks for auth. */
  handoffProvider: (() => Promise<string | null>) | null = null;

  private controller: EmbedController | null = null;
  private readonly root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.mount();
  }

  disconnectedCallback(): void {
    this.controller?.destroy();
    this.controller = null;
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.mount();
  }

  private mount(): void {
    this.controller?.destroy();
    this.controller = null;
    this.root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = ':host{display:block;width:100%}.hint{padding:1.25rem;font:13px system-ui,sans-serif;color:#64748b;border:1px dashed #cbd5e1;border-radius:10px;text-align:center}';
    this.root.appendChild(style);

    const surface = (this.constructor as typeof AinobiEmbedElement).surface;
    const baseUrl = this.getAttribute('base-url') ?? this.getAttribute('src');
    const coursewareId = this.getAttribute('courseware-id') ?? this.getAttribute('course-id') ?? undefined;
    if (!baseUrl || ((surface === 'editor' || surface === 'player') && !coursewareId)) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = `AINOBI ${surface}: set base-url${surface === 'editor' || surface === 'player' ? ' and courseware-id' : ''}.`;
      this.root.appendChild(hint);
      return;
    }

    try {
      this.controller = mountEmbed(this.root, {
        baseUrl,
        surface,
        coursewareId,
        params: (() => {
          const orgId = this.getAttribute('org-id');
          const modelUrl = this.getAttribute('model-url');
          if (!orgId && !modelUrl) return undefined;
          return {
            ...(orgId ? { org_id: orgId } : {}),
            ...(modelUrl ? { model_url: modelUrl } : {}),
          };
        })(),
        height: this.getAttribute('height') ?? undefined,
        autoResize: this.hasAttribute('auto-resize'),
        getHandoff: async () => {
          if (this.handoffProvider) return this.handoffProvider();
          const once = this.getAttribute('handoff');
          // A handoff code is single-use: hand it over once, then forget it.
          this.removeAttribute('handoff');
          return once;
        },
      });
    } catch (error) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = error instanceof Error ? error.message : String(error);
      this.root.appendChild(hint);
      return;
    }
    for (const event of EVENTS) {
      this.controller.on(event, (detail) => {
        this.dispatchEvent(new CustomEvent(eventName(event), { detail, bubbles: true, composed: true }));
      });
    }
  }
}

export class AinobiEditorElement extends AinobiEmbedElement {
  static override surface: EmbedSurface = 'editor';
}
export class AinobiPlayerElement extends AinobiEmbedElement {
  static override surface: EmbedSurface = 'player';
}
export class AinobiAvatarElement extends AinobiEmbedElement {
  static override surface: EmbedSurface = 'avatar';
}
export class AinobiLoginElement extends AinobiEmbedElement {
  static override surface: EmbedSurface = 'login';
}

/** Define the elements (idempotent). */
export function defineAinobiElements(registry: CustomElementRegistry | undefined = globalThis.customElements): void {
  if (!registry) return;
  const elements: [string, CustomElementConstructor][] = [
    ['ainobi-editor', AinobiEditorElement],
    ['ainobi-player', AinobiPlayerElement],
    ['ainobi-avatar', AinobiAvatarElement],
    ['ainobi-login', AinobiLoginElement],
  ];
  for (const [tag, ctor] of elements) {
    if (!registry.get(tag)) registry.define(tag, ctor);
  }
}
