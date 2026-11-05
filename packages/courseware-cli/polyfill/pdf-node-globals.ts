// SPDX-License-Identifier: AGPL-3.0-only
/**
 * pdfjs-dist 5.x (via markitdown-ts → pdf-parse) expects browser canvas globals at module load.
 * FC Nodejs20 layer ships v20.11.0, which lacks `process.getBuiltinModule`, so pdf.js cannot
 * auto-polyfill via @napi-rs/canvas. Minimal stubs are enough for text extraction (no rendering).
 */
const g = globalThis as typeof globalThis & {
  DOMMatrix?: typeof DOMMatrix;
  ImageData?: typeof ImageData;
  Path2D?: typeof Path2D;
};

if (typeof g.DOMMatrix === 'undefined') {
  g.DOMMatrix = class DOMMatrix {
    is2D = true;
    isIdentity = true;
    transformPoint(point: unknown): unknown {
      return point;
    }
  } as unknown as typeof DOMMatrix;
}

if (typeof g.ImageData === 'undefined') {
  g.ImageData = class ImageData {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  } as unknown as typeof ImageData;
}

if (typeof g.Path2D === 'undefined') {
  g.Path2D = class Path2D {} as unknown as typeof Path2D;
}
