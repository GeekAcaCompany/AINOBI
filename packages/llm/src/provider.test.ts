// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  getLLMProvider,
  registerLLMProvider,
  unregisterLLMProvider,
  type CompletionResult,
  type BaseLLMProvider,
  type StreamChunk,
} from './provider.ts';

afterEach(() => {
  unregisterLLMProvider();
});

function fakeProvider(overrides: Partial<BaseLLMProvider> = {}): BaseLLMProvider {
  return {
    model: 'test-model',
    async *create_completion_stream(): AsyncGenerator<StreamChunk, void, undefined> {
      yield { content: 'hello' };
      yield { finish_reason: 'stop' };
    },
    async create_completion(): Promise<CompletionResult> {
      return { content: 'hello', finish_reason: 'stop' };
    },
    async close() {},
    supports_tools: () => true,
    supports_thinking: () => false,
    ...overrides,
  };
}

describe('the registry', () => {
  it('returns the throwing default for an unregistered kind', async () => {
    const provider = getLLMProvider('openai');
    await expect(async () => {
      for await (const _ of provider.create_completion_stream({ messages: [] })) void _;
    }).rejects.toThrowError(/not configured/);
    await expect(provider.create_completion({ messages: [] })).rejects.toThrowError(
      /not configured/,
    );
    expect(() => provider.supports_tools()).toThrowError(/not configured/);
  });

  it('round-trips a registered implementation', async () => {
    const fake = fakeProvider();
    registerLLMProvider('deepseek', fake);
    expect(getLLMProvider('deepseek')).toBe(fake);
    const chunks: StreamChunk[] = [];
    for await (const chunk of getLLMProvider('deepseek').create_completion_stream({
      messages: [],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ content: 'hello' }, { finish_reason: 'stop' }]);
    await expect(
      getLLMProvider('deepseek').create_completion({ messages: [] }),
    ).resolves.toEqual({ content: 'hello', finish_reason: 'stop' });
  });

  it('keeps kinds isolated and unregisters', () => {
    const fake = fakeProvider({ model: 'other' });
    registerLLMProvider('xai', fake);
    expect(getLLMProvider('xai').model).toBe('other');
    expect(getLLMProvider('openai').model).toBe('unconfigured');
    unregisterLLMProvider('xai');
    expect(getLLMProvider('xai').model).toBe('unconfigured');
  });
});
