// SPDX-License-Identifier: AGPL-3.0-only
import type { Element as CourseElement, PPTElement, VtuberElement } from "./elements.ts";
import { expandPptSlideRanges } from "./elements.ts";
import type { Scene } from "./scene.ts";
import {
  applySignedUrlsToQuizConfig,
  collectQuizAssetUrlsForPresign,
  stripSignaturesFromQuizConfig,
} from "./quiz.ts";
import { collectAssetUrlsFromRichAst, mapRichAstAssetUrl } from "./rich-ast.ts";
import { extractSignableFilePathFromUrl, PRESIGN_FILE_PATH_PREFIXES } from "./asset-url-normalize.ts";

/**
 * Signs a batch of original URLs; returns original → signed. The host injects it
 * (the editor's courseware-assets client, the CLI's service client), so this module
 * stays free of any API layer.
 */
export type PresignUrls = (urls: string[]) => Promise<Record<string, string>>;

/**
 * The batch_presign server caps `filePaths` at 100 (`batchPresignBodySchema`) — exceeding it
 * 400s the whole batch, and the fallback in `tryPresignSceneAssetUrls` leaves the **whole scene** unsigned
 * (every private asset 403s together). The shared library chunks by 100 and merges itself; if a consumer wrapper
 * already chunks, chunking twice is harmless. ppt elements expanded page by page can reach the page limit in URLs, the main source of overflow.
 */
export const BATCH_PRESIGN_MAX_URLS = 100;

export const presignUrlsInChunks = async (
  presign: PresignUrls,
  urls: string[],
): Promise<Record<string, string>> => {
  if (urls.length <= BATCH_PRESIGN_MAX_URLS) {
    return presign(urls);
  }
  const merged: Record<string, string> = {};
  for (let i = 0; i < urls.length; i += BATCH_PRESIGN_MAX_URLS) {
    Object.assign(merged, await presign(urls.slice(i, i + BATCH_PRESIGN_MAX_URLS)));
  }
  return merged;
};

const AI_TEACHER_ASSET_METADATA_URL_KEYS = [
  "model_url",
  "ai_teacher_live2d_model_url",
  "ai_teacher_live2d_model_image_url",
  "ai_teacher_avatar_url",
] as const;

const applyPersistenceUrlToAITeacherMetadata = (
  metadata: CourseElement["metadata"],
  normalize: (url: string) => string,
): CourseElement["metadata"] => {
  let next = metadata;
  for (const key of AI_TEACHER_ASSET_METADATA_URL_KEYS) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const normalized = normalize(value);
    if (normalized === value) continue;
    if (next === metadata) next = { ...metadata };
    next[key] = normalized;
  }
  return next;
};

const applySignedUrlsToAITeacherMetadata = (
  metadata: CourseElement["metadata"],
  signedByOriginal: Record<string, string>,
): CourseElement["metadata"] => {
  let next = metadata;
  for (const key of AI_TEACHER_ASSET_METADATA_URL_KEYS) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const signed = signedByOriginal[value];
    if (!signed) continue;
    if (next === metadata) next = { ...metadata };
    next[key] = signed;
  }
  return next;
};

/** Expand a `ppt` element into per-page slide URLs (page number + URL pairs) by `slide_ranges` (all pages by default). */
const pptSlideUrls = (el: PPTElement): Array<{ page: number; url: string }> => {
  const slideNumbers = expandPptSlideRanges(el.slide_ranges, el.slide_count);
  const base = typeof el.src === "string" ? el.src.trim().replace(/\/+$/, "") : "";
  if (!base) return [];
  return slideNumbers.map((page) => ({ page, url: `${base}/html/slide_${page}.html` }));
};

export const collectSignableUrlsForPresign = (scene: Scene): string[] => {
  const urls: string[] = [];
  const pushIfSignable = (value: unknown): void => {
    if (typeof value !== "string") return;
    if (!extractSignableFilePathFromUrl(value, PRESIGN_FILE_PATH_PREFIXES)) return;
    urls.push(value);
  };
  const walk = (el: CourseElement): void => {
    if (el.element_type === "rich") {
      // rich elements: embedded media in the react_layout AST such as <img src>/<audio src>.
      const richUrls: string[] = [];
      collectAssetUrlsFromRichAst(el.react_layout, richUrls);
      for (const url of richUrls) pushIfSignable(url);
    }
    if (
      el.element_type === "image" ||
      el.element_type === "video" ||
      el.element_type === "audio" ||
      el.element_type === "svg"
    ) {
      pushIfSignable(el.source);
    }
    if (el.element_type === "html") {
      pushIfSignable(el.src);
      for (const child of el.children_elements) walk(child);
    }
    if (el.element_type === "ppt") {
      // On the private bucket, slide HTML is presigned page by page (signing the base is useless — signatures cover the full key),
      // backfilled into `signed_slide_urls` (the main path of the student app's resolvePptSlideHtmlUrl).
      for (const { url } of pptSlideUrls(el)) {
        pushIfSignable(url);
      }
    }
    if (el.element_type === "group") {
      for (const child of el.children_elements) walk(child);
    }
    if (el.element_type === "narration") {
      for (const seg of el.segments) pushIfSignable(seg.audio_url);
      for (const key of AI_TEACHER_ASSET_METADATA_URL_KEYS) {
        pushIfSignable(el.metadata[key]);
      }
    }
    if (el.element_type === "vtuber") {
      for (const key of AI_TEACHER_ASSET_METADATA_URL_KEYS) {
        pushIfSignable(el.metadata[key]);
      }
    }
  };

  for (const slide of scene.slide_elements) {
    pushIfSignable(slide.background_image_url);
    pushIfSignable(slide.background_html_src);
    for (const el of slide.children_elements) walk(el);
  }
  for (const audio of scene.audio_elements) {
    pushIfSignable(audio.source);
  }
  for (const vtuber of scene.vtuber_elements) {
    walk(vtuber);
  }
  if (scene.quiz) {
    for (const u of collectQuizAssetUrlsForPresign(scene.quiz)) {
      pushIfSignable(u);
    }
  }
  return Array.from(new Set(urls));
};

/**
 * Rewrite every asset URL with the host's persistence normalizer (deployment policy: which
 * hosts collapse to bare keys, how signatures are dropped) and drop transient presign caches.
 */
export const stripAssetUrlsForPersistence = (
  scene: Scene,
  normalize: (url: string) => string,
): Scene => {
  const applyToElement = (el: CourseElement): CourseElement => {
    if (
      el.element_type === "image" ||
      el.element_type === "video" ||
      el.element_type === "audio" ||
      el.element_type === "svg"
    ) {
      return { ...el, source: normalize(el.source) };
    }
    if (el.element_type === "html") {
      return {
        ...el,
        src: normalize(el.src),
        children_elements: el.children_elements.map(applyToElement),
      };
    }
    if (el.element_type === "rich") {
      return { ...el, react_layout: mapRichAstAssetUrl(el.react_layout, normalize) };
    }
    if (el.element_type === "ppt") {
      // signed_slide_urls is a transient response-time cache, never persisted.
      const { signed_slide_urls: _stripped, ...rest } = el;
      return rest;
    }
    if (el.element_type === "group") {
      return {
        ...el,
        children_elements: el.children_elements.map(applyToElement),
      };
    }
    if (el.element_type === "narration") {
      return {
        ...el,
        metadata: applyPersistenceUrlToAITeacherMetadata(el.metadata, normalize),
        segments: el.segments.map((seg) => ({ ...seg, audio_url: normalize(seg.audio_url) })),
      };
    }
    if (el.element_type === "vtuber") {
      return { ...el, metadata: applyPersistenceUrlToAITeacherMetadata(el.metadata, normalize) };
    }
    return el;
  };

  return {
    ...scene,
    slide_elements: scene.slide_elements.map((slide) => ({
      ...slide,
      background_image_url: slide.background_image_url
        ? normalize(slide.background_image_url)
        : slide.background_image_url,
      background_html_src: slide.background_html_src
        ? normalize(slide.background_html_src)
        : slide.background_html_src,
      children_elements: slide.children_elements.map(applyToElement),
    })),
    audio_elements: scene.audio_elements.map((audio) => ({
      ...audio,
      source: normalize(audio.source),
    })),
    vtuber_elements: scene.vtuber_elements.map(
      (vtuber) => applyToElement(vtuber) as VtuberElement,
    ),
  };
};

/**
 * Before persisting scene JSON: rewrite VPC/internal OSS hosts to public URLs and drop presign query params.
 * Mirrors `collectSignableUrlsForPresign` / `applySignedUrlsToSceneElements` (load-time presign).
 */
export const prepareSceneAssetUrlsForPersistence = (
  scene: Scene,
  normalize: (url: string) => string,
): Scene => {
  let next = stripAssetUrlsForPersistence(scene, normalize);
  if (next.quiz) {
    next = { ...next, quiz: stripSignaturesFromQuizConfig(next.quiz) };
  }
  return next;
};

export const applySignedUrlsToSceneElements = (
  scene: Scene,
  signedByOriginal: Record<string, string>,
): Scene => {
  const resolve = (url: string): string => signedByOriginal[url] ?? url;
  const applyToElement = (el: CourseElement): CourseElement => {
    if (
      el.element_type === "image" ||
      el.element_type === "video" ||
      el.element_type === "audio" ||
      el.element_type === "svg"
    ) {
      return { ...el, source: resolve(el.source) };
    }
    if (el.element_type === "html") {
      return {
        ...el,
        src: resolve(el.src),
        children_elements: el.children_elements.map(applyToElement),
      };
    }
    if (el.element_type === "rich") {
      return { ...el, react_layout: mapRichAstAssetUrl(el.react_layout, resolve) };
    }
    if (el.element_type === "ppt") {
      // Per-page signature backfill: the base src keeps its original form (URL/bare key), page URLs are expanded in
      // the same form during collect, so the signature map hits; consumed by the student app's resolvePptSlideHtmlUrl.
      const signedSlideUrls: Record<string, string> = {};
      for (const { page, url } of pptSlideUrls(el)) {
        const signed = signedByOriginal[url];
        if (signed && signed !== url) signedSlideUrls[String(page)] = signed;
      }
      if (Object.keys(signedSlideUrls).length === 0) return el;
      return { ...el, signed_slide_urls: signedSlideUrls };
    }
    if (el.element_type === "group") {
      return {
        ...el,
        children_elements: el.children_elements.map(applyToElement),
      };
    }
    if (el.element_type === "narration") {
      return {
        ...el,
        metadata: applySignedUrlsToAITeacherMetadata(el.metadata, signedByOriginal),
        segments: el.segments.map((seg) => ({ ...seg, audio_url: resolve(seg.audio_url) })),
      };
    }
    if (el.element_type === "vtuber") {
      return { ...el, metadata: applySignedUrlsToAITeacherMetadata(el.metadata, signedByOriginal) };
    }
    return el;
  };

  return {
    ...scene,
    slide_elements: scene.slide_elements.map((slide) => ({
      ...slide,
      background_image_url: slide.background_image_url
        ? resolve(slide.background_image_url)
        : slide.background_image_url,
      background_html_src: slide.background_html_src
        ? resolve(slide.background_html_src)
        : slide.background_html_src,
      children_elements: slide.children_elements.map(applyToElement),
    })),
    audio_elements: scene.audio_elements.map((audio) => ({
      ...audio,
      source: resolve(audio.source),
    })),
    vtuber_elements: scene.vtuber_elements.map(
      (vtuber) => applyToElement(vtuber) as VtuberElement,
    ),
  };
};

/**
 * Batch-presign courseware asset URLs in a scene (slides, global audio, vtuber models, **quiz media**).
 * Used by the editor on load and by preview after reading unsigned JSON from storage. Failures
 * keep the original URLs: an unsigned scene still renders its public assets.
 */
export async function tryPresignSceneAssetUrls(
  scene: Scene,
  coursewareId: string | null | undefined,
  presign: PresignUrls,
): Promise<Scene> {
  const signableUrls = collectSignableUrlsForPresign(scene);
  if (signableUrls.length === 0) return scene;
  if (!coursewareId?.trim()) return scene;

  try {
    const signedByOriginal = await presignUrlsInChunks(presign, signableUrls);
    if (Object.keys(signedByOriginal).length === 0) return scene;
    let next = applySignedUrlsToSceneElements(scene, signedByOriginal);
    if (scene.quiz) {
      next = {
        ...next,
        quiz: applySignedUrlsToQuizConfig(scene.quiz, signedByOriginal),
      };
    }
    return next;
  } catch (error) {
    console.warn("Failed to presign scene asset urls, continuing with original urls.", error);
    return scene;
  }
}
