// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Semantic vision gates of the avatar pipeline.
 *
 * Pixel differences can only prove "the two images changed", not "what changed is the mouth". This module turns the missing
 * semantic facts into first-class pipeline inputs: the vision model gives structured evaluations per JSON schema,
 * and every gate is fail-closed (incomplete evidence = rejection). The production path uses the provider factory's
 * OpenAI-compatible multimodal messages (data URL images + original detail); the underlying calls and
 * retry waits are injectable for unit tests.
 */

import { openApiClient } from "./openai_client.ts";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Raster } from "./image.ts";
import {
  alphaBand,
  checkerboardRaster,
  cloneRaster,
  createRaster,
  cropRaster,
  fitPanel,
  labelPanel,
  pasteRaster,
  resizeRaster,
  strokeRectangle,
  thumbnailRaster,
} from "./image.ts";
import { encodePng } from "./png.ts";
import type { AvatarPipelineSettings } from "./config.ts";
import { pyRound } from "./cvops.ts";
import { AvatarPipelineError } from "./errors.ts";

export const VISION_RETRIES = 3;
export const MIN_VISION_CONFIDENCE = 0.78;

// ---------------------------------------------------------------------------
// Pixel coordinate model
// ---------------------------------------------------------------------------

export interface PixelPoint {
  x: number;
  y: number;
}

/** Pixel box (x1/y1 are endpoint-inclusive coordinates; must have positive width and height) */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Builds a pixel box (non-positive width/height throws — the first line of defense for structured output) */
export function makePixelBox(x0: number, y0: number, x1: number, y1: number): PixelBox {
  if (x1 <= x0 || y1 <= y0) {
    throw new Error("box must have positive width and height");
  }
  return { x0, y0, x1, y1 };
}

export function pixelBoxToTuple(box: PixelBox): [number, number, number, number] {
  return [box.x0, box.y0, box.x1, box.y1];
}

export const PixelPointSchema = z.object({ x: z.number(), y: z.number() });
export const PixelBoxSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
});

// ---------------------------------------------------------------------------
// Evaluation schema (the structured output of the vision gates)
// ---------------------------------------------------------------------------

export const BaseAssessmentSchema = z.object({
  usable: z.boolean(),
  person_count: z.number(),
  composition: z.enum(["full-body", "three-quarter", "half-body", "close-up", "other"]),
  front_facing: z.boolean(),
  full_character_visible: z.boolean(),
  mouth_area_visible: z.boolean(),
  head_bbox: PixelBoxSchema.nullable(),
  confidence: z.number(),
  issues: z.array(z.string()),
});
export type BaseAssessment = z.infer<typeof BaseAssessmentSchema>;

export const MouthAssessmentSchema = z.object({
  mouth_visible: z.boolean(),
  mouth_bbox: PixelBoxSchema.nullable(),
  lip_center: PixelPointSchema.nullable(),
  chin_y: z.number().nullable(),
  confidence: z.number(),
  issues: z.array(z.string()),
});
export type MouthAssessment = z.infer<typeof MouthAssessmentSchema>;

export const VariantAssessmentSchema = z.object({
  accepted: z.boolean(),
  same_character_and_pose: z.boolean(),
  only_mouth_changed_semantically: z.boolean(),
  mouth_clearly_open: z.boolean(),
  dark_cavity_visible: z.boolean(),
  detected_box_is_on_mouth: z.boolean(),
  confidence: z.number(),
  issues: z.array(z.string()),
});
export type VariantAssessment = z.infer<typeof VariantAssessmentSchema>;

export const FinalAssessmentSchema = z.object({
  accepted: z.boolean(),
  mouth_box_is_on_face_mouth: z.boolean(),
  closed_to_open_progression_is_natural: z.boolean(),
  no_face_or_composite_artifacts: z.boolean(),
  cutout_is_visually_intact: z.boolean(),
  confidence: z.number(),
  issues: z.array(z.string()),
});
export type FinalAssessment = z.infer<typeof FinalAssessmentSchema>;

/** Pixel-space semantic anchors on the base image */
export interface Landmarks {
  source: "openai-vision" | "manual" | "fixture";
  model: string;
  image_sha256: string;
  head_bbox: PixelBox;
  mouth_bbox: PixelBox;
  lip_center: PixelPoint;
  chin_y: number;
  confidence: number;
  issues: string[];
}

export const LandmarksSchema = z.object({
  source: z.enum(["openai-vision", "manual", "fixture"]),
  model: z.string(),
  image_sha256: z.string(),
  head_bbox: PixelBoxSchema,
  mouth_bbox: PixelBoxSchema,
  lip_center: PixelPointSchema,
  chin_y: z.number(),
  confidence: z.number(),
  issues: z.array(z.string()).default([]),
});

/** Box width and height */
function boxWidth(box: PixelBox): number {
  return box.x1 - box.x0;
}
function boxHeight(box: PixelBox): number {
  return box.y1 - box.y0;
}

/**
 * Anchor consistency validation: boxes inside the canvas, the lip point in a sensible relation to the head box and mouth box,
 * the chin line below the lips and close to the head box, confidence above threshold, sha shaped like lowercase SHA-256.
 * Any violation throws (fail-closed).
 */
export function validateLandmarks(
  landmarks: Landmarks,
  size: [number, number],
  expectedSha256: string | null = null,
): void {
  const [w, h] = size;
  for (const [name, box] of [
    ["head", landmarks.head_bbox],
    ["mouth", landmarks.mouth_bbox],
  ] as const) {
    if (!(0 <= box.x0 && box.x0 < box.x1 && box.x1 <= w && 0 <= box.y0 && box.y0 < box.y1 && box.y1 <= h)) {
      throw new Error(
        `${name} bbox is outside the ${w}x${h} canvas: [${pixelBoxToTuple(box).join(", ")}]`,
      );
    }
  }
  const { head_bbox: hb, mouth_bbox: mb, lip_center: p } = landmarks;
  if (!(hb.x0 <= p.x && p.x <= hb.x1 && hb.y0 <= p.y && p.y <= hb.y1)) {
    throw new Error("lip center is outside the head bbox");
  }
  if (!(mb.x0 <= p.x && p.x <= mb.x1 && mb.y0 - boxHeight(mb) <= p.y && p.y <= mb.y1 + boxHeight(mb))) {
    throw new Error("lip center is inconsistent with the mouth bbox");
  }
  if (!(hb.x0 <= (mb.x0 + mb.x1) / 2 && (mb.x0 + mb.x1) / 2 <= hb.x1)) {
    throw new Error("mouth bbox is horizontally outside the head");
  }
  const relativeY = (p.y - hb.y0) / boxHeight(hb);
  if (!(0.42 <= relativeY && relativeY <= 0.92)) {
    throw new Error(
      `mouth has implausible vertical position inside head (${relativeY.toFixed(2)})`,
    );
  }
  if (!(p.y < landmarks.chin_y && landmarks.chin_y <= Math.min(h, hb.y1 + pyRound(boxHeight(hb) * 0.15)))) {
    throw new Error("chin_y must be below the lips and near the head bbox");
  }
  if (landmarks.confidence < MIN_VISION_CONFIDENCE) {
    throw new Error(
      `semantic landmark confidence ${landmarks.confidence.toFixed(2)} is below ` +
        `the required ${MIN_VISION_CONFIDENCE.toFixed(2)}`,
    );
  }
  const sha = landmarks.image_sha256;
  if (sha.length !== 64 || /[^0-9a-f]/.test(sha)) {
    throw new Error("image_sha256 must be a lowercase SHA-256 hex digest");
  }
  if (expectedSha256 !== null && sha !== expectedSha256) {
    throw new Error("landmarks were created for a different base image (SHA-256 mismatch)");
  }
}

/** Face-relative mouth patch box (never a canvas-relative search band) */
export function landmarksPatchBbox(landmarks: Landmarks, size: [number, number]): [number, number, number, number] {
  const [canvasW, canvasH] = size;
  const hb = landmarks.head_bbox;
  const mb = landmarks.mouth_bbox;
  const p = landmarks.lip_center;
  const patchW = Math.max(pyRound(boxWidth(mb) * 2.4), pyRound(boxWidth(hb) * 0.32), 32);
  const topPad = Math.max(pyRound(boxHeight(mb) * 0.8), pyRound(boxHeight(hb) * 0.075), 8);
  const bottom = Math.max(mb.y1 + pyRound(boxHeight(hb) * 0.08), landmarks.chin_y + pyRound(boxHeight(hb) * 0.02));
  let x0 = Math.max(0, p.x - Math.floor(patchW / 2));
  let x1 = Math.min(canvasW, x0 + patchW);
  x0 = Math.max(0, x1 - patchW);
  const y0 = Math.max(0, Math.min(mb.y0, p.y) - topPad);
  const y1 = Math.min(canvasH, Math.max(bottom, y0 + 24));
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------------------
// Image fingerprints and data URLs
// ---------------------------------------------------------------------------

/** SHA-256 of the RGB-form PNG (the fingerprint binding anchors to the image) */
export function imageSha256(raster: Raster): string {
  const rgb = cloneRaster(raster);
  for (let i = 3; i < rgb.data.length; i += 4) {
    rgb.data[i] = 255;
  }
  return createHash("sha256").update(encodePng(rgb)).digest("hex");
}

/** PNG data URL (multimodal message payload) */
function dataUrl(raster: Raster): string {
  const rgb = cloneRaster(raster);
  for (let i = 3; i < rgb.data.length; i += 4) {
    rgb.data[i] = 255;
  }
  return `data:image/png;base64,${Buffer.from(encodePng(rgb)).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Vision client
// ---------------------------------------------------------------------------

/** Shape of the underlying completion call (the default implementation goes through the provider factory; tests inject stubs) */
export type VisionCompletion = (params: {
  model: string;
  messages: Array<Record<string, unknown>>;
  responseFormat: { type: "json_object" } | null;
}) => Promise<{ content: string | null }>;

export interface VisionClientDeps {
  complete?: VisionCompletion;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Default provider factory completion implementation: OpenAI-compatible chat.completions + JSON mode */
function makeFactoryCompletion(settings: AvatarPipelineSettings): VisionCompletion {
  return async (params) => {
    const provider = await openApiClient(settings, settings.visionModel);
    try {
      const response = (await provider.client.chat.completions.create({
        model: params.model,
        messages: params.messages as never,
        response_format: params.responseFormat ?? undefined,
        store: false,
      } as never)) as { choices?: Array<{ message?: { content?: string | null } | null }> };
      return { content: response.choices?.[0]?.message?.content ?? null };
    } finally {
      await provider.close();
    }
  };
}

/** Extracts the first JSON object from the model output (tolerating markdown fences/prefix and suffix noise) */
function extractJsonObject(content: string): unknown {
  const stripped = content.replace(/```(?:json)?/gi, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("vision response contained no JSON object");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

/** Vision gate client: multimodal messages + JSON schema structured parsing + failure retries */
export class VisionClient {
  readonly model: string;
  private readonly complete: VisionCompletion;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(settings: AvatarPipelineSettings, deps: VisionClientDeps = {}) {
    this.model = settings.visionModel;
    this.complete = deps.complete ?? makeFactoryCompletion(settings);
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /** Structured parsing entry point (VISION_RETRIES retries, with increasing waits) */
  private async parse<T>(
    schema: z.ZodType<T>,
    schemaName: string,
    prompt: string,
    images: Raster[],
  ): Promise<T> {
    const schemaJson = JSON.stringify(z.toJSONSchema(schema));
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: prompt },
      {
        type: "text",
        text:
          `Respond with a single JSON object that validates against this JSON Schema ` +
          `(no extra keys, no markdown): ${schemaJson}`,
      },
    ];
    for (const img of images) {
      content.push({
        type: "image_url",
        image_url: { url: dataUrl(img), detail: "original" },
      });
    }
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= VISION_RETRIES; attempt++) {
      try {
        const response = await this.complete({
          model: this.model,
          messages: [{ role: "user", content }],
          responseFormat: { type: "json_object" },
        });
        if (!response.content) {
          throw new Error("vision response was empty");
        }
        const parsed = schema.safeParse(extractJsonObject(response.content));
        if (!parsed.success) {
          throw new Error(`vision response failed schema validation: ${parsed.error.message}`);
        }
        return parsed.data;
      } catch (error) {
        lastError = error;
        console.warn(`[vision] ${schemaName} attempt ${attempt} failed: ${String(error)}`);
        if (attempt < VISION_RETRIES) {
          await this.sleep(attempt * 2 * 1000);
        }
      }
    }
    void lastError;
    throw new AvatarPipelineError(`vision gate ${schemaName} failed after ${VISION_RETRIES} attempts`);
  }

  /** Whole-image semantic composition gate → zoomed face crop refines the mouth anchors */
  async locateLandmarks(
    base: Raster,
    evidenceDir: string,
  ): Promise<{ landmarks: Landmarks; evidence: Record<string, unknown> }> {
    await mkdir(evidenceDir, { recursive: true });
    const w = base.width;
    const h = base.height;
    console.info(`[vision] validating composition and locating head (${this.model}) …`);
    const baseAssessment: BaseAssessment = await this.parse(
      BaseAssessmentSchema,
      "BaseAssessment",
      `Inspect this candidate 2D avatar base image (${w}x${h} pixels).
The required asset has exactly one front-facing anime character, a visible face and mouth,
and no obstruction over the lower face. A full-body composition is preferred and the whole
character should fit in frame. Return all coordinates in ORIGINAL IMAGE PIXELS, origin at
top-left. head_bbox must tightly contain the complete head including hair, not the torso.
Set usable=false for any ambiguity; do not infer hidden content.`,
      [base],
    );
    if (
      !baseAssessment.usable ||
      baseAssessment.person_count !== 1 ||
      !baseAssessment.front_facing ||
      !baseAssessment.mouth_area_visible ||
      baseAssessment.head_bbox === null ||
      baseAssessment.confidence < MIN_VISION_CONFIDENCE
    ) {
      throw new Error(
        "base image failed semantic composition gate: " +
          (baseAssessment.issues.length > 0
            ? baseAssessment.issues.join("; ")
            : "vision model rejected the image"),
      );
    }
    const head = makePixelBox(
      baseAssessment.head_bbox.x0,
      baseAssessment.head_bbox.y0,
      baseAssessment.head_bbox.x1,
      baseAssessment.head_bbox.y1,
    );
    if (!(0 <= head.x0 && head.x0 < head.x1 && head.x1 <= w && 0 <= head.y0 && head.y0 < head.y1 && head.y1 <= h)) {
      throw new Error(`vision head bbox is outside canvas: [${pixelBoxToTuple(head).join(", ")}]`);
    }

    const cropBox = expandBox(head, [w, h], 0.12);
    const faceCrop = cropRaster(base, cropBox);
    const scale = Math.min(4.0, 1024 / Math.max(faceCrop.width, faceCrop.height));
    const displaySize: [number, number] = [
      Math.max(1, pyRound(faceCrop.width * scale)),
      Math.max(1, pyRound(faceCrop.height * scale)),
    ];
    const faceDisplay = resizeRaster(faceCrop, displaySize[0], displaySize[1], "lanczos");
    await writeFile(`${evidenceDir}/face_crop.png`, encodePng(faceDisplay));
    const fw = faceDisplay.width;
    const fh = faceDisplay.height;
    console.info(`[vision] refining mouth anchors on enlarged face crop ${fw}x${fh} …`);
    const mouth: MouthAssessment = await this.parse(
      MouthAssessmentSchema,
      "MouthAssessment",
      `This is an enlarged crop of one front-facing anime head (${fw}x${fh} pixels).
Locate the actual visible closed mouth/lip stroke, not the nose, chin, hair, collar, clothing,
or a shadow. Return coordinates in THIS CROP'S PIXELS with origin at top-left.
mouth_bbox tightly encloses the visible lips; lip_center is the center of the lip opening line;
chin_y is the bottom of the visible chin/jaw on the face centerline. Use the exact rendered
pixels. If the mouth cannot be distinguished confidently, set mouth_visible=false.`,
      [faceDisplay],
    );
    if (
      !mouth.mouth_visible ||
      mouth.mouth_bbox === null ||
      mouth.lip_center === null ||
      mouth.chin_y === null ||
      mouth.confidence < MIN_VISION_CONFIDENCE
    ) {
      throw new Error(
        "mouth failed semantic localization gate: " +
          (mouth.issues.length > 0 ? mouth.issues.join("; ") : "vision model could not locate the mouth"),
      );
    }

    const sx = faceCrop.width / fw;
    const sy = faceCrop.height / fh;
    const [cx0, cy0] = [cropBox[0], cropBox[1]];
    const mapPoint = (point: PixelPoint): PixelPoint => ({
      x: cx0 + pyRound(point.x * sx),
      y: cy0 + pyRound(point.y * sy),
    });
    const mappedBox = makePixelBox(
      cx0 + pyRound(mouth.mouth_bbox.x0 * sx),
      cy0 + pyRound(mouth.mouth_bbox.y0 * sy),
      cx0 + pyRound(mouth.mouth_bbox.x1 * sx),
      cy0 + pyRound(mouth.mouth_bbox.y1 * sy),
    );
    const landmarks: Landmarks = {
      source: "openai-vision",
      model: this.model,
      image_sha256: imageSha256(base),
      head_bbox: head,
      mouth_bbox: mappedBox,
      lip_center: mapPoint(mouth.lip_center),
      chin_y: cy0 + pyRound(mouth.chin_y * sy),
      confidence: Math.min(baseAssessment.confidence, mouth.confidence),
      issues: [...baseAssessment.issues, ...mouth.issues],
    };
    validateLandmarks(landmarks, [w, h], imageSha256(base));
    const evidence = {
      base_assessment: baseAssessment,
      mouth_crop_assessment: mouth,
      face_crop_box: [...cropBox],
      face_crop_display_size: [...displaySize],
      landmarks,
    };
    await writeFile(`${evidenceDir}/localization.json`, JSON.stringify(evidence, null, 2));
    return { landmarks, evidence };
  }

  /** Mouth-opening variant comparison gate (annotated review image: top row full image, bottom row mouth zoom + detection box) */
  async reviewVariant(reviewSheet: Raster): Promise<VariantAssessment> {
    console.info(`[vision] reviewing open-mouth variant semantics (${this.model}) …`);
    return this.parse(
      VariantAssessmentSchema,
      "VariantAssessment",
      `Review this labeled comparison sheet for a lip-sync asset. The top row shows
the full closed-mouth base and proposed open-mouth variant. The bottom row shows enlarged
mouth crops; the red rectangle is the algorithm's detected changed region. Accept only if
the same character, framing, head and pose are preserved; the mouth is unmistakably open
with a dark cavity; the meaningful edit is limited to the mouth; and the red rectangle is
on the face's actual mouth. Ignore harmless compression or subpixel registration noise.
When uncertain, reject.`,
      [reviewSheet],
    );
  }

  /** Final acceptance gate (contact sheet: matting checkerboard / semantic mouth box / three mouth-opening patches) */
  async reviewFinal(contactSheet: Raster): Promise<FinalAssessment> {
    console.info(`[vision] running final semantic acceptance gate (${this.model}) …`);
    return this.parse(
      FinalAssessmentSchema,
      "FinalAssessment",
      `Perform final acceptance QA on this avatar contact sheet. The first panel
shows the transparent cutout over a checkerboard. The second shows the semantic mouth box
on the original full character. The last three panels show closed, half-open, and fully
open mouth patches enlarged. Accept only if the box is on the face's real mouth, the three
frames form a plausible closed-to-open progression at that same mouth, there are no seams,
duplicate mouths, distorted facial features or clothing edits, and the character cutout is
visually intact. Any mouth on the torso/skirt/legs must be rejected. When uncertain, reject.`,
      [contactSheet],
    );
  }
}

/** Box expansion (proportional pyRound; clamped to the canvas) */
function expandBox(box: PixelBox, size: [number, number], ratio: number): [number, number, number, number] {
  const [w, h] = size;
  const px = pyRound(boxWidth(box) * ratio);
  const py = pyRound(boxHeight(box) * ratio);
  return [
    Math.max(0, box.x0 - px),
    Math.max(0, box.y0 - py),
    Math.min(w, box.x1 + px),
    Math.min(h, box.y1 + py),
  ];
}

// ---------------------------------------------------------------------------
// Review image / contact sheet
// ---------------------------------------------------------------------------

/** Variant review image (1024x1024 four-cell grid) */
export function makeVariantReviewSheet(
  base: Raster,
  variantAligned: Raster,
  patchBbox: [number, number, number, number],
  detectedBbox: [number, number, number, number],
): Raster {
  const panel: [number, number] = [512, 512];
  const baseFull = labelPanel(fitPanel(base, panel), "BASE / closed");
  const openFull = labelPanel(fitPanel(variantAligned, panel), "VARIANT / proposed open");

  const zoomBox = patchBbox;
  const baseZoom = resizeRaster(cropRaster(base, zoomBox), panel[0], panel[1], "nearest");
  const openZoom = resizeRaster(cropRaster(variantAligned, zoomBox), panel[0], panel[1], "nearest");
  const sx = panel[0] / (zoomBox[2] - zoomBox[0]);
  const sy = panel[1] / (zoomBox[3] - zoomBox[1]);
  const rel = [
    pyRound((detectedBbox[0] - zoomBox[0]) * sx),
    pyRound((detectedBbox[1] - zoomBox[1]) * sy),
    pyRound((detectedBbox[2] - zoomBox[0]) * sx),
    pyRound((detectedBbox[3] - zoomBox[1]) * sy),
  ];
  strokeRectangle(
    openZoom,
    [rel[0], rel[1], rel[2] - 1, rel[3] - 1],
    [255, 30, 30, 255],
    5,
  );
  const baseZoomLabeled = labelPanel(baseZoom, "BASE mouth crop");
  const openZoomLabeled = labelPanel(openZoom, "VARIANT crop + detected change");

  const sheet = createRaster(1024, 1024, [20, 24, 32, 255]);
  pasteRaster(sheet, baseFull, 0, 0);
  pasteRaster(sheet, openFull, 512, 0);
  pasteRaster(sheet, baseZoomLabeled, 0, 512);
  pasteRaster(sheet, openZoomLabeled, 512, 512);
  return sheet;
}

/** Final contact sheet (1536x1024 five panels) */
export function makeFinalContactSheet(
  baseRgba: Raster,
  debugOverlay: Raster,
  frameImages: Raster[],
): Raster {
  const fullSize: [number, number] = [512, 512];
  const checker = checkerboardRaster(fullSize);
  const cutout = thumbnailRaster(cloneRaster(baseRgba), fullSize);
  pasteRaster(
    checker,
    cutout,
    Math.floor((512 - cutout.width) / 2),
    Math.floor((512 - cutout.height) / 2),
    alphaBand(cutout),
  );
  const panels = [
    labelPanel(checker, "CUTOUT / checkerboard"),
    labelPanel(fitPanel(debugOverlay, fullSize), "SEMANTIC MOUTH BOX"),
  ];
  const labels = ["CLOSED 0%", "HALF OPEN 50%", "OPEN 100%"];
  frameImages.slice(0, 3).forEach((frame, index) => {
    panels.push(
      labelPanel(
        resizeRaster(frame, fullSize[0], fullSize[1], "nearest"),
        labels[index] ?? `FRAME ${index}`,
      ),
    );
  });
  const sheet = createRaster(1536, 1024, [20, 24, 32, 255]);
  pasteRaster(sheet, panels[0]!, 0, 0);
  pasteRaster(sheet, panels[1]!, 512, 0);
  pasteRaster(sheet, panels[2]!, 0, 512);
  pasteRaster(sheet, panels[3]!, 512, 512);
  pasteRaster(sheet, panels[4]!, 1024, 512);
  return sheet;
}
