// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vision gate unit tests — anchor validation rules one by one, patch bbox goldens, review image/contact sheet structure,
 * client structured parsing (JSON extraction/retry cadence/schema validation).
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Raster } from "./image.ts";
import { createRaster, fillRectangle, getPixel } from "./image.ts";
import {
  LandmarksSchema,
  MIN_VISION_CONFIDENCE,
  VisionClient,
  imageSha256,
  landmarksPatchBbox,
  makePixelBox,
  makeFinalContactSheet,
  makeVariantReviewSheet,
  validateLandmarks,
  type FinalAssessment,
  type Landmarks,
  type VariantAssessment,
} from "./vision.ts";

/** Baseline valid anchors (synthetic character 1024x1024) */
function baseLandmarks(overrides: Partial<Landmarks> = {}): Landmarks {
  return {
    source: "fixture",
    model: "synthetic-test",
    image_sha256: "a".repeat(64),
    head_bbox: makePixelBox(400, 100, 624, 370),
    mouth_bbox: makePixelBox(480, 225, 544, 255),
    lip_center: { x: 512, y: 242 },
    chin_y: 330,
    confidence: 1.0,
    issues: [],
    ...overrides,
  };
}

test("makePixelBox: 非正宽高拒绝", () => {
  assert.throws(() => makePixelBox(10, 10, 10, 20), /positive width/);
  assert.throws(() => makePixelBox(10, 10, 5, 20), /positive width/);
});

test("validateLandmarks: 合法锚点通过", () => {
  validateLandmarks(baseLandmarks(), [1024, 1024]);
});

test("validateLandmarks: 逐条拒绝规则", () => {
  const size: [number, number] = [1024, 1024];
  // Head box out of bounds
  assert.throws(
    () => validateLandmarks(baseLandmarks({ head_bbox: makePixelBox(0, 0, 2000, 300) }), size),
    /head bbox is outside/,
  );
  // Lip point outside the head box
  assert.throws(
    () => validateLandmarks(baseLandmarks({ lip_center: { x: 100, y: 110 } }), size),
    /lip center is outside the head bbox/,
  );
  // Lip point contradicts the mouth box
  assert.throws(
    () => validateLandmarks(baseLandmarks({ lip_center: { x: 512, y: 150 } }), size),
    /inconsistent with the mouth bbox/,
  );
  // Mouth box horizontally outside the head box (the lip point is still inside the mouth box, the midpoint exits the head box)
  assert.throws(
    () => validateLandmarks(baseLandmarks({ mouth_bbox: makePixelBox(500, 225, 760, 255) }), size),
    /horizontally outside the head/,
  );
  // Implausible vertical mouth position (too high — still within the mouth box tolerance, but < 0.42 of the head box)
  assert.throws(
    () => validateLandmarks(baseLandmarks({ lip_center: { x: 512, y: 200 } }), size),
    /implausible vertical position/,
  );
  // The chin line must hug the area below the lips
  assert.throws(
    () => validateLandmarks(baseLandmarks({ chin_y: 242 }), size),
    /chin_y must be below the lips/,
  );
  assert.throws(
    () => validateLandmarks(baseLandmarks({ chin_y: 500 }), size),
    /chin_y must be below the lips/,
  );
  // Confidence below threshold
  assert.throws(
    () =>
      validateLandmarks(
        baseLandmarks({ confidence: MIN_VISION_CONFIDENCE - 0.01 }),
        size,
      ),
    /confidence/,
  );
  // sha isn't lowercase hex
  assert.throws(
    () => validateLandmarks(baseLandmarks({ image_sha256: "XYZ" }), size),
    /lowercase SHA-256/,
  );
  // Doesn't match the expected sha
  assert.throws(
    () => validateLandmarks(baseLandmarks(), size, "b".repeat(64)),
    /SHA-256 mismatch/,
  );
});

test("landmarksPatchBbox: 面部相对嘴部贴片黄金（参考实现实测）", () => {
  const patch = landmarksPatchBbox(baseLandmarks(), [1024, 1024]);
  assert.deepEqual(patch, [435, 201, 589, 335]);
});

test("LandmarksSchema: 解析 + issues 默认空数组", () => {
  const parsed = LandmarksSchema.parse({
    source: "fixture",
    model: "m",
    image_sha256: "a".repeat(64),
    head_bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
    mouth_bbox: { x0: 1, y0: 2, x1: 3, y1: 4 },
    lip_center: { x: 2, y: 3 },
    chin_y: 4,
    confidence: 0.9,
  });
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.source, "fixture");
});

test("imageSha256: 64 位小写 hex 且逐字节确定", () => {
  const raster = createRaster(16, 16, [10, 20, 30, 255]);
  const sha = imageSha256(raster);
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(imageSha256(raster), sha);
});

// ---------------------------------------------------------------------------
// Review image / contact sheet
// ---------------------------------------------------------------------------

function smallScene(): { base: Raster; aligned: Raster } {
  const base = createRaster(64, 64, [0, 255, 0, 255]);
  fillRectangle(base, [10, 10, 40, 50], [200, 100, 60, 255]);
  const aligned = createRaster(64, 64, [0, 255, 0, 255]);
  fillRectangle(aligned, [10, 10, 40, 50], [200, 100, 60, 255]);
  fillRectangle(aligned, [20, 30, 30, 40], [40, 10, 20, 255]);
  return { base, aligned };
}

test("makeVariantReviewSheet: 1024x1024 四宫格 + 检出红框", () => {
  const { base, aligned } = smallScene();
  const sheet = makeVariantReviewSheet(base, aligned, [18, 26, 34, 44], [20, 30, 30, 40]);
  assert.equal(sheet.width, 1024);
  assert.equal(sheet.height, 1024);
  // Bottom-left cell = base image mouth zoom (in this synthetic scene the patch lies entirely within the body rectangle)
  assert.deepEqual(getPixel(sheet, 2, 1022).slice(0, 3), [200, 100, 60]);
  // Red box pixels (255,30,30) exist in the zoom area (bottom-right cell)
  let hasRed = false;
  for (let y = 512; y < 1024 && !hasRed; y++) {
    for (let x = 512; x < 1024; x++) {
      const p = getPixel(sheet, x, y);
      if (p[0] === 255 && p[1] === 30 && p[2] === 30) {
        hasRed = true;
        break;
      }
    }
  }
  assert.ok(hasRed, "detected-changed rectangle must be drawn");
});

test("makeFinalContactSheet: 1536x1024 五面板", () => {
  const { base, aligned } = smallScene();
  const frames = [0, 1, 2].map(() => createRaster(16, 12, [120, 80, 90, 255]));
  const sheet = makeFinalContactSheet(base, aligned, frames);
  assert.equal(sheet.width, 1536);
  assert.equal(sheet.height, 1024);
  // Checkerboard panel: light/dark alternates by the parity of (x//24 + y//24) (the top rows 0..27 are the annotation bar)
  const light = getPixel(sheet, 5, 60);
  assert.deepEqual([light[0], light[1], light[2]], [225, 225, 225]);
  const dark = getPixel(sheet, 5, 40);
  assert.deepEqual([dark[0], dark[1], dark[2]], [170, 170, 170]);
});

// ---------------------------------------------------------------------------
// Client (injected stubs: structured parsing/retry cadence)
// ---------------------------------------------------------------------------

function okVariant(overrides: Partial<VariantAssessment> = {}): VariantAssessment {
  return {
    accepted: true,
    same_character_and_pose: true,
    only_mouth_changed_semantically: true,
    mouth_clearly_open: true,
    dark_cavity_visible: true,
    detected_box_is_on_mouth: true,
    confidence: 0.95,
    issues: [],
    ...overrides,
  };
}

test("VisionClient: 结构化解析（markdown 围栏容忍 + schema 校验失败重试）", async () => {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const client = new VisionClient(
    { apiKey: "test-key", apiBase: null, imageModel: "img", visionModel: "vision-m" },
    {
      complete: async ({ messages }) => {
        const parts = messages[0]!.content as Array<Record<string, unknown>>;
        calls.push(parts.filter((part) => part.type === "text").map((part) => String(part.text)).join(" "));
        if (calls.length === 1) {
          return { content: "前置噪声 ```json\n{\"accepted\": false}\n``` 后缀" };
        }
        if (calls.length === 2) {
          return { content: '{"accepted": "not-a-bool"}' };
        }
        return { content: JSON.stringify(okVariant()) };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  const sheet = createRaster(8, 8, [0, 0, 0, 255]);
  const assessment = await client.reviewVariant(sheet);
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.confidence, 0.95);
  // Two failures, then success on the third; waits of 2s, 4s
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 4000]);
  // The message contains the JSON schema instruction and multimodal images
  const firstCall = calls[0]!;
  assert.ok(firstCall.includes("JSON Schema"));
});

test("VisionClient: 全部尝试失败 → 管线级错误", async () => {
  const client = new VisionClient(
    { apiKey: "test-key", apiBase: null, imageModel: "img", visionModel: "vision-m" },
    {
      complete: async () => ({ content: "no json here" }),
      sleep: async () => undefined,
    },
  );
  await assert.rejects(
    () => client.reviewFinal(createRaster(4, 4, [0, 0, 0, 255])),
    /vision gate FinalAssessment failed after 3 attempts/,
  );
});

test("VisionClient: locateLandmarks 证据落盘（face_crop + localization.json）", async () => {
  const base = createRaster(128, 128, [10, 200, 60, 255]);
  fillRectangle(base, [40, 30, 88, 120], [240, 200, 170, 255]);
  fillRectangle(base, [58, 84, 70, 88], [120, 40, 50, 255]);
  const client = new VisionClient(
    { apiKey: "test-key", apiBase: null, imageModel: "img", visionModel: "vision-m" },
    {
      complete: async ({ messages }) => {
        const content = messages[0]!.content as Array<Record<string, unknown>>;
        const text = String((content[0] as { text?: string }).text);
        if (text.startsWith("Inspect this candidate")) {
          return {
            content: JSON.stringify({
              usable: true,
              person_count: 1,
              composition: "half-body",
              front_facing: true,
              full_character_visible: true,
              mouth_area_visible: true,
              head_bbox: { x0: 40, y0: 30, x1: 88, y1: 120 },
              confidence: 0.97,
              issues: [],
            }),
          };
        }
        // Zoomed face crop coordinate system (scale=4): lip point/mouth box/chin line must pass anchor validation after conversion
        return {
          content: JSON.stringify({
            mouth_visible: true,
            mouth_bbox: { x0: 96, y0: 260, x1: 144, y1: 284 },
            lip_center: { x: 120, y: 276 },
            chin_y: 344,
            confidence: 0.99,
            issues: [],
          }),
        };
      },
      sleep: async () => undefined,
    },
  );
  const evidenceDir = join(await mkdtemp(join(tmpdir(), "ainobi-vision-test-")), "qa");
  const { landmarks, evidence } = await client.locateLandmarks(base, evidenceDir);
  assert.equal(landmarks.source, "openai-vision");
  assert.equal(landmarks.image_sha256, imageSha256(base));
  assert.equal(landmarks.confidence, 0.97);
  // Evidence files written to disk
  assert.ok(existsSync(join(evidenceDir, "face_crop.png")));
  assert.ok(existsSync(join(evidenceDir, "localization.json")));
  assert.ok((evidence as Record<string, unknown>).landmarks !== undefined);
});

test("VisionClient: 构图门拒绝（usable=false）→ 带问题清单的错误", async () => {
  const client = new VisionClient(
    { apiKey: "test-key", apiBase: null, imageModel: "img", visionModel: "vision-m" },
    {
      complete: async () => ({
        content: JSON.stringify({
          usable: false,
          person_count: 2,
          composition: "other",
          front_facing: false,
          full_character_visible: false,
          mouth_area_visible: false,
          head_bbox: null,
          confidence: 0.9,
          issues: ["two people", "side view"],
        }),
      }),
      sleep: async () => undefined,
    },
  );
  await assert.rejects(
    () => client.locateLandmarks(createRaster(16, 16, [0, 0, 0, 255]), "/tmp/unused-qa"),
    /base image failed semantic composition gate: two people; side view/,
  );
});

test("makeFinalContactSheet 所需 FinalAssessment 形状自检（编译期契约）", () => {
  const assessment: FinalAssessment = {
    accepted: true,
    mouth_box_is_on_face_mouth: true,
    closed_to_open_progression_is_natural: true,
    no_face_or_composite_artifacts: true,
    cutout_is_visually_intact: true,
    confidence: 1,
    issues: [],
  };
  assert.equal(assessment.accepted, true);
});
