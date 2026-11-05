// SPDX-License-Identifier: AGPL-3.0-only
import type { Element as CourseElement, Scene } from "../courseware/index.ts";
import { collectQuizAssetUrlsForPresign } from "@ainobi/courseware-core/quiz.ts";
import { collectSignableUrlsForPresign } from "../courseware/presign-scene.ts";
import { getVtuberModelUrlFromMetadata } from "@ainobi/avatar/vtuber-model-defaults";
import { isLive2dModel3JsonUrl } from "@ainobi/avatar/live2d-model-presign";

const pushUrl = (urls: Set<string>, value: unknown): void => {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  urls.add(trimmed);
};

const walkElement = (urls: Set<string>, el: CourseElement): void => {
  if (
    el.element_type === "image" ||
    el.element_type === "video" ||
    el.element_type === "audio" ||
    el.element_type === "svg"
  ) {
    pushUrl(urls, el.source);
  }
  if (el.element_type === "ppt") {
    pushUrl(urls, el.src);
  }
  if (el.element_type === "html") {
    pushUrl(urls, el.src);
    for (const child of el.children_elements) walkElement(urls, child);
  }
  if (el.element_type === "group") {
    for (const child of el.children_elements) walkElement(urls, child);
  }
  if (el.element_type === "narration") {
    for (const seg of el.segments) pushUrl(urls, seg.audio_url);
    pushUrl(urls, getVtuberModelUrlFromMetadata(el.metadata));
  }
  if (el.element_type === "vtuber") {
    pushUrl(urls, getVtuberModelUrlFromMetadata(el.metadata));
  }
};

/** In-scene media URLs to warm up before video rendering (signed resources, narration tracks, quiz assets, etc.). */
export function collectScenePlaybackAssetUrls(scene: Scene): string[] {
  const urls = new Set<string>();

  for (const u of collectSignableUrlsForPresign(scene)) urls.add(u);

  for (const slide of scene.slide_elements) {
    pushUrl(urls, slide.background_image_url);
    pushUrl(urls, slide.background_html_src);
    for (const el of slide.children_elements) walkElement(urls, el);
  }
  for (const audio of scene.audio_elements) pushUrl(urls, audio.source);
  for (const vtuber of scene.vtuber_elements) walkElement(urls, vtuber);

  if (scene.quiz) {
    for (const u of collectQuizAssetUrlsForPresign(scene.quiz)) urls.add(u);
    for (const q of scene.quiz.questions) {
      pushUrl(urls, q.content_narration_audio_url);
    }
  }

  return [...urls];
}

export function partitionScenePlaybackAssetUrls(urls: readonly string[]): {
  audio: string[];
  image: string[];
  video: string[];
  live2dModel: string[];
  other: string[];
} {
  const audio: string[] = [];
  const image: string[] = [];
  const video: string[] = [];
  const live2dModel: string[] = [];
  const other: string[] = [];

  for (const raw of urls) {
    const url = raw.trim();
    if (!url) continue;
    const lower = url.split("?")[0]?.toLowerCase() ?? url.toLowerCase();
    if (isLive2dModel3JsonUrl(url) || lower.endsWith(".inx")) {
      live2dModel.push(url);
      continue;
    }
    if (/\.(mp3|wav|ogg|m4a|aac|flac|opus)(?:$|[?#])/i.test(lower)) {
      audio.push(url);
      continue;
    }
    if (/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(lower)) {
      video.push(url);
      continue;
    }
    if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:$|[?#])/i.test(lower)) {
      image.push(url);
      continue;
    }
    other.push(url);
  }

  return { audio, image, video, live2dModel, other };
}
