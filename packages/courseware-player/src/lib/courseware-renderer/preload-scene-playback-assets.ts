// SPDX-License-Identifier: AGPL-3.0-only
import type { Scene } from "../courseware/index.ts";
import {
  collectLive2dModelDependencyUrls,
  isLive2dModel3JsonUrl,
} from "@ainobi/avatar/live2d-model-presign";
import { preloadNarrationSegmentUrls } from "../courseware/narration-preload.ts";
import {
  collectScenePlaybackAssetUrls,
  partitionScenePlaybackAssetUrls,
} from "./collect-scene-playback-asset-urls.ts";

export type PreloadScenePlaybackAssetsOptions = {
  onProgress?: (completed: number, total: number) => void;
};

const preloadImage = (url: string): Promise<void> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const done = (): void => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    img.src = url;
    if (img.complete && img.naturalWidth > 0) done();
  });

const preloadVideo = (url: string): Promise<void> =>
  new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    const done = (): void => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      resolve();
    };
    video.addEventListener("canplaythrough", done, { once: true });
    video.addEventListener("error", done, { once: true });
    video.src = url;
    video.load();
    window.setTimeout(done, 30_000);
  });

const preloadAudioFetch = (url: string): Promise<void> =>
  fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" })
    .then(async (res) => {
      if (res.ok) await res.arrayBuffer();
    })
    .catch(() => {
      /* when preloading fails, the playback phase may still retry */
    });

const preloadLive2dModelBundle = async (model3Url: string): Promise<void> => {
  const res = await fetch(model3Url, { mode: "cors", credentials: "omit", cache: "force-cache" });
  if (!res.ok) return;
  const json = (await res.json()) as unknown;
  const deps = collectLive2dModelDependencyUrls(json, model3Url);
  await Promise.all(
    deps.map((dep) =>
      fetch(dep, { mode: "cors", credentials: "omit", cache: "force-cache" }).catch(() => undefined),
    ),
  );
};

const preloadGeneric = (url: string): Promise<void> =>
  fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" })
    .then(() => undefined)
    .catch(() => undefined);

/**
 * Fetch as many static resources of the scene as possible before playing, reducing load-while-playing during frame capture.
 * HTML / PPT iframes etc. still report loading tokens from the stage components, waited on a second time by the render page.
 */
export async function preloadScenePlaybackAssets(
  scene: Scene,
  options?: PreloadScenePlaybackAssetsOptions,
): Promise<void> {
  if (typeof window === "undefined") return;

  const urls = collectScenePlaybackAssetUrls(scene);
  const { audio, image, video, live2dModel, other } = partitionScenePlaybackAssetUrls(urls);

  preloadNarrationSegmentUrls(audio);

  const tasks: Array<() => Promise<void>> = [
    ...image.map((url) => () => preloadImage(url)),
    ...video.map((url) => () => preloadVideo(url)),
    ...audio.map((url) => () => preloadAudioFetch(url)),
    ...other.map((url) => () => preloadGeneric(url)),
    ...live2dModel.map((url) => () =>
      isLive2dModel3JsonUrl(url) ? preloadLive2dModelBundle(url) : preloadGeneric(url),
    ),
  ];

  const total = tasks.length;
  if (total === 0) {
    options?.onProgress?.(0, 0);
    return;
  }

  let completed = 0;
  const bump = (): void => {
    completed += 1;
    options?.onProgress?.(completed, total);
  };

  await Promise.all(
    tasks.map((run) =>
      run()
        .then(bump)
        .catch(() => bump()),
    ),
  );
}
