// SPDX-License-Identifier: AGPL-3.0-only
import type * as THREE from "three";

export type InochiMouthDriver = {
  object: THREE.Object3D;
  basePositionY: number;
  baseScaleX: number;
  baseScaleY: number;
  /** Generated mouth overlays are opacity-driven instead of mesh-deformed. */
  opacityDriven: boolean;
  /** Zero-based baked frame index; null for legacy one-frame/regular mouth nodes. */
  frameIndex: number | null;
};

export type InochiBodyDriver = {
  object: THREE.Object3D;
  baseRotZ: number;
  basePosY: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Fade a legacy single open-mouth overlay without squashing its dark cavity. */
export function resolveLegacyMouthOverlayOpacity(open: number): number {
  const value = clamp01(Number.isFinite(open) ? open : 0);
  return value * value * (3 - 2 * value);
}

/** Cross-fade weight for one of the baked mouth frames embedded in an INX. */
export function resolveMouthFrameOpacity(
  open: number,
  frameIndex: number,
  frameCount: number,
): number {
  if (
    !Number.isInteger(frameIndex) ||
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameIndex < 0 ||
    frameIndex >= frameCount
  ) {
    return 0;
  }
  if (frameCount === 1) return frameIndex === 0 ? 1 : 0;
  const framePosition = clamp01(Number.isFinite(open) ? open : 0) * (frameCount - 1);
  return Math.max(0, 1 - Math.abs(framePosition - frameIndex));
}

/** Apply continuous opacity and bypass the INX alpha-test threshold. */
export function setInochiObjectOpacity(object: THREE.Object3D, value: number): void {
  const opacity = clamp01(Number.isFinite(value) ? value : 0);
  object.visible = opacity > 0.001;
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const item of materials) {
      const requiresMaterialUpdate =
        !item.transparent || item.alphaTest !== 0 || item.depthWrite;
      item.transparent = true;
      item.opacity = opacity;
      item.alphaTest = 0;
      item.depthWrite = false;
      if (requiresMaterialUpdate) item.needsUpdate = true;
    }
  });
}

/** Return to the neutral pose before the lip/body drivers apply (when returning to the cache / reusing). */
export function resetInochiMouthDrivers(drivers: readonly InochiMouthDriver[]): void {
  for (const node of drivers) {
    try {
      node.object.scale.x = node.baseScaleX;
      node.object.scale.y = node.baseScaleY;
      node.object.position.y = node.basePositionY;
      if (node.opacityDriven) {
        setInochiObjectOpacity(node.object, node.frameIndex === 0 ? 1 : 0);
      }
    } catch {
      /* noop */
    }
  }
}

export function resetInochiBodyDrivers(drivers: readonly InochiBodyDriver[]): void {
  for (const node of drivers) {
    try {
      node.object.rotation.z = node.baseRotZ;
      node.object.position.y = node.basePosY;
    } catch {
      /* noop */
    }
  }
}
