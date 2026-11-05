// SPDX-License-Identifier: AGPL-3.0-only
import type * as THREE from "three";
import { disposeInochiCachedInstance } from "./inochi-model-dispose.ts";
import {
  resetInochiBodyDrivers,
  resetInochiMouthDrivers,
  type InochiBodyDriver,
  type InochiMouthDriver,
} from "./inochi-puppet-drivers.ts";
import { logger } from "./host.ts";

/** Cap of the idle stack per .inx URL (up to 2 on the same slide). */
const MAX_IDLE_PER_CACHE_KEY = 2;

export interface CachedInochiInstance {
  puppet: unknown;
  textures: THREE.Texture[];
  /** The aspect from the first fitOrthographicCameraToObject (for the resize fallback). */
  contentAspect: number;
  /** Lip and body drivers at first mount (base values are the neutral pose). */
  mouthDrivers: InochiMouthDriver[];
  bodyDrivers: InochiBodyDriver[];
}

const idleByCacheKey = new Map<string, CachedInochiInstance[]>();
/** Number of puppets in use on the DOM / shared stage. */
const activeCountByCacheKey = new Map<string, number>();

export const hasIdleInochiModelCache = (cacheKey: string): boolean => {
  const key = cacheKey.trim();
  if (!key) return false;
  const stack = idleByCacheKey.get(key);
  if (!stack || stack.length === 0) return false;
  return stack.some((entry) => isInochiPuppetReusable(entry.puppet));
};

export const countInochiCachedInstances = (cacheKey: string): number => {
  const key = cacheKey.trim();
  if (!key) return 0;
  const stack = idleByCacheKey.get(key);
  let idle = 0;
  if (stack) {
    for (const entry of stack) {
      if (isInochiPuppetReusable(entry.puppet)) idle += 1;
    }
  }
  return idle + (activeCountByCacheKey.get(key) ?? 0);
};

export const isInochiModelCacheWarm = (cacheKey: string): boolean => {
  return countInochiCachedInstances(cacheKey) > 0;
};

const trackActiveLease = (cacheKey: string, delta: 1 | -1): void => {
  const key = cacheKey.trim();
  if (!key) return;
  const next = (activeCountByCacheKey.get(key) ?? 0) + delta;
  if (next <= 0) activeCountByCacheKey.delete(key);
  else activeCountByCacheKey.set(key, next);
};

const isInochiPuppetReusable = (puppet: unknown): boolean => {
  if (!puppet || typeof puppet !== "object") return false;
  const rootNode = (puppet as { rootNode?: { threeObj?: THREE.Object3D } }).rootNode;
  return Boolean(rootNode?.threeObj);
};

/** Reset the root transform before returning to the cache (re-centered on the next mount). */
export const resetInochiPuppetRootTransform = (puppet: unknown): void => {
  const rootObj = (puppet as { rootNode?: { threeObj?: THREE.Object3D } })?.rootNode?.threeObj;
  if (!rootObj) return;
  try {
    rootObj.position.set(0, 0, 0);
    rootObj.rotation.set(0, 0, 0);
    rootObj.scale.set(1, 1, 1);
  } catch {
    /* noop */
  }
};

/**
 * Keep the INP puppet even when the component unmounts on a slide switch.
 */
export const borrowInochiModelInstance = (cacheKey: string): CachedInochiInstance | null => {
  const key = cacheKey.trim();
  if (!key) return null;
  const stack = idleByCacheKey.get(key);
  if (!stack || stack.length === 0) return null;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || !isInochiPuppetReusable(entry.puppet)) {
      if (entry) disposeInochiCachedInstance(entry);
      continue;
    }
    resetInochiPuppetRootTransform(entry.puppet);
    resetInochiMouthDrivers(entry.mouthDrivers);
    resetInochiBodyDrivers(entry.bodyDrivers);
    trackActiveLease(key, 1);
    logger.debug("[Inochi2D] Reused cached puppet instance:", {
      cacheKey: key,
      contentAspect: entry.contentAspect,
    });
    return entry;
  }
  idleByCacheKey.delete(key);
  return null;
};

/** After a new load completes, prevents double loading with other instances. */
export const registerInochiActiveLease = (
  cacheKey: string,
  _instance?: CachedInochiInstance,
): void => {
  trackActiveLease(cacheKey, 1);
};

export const returnInochiModelInstance = (
  cacheKey: string,
  instance: CachedInochiInstance,
): void => {
  const key = cacheKey.trim();
  const { puppet, textures, contentAspect, mouthDrivers, bodyDrivers } = instance;
  if (!key || !puppet) return;
  if ((activeCountByCacheKey.get(key) ?? 0) > 0) {
    trackActiveLease(key, -1);
  }
  if (!isInochiPuppetReusable(puppet)) {
    disposeInochiCachedInstance(instance);
    return;
  }
  resetInochiMouthDrivers(mouthDrivers);
  resetInochiBodyDrivers(bodyDrivers);
  resetInochiPuppetRootTransform(puppet);
  let stack = idleByCacheKey.get(key);
  if (!stack) {
    stack = [];
    idleByCacheKey.set(key, stack);
  }
  if (stack.length >= MAX_IDLE_PER_CACHE_KEY) {
    disposeInochiCachedInstance(instance);
    return;
  }
  stack.push({ puppet, textures, contentAspect, mouthDrivers, bodyDrivers });
  logger.debug("[Inochi2D] Returned puppet instance to cache:", {
    cacheKey: key,
    idle: stack.length,
  });
};

export const purgeInochiModelInstanceCache = (): void => {
  for (const stack of idleByCacheKey.values()) {
    for (const entry of stack) {
      disposeInochiCachedInstance(entry);
    }
  }
  idleByCacheKey.clear();
  activeCountByCacheKey.clear();
};
