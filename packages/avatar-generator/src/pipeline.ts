// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Main avatar generation orchestration: a fail-closed, QA-approved Inochi2D .inx model.
 *
 * Flow: base image generation → composition/anchor semantic gate (3 chances) → mouth-opening variant (the first round edits the full
 * image, retries use head-crop-assisted editing) → pixel gate (dark cavity localization within the ROI) + variant semantic gate →
 * matting + metrics → mouth-opening frame sequence baking → final contact sheet semantic gate → evidence written → .inx assembly.
 * Any failed step → throws AvatarPipelineError; half-finished output is never delivered.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Raster } from "./image.ts";
import {
  alphaBand,
  bandHistogram,
  cloneRaster,
  createRaster,
  cropRaster,
  fillRectangle,
  getPixel,
  gaussianBlurBand,
  pasteRaster,
  resizeRaster,
} from "./image.ts";
import { decodePng, encodePng } from "./png.ts";
import { pyRound, pyRound6 } from "./cvops.ts";
import { AvatarPipelineError } from "./errors.ts";
import type { AvatarPipelineSettings } from "./config.ts";
import {
  AVATAR_MOUTH_OPEN_PROMPT,
  AVATAR_MOUTH_OPEN_RETRY_PROMPT,
  buildAvatarPrompt,
} from "./prompts.ts";
import { ImageClient } from "./openai_client.ts";
import {
  VisionClient,
  landmarksPatchBbox,
  makeFinalContactSheet,
  makeVariantReviewSheet,
  pixelBoxToTuple,
  type FinalAssessment,
  type Landmarks,
  type VariantAssessment,
} from "./vision.ts";
import { cutout } from "./segment.ts";
import { N_FRAMES, bakeFrames, locateMouth, saveDiffDebug } from "./mouth.ts";
import { applyShift, registerTranslation } from "./register.ts";
import { writeInochiModel } from "./inx.ts";

const MAX_BASE_ATTEMPTS = 3;
const MAX_VARIANT_ATTEMPTS = 3;

/** Pipeline output: model file + preview + evidence chain */
export interface AvatarModelResult {
  modelPath: string;
  previewPath: string;
  evidencePath: string;
}

/** Client injection seam (for unit tests; production builds real clients by default) */
export interface PipelineClients {
  image?: Pick<ImageClient, "generate" | "edit">;
  vision?: Pick<VisionClient, "locateLandmarks" | "reviewVariant" | "reviewFinal" | "model">;
}

/** Head-crop-assisted editing: the edit only sees the head region, and the result is feathered back into the full image (used in retry rounds) */
async function cropAssistedEdit(
  client: Pick<ImageClient, "generate" | "edit">,
  base: Raster,
  prompt: string,
  headBbox: { x0: number; y0: number; x1: number; y1: number },
): Promise<Raster> {
  const [x0, y0, x1, y1] = pixelBoxToTuple(headBbox);
  const padX = pyRound((x1 - x0) * 0.18);
  const padTop = pyRound((y1 - y0) * 0.1);
  const padBottom = pyRound((y1 - y0) * 0.22);
  const box = [
    Math.max(0, x0 - padX),
    Math.max(0, y0 - padTop),
    Math.min(base.width, x1 + padX),
    Math.min(base.height, y1 + padBottom),
  ] as const;
  const crop = cropRaster(base, [box[0], box[1], box[2], box[3]]);
  const editedFull = await client.edit(prompt, [crop]);
  const edited = resizeRaster(editedFull, crop.width, crop.height, "lanczos");

  // Edge feathering band: the edit result must be scaled back after the full-canvas round trip; feathered transitions around it avoid hard seams
  const feather = Math.max(8, pyRound(Math.min(crop.width, crop.height) * 0.06));
  const maskRaster = createRaster(crop.width, crop.height, [255, 255, 255, 255]);
  fillRectangle(maskRaster, [0, 0, crop.width - 1, feather], [0, 0, 0, 0]);
  fillRectangle(maskRaster, [0, crop.height - feather, crop.width - 1, crop.height - 1], [0, 0, 0, 0]);
  fillRectangle(maskRaster, [0, 0, feather, crop.height - 1], [0, 0, 0, 0]);
  fillRectangle(maskRaster, [crop.width - feather, 0, crop.width - 1, crop.height - 1], [0, 0, 0, 0]);
  const mask = alphaBand(maskRaster);
  const blurred = gaussianBlurBand(mask, crop.width, crop.height, feather / 2);

  const result = cloneRaster(base);
  pasteRaster(result, edited, box[0], box[1], blurred);
  return result;
}

/** Variant evaluation result (accepted only when all three pass) */
interface VariantReview {
  shift: [number, number];
  detected: [number, number, number, number];
  assessment: VariantAssessment;
}

/** Registration + ROI dark cavity localization + review image + variant semantic gate */
async function evaluateVariant(
  base: Raster,
  variant: Raster,
  landmarks: Landmarks,
  vision: Pick<VisionClient, "locateLandmarks" | "reviewVariant" | "reviewFinal" | "model">,
  qaDir: string,
  attempt: number,
): Promise<VariantReview | null> {
  const shift = registerTranslation(base, variant);
  const patchBbox = landmarksPatchBbox(landmarks, [base.width, base.height]);
  const detected = locateMouth(base, variant, shift, patchBbox, [
    landmarks.lip_center.x,
    landmarks.lip_center.y,
  ]);
  if (detected === null) {
    return null;
  }

  const aligned = applyShift(variant, shift[0], shift[1]);
  const reviewSheet = makeVariantReviewSheet(base, aligned, patchBbox, detected);
  await writeFile(`${qaDir}/variant_attempt${attempt}.png`, encodePng(reviewSheet));
  const assessment = await vision.reviewVariant(reviewSheet);
  await writeFile(`${qaDir}/variant_attempt${attempt}.json`, JSON.stringify(assessment, null, 2));
  const accepted =
    assessment.accepted &&
    assessment.same_character_and_pose &&
    assessment.only_mouth_changed_semantically &&
    assessment.mouth_clearly_open &&
    assessment.dark_cavity_visible &&
    assessment.detected_box_is_on_mouth &&
    assessment.confidence >= 0.78;
  return accepted ? { shift, detected, assessment } : null;
}

/** Matting metrics: coverage range / background removal / mouth alpha / green screen residue (throws on failure) */
function validateCutout(
  baseRgba: Raster,
  baseRgb: Raster,
  landmarks: Landmarks,
): { opaque_fraction: number; transparent_fraction: number; mouth_alpha: number; chroma_residue_fraction: number } {
  const alpha = alphaBand(baseRgba);
  const histogram = bandHistogram(alpha);
  const total = baseRgba.width * baseRgba.height;
  let opaqueCount = 0;
  for (let v = 224; v <= 255; v++) opaqueCount += histogram[v];
  let transparentCount = 0;
  for (let v = 0; v <= 15; v++) transparentCount += histogram[v];
  const opaqueFraction = opaqueCount / total;
  const transparentFraction = transparentCount / total;
  const mouthAlpha = alpha[landmarks.lip_center.y * baseRgba.width + landmarks.lip_center.x];

  const cornerPixel: number[] = [];
  const corners = [
    [0, 0],
    [baseRgb.width - 1, 0],
    [0, baseRgb.height - 1],
    [baseRgb.width - 1, baseRgb.height - 1],
  ] as const;
  const chroma: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    const values = corners.map(([x, y]) => getPixel(baseRgb, x, y, cornerPixel)[channel]).sort((a, b) => a - b);
    chroma[channel] = values[2];
  }
  let opaqueChroma = 0;
  let opaque = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < 96) continue;
    opaque++;
    const o = i * 4;
    if (
      Math.abs(baseRgb.data[o] - chroma[0]) < 44 &&
      Math.abs(baseRgb.data[o + 1] - chroma[1]) < 44 &&
      Math.abs(baseRgb.data[o + 2] - chroma[2]) < 44
    ) {
      opaqueChroma++;
    }
  }
  const chromaResidueFraction = opaqueChroma / Math.max(1, opaque);

  if (!(opaqueFraction >= 0.03 && opaqueFraction <= 0.82)) {
    throw new AvatarPipelineError(`implausible cutout opaque coverage: ${opaqueFraction.toFixed(3)}`);
  }
  if (transparentFraction < 0.1) {
    throw new AvatarPipelineError("avatar background removal failed");
  }
  if (mouthAlpha < 200) {
    throw new AvatarPipelineError("avatar cutout removed the semantic mouth");
  }
  if (Math.max(...chroma) - Math.min(...chroma) >= 120 && chromaResidueFraction > 0.002) {
    throw new AvatarPipelineError("green-screen residue remained after cutout");
  }
  return {
    opaque_fraction: pyRound6(opaqueFraction),
    transparent_fraction: pyRound6(transparentFraction),
    mouth_alpha: mouthAlpha,
    chroma_residue_fraction: pyRound6(chromaResidueFraction),
  };
}

/** Final acceptance gate (all flags + confidence) */
function finalGate(assessment: FinalAssessment): boolean {
  return (
    assessment.accepted &&
    assessment.mouth_box_is_on_face_mouth &&
    assessment.closed_to_open_progression_is_natural &&
    assessment.no_face_or_composite_artifacts &&
    assessment.cutout_is_visually_intact &&
    assessment.confidence >= 0.78
  );
}

/** Reads a PNG file back as a Raster (RGB semantics: alpha set to 255) */
async function loadRgbPng(path: string): Promise<Raster> {
  const raster = decodePng(new Uint8Array(await readFile(path)));
  const out = cloneRaster(raster);
  for (let i = 3; i < out.data.length; i += 4) {
    out.data[i] = 255;
  }
  return out;
}

/**
 * Generates a QA-approved Inochi2D .inx model.
 *
 * @param params.prompt character description (user input)
 * @param params.outputDir working directory (outputs: base.png / mouth/*.png / qa/* / model.inx)
 * @param params.settings client config, or a getter for it
 * @param params.clients client injection seam (unit tests)
 */
export async function generateAvatarModel(params: {
  prompt: string;
  outputDir: string;
  /** A getter is called inside the pipeline, so a missing credential surfaces as an AvatarPipelineError. */
  settings: AvatarPipelineSettings | (() => AvatarPipelineSettings);
  clients?: PipelineClients;
}): Promise<AvatarModelResult> {
  const cleanPrompt = params.prompt.trim();
  if (!cleanPrompt) {
    throw new AvatarPipelineError("avatar prompt must not be empty");
  }

  const outputDir = params.outputDir;
  const mouthDir = `${outputDir}/mouth`;
  const qaDir = `${outputDir}/qa`;
  await mkdir(mouthDir, { recursive: true });
  await mkdir(qaDir, { recursive: true });

  let settings: AvatarPipelineSettings;
  try {
    settings = typeof params.settings === "function" ? params.settings() : params.settings;
  } catch (error) {
    throw new AvatarPipelineError(error instanceof Error ? error.message : String(error));
  }
  const imageClient = params.clients?.image ?? new ImageClient(settings);
  const vision = params.clients?.vision ?? new VisionClient(settings);

  // ---- Base image: generation + composition/anchor semantic gate (retry with a new image when localization fails) ----
  let base: Raster | null = null;
  let landmarks: Landmarks | null = null;
  let localizationEvidence: Record<string, unknown> = {};
  const baseRejections: string[] = [];
  for (let attempt = 1; attempt <= MAX_BASE_ATTEMPTS; attempt++) {
    const candidate = await imageClient.generate(buildAvatarPrompt(cleanPrompt));
    try {
      const located = await vision.locateLandmarks(candidate, qaDir);
      base = candidate;
      landmarks = located.landmarks;
      localizationEvidence = located.evidence;
      break;
    } catch (error) {
      baseRejections.push(error instanceof Error ? error.message : String(error));
      continue;
    }
  }
  if (base === null || landmarks === null) {
    throw new AvatarPipelineError(
      "no base candidate passed semantic vision QA: " + baseRejections.join("; "),
    );
  }

  // ---- Mouth-opening variant: full image edit → pixel gate + semantic gate; retries use crop-assisted editing ----
  let variant: Raster | null = null;
  let variantShift: [number, number] = [0, 0];
  let detectedBbox: [number, number, number, number] | null = null;
  let variantAssessment: VariantAssessment | null = null;
  for (let attempt = 1; attempt <= MAX_VARIANT_ATTEMPTS; attempt++) {
    const editPrompt = attempt === 1 ? AVATAR_MOUTH_OPEN_PROMPT : AVATAR_MOUTH_OPEN_RETRY_PROMPT;
    const candidate =
      attempt === 1
        ? await imageClient.edit(editPrompt, [base])
        : await cropAssistedEdit(imageClient, base, editPrompt, landmarks.head_bbox);
    const reviewed = await evaluateVariant(base, candidate, landmarks, vision, qaDir, attempt);
    if (reviewed === null) {
      continue;
    }
    variantShift = reviewed.shift;
    detectedBbox = reviewed.detected;
    variantAssessment = reviewed.assessment;
    variant = candidate;
    break;
  }
  if (variant === null || detectedBbox === null || variantAssessment === null) {
    throw new AvatarPipelineError("no mouth-open variant passed semantic vision QA");
  }

  // ---- Matting + metrics ----
  const patchBbox = landmarksPatchBbox(landmarks, [base.width, base.height]);
  const cut = cutout(base, "avatar base", true);
  const baseRgba = cut.image;
  const cutoutMetrics = validateCutout(baseRgba, base, landmarks);
  await writeFile(`${outputDir}/base.png`, encodePng(baseRgba));

  // ---- Mouth-opening frame sequence baking + final contact sheet semantic gate ----
  const frameNames = await bakeFrames(
    base,
    variant,
    variantShift,
    patchBbox,
    detectedBbox,
    landmarks.lip_center.y,
    mouthDir,
  );
  const debugPath = `${qaDir}/mouth_debug.png`;
  await saveDiffDebug(base, patchBbox, debugPath, detectedBbox);
  const reviewFrameIndexes = [0, Math.floor(N_FRAMES / 2), N_FRAMES - 1];
  const reviewFrames: Raster[] = [];
  for (const index of reviewFrameIndexes) {
    reviewFrames.push(await loadRgbPng(`${mouthDir}/${frameNames[index]}`));
  }
  const debugOverlay = await loadRgbPng(debugPath);
  const finalSheet = makeFinalContactSheet(baseRgba, debugOverlay, reviewFrames);
  const finalSheetPath = `${qaDir}/final_contact_sheet.png`;
  await writeFile(finalSheetPath, encodePng(finalSheet));
  const finalAssessment = await vision.reviewFinal(finalSheet);
  if (!finalGate(finalAssessment)) {
    throw new AvatarPipelineError(
      "final avatar failed semantic vision QA: " + finalAssessment.issues.join("; "),
    );
  }

  // ---- Evidence chain and model assembly ----
  const evidence = {
    mode: "multimodal",
    accepted: true,
    vision_model: vision.model,
    image_model: settings.imageModel,
    localization: localizationEvidence,
    landmarks,
    variant_assessment: variantAssessment,
    final_assessment: finalAssessment,
    cutout: cutoutMetrics,
  };
  const evidencePath = `${qaDir}/evidence.json`;
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));

  const mouthFrames: Raster[] = [];
  for (const frameName of frameNames) {
    mouthFrames.push(decodePng(new Uint8Array(await readFile(`${mouthDir}/${frameName}`))));
  }
  const modelPath = await writeInochiModel(baseRgba, mouthFrames, patchBbox, `${outputDir}/model.inx`);
  return {
    modelPath,
    previewPath: `${outputDir}/base.png`,
    evidencePath,
  };
}
