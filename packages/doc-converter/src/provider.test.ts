// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDocConverter,
  registerDocConverter,
  unregisterDocConverter,
  type ConvertedDocument,
  type DocConverter,
  type ExtractedDocument,
} from './provider.ts';

afterEach(() => {
  unregisterDocConverter();
});

describe('the registry', () => {
  it('returns the throwing default for an unregistered kind', async () => {
    await expect(getDocConverter('pdf_text').convert({})).rejects.toThrowError(
      /not configured/,
    );
  });

  it('round-trips an in-process extraction implementation', async () => {
    const parser: DocConverter = {
      async convert() {
        const extracted: ExtractedDocument = {
          pages: [
            { index: 0, text: 'title', notes: 'first slide' },
            { index: 1, text: 'body' },
          ],
        };
        return extracted;
      },
    };
    registerDocConverter('pptx_text', parser);
    await expect(getDocConverter('pptx_text').convert({})).resolves.toEqual({
      pages: [
        { index: 0, text: 'title', notes: 'first slide' },
        { index: 1, text: 'body' },
      ],
    });
  });

  it('round-trips a remote-service implementation', async () => {
    const service: DocConverter = {
      async convert({ key }) {
        const converted: ConvertedDocument = {
          pageCount: 2,
          pageKeys: [`artifact/pdf/${key}/html/page_1.html`, `artifact/pdf/${key}/html/page_2.html`],
          sourceKey: `raw/pdf/${key}.pdf`,
        };
        return converted;
      },
    };
    registerDocConverter('pdf2html', service);
    await expect(getDocConverter('pdf2html').convert({ key: 'abc' })).resolves.toEqual({
      pageCount: 2,
      pageKeys: ['artifact/pdf/abc/html/page_1.html', 'artifact/pdf/abc/html/page_2.html'],
      sourceKey: 'raw/pdf/abc.pdf',
    });
  });

  it('keeps kinds isolated and unregisters', async () => {
    const noop: DocConverter = { async convert() { return { pages: [] }; } };
    registerDocConverter('pdf_text', noop);
    expect(getDocConverter('pdf_text')).toBe(noop);
    await expect(getDocConverter('pptx2html').convert({})).rejects.toThrowError(/not configured/);
    unregisterDocConverter('pdf_text');
    await expect(getDocConverter('pdf_text').convert({})).rejects.toThrowError(/not configured/);
  });
});
