// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineAinobiElements, type AinobiEditorElement } from './elements.ts';
import { buildEmbedUrl, mountEmbed } from './loader.ts';
import { envelope, parseOriginList, readGuestMessage, readHostMessage } from './protocol.ts';

const CODE = 'a'.repeat(43);

/** Deliver a message to the window as if it came from `source` at `origin`. */
function deliver(data: unknown, origin: string, source: MessageEventSource | null) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('protocol', () => {
  it('accepts only versioned, well-formed messages', () => {
    expect(readGuestMessage(envelope({ type: 'resize', height: 300 }))).toEqual(
      expect.objectContaining({ type: 'resize', height: 300 }),
    );
    expect(readGuestMessage({ type: 'resize', height: 300 })).toBeNull();
    expect(readGuestMessage(envelope({ type: 'resize', height: -1 }))).toBeNull();
    expect(readHostMessage(envelope({ type: 'auth', handoff: CODE }))).toEqual({ type: 'auth', handoff: CODE });
    expect(readHostMessage(envelope({ type: 'auth', handoff: 'short' }))).toBeNull();
  });

  it('normalizes origin lists', () => {
    expect(parseOriginList('https://a.example/x, https://b.example nonsense')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

describe('loader', () => {
  it('builds a frame URL without identity parameters', () => {
    const url = buildEmbedUrl({
      baseUrl: 'https://app.example',
      surface: 'editor',
      coursewareId: 'cw 1',
      params: { session: 'tok', handoff: 'x', slide: '2' },
    });
    expect(url.href).toBe('https://app.example/courseware-editor?embed=1&courseware_id=cw+1&slide=2');
    expect(() => buildEmbedUrl({ baseUrl: 'javascript:alert(1)', surface: 'player' })).toThrow();
  });

  it('answers ready with a handoff only to its own frame, and ignores other sources', async () => {
    const getHandoff = vi.fn(async () => CODE);
    const controller = mountEmbed(document.body, {
      baseUrl: 'https://app.example',
      surface: 'player',
      coursewareId: 'cw',
      getHandoff,
      autoResize: true,
    });
    const frameWindow = controller.iframe.contentWindow!;
    const posted = vi.spyOn(frameWindow, 'postMessage').mockImplementation(() => {});
    const ready = vi.fn();
    controller.on('ready', ready);

    deliver(envelope({ type: 'ready', surface: 'player', needsAuth: true }), 'https://evil.example', frameWindow);
    deliver(envelope({ type: 'ready', surface: 'player', needsAuth: true }), 'https://app.example', window);
    expect(ready).not.toHaveBeenCalled();

    deliver(envelope({ type: 'ready', surface: 'player', needsAuth: true }), 'https://app.example', frameWindow);
    await vi.waitFor(() => expect(posted).toHaveBeenCalled());
    expect(posted).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth', handoff: CODE }),
      'https://app.example',
    );

    deliver(envelope({ type: 'resize', height: 812.4 }), 'https://app.example', frameWindow);
    expect(controller.iframe.style.height).toBe('813px');
    controller.destroy();
    expect(document.body.querySelector('iframe')).toBeNull();
  });
});

describe('custom elements', () => {
  it('render the frame safely and re-dispatch protocol events', () => {
    defineAinobiElements();
    const payload = '"><img src=x onerror=alert(1)>';
    const el = document.createElement('ainobi-editor') as AinobiEditorElement;
    el.setAttribute('base-url', 'https://app.example');
    el.setAttribute('courseware-id', payload);
    document.body.appendChild(el);
    const iframe = el.shadowRoot!.querySelector('iframe')!;
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(new URL(iframe.src).searchParams.get('courseware_id')).toBe(payload);

    const saved = vi.fn();
    el.addEventListener('ainobi-saved', (event) => saved((event as CustomEvent).detail));
    deliver(envelope({ type: 'saved', coursewareId: 'cw' }), 'https://app.example', iframe.contentWindow);
    expect(saved).toHaveBeenCalledWith({ coursewareId: 'cw' });
  });

  it('shows a hint instead of a frame without required attributes', () => {
    defineAinobiElements();
    const el = document.createElement('ainobi-player');
    document.body.appendChild(el);
    expect(el.shadowRoot!.querySelector('iframe')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain('base-url');
  });
});

describe('sign-in hand-back', () => {
  it('re-dispatches a valid signed-in code from the login frame and drops malformed ones', () => {
    defineAinobiElements();
    const el = document.createElement('ainobi-login');
    el.setAttribute('base-url', 'https://app.example');
    document.body.appendChild(el);
    const iframe = el.shadowRoot!.querySelector('iframe')!;
    expect(new URL(iframe.src).pathname).toBe('/login');

    const signedIn = vi.fn();
    el.addEventListener('ainobi-signed-in', (event) => signedIn((event as CustomEvent).detail));
    deliver(envelope({ type: 'signed-in', handoff: 'not-a-code' }), 'https://app.example', iframe.contentWindow);
    deliver(envelope({ type: 'signed-in', handoff: CODE }), 'https://evil.example', iframe.contentWindow);
    expect(signedIn).not.toHaveBeenCalled();
    deliver(envelope({ type: 'signed-in', handoff: CODE }), 'https://app.example', iframe.contentWindow);
    expect(signedIn).toHaveBeenCalledWith({ handoff: CODE });
  });
});

describe('organization context', () => {
  it('passes org-id to the embedded page', () => {
    defineAinobiElements();
    const el = document.createElement('ainobi-editor');
    el.setAttribute('base-url', 'https://app.example');
    el.setAttribute('courseware-id', 'cw');
    el.setAttribute('org-id', 'org-1');
    document.body.appendChild(el);
    const url = new URL(el.shadowRoot!.querySelector('iframe')!.src);
    expect(url.searchParams.get('org_id')).toBe('org-1');
  });

  it('passes model-url to the avatar page', () => {
    defineAinobiElements();
    const el = document.createElement('ainobi-avatar');
    el.setAttribute('base-url', 'https://app.example');
    el.setAttribute('model-url', 'https://cdn.example/teacher.inx');
    document.body.appendChild(el);
    const url = new URL(el.shadowRoot!.querySelector('iframe')!.src);
    expect(url.pathname).toBe('/embed/avatar');
    expect(url.searchParams.get('model_url')).toBe('https://cdn.example/teacher.inx');
  });
});
