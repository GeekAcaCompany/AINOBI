// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractEmbeddedImagesFromHtml,
  selectRepresentativeSlideNumbers,
} from "./design-template-document-slides.ts";

describe("design-template-document-slides", () => {
  it("selectRepresentativeSlideNumbers picks first, middle, and last", () => {
    assert.deepEqual(selectRepresentativeSlideNumbers(10, 3), [1, 5, 10]);
    assert.deepEqual(selectRepresentativeSlideNumbers(2, 3), [1, 2]);
    assert.deepEqual(selectRepresentativeSlideNumbers(0, 3), []);
  });

  it("extractEmbeddedImagesFromHtml returns largest image first", () => {
    const small = Buffer.from("small").toString("base64");
    const large = Buffer.alloc(120, 1).toString("base64");
    const html = `
      <img src="data:image/png;base64,${small}" />
      <div style="background:url(data:image/jpeg;base64,${large})"></div>
    `;
    const images = extractEmbeddedImagesFromHtml(html);
    assert.equal(images.length, 2);
    assert.ok((images[0]?.bytes ?? 0) >= (images[1]?.bytes ?? 0));
    assert.equal(images[0]?.mimeType, "image/jpeg");
  });
});
