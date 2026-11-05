// SPDX-License-Identifier: AGPL-3.0-only
import { toBlob } from "html-to-image";

import { SLIDE_LOGICAL_HEIGHT, SLIDE_LOGICAL_WIDTH } from "./slide-cover-layout.ts";

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitForPaint = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
};

const waitForImages = async (root: HTMLElement, timeoutMs = 4000): Promise<void> => {
  const images = [...root.querySelectorAll("img")];
  if (images.length === 0) return;
  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            const done = (): void => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          }),
      ),
    ),
    wait(timeoutMs),
  ]);
};

/** Export the offscreen cover render root as WebP (falling back to PNG when unsupported). */
export const captureSlideCoverBlob = async (root: HTMLElement): Promise<Blob | null> => {
  await waitForImages(root);
  await waitForPaint();

  const baseOptions = {
    width: SLIDE_LOGICAL_WIDTH,
    height: SLIDE_LOGICAL_HEIGHT,
    pixelRatio: 1,
    // cacheBust disabled: OCI presigned URLs (SigV4) can't be changed in any way, and appending a timestamp
    // breaks the signature into 403 SignatureDoesNotMatch (every image on the page dies).
    cacheBust: false,
    skipFonts: true,
  } as const;

  const webpBlob = await toBlob(root, {
    ...baseOptions,
    type: "image/webp",
    quality: 0.92,
  });
  if (webpBlob && webpBlob.size > 0) {
    return webpBlob;
  }

  const pngBlob = await toBlob(root, {
    ...baseOptions,
    type: "image/png",
  });
  return pngBlob && pngBlob.size > 0 ? pngBlob : null;
};
