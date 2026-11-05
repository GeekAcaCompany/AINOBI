// SPDX-License-Identifier: AGPL-3.0-only
import * as yup from "yup";
import {
  deserializeElement,
  deserializeElementWithIssues,
  normalizeElementForSerialization,
  serializeElement,
  type AudioElement,
  type SlideElement,
  type DeserializeOptions,
  type DeserializeResult,
  type Element,
  type ParseIssue,
  type VtuberElement,
} from "./elements.ts";
import { TRANSITION_VALUES, Transitions, type Transition } from "./enums/transitions.ts";
import { deserializeQuizConfig, serializeQuizConfig, type QuizConfig } from "./quiz.ts";
import { stripUndefinedDeep } from "./strip-undefined.ts";

const newSceneId = (): string => {
  const nativeCrypto = globalThis.crypto;
  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return `sc_${nativeCrypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `sc_${`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 12)}`;
};

export interface SceneController {
  play: boolean;
  next: boolean;
  back: boolean;
  seekBar: boolean;
  time: boolean;
  slideNumber: boolean;
  volume: boolean;
  fullScreen: boolean;
  brand: boolean;
  playbackRate: boolean;
}

export interface Scene {
  scene_id: string;
  name: string;
  slide_elements: SlideElement[];
  vtuber_elements: VtuberElement[];
  /**
   * Global background music / sound effect track. Each element is a standard AudioElement,
   * whose timeline.start_at / timeline.end_at are the enter / exit points on the scene's global timeline
   * (= the sum of all slide durations);
   * fade_in_ms / fade_out_ms control fading in and out.
   */
  audio_elements: AudioElement[];
  controller: SceneController;
  transitions: Transition[];
  preset_script: string;
  metadata: Record<string, unknown>;
  /**
   * Quiz config. null means the scene has no quiz;
   * it is omitted from the JSON on serialization, so old courseware JSON round-trips unchanged.
   */
  quiz?: QuizConfig | null;
}

export interface SceneScriptHost {
  currentSlideIndex?: number;
  getCurrentSlideIndex?: () => number;
  slideCount: number;
  goToSlide: (index: number) => void;
  openExternalUrl?: (url: string, target: "_blank" | "_self") => void;
}

export interface SceneScriptRuntime {
  getCurrentSlideIndex: () => number;
  getCurrentPage: () => number;
  getSlideCount: () => number;
  canGoPrevious: () => boolean;
  canGoNext: () => boolean;
  isFirstSlide: () => boolean;
  isLastSlide: () => boolean;
  firstSlide: () => number;
  lastSlide: () => number;
  previousSlide: () => number;
  nextSlide: () => number;
  jumpRelative: (offset: number) => number;
  jumpToSlide: (index: number) => number;
  jumpToPage: (page: number) => number;
  openUrl: (url: string, target?: "_blank" | "_self") => void;
  openUrlInNewTab: (url: string) => void;
  openUrlInCurrentTab: (url: string) => void;
}

const clampSlideIndex = (index: number, max: number): number => {
  if (max <= 0) return 0;
  return Math.min(Math.max(index, 0), max - 1);
};

export const createSceneScriptRuntime = (host: SceneScriptHost): SceneScriptRuntime => {
  const getCurrentSlideIndex = (): number => {
    if (typeof host.getCurrentSlideIndex === "function") {
      const value = host.getCurrentSlideIndex();
      if (Number.isFinite(value)) return clampSlideIndex(Math.floor(value), host.slideCount);
      return 0;
    }
    return clampSlideIndex(host.currentSlideIndex ?? 0, host.slideCount);
  };
  const jumpToSlide = (index: number): number => {
    const safeIndex = Number.isFinite(index) ? clampSlideIndex(Math.floor(index), host.slideCount) : 0;
    host.goToSlide(safeIndex);
    return safeIndex;
  };
  const openUrl = (url: string, target: "_blank" | "_self" = "_blank"): void => {
    host.openExternalUrl?.(url, target);
  };
  return {
    getCurrentSlideIndex,
    getCurrentPage: () => getCurrentSlideIndex() + 1,
    getSlideCount: () => host.slideCount,
    canGoPrevious: () => getCurrentSlideIndex() > 0,
    canGoNext: () => getCurrentSlideIndex() + 1 < host.slideCount,
    isFirstSlide: () => getCurrentSlideIndex() === 0,
    isLastSlide: () => host.slideCount <= 0 || getCurrentSlideIndex() >= host.slideCount - 1,
    firstSlide: () => jumpToSlide(0),
    lastSlide: () => jumpToSlide(host.slideCount - 1),
    previousSlide: () => jumpToSlide(getCurrentSlideIndex() - 1),
    nextSlide: () => jumpToSlide(getCurrentSlideIndex() + 1),
    jumpRelative: (offset: number) => jumpToSlide(getCurrentSlideIndex() + (Number.isFinite(offset) ? offset : 0)),
    jumpToSlide,
    jumpToPage: (page: number) => jumpToSlide((Number.isFinite(page) ? Math.floor(page) : 1) - 1),
    openUrl,
    openUrlInNewTab: (url: string) => openUrl(url, "_blank"),
    openUrlInCurrentTab: (url: string) => openUrl(url, "_self"),
  };
};

export const runScenePresetScript = (
  script: string,
  runtime: SceneScriptRuntime,
  payload: Record<string, unknown> = {},
): unknown => {
  const runner = new Function("preset", "payload", `"use strict";\n${script}`);
  return runner(runtime, payload);
};

const controllerSchema: yup.ObjectSchema<SceneController> = yup
  .object({
    play: yup.boolean().required().default(true),
    next: yup.boolean().required().default(true),
    back: yup.boolean().required().default(true),
    seekBar: yup.boolean().required().default(true),
    time: yup.boolean().required().default(true),
    slideNumber: yup.boolean().required().default(true),
    volume: yup.boolean().required().default(true),
    fullScreen: yup.boolean().required().default(true),
    brand: yup.boolean().required().default(true),
    playbackRate: yup.boolean().required().default(true),
  })
  .required();

const sceneSchema: yup.ObjectSchema<Scene> = yup
  .object({
    scene_id: yup.string().required().default(newSceneId),
    name: yup.string().defined().default(""),
    controller: controllerSchema.required().default(() => controllerSchema.getDefault()),
    transitions: yup.array(yup.mixed<Transition>().oneOf(TRANSITION_VALUES).required()).required().default([]),
    preset_script: yup.string().defined().default(""),
    metadata: yup.object().required().default({}).unknown(true),
    slide_elements: yup.array(yup.mixed<SlideElement>().required()).required().default([]),
    vtuber_elements: yup.array(yup.mixed<VtuberElement>().required()).required().default([]),
    audio_elements: yup.array(yup.mixed<AudioElement>().required()).required().default([]),
    quiz: yup.mixed<QuizConfig>().nullable().optional().default(null),
  })
  .required()
  .unknown(false);

const issueFromError = (error: unknown, path: string, node: unknown): ParseIssue => {
  if (!(error instanceof yup.ValidationError)) {
    return { path, message: error instanceof Error ? error.message : String(error), node };
  }
  const detail =
    error.inner.length > 0
      ? error.inner.map((item) => `${item.path ?? "(root)"}: ${item.message}`).join("; ")
      : error.message;
  return { path, message: detail, node };
};

const transitionsBetween = (scene: Scene): Transition[] => {
  const needed = Math.max(0, scene.slide_elements.length - 1);
  const out = [...scene.transitions];
  while (out.length < needed) out.push(Transitions.NONE);
  return out.slice(0, needed);
};

export const serializeScene = (scene: Scene): unknown => {
  const base = sceneSchema.validateSync(scene, { strict: true, abortEarly: false, stripUnknown: false });
  const out: Record<string, unknown> = {
    ...base,
    slide_elements: scene.slide_elements.map((slide) =>
      serializeElement(normalizeElementForSerialization(slide) as SlideElement),
    ),
    vtuber_elements: scene.vtuber_elements.map((vtuber) => serializeElement(vtuber)),
    audio_elements: scene.audio_elements.map((audio) => serializeElement(audio)),
    transitions: transitionsBetween(scene),
  };
  if (scene.quiz) {
    out.quiz = serializeQuizConfig(scene.quiz);
  } else {
    delete out.quiz;
  }
  return stripUndefinedDeep(out);
};

export const deserializeScene = (input: unknown, options: DeserializeOptions = {}): Scene => {
  const issues: ParseIssue[] = [];
  const onIssue = (issue: ParseIssue): void => {
    issues.push(issue);
    options.onIssue?.(issue);
  };
  try {
    // Backward compat: older JSON may omit audio_elements; pre-fill to []
    // so that the strict-mode schema validation does not reject the scene.
    const inputWithDefaults =
      typeof input === "object" && input !== null
        ? {
            audio_elements: [],
            ...(input as Record<string, unknown>),
          }
        : input;
    const base = sceneSchema.validateSync(inputWithDefaults, {
      strict: true,
      abortEarly: false,
      stripUnknown: false,
    });
    const source = (input ?? {}) as {
      slide_elements?: unknown;
      vtuber_elements?: unknown;
      audio_elements?: unknown;
    };
    const slide_elements: SlideElement[] = [];
    const vtuber_elements: VtuberElement[] = [];
    const audio_elements: AudioElement[] = [];

    if (!Array.isArray(source.slide_elements)) {
      throw new Error("slide_elements must be an array");
    }
    for (let index = 0; index < source.slide_elements.length; index += 1) {
      const nodePath = `root.slide_elements[${index}]`;
      try {
        const element = deserializeElement(source.slide_elements[index], {
          ...options,
          onIssue,
        }, nodePath);
        if (element.element_type === "slide") {
          slide_elements.push(element);
        } else if (options.skipInvalidNodes) {
          onIssue({
            path: nodePath,
            message: `expected slide, got ${element.element_type}`,
            node: source.slide_elements[index],
          });
        } else {
          throw new Error(`expected slide, got ${element.element_type}`);
        }
      } catch (error) {
        if (!options.skipInvalidNodes) throw error;
        onIssue(issueFromError(error, nodePath, source.slide_elements[index]));
      }
    }

    if (Array.isArray(source.vtuber_elements)) {
      for (let index = 0; index < source.vtuber_elements.length; index += 1) {
        const nodePath = `root.vtuber_elements[${index}]`;
        try {
          const element = deserializeElement(source.vtuber_elements[index], {
            ...options,
            onIssue,
          }, nodePath);
          if (element.element_type === "vtuber") {
            vtuber_elements.push(element);
          } else if (options.skipInvalidNodes) {
            onIssue({
              path: nodePath,
              message: `expected vtuber, got ${element.element_type}`,
              node: source.vtuber_elements[index],
            });
          } else {
            throw new Error(`expected vtuber, got ${element.element_type}`);
          }
        } catch (error) {
          if (!options.skipInvalidNodes) throw error;
          onIssue(issueFromError(error, nodePath, source.vtuber_elements[index]));
        }
      }
    }

    if (Array.isArray(source.audio_elements)) {
      for (let index = 0; index < source.audio_elements.length; index += 1) {
        const nodePath = `root.audio_elements[${index}]`;
        try {
          const element = deserializeElement(source.audio_elements[index], {
            ...options,
            onIssue,
          }, nodePath);
          if (element.element_type === "audio") {
            audio_elements.push(element);
          } else if (options.skipInvalidNodes) {
            onIssue({
              path: nodePath,
              message: `expected audio, got ${element.element_type}`,
              node: source.audio_elements[index],
            });
          } else {
            throw new Error(`expected audio, got ${element.element_type}`);
          }
        } catch (error) {
          if (!options.skipInvalidNodes) throw error;
          onIssue(issueFromError(error, nodePath, source.audio_elements[index]));
        }
      }
    }

    const maxTransitions = Math.max(0, slide_elements.length - 1);
    if (base.transitions.length > maxTransitions) {
      const issue = {
        path: "root.transitions",
        message: `too many transitions: expected at most ${maxTransitions}, got ${base.transitions.length}`,
        node: base.transitions,
      };
      if (!options.skipInvalidNodes) throw new Error(`${issue.path}: ${issue.message}`);
      onIssue(issue);
    }

    let quiz: QuizConfig | null = null;
    const rawQuiz = (input as { quiz?: unknown } | null)?.quiz;
    if (rawQuiz !== undefined && rawQuiz !== null) {
      try {
        quiz = deserializeQuizConfig(rawQuiz, "root.quiz");
      } catch (error) {
        if (!options.skipInvalidNodes) throw error;
        onIssue(issueFromError(error, "root.quiz", rawQuiz));
      }
    }

    return {
      ...base,
      slide_elements,
      vtuber_elements,
      audio_elements,
      transitions: base.transitions.slice(0, maxTransitions),
      quiz,
    };
  } catch (error) {
    const issue = issueFromError(error, "root", input);
    if (!options.skipInvalidNodes) {
      throw new Error(`${issue.path}: ${issue.message}`);
    }
    onIssue(issue);
    return {
      scene_id: newSceneId(),
      name: "invalid-scene-fallback",
      slide_elements: [],
      vtuber_elements: [],
      audio_elements: [],
      controller: controllerSchema.getDefault() as SceneController,
      transitions: [],
      preset_script: "",
      metadata: {},
      quiz: null,
    };
  }
};

export const deserializeSceneWithIssues = (
  input: unknown,
  options: DeserializeOptions = {},
): DeserializeResult<Scene> => {
  const issues: ParseIssue[] = [];
  const value = deserializeScene(input, {
    ...options,
    onIssue: (issue) => {
      issues.push(issue);
      options.onIssue?.(issue);
    },
  });
  return { value, issues };
};

export const deserializeAnyElementWithIssues = (
  input: unknown,
  options: DeserializeOptions = {},
): DeserializeResult<Element> => deserializeElementWithIssues(input, options);
