// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pipeline orchestration unit tests — injected stub image/vision clients + a synthetic green screen character pair:
 * the full happy path output, base image/variant/final gate failure paths, empty description rejection.
 * The stub clients touch no network; the image math uses the real implementation.
 */

import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import type { Raster } from "./image.ts";
import { decodePng } from "./png.ts";
import { AvatarPipelineError, generateAvatarModel } from "./index.ts";
import { readInochiModel } from "./inx.ts";
import type { Landmarks, VariantAssessment, FinalAssessment } from "./vision.ts";
import { makeGreenAvatarPair } from "./test_fixtures.ts";

/** Semantic anchors of the synthetic character pair (head box/mouth box/lip point match the picture elements) */
function greenLandmarks(): Landmarks {
  return {
    source: "fixture",
    model: "stubbed-vision",
    image_sha256: "f".repeat(64),
    head_bbox: { x0: 400, y0: 100, x1: 624, y1: 370 },
    mouth_bbox: { x0: 480, y0: 225, x1: 544, y1: 300 },
    lip_center: { x: 512, y: 242 },
    chin_y: 330,
    confidence: 0.99,
    issues: [],
  };
}

function acceptedVariant(): VariantAssessment {
  return {
    accepted: true,
    same_character_and_pose: true,
    only_mouth_changed_semantically: true,
    mouth_clearly_open: true,
    dark_cavity_visible: true,
    detected_box_is_on_mouth: true,
    confidence: 0.95,
    issues: [],
  };
}

function acceptedFinal(): FinalAssessment {
  return {
    accepted: true,
    mouth_box_is_on_face_mouth: true,
    closed_to_open_progression_is_natural: true,
    no_face_or_composite_artifacts: true,
    cutout_is_visually_intact: true,
    confidence: 0.93,
    issues: [],
  };
}

/** Stub client factory: the image client replays in order, the vision client's behavior is injectable */
function makeStubClients(options: {
  baseRejections?: number;
  variantRejected?: boolean;
  finalRejected?: boolean;
} = {}) {
  const { base, opened } = makeGreenAvatarPair();
  const state = {
    generateCalls: 0,
    editCalls: 0,
    editPrompts: [] as string[],
    variantReviews: 0,
    finalReviews: 0,
  };
  let baseAttemptsLeft = options.baseRejections ?? 0;
  const clients = {
    image: {
      async generate(): Promise<Raster> {
        state.generateCalls++;
        return base;
      },
      async edit(prompt: string, _references: Raster[]): Promise<Raster> {
        state.editCalls++;
        state.editPrompts.push(prompt);
        return opened;
      },
    },
    vision: {
      model: "stubbed-vision",
      async locateLandmarks(): Promise<{ landmarks: Landmarks; evidence: Record<string, unknown> }> {
        if (baseAttemptsLeft > 0) {
          baseAttemptsLeft--;
          throw new Error(`stub rejection ${options.baseRejections! - baseAttemptsLeft}`);
        }
        return { landmarks: greenLandmarks(), evidence: { stub: true } };
      },
      async reviewVariant(): Promise<VariantAssessment> {
        state.variantReviews++;
        return options.variantRejected
          ? { ...acceptedVariant(), accepted: false, issues: ["mouth not open"] }
          : acceptedVariant();
      },
      async reviewFinal(): Promise<FinalAssessment> {
        state.finalReviews++;
        return options.finalRejected
          ? { ...acceptedFinal(), accepted: false, issues: ["seam on cheek", "duplicate mouth"] }
          : acceptedFinal();
      },
    },
    state,
  };
  return clients;
}

const SETTINGS = { apiKey: "test-key", apiBase: null, imageModel: "gpt-image-test", visionModel: "vision-test" };

test("pipeline: happy path —— 模型/预览/证据/嘴帧全落盘 + .inx 可读回", async () => {
  const clients = makeStubClients();
  const outputDir = await mkdtemp(join(tmpdir(), "ainobi-pipeline-happy-"));
  const result = await generateAvatarModel({
    prompt: "  A friendly science teacher  ",
    outputDir,
    settings: SETTINGS,
    clients,
  });

  assert.equal(normalize(result.modelPath), join(outputDir, "model.inx"));
  assert.equal(normalize(result.previewPath), join(outputDir, "base.png"));
  assert.equal(normalize(result.evidencePath), join(outputDir, "qa", "evidence.json"));
  assert.ok(existsSync(result.modelPath));
  assert.ok(existsSync(result.previewPath));
  assert.ok(existsSync(join(outputDir, "qa", "evidence.json")));
  // localization.json / face_crop.png are written by the real vision client (covered by vision.test); the stub doesn't produce them
  assert.ok(existsSync(join(outputDir, "qa", "variant_attempt1.png")));
  assert.ok(existsSync(join(outputDir, "qa", "variant_attempt1.json")));
  assert.ok(existsSync(join(outputDir, "qa", "mouth_debug.png")));
  assert.ok(existsSync(join(outputDir, "qa", "final_contact_sheet.png")));
  for (let k = 0; k < 7; k++) {
    assert.ok(existsSync(join(outputDir, "mouth", `m${k}.png`)), `frame m${k}.png`);
  }

  // Accepted on the first round: 1 generation + 1 edit (full image)
  assert.equal(clients.state.generateCalls, 1);
  assert.equal(clients.state.editCalls, 1);
  assert.ok(clients.state.editPrompts[0]!.includes("ONLY CHANGE: open the mouth wide"));

  // Evidence chain contents
  const evidence = JSON.parse(await readFile(result.evidencePath, "utf8")) as Record<string, unknown>;
  assert.equal(evidence.mode, "multimodal");
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.vision_model, "stubbed-vision");
  assert.equal(evidence.image_model, "gpt-image-test");
  const cutoutMetrics = evidence.cutout as Record<string, number>;
  assert.ok(cutoutMetrics.opaque_fraction >= 0.03 && cutoutMetrics.opaque_fraction <= 0.82);
  assert.ok(cutoutMetrics.transparent_fraction >= 0.1);
  assert.ok(cutoutMetrics.mouth_alpha >= 200);

  // .inx structure: 1 body texture + 7 mouth frames
  const model = readInochiModel(new Uint8Array(await readFile(result.modelPath)));
  assert.equal(model.textures.length, 8);
  const nodes = (model.payload.nodes as Record<string, unknown>).children as Array<Record<string, unknown>>;
  assert.equal(nodes.length, 8);
  assert.equal(nodes[0]!.name, "body_base");

  // The preview is an RGBA PNG
  const preview = decodePng(new Uint8Array(await readFile(result.previewPath)));
  assert.equal(preview.width, 1024);
});

test("pipeline: 基础像语义门全拒（3 次机会）→ 拒绝理由串联", async () => {
  const clients = makeStubClients({ baseRejections: 3 });
  const outputDir = await mkdtemp(join(tmpdir(), "ainobi-pipeline-base-rej-"));
  await assert.rejects(
    () => generateAvatarModel({ prompt: "A teacher", outputDir, settings: SETTINGS, clients }),
    (error: unknown) =>
      error instanceof AvatarPipelineError &&
      error.message === "no base candidate passed semantic vision QA: stub rejection 1; stub rejection 2; stub rejection 3",
  );
  assert.equal(clients.state.generateCalls, 3);
});

test("pipeline: 变体三轮全拒（首轮整幅 + 两轮裁剪辅助编辑）→ 显式失败", async () => {
  const clients = makeStubClients({ variantRejected: true });
  const outputDir = await mkdtemp(join(tmpdir(), "ainobi-pipeline-var-rej-"));
  await assert.rejects(
    () => generateAvatarModel({ prompt: "A teacher", outputDir, settings: SETTINGS, clients }),
    (error: unknown) =>
      error instanceof AvatarPipelineError &&
      error.message === "no mouth-open variant passed semantic vision QA",
  );
  // Three edit rounds: rounds 2/3 switch to the retry prompt (SHOUTING)
  assert.equal(clients.state.editCalls, 3);
  assert.ok(clients.state.editPrompts[1]!.includes("SHOUTING"));
  assert.equal(clients.state.variantReviews, 3);
});

test("pipeline: 最终门拒绝 → 问题清单串联", async () => {
  const clients = makeStubClients({ finalRejected: true });
  const outputDir = await mkdtemp(join(tmpdir(), "ainobi-pipeline-final-rej-"));
  await assert.rejects(
    () => generateAvatarModel({ prompt: "A teacher", outputDir, settings: SETTINGS, clients }),
    (error: unknown) =>
      error instanceof AvatarPipelineError &&
      error.message === "final avatar failed semantic vision QA: seam on cheek; duplicate mouth",
  );
  assert.equal(clients.state.finalReviews, 1);
});

test("pipeline: 空描述拒绝", async () => {
  const clients = makeStubClients();
  const outputDir = await mkdtemp(join(tmpdir(), "ainobi-pipeline-empty-"));
  await assert.rejects(
    () => generateAvatarModel({ prompt: "   ", outputDir, settings: SETTINGS, clients }),
    (error: unknown) =>
      error instanceof AvatarPipelineError && error.message === "avatar prompt must not be empty",
  );
});
