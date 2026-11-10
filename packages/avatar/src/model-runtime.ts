// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from "react";

/**
 * This package renders Inochi2D (`.inx`) models itself. Live2D (`.model3.json`) is not part of it: a host that has
 * a Live2D renderer registers it here once at startup, and the courseware stages use it for every model that is not
 * Inochi2D. Without one, those models show a placeholder.
 */

/** What a courseware stage passes to a model component. */
export type StageModelProps = {
  modelUrl: string;
  widthPx: number;
  heightPx: number;
  coursewareId?: string;
  debugId?: string;
  /** Headless rendering: drive the idle animation from scene time. */
  sceneTimeMs?: number;
  headlessSceneDrive?: boolean;
  onLoadingChange?: (loading: boolean) => void;
  onModelLoaded?: (model: unknown) => void;
  onError?: (error: Error) => void;
  onCanvasSnapshot?: (dataUrl: string) => void;
};

export type Live2dRuntime = {
  StageModel: ComponentType<StageModelProps>;
  /** Whether a model with this cache key can show without loading. */
  isModelCacheWarm: (cacheKey: string) => boolean;
  /** How many loaded instances of this model are cached. */
  countCachedInstances: (cacheKey: string) => number;
  /** Whether a URL is the model's entry file, which names further files to load. */
  isModelEntryUrl: (url: string) => boolean;
  /** The files an entry file names, as absolute URLs. */
  collectModelDependencyUrls: (entry: unknown, entryUrl: string) => string[];
  /** The canvas several models share, which cover capture has to wait for. */
  sharedStage: {
    isBoundForCapture: () => boolean;
    hasPaintedTargets: () => boolean;
    /** Draws every model now, before a headless capture. */
    flushAll: () => void;
    setCaptureManualMode: (enabled: boolean) => void;
  };
};

let live2d: Live2dRuntime | null = null;

export function registerLive2dRuntime(runtime: Live2dRuntime): void {
  live2d = runtime;
}

export const getLive2dRuntime = (): Live2dRuntime | null => live2d;

export const isLive2dModelEntryUrl = (url: string): boolean => live2d?.isModelEntryUrl(url) ?? false;
