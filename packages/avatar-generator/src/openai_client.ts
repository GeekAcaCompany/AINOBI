// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OpenAI Images API client (the gpt-image family).
 *
 * Generation / editing both require b64_json payloads; any API failure retries with linear backoff
 * (RETRY_WAIT_SECONDS × attempt number). The client is built through the provider factory,
 * sharing credentials and the base URL fallback with the main LLM stack; the underlying calls and waits are injectable for unit tests.
 */

import type { Raster } from "./image.ts";
import { cloneRaster } from "./image.ts";
import { decodePng, encodePng } from "./png.ts";
import { CANVAS_SIZE } from "./config.ts";
import type { AvatarApiClient, AvatarPipelineSettings } from "./config.ts";
import { AvatarPipelineError } from "./errors.ts";

const MAX_RETRIES = 3;
const RETRY_WAIT_SECONDS = 5.0;

/** The shape of the Images API response the pipeline cares about */
interface ImagesApiResponse {
  data?: Array<{ b64_json?: string | null } | null> | null;
}

/** Shape of the underlying Images calls (the default implementation goes through the provider factory; tests inject stubs) */
export type ImagesApiCall = (params: {
  model: string;
  prompt: string;
  size: string;
  images?: Raster[];
}) => Promise<ImagesApiResponse>;

export interface ImageClientDeps {
  callImagesApi?: ImagesApiCall;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The host's client if it supplies one, otherwise the OpenAI SDK. */
export async function openApiClient(settings: AvatarPipelineSettings, model: string): Promise<AvatarApiClient> {
  if (settings.openClient) return settings.openClient(model);
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: settings.apiKey, baseURL: settings.apiBase ?? undefined });
  return { client: client as unknown as AvatarApiClient["client"], close: async () => undefined };
}

/** Default implementation: images.generate / images.edit (multiple reference images) */
function makeFactoryImagesCall(settings: AvatarPipelineSettings): ImagesApiCall {
  return async (params) => {
    const { toFile } = await import("openai");
    const provider = await openApiClient(settings, settings.imageModel);
    try {
      if (params.images && params.images.length > 0) {
        const files = [];
        for (let i = 0; i < params.images.length; i++) {
          files.push(
            await toFile(Buffer.from(encodeRasterPng(params.images[i])), `reference_${i}.png`, {
              type: "image/png",
            }),
          );
        }
        return (await provider.client.images.edit({
          model: params.model,
          prompt: params.prompt,
          image: files,
          size: params.size,
        } as never)) as ImagesApiResponse;
      }
      return (await provider.client.images.generate({
        model: params.model,
        prompt: params.prompt,
        size: params.size,
      } as never)) as ImagesApiResponse;
    } finally {
      await provider.close();
    }
  };
}

/** RGBA raster → PNG bytes (edit reference image payload) */
function encodeRasterPng(raster: Raster): Uint8Array {
  return encodePng(raster);
}

/** b64_json → RGBA Raster (RGB semantics: alpha set to 255) */
function rasterFromB64(b64: string): Raster {
  const raster = decodePng(Buffer.from(b64, "base64"));
  const out = cloneRaster(raster);
  for (let i = 3; i < out.data.length; i += 4) {
    out.data[i] = 255;
  }
  return out;
}

export class ImageClient {
  private readonly model: string;
  private readonly callImagesApi: ImagesApiCall;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(settings: AvatarPipelineSettings, deps: ImageClientDeps = {}) {
    this.model = settings.imageModel;
    this.callImagesApi = deps.callImagesApi ?? makeFactoryImagesCall(settings);
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /** Text-to-image (the canvas is always CANVAS_SIZE) */
  async generate(prompt: string): Promise<Raster> {
    console.info(`[openai] generate (${this.model}) …`);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.callImagesApi({
          model: this.model,
          prompt,
          size: CANVAS_SIZE,
        });
        const b64 = response.data?.[0]?.b64_json;
        if (!b64) {
          throw new Error("image API response does not contain b64_json");
        }
        return rasterFromB64(b64);
      } catch (error) {
        lastError = error;
        console.warn(`[openai] generate attempt ${attempt + 1} failed: ${String(error)}`);
        await this.sleep(RETRY_WAIT_SECONDS * (attempt + 1) * 1000);
      }
    }
    void lastError;
    throw new AvatarPipelineError(`images.generate failed after ${MAX_RETRIES} attempts`);
  }

  /** Image-to-image (reference images sent in full for consistency; output normalized to the canvas) */
  async edit(prompt: string, references: Raster[]): Promise<Raster> {
    console.info(`[openai] edit with ${references.length} reference(s) (${this.model}) …`);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.callImagesApi({
          model: this.model,
          prompt,
          size: CANVAS_SIZE,
          images: references,
        });
        const b64 = response.data?.[0]?.b64_json;
        if (!b64) {
          throw new Error("image API response does not contain b64_json");
        }
        return rasterFromB64(b64);
      } catch (error) {
        lastError = error;
        console.warn(`[openai] edit attempt ${attempt + 1} failed: ${String(error)}`);
        await this.sleep(RETRY_WAIT_SECONDS * (attempt + 1) * 1000);
      }
    }
    void lastError;
    throw new AvatarPipelineError(`images.edit failed after ${MAX_RETRIES} attempts`);
  }
}
