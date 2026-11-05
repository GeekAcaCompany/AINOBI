// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  countBillableCodePoints,
  getTTSProvider,
  PROVIDER_NOT_CONFIGURED,
  registerTTSProvider,
  unregisterTTSProvider,
  type TTSProvider,
} from './provider.ts';

afterEach(() => {
  unregisterTTSProvider();
});

describe('countBillableCodePoints', () => {
  it('counts code points, not UTF-16 code units', () => {
    expect(countBillableCodePoints('hello')).toBe(5);
    // 😀 is one character but two UTF-16 code units.
    expect(countBillableCodePoints('a😀b')).toBe(3);
    expect('a😀b'.length).toBe(4);
  });
});

describe('the registry', () => {
  it('returns the throwing default for an unregistered kind', async () => {
    const provider = getTTSProvider('fishaudio');
    await expect(provider.textToSpeech({} as never)).rejects.toThrowError(/not configured/);
    expect(() => provider.get_service_code()).toThrowError(/not configured/);
  });

  it('round-trips a registered implementation', async () => {
    const fake: TTSProvider = {
      model: 'test-model',
      async textToSpeech() {
        return Buffer.from('audio');
      },
      async close() {},
      get_service_code: () => 'tts_test',
      get_billable_units: (text) => countBillableCodePoints(text),
    };
    registerTTSProvider('fishaudio', fake);
    expect(getTTSProvider('fishaudio')).toBe(fake);
    await expect(getTTSProvider('fishaudio').textToSpeech({} as never)).resolves.toEqual(
      Buffer.from('audio'),
    );
  });

  it('keeps kinds isolated', () => {
    const fake: TTSProvider = {
      model: 'm',
      async textToSpeech() {
        return Buffer.alloc(0);
      },
      async close() {},
      get_service_code: () => 'x',
      get_billable_units: () => 0,
    };
    registerTTSProvider('minimax', fake);
    expect(getTTSProvider('minimax')).toBe(fake);
    expect(getTTSProvider('google').model).toBe('unconfigured');
    unregisterTTSProvider('minimax');
    expect(getTTSProvider('minimax').model).toBe('unconfigured');
  });

  it('exposes the stable error code', () => {
    expect(PROVIDER_NOT_CONFIGURED).toBe('PROVIDER_NOT_CONFIGURED');
  });
});
