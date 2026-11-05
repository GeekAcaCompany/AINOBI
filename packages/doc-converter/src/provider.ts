// SPDX-License-Identifier: AGPL-3.0-only
// Document conversion capability port. Two implementation families align to this
// interface: the platform backend's in-process parsers (PDF text/page-image
// extraction, the byte-exact PPTX text extractor) and the remote pdf2html /
// pptx2html services (per-page standalone HTML, cached under artifact/ keys).
// Keeping one contract lets a deployment swap a parser for a service without
// touching callers.

import { createProviderRegistry, PortNotConfiguredError, type ProviderRegistry } from '@ainobi/port-kit';

/**
 * Kinds of the built-in converters (the platform parsers and the pdf2html / pptx2html services). The registry accepts any string, so a third party
 * registers its own kind without extending this list.
 */
export const DocConverterKind = {
  PDF_TEXT: 'pdf_text',
  PDF_PAGE_IMAGE: 'pdf_page_image',
  PPTX_TEXT: 'pptx_text',
  PDF2HTML: 'pdf2html',
  PPTX2HTML: 'pptx2html',
} as const;
export type DocConverterKind = (typeof DocConverterKind)[keyof typeof DocConverterKind];

/** Structured extraction result (in-process parsers). */

export interface ExtractedDocument {
  pages: Array<{
    index: number;
    text?: string;
    /** Page raster (page-image converters only). */
    image?: Buffer;
    /** Slide metadata (PPTX converters only). */
    title?: string;
    notes?: string;
  }>;
  [key: string]: unknown;
}

/** Conversion result for HTML-producing converters: one standalone HTML page each,
 * addressed by storage key (uploaders return the keys they wrote). */
export interface ConvertedDocument {
  pageCount: number;
  /** Storage keys of the produced pages, in order. */
  pageKeys: string[];
  /** Storage key of the original document when the converter uploads it. */
  sourceKey?: string;
  [key: string]: unknown;
}

/** Narrows a conversion result to the structured extraction of an in-process parser. */
export function isExtractedDocument(result: ExtractedDocument | ConvertedDocument): result is ExtractedDocument {
  return Array.isArray((result as ExtractedDocument).pages);
}

/** Narrows a conversion result to the stored HTML pages of an HTML-producing converter. */
export function isConvertedDocument(result: ExtractedDocument | ConvertedDocument): result is ConvertedDocument {
  return Array.isArray((result as ConvertedDocument).pageKeys);
}

export interface ConvertParams {
  /** The document bytes when converting in-process. */
  content?: Buffer;
  /** A storage key when the converter reads/writes object storage itself. */
  key?: string;
  [key: string]: unknown;
}

/**
 * The converter contract. An implementation handles one input family (PDF or
 * PPTX) and one output family (text/structure or HTML); the kind it registers
 * under names both.
 */
export interface DocConverter {
  convert(params: ConvertParams): Promise<ExtractedDocument | ConvertedDocument>;
}

/** Thrown by the default converter and by registry misses. */
export { PROVIDER_NOT_CONFIGURED } from '@ainobi/port-kit';
export { PortNotConfiguredError };
export type { ProviderRegistry };

/** This port's not-configured error; `instanceof PortNotConfiguredError` catches every port's. */
export class ProviderNotConfiguredError extends PortNotConfiguredError {
  constructor(kind: string) {
    super('Doc converter', kind);
  }
}

/** The throwing default. */
export class UnconfiguredDocConverter implements DocConverter {
  constructor(private readonly kind: string) {}
  async convert(): Promise<never> {
    throw new ProviderNotConfiguredError(this.kind);
  }
}

/**
 * Creates a converter registry owned by the caller — for hosts that keep several configurations
 * in one process, or that avoid module-level state. Unregistered kinds resolve to the throwing
 * default.
 */
export function createDocConverterRegistry(): ProviderRegistry<DocConverter> {
  return createProviderRegistry<DocConverter>((kind) => new UnconfiguredDocConverter(kind));
}

/** The process-wide default registry behind the functions below. */
const defaultRegistry = createDocConverterRegistry();

/** Register an implementation for a kind at the composition root. */
export function registerDocConverter(kind: string, converter: DocConverter): void {
  defaultRegistry.register(kind, converter);
}

/** Test hook: drop one kind (or the whole registry). */
export function unregisterDocConverter(kind?: string): void {
  defaultRegistry.unregister(kind);
}

/** Resolve a converter; an unregistered kind yields the throwing default. */
export function getDocConverter(kind: string): DocConverter {
  return defaultRegistry.get(kind);
}
