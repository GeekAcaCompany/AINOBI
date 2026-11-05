// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { createProviderRegistry, PortNotConfiguredError, PROVIDER_NOT_CONFIGURED } from './registry.ts';

describe('createProviderRegistry', () => {
  it('returns registered providers and the fallback for unknown kinds', () => {
    const registry = createProviderRegistry<string>((kind) => `fallback:${kind}`);
    registry.register('a', 'provider-a');
    expect(registry.get('a')).toBe('provider-a');
    expect(registry.get('b')).toBe('fallback:b');
    expect(registry.has('a')).toBe(true);
    expect(registry.has('b')).toBe(false);
    expect(registry.kinds()).toEqual(['a']);
  });

  it('unregisters one kind or all of them', () => {
    const registry = createProviderRegistry<string>(() => 'none');
    registry.register('a', 'x');
    registry.register('b', 'y');
    registry.unregister('a');
    expect(registry.kinds()).toEqual(['b']);
    registry.unregister();
    expect(registry.kinds()).toEqual([]);
  });

  it('keeps registries independent', () => {
    const first = createProviderRegistry<string>(() => 'none');
    const second = createProviderRegistry<string>(() => 'none');
    first.register('a', 'x');
    expect(second.has('a')).toBe(false);
  });
});

describe('PortNotConfiguredError', () => {
  it('carries the code, subject, kind, and the composition-root hint', () => {
    const error = new PortNotConfiguredError('TTS provider', 'fishaudio');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(PROVIDER_NOT_CONFIGURED);
    expect(error.name).toBe('ProviderNotConfiguredError');
    expect(error.kind).toBe('fishaudio');
    expect(error.message).toBe(
      'TTS provider "fishaudio" is not configured; register an implementation at the composition root',
    );
  });
});
