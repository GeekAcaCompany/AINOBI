// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentAnswerError, AgentModelBridge, AGENT_PIPELINE_SETTINGS, agentPipelineClients, type AgentRequest } from "./agent_bridge.ts";
import { createRaster } from "./image.ts";
import { generateAvatarModel } from "./pipeline.ts";
import { encodePng } from "./png.ts";
import { makeGreenAvatarPair } from "./test_fixtures.ts";

// Where the synthetic character's head and mouth are (see pipeline.test.ts).
const HEAD = { x0: 400, y0: 100, x1: 624, y1: 370 };
const MOUTH = { x0: 480, y0: 225, x1: 544, y1: 300 };
const LIP = { x: 512, y: 242 };
const CHIN = 330;
// The pipeline crops the head with a 12% margin before asking for the mouth.
const CROP = { x0: 373, y0: 68, w: 278, h: 334 };

const tempDir = (name: string) => mkdtemp(join(tmpdir(), `ainobi-agent-${name}-`));
const nextRequest = async (bridge: AgentModelBridge, done: () => boolean): Promise<AgentRequest | null> => {
  for (let i = 0; i < 2000; i++) {
    if (bridge.pending) return bridge.pending;
    if (done()) return null;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the pipeline asked nothing");
};

/** Answers like a capable agent would, from what each request says. */
async function scriptedAgent(request: AgentRequest, files: { base: string; opened: string }) {
  if (request.kind === "draw") return { image_path: request.input_images.length > 0 ? files.opened : files.base };
  const text = request.instructions;
  if (text.includes("candidate 2D avatar base image")) {
    return { answer: JSON.stringify({ usable: true, person_count: 1, composition: "full-body", front_facing: true, full_character_visible: true, mouth_area_visible: true, head_bbox: HEAD, confidence: 0.95, issues: [] }) };
  }
  if (text.includes("enlarged crop")) {
    const [, fw, fh] = /\((\d+)x(\d+) pixels\)/.exec(text)!.map(Number);
    const sx = fw / CROP.w;
    const sy = fh / CROP.h;
    const x = (v: number) => Math.round((v - CROP.x0) * sx);
    const y = (v: number) => Math.round((v - CROP.y0) * sy);
    return {
      answer: JSON.stringify({
        mouth_visible: true,
        mouth_bbox: { x0: x(MOUTH.x0), y0: y(MOUTH.y0), x1: x(MOUTH.x1), y1: y(MOUTH.y1) },
        lip_center: { x: x(LIP.x), y: y(LIP.y) },
        chin_y: y(CHIN),
        confidence: 0.95,
        issues: [],
      }),
    };
  }
  if (text.includes("comparison sheet")) {
    return { answer: JSON.stringify({ accepted: true, same_character_and_pose: true, only_mouth_changed_semantically: true, mouth_clearly_open: true, dark_cavity_visible: true, detected_box_is_on_mouth: true, confidence: 0.95, issues: [] }) };
  }
  return { answer: JSON.stringify({ accepted: true, mouth_box_is_on_face_mouth: true, closed_to_open_progression_is_natural: true, no_face_or_composite_artifacts: true, cutout_is_visually_intact: true, confidence: 0.93, issues: [] }) };
}

async function fixtureFiles() {
  const dir = await tempDir("drawings");
  const { base, opened } = makeGreenAvatarPair();
  const files = { base: join(dir, "base.png"), opened: join(dir, "opened.png") };
  await writeFile(files.base, encodePng(base));
  await writeFile(files.opened, encodePng(opened));
  return files;
}

test("the agent draws and checks a whole avatar through the unchanged pipeline", async () => {
  const files = await fixtureFiles();
  const bridge = new AgentModelBridge({ dir: await tempDir("requests") });
  const outputDir = await tempDir("output");
  let finished = false;
  const run = generateAvatarModel({ prompt: "A friendly science teacher", outputDir, settings: AGENT_PIPELINE_SETTINGS, clients: agentPipelineClients(bridge) })
    .finally(() => { finished = true; });

  const kinds: string[] = [];
  for (let request = await nextRequest(bridge, () => finished); request; request = await nextRequest(bridge, () => finished)) {
    kinds.push(request.kind);
    for (const input of request.input_images) expect(existsSync(input)).toBe(true);
    if (request.kind === "draw" && request.input_images.length === 0) expect(request.instructions).toContain("A friendly science teacher");
    await bridge.answer(request.request_id, await scriptedAgent(request, files));
  }

  const result = await run;
  expect(existsSync(result.modelPath)).toBe(true);
  expect(kinds).toEqual(["draw", "look", "look", "draw", "look", "look"]);
  const evidence = JSON.parse(await readFile(result.evidencePath, "utf8"));
  expect(evidence.vision_model).toBe("agent");
  expect(evidence.image_model).toBe("agent");
});

test("an answer the agent can fix is refused without using up the pipeline's retries", async () => {
  const files = await fixtureFiles();
  const dir = await tempDir("refusals");
  const bridge = new AgentModelBridge({ dir });
  const run = agentPipelineClients(bridge).image!.generate("draw a teacher");
  const request = await nextRequest(bridge, () => false);

  await expect(bridge.answer("someone-else", { image_path: files.base })).rejects.toThrow(AgentAnswerError);
  await expect(bridge.answer(request!.request_id, { image_path: "relative.png" })).rejects.toThrow(/absolute path/);
  await expect(bridge.answer(request!.request_id, { image_path: join(dir, "missing.png") })).rejects.toThrow(/no readable file/);
  const jpeg = join(dir, "x.jpg");
  await writeFile(jpeg, "not an image");
  await expect(bridge.answer(request!.request_id, { image_path: jpeg })).rejects.toThrow(/PNG/);
  const wide = join(dir, "wide.png");
  await writeFile(wide, encodePng(createRaster(1536, 1024, [0, 255, 0, 255])));
  await expect(bridge.answer(request!.request_id, { image_path: wide })).rejects.toThrow(/square/);

  // Still the same request: a good answer goes through, scaled to the canvas.
  expect(bridge.pending?.request_id).toBe(request!.request_id);
  const small = join(dir, "small.png");
  await writeFile(small, encodePng(createRaster(512, 512, [0, 255, 0, 255])));
  await bridge.answer(request!.request_id, { image_path: small });
  const drawn = await run;
  expect([drawn.width, drawn.height]).toEqual([1024, 1024]);
});

test("a verdict must be JSON", async () => {
  const bridge = new AgentModelBridge({ dir: await tempDir("verdict") });
  const run = bridge.vision({ model: "agent", messages: [{ role: "user", content: [{ type: "text", text: "Is it fine?" }] }], responseFormat: { type: "json_object" } });
  const request = await nextRequest(bridge, () => false);
  expect(request!.kind).toBe("look");
  await expect(bridge.answer(request!.request_id, { answer: "looks fine to me" })).rejects.toThrow(/not valid JSON/);
  await bridge.answer(request!.request_id, { answer: '{"accepted": true}' });
  expect((await run).content).toBe('{"accepted": true}');
});

test("stopping, or an agent that never answers, ends the generation with the reason", async () => {
  const stopped = new AgentModelBridge({ dir: await tempDir("stop") });
  const first = agentPipelineClients(stopped).image!.generate("draw");
  await nextRequest(stopped, () => false);
  stopped.stop("The user cancelled.");
  await expect(first).rejects.toThrow();
  expect(stopped.stopReason).toBe("The user cancelled.");
  expect(stopped.pending).toBeNull();

  const idle = new AgentModelBridge({ dir: await tempDir("idle"), idleMs: 20 });
  await expect(agentPipelineClients(idle).image!.generate("draw")).rejects.toThrow();
  expect(idle.stopReason).toMatch(/did not answer in time/);
});
