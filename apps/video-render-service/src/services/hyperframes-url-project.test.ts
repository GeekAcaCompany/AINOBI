// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import test from "node:test";

import { buildHyperframesRedirectProject } from "./hyperframes-url-project.ts";

test("buildHyperframesRedirectProject omits data-duration when durationSec is 0", () => {
  const dir = buildHyperframesRedirectProject({
    targetUrl: "http://localhost:5173/courseware-renderer?hf=1",
    width: 1920,
    height: 1080,
    durationSec: 0,
    compositionId: "courseware",
  });

  try {
    const html = readFileSync(`${dir}/index.html`, "utf8");
    assert.doesNotMatch(html, /data-duration=/);
    assert.match(html, /data-composition-id="courseware"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildHyperframesRedirectProject includes data-duration when durationSec is positive", () => {
  const dir = buildHyperframesRedirectProject({
    targetUrl: "https://example.com",
    width: 1280,
    height: 720,
    durationSec: 10,
  });

  try {
    const html = readFileSync(`${dir}/index.html`, "utf8");
    assert.match(html, /data-duration="10"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
