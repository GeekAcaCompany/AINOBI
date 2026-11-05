// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  resetInochiMouthDrivers,
  resolveLegacyMouthOverlayOpacity,
  resolveMouthFrameOpacity,
  setInochiObjectOpacity,
  type InochiMouthDriver,
} from "./inochi-puppet-drivers.ts";

describe("resolveMouthFrameOpacity", () => {
  it("selects exact baked frames at their axis points", () => {
    expect(resolveMouthFrameOpacity(0, 0, 7)).toBe(1);
    expect(resolveMouthFrameOpacity(0.5, 3, 7)).toBe(1);
    expect(resolveMouthFrameOpacity(1, 6, 7)).toBe(1);
  });

  it("cross-fades only the adjacent baked frames", () => {
    const weights = Array.from({ length: 7 }, (_, index) =>
      resolveMouthFrameOpacity(0.25, index, 7),
    );
    expect(weights).toEqual([0, 0.5, 0.5, 0, 0, 0, 0]);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(1);
  });
});

describe("legacy generated mouth overlay", () => {
  it("uses continuous eased opacity", () => {
    expect(resolveLegacyMouthOverlayOpacity(0)).toBe(0);
    expect(resolveLegacyMouthOverlayOpacity(0.3)).toBeGreaterThan(0);
    expect(resolveLegacyMouthOverlayOpacity(0.3)).toBeLessThan(
      resolveLegacyMouthOverlayOpacity(0.7),
    );
    expect(resolveLegacyMouthOverlayOpacity(1)).toBe(1);
  });

  it("disables thresholded transparency on the material", () => {
    const object = new THREE.Object3D();
    const material = new THREE.MeshBasicMaterial({ alphaTest: 0.5 });
    object.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));

    setInochiObjectOpacity(object, 0.24);

    expect(object.visible).toBe(true);
    expect(material.opacity).toBeCloseTo(0.24);
    expect(material.alphaTest).toBe(0);
    expect(material.depthWrite).toBe(false);
  });
});

describe("resetInochiMouthDrivers", () => {
  it("restores baked mouth frames to the fully closed pose", () => {
    const drivers: InochiMouthDriver[] = [0, 1, 2].map((frameIndex) => {
      const object = new THREE.Object3D();
      const material = new THREE.MeshBasicMaterial();
      object.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
      return {
        object,
        basePositionY: 3,
        baseScaleX: 1,
        baseScaleY: 1,
        opacityDriven: true,
        frameIndex,
      };
    });

    resetInochiMouthDrivers(drivers);

    expect(drivers[0].object.visible).toBe(true);
    expect(drivers[1].object.visible).toBe(false);
    expect(drivers[2].object.visible).toBe(false);
  });
});
