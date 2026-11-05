// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCapabilityStore } from './store.ts';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createCapabilityStore', () => {
  it('starts unloaded with nothing available', () => {
    const store = createCapabilityStore();
    expect(store.isLoaded()).toBe(false);
    expect(store.isAvailable('tts.fishaudio')).toBe(false);
    expect(store.getStatus('tts.fishaudio')).toBeUndefined();
  });

  it('loads capabilities from the API', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 0,
          data: {
            'tts.fishaudio': { available: true, package: 'tts.fishaudio', label: 'Fish Audio TTS' },
            'billing.stripe': { available: false, package: 'billing.stripe', label: 'Stripe', reason: 'not configured' },
          },
        }),
    });

    const store = createCapabilityStore();
    await store.load('http://localhost:8000/v1');
    expect(store.isLoaded()).toBe(true);
    expect(store.isAvailable('tts.fishaudio')).toBe(true);
    expect(store.isAvailable('billing.stripe')).toBe(false);
    expect(store.getStatus('billing.stripe')?.reason).toBe('not configured');
  });

  it('fail-opens to empty map on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const store = createCapabilityStore();
    await store.load('http://localhost:9999');
    expect(store.isLoaded()).toBe(true);
    expect(store.isAvailable('anything')).toBe(false);
  });
});
