// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEmbedGuest, type EmbedGuest } from './guest.ts';
import { envelope } from './protocol.ts';

const CODE = 'b'.repeat(43);
let guest: EmbedGuest | null = null;

function framedBy(parent: Window) {
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
}

function deliver(data: unknown, origin: string, source: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource }));
}

afterEach(() => {
  guest?.stop();
  guest = null;
  vi.restoreAllMocks();
});

describe('embed guest', () => {
  it('stays inert when not framed or without an allowlist', () => {
    expect(startEmbedGuest({ surface: 'editor', allowedOrigins: ['https://host.example'], needsAuth: false })).toBeNull();
    framedBy({ postMessage: vi.fn() } as unknown as Window);
    expect(startEmbedGuest({ surface: 'editor', allowedOrigins: [], needsAuth: false })).toBeNull();
  });

  it('announces ready to the allowed origin and takes a handoff only from the parent there', () => {
    const parent = { postMessage: vi.fn() } as unknown as Window;
    framedBy(parent);
    const onHandoff = vi.fn();
    guest = startEmbedGuest({
      surface: 'editor',
      allowedOrigins: ['https://host.example'],
      needsAuth: true,
      onHandoff,
      observeHeightOf: null,
    });
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ready', surface: 'editor', needsAuth: true }),
      'https://host.example',
    );

    deliver(envelope({ type: 'auth', handoff: CODE }), 'https://evil.example', parent);
    deliver(envelope({ type: 'auth', handoff: CODE }), 'https://host.example', window);
    expect(onHandoff).not.toHaveBeenCalled();

    deliver(envelope({ type: 'auth', handoff: CODE }), 'https://host.example', parent);
    expect(onHandoff).toHaveBeenCalledWith(CODE);

    guest!.saved('cw-1');
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'saved', coursewareId: 'cw-1' }),
      'https://host.example',
    );
  });
});
