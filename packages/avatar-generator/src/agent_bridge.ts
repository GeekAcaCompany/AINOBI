// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Lets the agent driving AINOBI act as the image and vision model, when it can draw and see. The pipeline runs unchanged:
 * each image or vision call becomes a request the agent answers, with the same prompts and the same quality gates as a
 * hosted model. Requests and answers pass as files, so this works only where the agent shares the host's disk.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { CANVAS_H, CANVAS_W, type AvatarPipelineSettings } from "./config.ts";
import { AvatarPipelineError } from "./errors.ts";
import { resizeRaster } from "./image.ts";
import { ImageClient, type ImagesApiCall } from "./openai_client.ts";
import type { PipelineClients } from "./pipeline.ts";
import { decodePng, encodePng } from "./png.ts";
import { VisionClient, type VisionCompletion } from "./vision.ts";

/** One thing the pipeline needs from the agent. */
export interface AgentRequest {
  request_id: string;
  /** draw: make an image and answer with its file; look: inspect the images and answer with JSON */
  kind: "draw" | "look";
  instructions: string;
  /** Absolute paths of the images to edit or inspect */
  input_images: string[];
  /** What the answer must be */
  answer_with: string;
}

export type AgentAnswer = { image_path?: string; answer?: string };

/** An answer the agent should fix and send again; the pipeline keeps waiting. */
export class AgentAnswerError extends Error {}

/** Settings for a pipeline whose models are the agent: no key, and evidence names the agent as the model. */
export const AGENT_PIPELINE_SETTINGS: AvatarPipelineSettings = {
  apiKey: "",
  apiBase: null,
  imageModel: "agent",
  visionModel: "agent",
};

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const SQUARE_TOLERANCE = 0.1;

interface Waiting {
  request: AgentRequest;
  settle: (value: string) => void;
  fail: (error: Error) => void;
}

export class AgentModelBridge {
  private waiting: Waiting | null = null;
  private stopped: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private count = 0;

  constructor(private readonly options: { dir: string; idleMs?: number }) {}

  /** The request the agent should answer now, or null while the host is working. */
  get pending(): AgentRequest | null {
    return this.waiting?.request ?? null;
  }

  /** Why the bridge stopped, if it did. */
  get stopReason(): string | null {
    return this.stopped;
  }

  /** Answers the pending request. Throws AgentAnswerError for an answer the agent should fix. */
  async answer(requestId: string, answer: AgentAnswer): Promise<void> {
    const waiting = this.waiting;
    if (!waiting || waiting.request.request_id !== requestId) {
      throw new AgentAnswerError("That request is not the one waiting for an answer. Check the generation's status for the current one.");
    }
    let value: string;
    if (waiting.request.kind === "draw") {
      value = await this.readDrawing(answer.image_path);
    } else {
      value = this.readVerdict(answer.answer);
    }
    this.clear();
    waiting.settle(value);
  }

  /** Stops the generation: the pending request and every later one fail. */
  stop(reason: string): void {
    if (this.stopped) return;
    this.stopped = reason;
    const waiting = this.waiting;
    this.clear();
    waiting?.fail(new AvatarPipelineError(reason));
  }

  /** The images call the pipeline makes, answered by the agent. */
  readonly images: ImagesApiCall = async (params) => {
    const inputs = await this.writeImages((params.images ?? []).map((raster) => encodePng(raster)));
    const b64 = await this.ask({
      kind: "draw",
      instructions: params.prompt,
      input_images: inputs,
      answer_with:
        inputs.length > 0
          ? `Edit the input image as instructed, keeping everything else identical, and save the result as a square PNG of ${CANVAS_W}×${CANVAS_H} pixels. Answer with its absolute path in image_path.`
          : `Draw the image as instructed and save it as a square PNG of ${CANVAS_W}×${CANVAS_H} pixels. Answer with its absolute path in image_path.`,
    });
    return { data: [{ b64_json: b64 }] };
  };

  /** The vision call the pipeline makes, answered by the agent. */
  readonly vision: VisionCompletion = async (params) => {
    const texts: string[] = [];
    const pngs: Uint8Array[] = [];
    for (const message of params.messages) {
      const content = message.content;
      if (typeof content === "string") {
        texts.push(content);
        continue;
      }
      for (const part of (content ?? []) as Array<Record<string, unknown>>) {
        if (part.type === "text") texts.push(String(part.text));
        const url = (part.image_url as { url?: string } | undefined)?.url;
        if (part.type === "image_url" && url?.startsWith("data:image/png;base64,")) {
          pngs.push(Buffer.from(url.slice("data:image/png;base64,".length), "base64"));
        }
      }
    }
    const content = await this.ask({
      kind: "look",
      instructions: texts.join("\n\n"),
      input_images: await this.writeImages(pngs),
      answer_with: "Look at every input image, then answer with the single JSON object the instructions describe, as a string in answer.",
    });
    return { content };
  };

  private ask(request: Omit<AgentRequest, "request_id">): Promise<string> {
    if (this.stopped) return Promise.reject(new AvatarPipelineError(this.stopped));
    if (this.waiting) return Promise.reject(new AvatarPipelineError("the pipeline asked the agent two things at once"));
    return new Promise<string>((settle, fail) => {
      this.waiting = { request: { request_id: randomUUID(), ...request }, settle, fail };
      this.timer = setTimeout(
        () => this.stop("The agent did not answer in time, so the generation stopped."),
        this.options.idleMs ?? DEFAULT_IDLE_MS,
      );
      this.timer.unref?.();
    });
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = null;
  }

  private async writeImages(pngs: Uint8Array[]): Promise<string[]> {
    if (pngs.length === 0) return [];
    await mkdir(this.options.dir, { recursive: true });
    const paths: string[] = [];
    for (const png of pngs) {
      this.count += 1;
      const path = join(this.options.dir, `input-${this.count}.png`);
      await writeFile(path, png);
      paths.push(path);
    }
    return paths;
  }

  /** A drawing the agent saved: a square PNG, scaled to the canvas the hosted model would return. */
  private async readDrawing(imagePath: string | undefined): Promise<string> {
    const path = imagePath?.trim();
    if (!path || !isAbsolute(path)) throw new AgentAnswerError("Answer with image_path, the absolute path of the PNG you saved.");
    if (extname(path).toLowerCase() !== ".png") throw new AgentAnswerError("Save the image as a PNG file.");
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch {
      throw new AgentAnswerError(`There is no readable file at ${path}.`);
    }
    let raster;
    try {
      raster = decodePng(bytes);
    } catch {
      throw new AgentAnswerError("That file is not a valid PNG image.");
    }
    if (Math.abs(raster.width / raster.height - 1) > SQUARE_TOLERANCE) {
      throw new AgentAnswerError(`The image is ${raster.width}×${raster.height}. Draw it square, ${CANVAS_W}×${CANVAS_H} pixels.`);
    }
    const sized = raster.width === CANVAS_W && raster.height === CANVAS_H ? raster : resizeRaster(raster, CANVAS_W, CANVAS_H, "lanczos");
    return Buffer.from(encodePng(sized)).toString("base64");
  }

  /** A verdict must at least be JSON; the pipeline checks it against its schema and asks again if it does not fit. */
  private readVerdict(answer: string | undefined): string {
    const text = answer?.trim();
    if (!text) throw new AgentAnswerError("Answer with the JSON object, as a string in answer.");
    try {
      JSON.parse(text.replace(/```(?:json)?/gi, "").trim());
    } catch {
      throw new AgentAnswerError("The answer is not valid JSON. Send only the JSON object.");
    }
    return text;
  }
}

/** Pipeline clients whose image and vision models are the agent, with the pipeline's own retries and no waits. */
export function agentPipelineClients(bridge: AgentModelBridge): PipelineClients {
  const noWait = async () => undefined;
  return {
    image: new ImageClient(AGENT_PIPELINE_SETTINGS, { callImagesApi: bridge.images, sleep: noWait }),
    vision: new VisionClient(AGENT_PIPELINE_SETTINGS, { complete: bridge.vision, sleep: noWait }),
  };
}
