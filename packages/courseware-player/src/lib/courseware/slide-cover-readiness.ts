// SPDX-License-Identifier: AGPL-3.0-only
import {
  computeElementEnterExitEffectVisual,
  interpolateElementTransformInSlide,
  isElementVisibleAtTimeInSlide,
  type SlideElement,
  type VtuberElement,
} from "@ainobi/courseware-core/elements.ts";
import { pickMostCompleteSnapshotTime } from "./slide-snapshot-time.ts";
import { listVtubersOnSlide } from "@ainobi/courseware-core/slide-stack.ts";
import { getVtuberModelUrlFromMetadata, isInochiModelUrl } from "@ainobi/avatar/vtuber-model-defaults";
import { getVtuberSourceKey } from "@ainobi/avatar/vtuber-source-key";

const isVtuberVisibleForCoverAtTime = (
  vtuber: VtuberElement,
  time: number,
  slide: SlideElement,
): boolean => {
  if (!isElementVisibleAtTimeInSlide(vtuber, time, slide)) return false;
  const transform = interpolateElementTransformInSlide(vtuber, time, slide);
  const fx = computeElementEnterExitEffectVisual(vtuber, slide, time);
  return transform.opacity * fx.opacityFactor > 0.01;
};

/** Live2D vtuber source keys whose static snapshot the cover capture must wait for (Inochi thumbnails don't depend on snapshots). */
export const listCoverVtuberSourceKeysAwaitingSnapshot = (
  slide: SlideElement | undefined,
  snapshotAt?: number,
): string[] => {
  if (!slide) return [];
  const time = snapshotAt ?? pickMostCompleteSnapshotTime(slide);
  const keys = new Set<string>();
  for (const vtuber of listVtubersOnSlide(slide)) {
    if (!isVtuberVisibleForCoverAtTime(vtuber, time, slide)) continue;
    const modelUrl = getVtuberModelUrlFromMetadata(vtuber.metadata as Record<string, unknown>);
    if (isInochiModelUrl(modelUrl)) continue;
    keys.add(getVtuberSourceKey(vtuber));
  }
  return [...keys];
};

export const areCoverVtuberSnapshotsReady = (
  slide: SlideElement | undefined,
  snapshotsBySourceKey: Record<string, string>,
  snapshotAt?: number,
): boolean => {
  const keys = listCoverVtuberSourceKeysAwaitingSnapshot(slide, snapshotAt);
  if (keys.length === 0) return true;
  return keys.every((key) => Boolean(snapshotsBySourceKey[key]?.trim()));
};

/** Poll until the vtuber snapshots the cover needs are ready or it times out. */
export const waitForCoverSlideReadiness = async (options: {
  slide: SlideElement | undefined;
  getSnapshots: () => Record<string, string>;
  snapshotAt?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<boolean> => {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  while (Date.now() < deadline) {
    if (areCoverVtuberSnapshotsReady(options.slide, options.getSnapshots(), options.snapshotAt)) {
      return true;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, pollIntervalMs);
    });
  }
  return areCoverVtuberSnapshotsReady(options.slide, options.getSnapshots(), options.snapshotAt);
};
