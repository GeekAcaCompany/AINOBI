// SPDX-License-Identifier: AGPL-3.0-only
import { logger } from "./host.ts";
import {
  returnInochiModelInstance,
  type CachedInochiInstance,
} from "./inochi-model-instance-cache.ts";

/** Interval between consecutive `inImportFromURL` calls (ms). */
const LOAD_COOLDOWN_MS = 200;

let inochiModelLoadQueue: Promise<void> = Promise.resolve();
let inochiModelLoadJobCounter = 0;

const inflightByCacheKey = new Map<string, Promise<unknown>>();

export class Inochi2DLoadCancelledError extends Error {
  constructor() {
    super("Inochi2D model load cancelled");
    this.name = "Inochi2DLoadCancelledError";
  }
}

export const isInochi2DLoadCancelledError = (error: unknown): boolean =>
  error instanceof Inochi2DLoadCancelledError;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const purgeInochiModelInflightCache = (): void => {
  inflightByCacheKey.clear();
};

export const recycleInochiPuppet = (cacheKey: string, instance: CachedInochiInstance): void => {
  if (!instance.puppet) return;
  returnInochiModelInstance(cacheKey, instance);
};

/**
 * Run `INP.inImportFromURL` on a global serial queue (in-flight dedupe per URL).
 */
export const loadInochiModelSerially = <T>(
  cacheKey: string,
  load: () => Promise<T>,
  shouldContinue: () => boolean,
  debugInfo: { modelUrl: string },
): Promise<T> => {
  const jobId = ++inochiModelLoadJobCounter;
  logger.debug("[Inochi2D] Queue model load:", {
    jobId,
    cacheKey,
    modelUrl: debugInfo.modelUrl,
  });

  const run = inochiModelLoadQueue.then(
    async () => {
      await delay(0);
      if (!shouldContinue()) throw new Inochi2DLoadCancelledError();

      let inflight = inflightByCacheKey.get(cacheKey);
      if (!inflight) {
        inflight = (async () => {
          logger.debug("[Inochi2D] Start queued model load:", {
            jobId,
            cacheKey,
            modelUrl: debugInfo.modelUrl,
          });
          try {
            return await load();
          } finally {
            inflightByCacheKey.delete(cacheKey);
            await delay(LOAD_COOLDOWN_MS);
          }
        })();
        inflightByCacheKey.set(cacheKey, inflight);
      } else {
        logger.debug("[Inochi2D] Join in-flight model load:", { jobId, cacheKey });
      }

      const puppet = (await inflight) as T;
      if (!shouldContinue()) {
        const textures = (puppet as { textures?: CachedInochiInstance["textures"] })?.textures ?? [];
        recycleInochiPuppet(cacheKey, {
          puppet,
          textures,
          contentAspect: 0.56,
          mouthDrivers: [],
          bodyDrivers: [],
        });
        throw new Inochi2DLoadCancelledError();
      }
      return puppet;
    },
    async () => {
      await delay(0);
      if (!shouldContinue()) throw new Inochi2DLoadCancelledError();
      return loadInochiModelSerially(cacheKey, load, shouldContinue, debugInfo);
    },
  );

  void run.catch((error) => {
    if (isInochi2DLoadCancelledError(error)) return;
    logger.warn("[Inochi2D] Queued model load rejected:", {
      jobId,
      cacheKey,
      modelUrl: debugInfo.modelUrl,
      error,
    });
  });

  inochiModelLoadQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};
