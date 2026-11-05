// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  createDocConverterRegistry,
  getDocConverter,
  isConvertedDocument,
  isExtractedDocument,
  PortNotConfiguredError,
  ProviderNotConfiguredError,
  registerDocConverter,
  unregisterDocConverter,
  type DocConverter,
} from './provider.ts';

const converter: DocConverter = { convert: async () => ({ pageCount: 1, pageKeys: ['a.html'] }) };

describe('doc-converter registry', () => {
  it('keeps the default registry behind the register/get functions', async () => {
    registerDocConverter('pptx2html', converter);
    expect(getDocConverter('pptx2html')).toBe(converter);
    unregisterDocConverter('pptx2html');
    await expect(getDocConverter('pptx2html').convert({})).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('fails unregistered kinds with the port error, catchable through the shared base', async () => {
    const error = await getDocConverter('nope').convert({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PortNotConfiguredError);
    expect((error as Error).message).toBe(
      'Doc converter "nope" is not configured; register an implementation at the composition root',
    );
  });

  it('lets callers own an independent registry', () => {
    const registry = createDocConverterRegistry();
    registry.register('pdf2html', converter);
    expect(registry.get('pdf2html')).toBe(converter);
    expect(getDocConverter('pdf2html')).not.toBe(converter);
  });
});

describe('result guards', () => {
  it('tells extracted documents from converted ones', () => {
    expect(isExtractedDocument({ pages: [{ index: 0, text: 'x' }] })).toBe(true);
    expect(isConvertedDocument({ pages: [] })).toBe(false);
    expect(isConvertedDocument({ pageCount: 1, pageKeys: ['k'] })).toBe(true);
    expect(isExtractedDocument({ pageCount: 1, pageKeys: ['k'] })).toBe(false);
  });
});
