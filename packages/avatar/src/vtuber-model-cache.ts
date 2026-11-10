// SPDX-License-Identifier: AGPL-3.0-only
import { stripCoursewareAssetSignatureFromUrl } from "@ainobi/courseware-core";
import {
  countInochiCachedInstances,
  isInochiModelCacheWarm,
} from "./inochi-model-instance-cache.ts";
import { getLive2dRuntime } from "./model-runtime.ts";
import { isInochiModelUrl } from "./vtuber-model-defaults.ts";

/** Model instance cache key (same as modelReloadKey in the component). */
export function getVtuberModelCacheKey(modelUrl: string): string {
  const trimmed = (modelUrl ?? "").trim();
  return stripCoursewareAssetSignatureFromUrl(trimmed) || trimmed;
}

export function isLive2dVtuberModelWarmInCache(modelUrl: string): boolean {
  return getLive2dRuntime()?.isModelCacheWarm(getVtuberModelCacheKey(modelUrl)) ?? false;
}

/** Whether the Live2D at mountIndex can mount right away (for the same URL, the instance count is checked too). */
export function isLive2dVtuberWarmEnoughForMountIndex(
  modelUrl: string,
  mountIndex: number,
): boolean {
  if (mountIndex < 0) return false;
  const key = getVtuberModelCacheKey(modelUrl);
  return (getLive2dRuntime()?.countCachedInstances(key) ?? 0) > mountIndex;
}

export function isInochiVtuberModelWarmInCache(modelUrl: string): boolean {
  return isInochiModelCacheWarm(getVtuberModelCacheKey(modelUrl));
}

export function isInochiVtuberWarmEnoughForMountIndex(
  modelUrl: string,
  mountIndex: number,
): boolean {
  if (mountIndex < 0) return false;
  const key = getVtuberModelCacheKey(modelUrl);
  return countInochiCachedInstances(key) > mountIndex;
}

export function isVtuberModelWarmInCache(modelUrl: string): boolean {
  if (!modelUrl.trim()) return false;
  if (isInochiModelUrl(modelUrl)) return isInochiVtuberModelWarmInCache(modelUrl);
  return isLive2dVtuberModelWarmInCache(modelUrl);
}

/** Get the element_id set from `live2dMountSig` (`elementId:mountIndex` joined with `|`). */
export function parseLive2dMountSigElementIds(sig: string): ReadonlySet<string> {
  if (!sig.trim()) return new Set();
  const ids = new Set<string>();
  for (const part of sig.split("|")) {
    const elementId = part.split(":")[0]?.trim();
    if (elementId) ids.add(elementId);
  }
  return ids;
}

/**
 * Initial unlock of serial mounting: the largest index warm continuously from mountIndex 0.
 * When all are warm, mount everything at once (suppressing flashes on slide switch).
 */
export function resolveInitialLive2dUnlockedThroughIndex(
  mountOrderByElementId: ReadonlyMap<string, number>,
  resolveModelUrl: (elementId: string) => string,
): number {
  if (mountOrderByElementId.size === 0) return 0;

  const urlByMountIndex = new Map<number, string>();
  let maxIndex = -1;
  for (const [elementId, mountIndex] of mountOrderByElementId) {
    maxIndex = Math.max(maxIndex, mountIndex);
    urlByMountIndex.set(mountIndex, resolveModelUrl(elementId));
  }

  let contiguousWarmThrough = -1;
  for (let i = 0; i <= maxIndex; i++) {
    const url = urlByMountIndex.get(i);
    if (!url || !isLive2dVtuberWarmEnoughForMountIndex(url, i)) break;
    contiguousWarmThrough = i;
  }

  return Math.max(0, contiguousWarmThrough);
}

const LIVE2D_UNLOCK_MEMORY_MAX = 48;

/** Restore the serial unlock when leaving a slide and coming back. */
export function rememberLive2dUnlockForMountSig(
  memory: Map<string, number>,
  mountSig: string,
  unlockedThroughIndex: number,
): void {
  const sig = mountSig.trim();
  if (!sig || unlockedThroughIndex < 0) return;
  const prev = memory.get(sig) ?? -1;
  if (unlockedThroughIndex <= prev) return;
  memory.set(sig, unlockedThroughIndex);
  if (memory.size <= LIVE2D_UNLOCK_MEMORY_MAX) return;
  const oldest = memory.keys().next().value;
  if (oldest) memory.delete(oldest);
}

export function getRememberedLive2dUnlockForMountSig(
  memory: ReadonlyMap<string, number>,
  mountSig: string,
): number | undefined {
  const sig = mountSig.trim();
  if (!sig) return undefined;
  const remembered = memory.get(sig);
  return remembered !== undefined && remembered >= 0 ? remembered : undefined;
}

/**
 * Whether the visible Live2D set is "a continuation on the same slide" (at least one element_id overlaps).
 * With an overlap, unlock isn't lowered: max(prev, initial), so adding a second model doesn't wait for the first one's onReady.
 */
export function shouldPreserveLive2dUnlockAcrossMountSigChange(
  previousSig: string,
  nextSig: string,
): boolean {
  if (!previousSig.trim() || !nextSig.trim()) return false;
  const prevIds = parseLive2dMountSigElementIds(previousSig);
  for (const id of parseLive2dMountSigElementIds(nextSig)) {
    if (prevIds.has(id)) return true;
  }
  return false;
}
