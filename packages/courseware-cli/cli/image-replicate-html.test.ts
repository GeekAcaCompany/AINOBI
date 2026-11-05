// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { extractHtmlFromModelText } from "./image-replicate-html.ts";

test("extractHtmlFromModelText strips fenced html block", () => {
  const raw = "```html\n<div class=\"slide\">Hello</div>\n```";
  assert.equal(extractHtmlFromModelText(raw), '<div class="slide">Hello</div>');
});

test("extractHtmlFromModelText returns trimmed plain html", () => {
  const raw = "  <!DOCTYPE html><html><body></body></html>  ";
  assert.match(extractHtmlFromModelText(raw), /<!DOCTYPE html>/);
});

test("extractHtmlFromModelText strips opening fence without closing marker on last line", () => {
  const raw = "```html\n<p>Line</p>\n```";
  assert.equal(extractHtmlFromModelText(raw), "<p>Line</p>");
});
