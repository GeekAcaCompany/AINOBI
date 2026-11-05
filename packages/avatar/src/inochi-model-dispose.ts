// SPDX-License-Identifier: AGPL-3.0-only
import type * as THREE from "three";
import { logger } from "./host.ts";
import type { CachedInochiInstance } from "./inochi-model-instance-cache.ts";

/** Release the geometry / materials of a Three.js object tree. */
export function disposeInochiObject3D(root: THREE.Object3D): void {
  root.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

/**
 * When evicting from the cache: release everything under the puppet's rootNode and its textures.
 */
export function disposeInochiCachedInstance(entry: CachedInochiInstance): void {
  const puppet = entry.puppet as { rootNode?: { threeObj?: THREE.Object3D } } | null;
  const rootObj = puppet?.rootNode?.threeObj;
  if (rootObj) {
    try {
      if (rootObj.parent) rootObj.parent.remove(rootObj);
      disposeInochiObject3D(rootObj);
    } catch (error) {
      logger.warn("[Inochi2D] dispose rootObject failed:", error);
    }
  }
  for (const tx of entry.textures) {
    try {
      tx.dispose();
    } catch {
      /* noop */
    }
  }
}
