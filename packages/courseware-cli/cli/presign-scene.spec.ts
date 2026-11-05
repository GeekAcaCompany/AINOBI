// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import type { Element as CourseElement, VtuberElement } from "@ainobi/courseware-core/elements.ts";
import {
  applySignedUrlsToSceneElements,
  collectSignableUrlsForPresign,
  prepareSceneAssetUrlsForPersistence as prepareWithNormalizer,
  presignUrlsInChunks,
} from "@ainobi/courseware-core/presign-scene.ts";
import { normalizeCoursewareAssetUrlForPersistence } from "./asset-url-persistence.ts";
import type { Scene } from "@ainobi/courseware-core/scene.ts";

// The CLI persists with its deployment URL policy.
const prepareSceneAssetUrlsForPersistence = (scene: Scene): Scene =>
  prepareWithNormalizer(scene, normalizeCoursewareAssetUrlForPersistence);

const baseElement = (overrides: Record<string, unknown>): CourseElement =>
  ({
    element_id: "el_test",
    name: "",
    locked: false,
    html: "",
    fps: 30,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    timeline: { start_at: 0, end_at: 1000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 0 },
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes: [],
    event_bindings: [],
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    metadata: {},
    ...overrides,
  }) as unknown as CourseElement;

const makeScene = (): Scene => ({
  scene_id: "sc_test",
  name: "test",
  controller: {
    play: true,
    next: true,
    back: true,
    seekBar: true,
    time: true,
    slideNumber: true,
    volume: true,
    fullScreen: true,
    brand: true,
    playbackRate: true,
  },
  transitions: [],
  preset_script: "",
  metadata: {},
  vtuber_elements: [],
  audio_elements: [
    baseElement({
      element_type: "audio",
      element_id: "el_global_audio",
      source: "tts_outputs/global.mp3",
      loop: false,
      volume: 1,
      fade_in_ms: 300,
      fade_out_ms: 300,
      source_start_at: 0,
      source_end_at: null,
    }) as Scene["audio_elements"][number],
  ],
  slide_elements: [
    baseElement({
      element_type: "slide",
      element_id: "el_slide",
      background_color: "#000000",
      background_image_url: "courseware_assets/background.png",
      background_image_fit: "cover",
      children_elements: [
        baseElement({
          element_type: "group",
          element_id: "el_group",
          children_elements: [
            baseElement({
              element_type: "image",
              element_id: "el_nested_image",
              source: "courseware_assets/nested/image.png",
              preserve_aspect_ratio: true,
              source_intrinsic_width: null,
              source_intrinsic_height: null,
            }),
          ],
        }),
        baseElement({
          element_type: "html",
          element_id: "el_html",
          src: "organization/html/page.html",
          html_event_bindings: {},
          children_elements: [
            baseElement({
              element_type: "audio",
              element_id: "el_nested_audio",
              source: "https://cdn.example.com/courseware_assets/nested/audio.mp3",
              loop: false,
              volume: 1,
              fade_in_ms: 300,
              fade_out_ms: 300,
              source_start_at: 0,
              source_end_at: null,
            }),
          ],
        }),
      ],
    }) as Scene["slide_elements"][number],
  ],
});

describe("collectSignableUrlsForPresign", () => {
  it("walks nested group/html children", () => {
    expect(collectSignableUrlsForPresign(makeScene())).toEqual(
      expect.arrayContaining([
        "courseware_assets/background.png",
        "courseware_assets/nested/image.png",
        "organization/html/page.html",
        "https://cdn.example.com/courseware_assets/nested/audio.mp3",
        "tts_outputs/global.mp3",
      ]),
    );
  });
});

describe("applySignedUrlsToSceneElements", () => {
  it("writes signed urls back into nested group/html children", () => {
    const next = applySignedUrlsToSceneElements(makeScene(), {
      "courseware_assets/background.png": "signed/background.png",
      "courseware_assets/nested/image.png": "signed/image.png",
      "organization/html/page.html": "signed/page.html",
      "https://cdn.example.com/courseware_assets/nested/audio.mp3": "signed/audio.mp3",
      "tts_outputs/global.mp3": "signed/global.mp3",
    });

    const group = next.slide_elements[0].children_elements[0] as Extract<
      CourseElement,
      { element_type: "group" }
    >;
    const html = next.slide_elements[0].children_elements[1] as Extract<
      CourseElement,
      { element_type: "html" }
    >;

    expect(next.slide_elements[0].background_image_url).toBe("signed/background.png");
    expect(group.children_elements[0]).toMatchObject({ source: "signed/image.png" });
    expect(html.src).toBe("signed/page.html");
    expect(html.children_elements[0]).toMatchObject({ source: "signed/audio.mp3" });
    expect(next.audio_elements[0].source).toBe("signed/global.mp3");
  });
});

describe("prepareSceneAssetUrlsForPersistence", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("persists internal signed OSS urls in nested elements as bare keys", () => {
    process.env.OSS_BUCKET = "example-courseware";
    process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1-internal.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const internalSigned =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/courseware_assets/nested/image.png?Signature=x";
    const scene = makeScene();
    const group = scene.slide_elements[0].children_elements[0] as Extract<
      CourseElement,
      { element_type: "group" }
    >;
    (group.children_elements[0] as Extract<CourseElement, { element_type: "image" }>).source =
      internalSigned;

    const next = prepareSceneAssetUrlsForPersistence(scene);
    const nextGroup = next.slide_elements[0].children_elements[0] as Extract<
      CourseElement,
      { element_type: "group" }
    >;

    expect(nextGroup.children_elements[0]).toMatchObject({
      source: "courseware_assets/nested/image.png",
    });
  });

  it("strips signed AI teacher metadata URLs on narration elements", () => {
    const signedModel =
      "https://example-storage-bucket-dev.s3.amazonaws.com/organization/org-1/ai_teachers/t1/live2d_model/Aka.inx?AWSAccessKeyId=AKIA&Signature=sig&Expires=1";
    const signedAvatar =
      "https://example-storage-bucket-dev.s3.amazonaws.com/public/avatar/ainobi-teacher-001.png?AWSAccessKeyId=AKIA&Signature=avatar&Expires=1";
    const scene = makeScene();
    const slide = scene.slide_elements[0];
    slide.children_elements.push(
      baseElement({
        element_type: "narration",
        element_id: "el_narration_meta",
        ai_teacher_id: "teacher_1",
        ai_teacher_name: "T",
        vtuber_element_id: "el_vtuber",
        script: "",
        transcript: "",
        subtitle_background_color: "#000",
        subtitle_background_opacity: 0.7,
        subtitle_background_transparent: false,
        subtitle_visible: true,
        metadata: {
          model_url: signedModel,
          ai_teacher_live2d_model_url: signedModel,
          ai_teacher_live2d_model_image_url: signedModel,
          ai_teacher_avatar_url: signedAvatar,
        },
        segments: [
          {
            text: "hi",
            audio_url: "https://cdn.example.com/tts_outputs/n1.mp3?Signature=nnn",
            duration_ms: 1000,
            gap_ms: 0,
          },
        ],
      }),
    );

    const next = prepareSceneAssetUrlsForPersistence(scene);
    const narration = next.slide_elements[0].children_elements.at(-1) as Extract<
      CourseElement,
      { element_type: "narration" }
    >;

    expect(narration.metadata.model_url).toBe(signedModel.split("?")[0]);
    expect(narration.metadata.ai_teacher_live2d_model_url).toBe(signedModel.split("?")[0]);
    expect(narration.metadata.ai_teacher_avatar_url).toBe(signedAvatar.split("?")[0]);
  });

  it("normalizes double-slash vtuber model URLs on save", () => {
    const broken =
      "https://example-storage-bucket-prod.s3.amazonaws.com//public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json";
    const fixed =
      "https://example-storage-bucket-prod.s3.amazonaws.com/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json";
    const scene = makeScene();
    scene.vtuber_elements = [
      baseElement({
        element_type: "vtuber",
        element_id: "el_vtuber_slash",
        model_id: "m_slash",
        expression: "neutral",
        motion: "idle",
        metadata: {
          model_url: broken,
          ai_teacher_live2d_model_url: broken,
          ai_teacher_live2d_model_image_url: broken,
        },
      }) as Extract<CourseElement, { element_type: "vtuber" }>,
    ];

    const next = prepareSceneAssetUrlsForPersistence(scene);
    const vtuber = next.vtuber_elements[0];
    expect(vtuber.metadata.model_url).toBe(fixed);
    expect(vtuber.metadata.ai_teacher_live2d_model_url).toBe(fixed);
    expect(vtuber.metadata.ai_teacher_live2d_model_image_url).toBe(fixed);
  });
});

/** Build a scene that exercises every element type known to carry a remote URL. */
const makeSignedScene = (): Scene => ({
  scene_id: "sc_signed",
  name: "signed",
  controller: {
    play: true,
    next: true,
    back: true,
    seekBar: true,
    time: true,
    slideNumber: true,
    volume: true,
    fullScreen: true,
    brand: true,
    playbackRate: true,
  },
  transitions: [],
  preset_script: "",
  metadata: {},
  vtuber_elements: [
    baseElement({
      element_type: "vtuber",
      element_id: "el_scene_vtuber",
      model_id: "m_default",
      expression: "neutral",
      motion: "idle",
      metadata: {
        model_url:
          "https://cdn.example.com/courseware_assets/models/global.model3.json?X-Amz-Signature=zzz",
        ai_teacher_live2d_model_url:
          "https://cdn.example.com/courseware_assets/models/teacher.model3.json?Signature=qqq",
      },
    }) as VtuberElement,
  ],
  audio_elements: [
    baseElement({
      element_type: "audio",
      element_id: "el_global_audio",
      source:
        "https://cdn.example.com/tts_outputs/global.mp3?OSSAccessKeyId=AAA&Expires=1&Signature=bbb",
      loop: false,
      volume: 1,
      fade_in_ms: 300,
      fade_out_ms: 300,
      source_start_at: 0,
      source_end_at: null,
    }) as Scene["audio_elements"][number],
  ],
  slide_elements: [
    baseElement({
      element_type: "slide",
      element_id: "el_slide",
      background_color: "#000000",
      background_image_url:
        "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/bg.png?OSSAccessKeyId=KKK&Expires=99&Signature=sss",
      background_image_fit: "cover",
      children_elements: [
        baseElement({
          element_type: "image",
          element_id: "el_raw_image",
          source:
            "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/foo.png?OSSAccessKeyId=KKK&Expires=99&Signature=sss",
          preserve_aspect_ratio: true,
          source_intrinsic_width: null,
          source_intrinsic_height: null,
        }),
        baseElement({
          element_type: "svg",
          element_id: "el_svg",
          source:
            "https://cdn.example.com/courseware_assets/icons/star.svg?X-Amz-Signature=xxx",
          preserve_aspect_ratio: true,
        }),
        baseElement({
          element_type: "video",
          element_id: "el_video",
          source:
            "https://cdn.example.com/courseware_assets/clips/intro.mp4?Signature=mmm",
          muted: false,
          loop: false,
          volume: 1,
        }),
        baseElement({
          element_type: "group",
          element_id: "el_group",
          children_elements: [
            baseElement({
              element_type: "image",
              element_id: "el_nested_image_in_group",
              source:
                "https://cdn.example.com/courseware_assets/group/nested.png?Expires=1&Signature=ppp",
              preserve_aspect_ratio: true,
              source_intrinsic_width: null,
              source_intrinsic_height: null,
            }),
          ],
        }),
        baseElement({
          element_type: "html",
          element_id: "el_html",
          src: "https://cdn.example.com/organization/html/page.html?Signature=hhh",
          html_event_bindings: {},
          children_elements: [
            baseElement({
              element_type: "audio",
              element_id: "el_nested_audio_in_html",
              source:
                "https://cdn.example.com/courseware_assets/html/audio.mp3?Signature=aaa",
              loop: false,
              volume: 1,
              fade_in_ms: 300,
              fade_out_ms: 300,
              source_start_at: 0,
              source_end_at: null,
            }),
          ],
        }),
        baseElement({
          element_type: "narration",
          element_id: "el_narration",
          ai_teacher_id: "teacher_1",
          ai_teacher_name: "T",
          vtuber_element_id: "",
          script: "",
          transcript: "",
          subtitle_background_color: "#000",
          subtitle_background_opacity: 0.7,
          subtitle_background_transparent: false,
          subtitle_visible: true,
          segments: [
            {
              text: "hi",
              audio_url:
                "https://cdn.example.com/tts_outputs/n1.mp3?Signature=nnn",
              duration_ms: 1000,
              gap_ms: 0,
            },
          ],
        }),
        baseElement({
          element_type: "quiz",
          element_id: "el_quiz",
          quiz_question_id: "qz_q_narrated",
        }),
      ],
    }) as Scene["slide_elements"][number],
  ],
  quiz: {
    enabled: true,
    total_score: 100,
    score_allocation: "custom",
    time_limit_minutes: null,
    questions: [
      {
        question_id: "qz_q_narrated",
        type: "single_choice",
        title: "示例题",
        explanation: "",
        score: 10,
        required: true,
        pass_score: 0,
        advance_score: 0,
        allow_resubmit: false,
        show_feedback_score: true,
        time_limit_minutes: null,
        content_narration_audio_url:
          "https://cdn.example.com/tts_outputs/qn.mp3?Signature=qqq",
        content_narration_duration_ms: 1000,
        content_narration_vtuber_element_id: "",
        react_layout: {
          kind: "element",
          tag: "QuizContainer",
          props: {},
          children: [],
        },
        options: [],
      },
    ],
    grade_levels: [],
    score_summary: null,
  } as Scene["quiz"],
});

describe("collectSignableUrlsForPresign (raw/ + svg + scene vtuber)", () => {
  it("treats raw/ paths, svg sources, and scene-level vtuber metadata as signable", () => {
    const urls = collectSignableUrlsForPresign(makeSignedScene());
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/bg.png?OSSAccessKeyId=KKK&Expires=99&Signature=sss",
        "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/foo.png?OSSAccessKeyId=KKK&Expires=99&Signature=sss",
        "https://cdn.example.com/courseware_assets/icons/star.svg?X-Amz-Signature=xxx",
        "https://cdn.example.com/courseware_assets/models/global.model3.json?X-Amz-Signature=zzz",
        "https://cdn.example.com/tts_outputs/qn.mp3?Signature=qqq",
      ]),
    );
  });
});

describe("ppt element presign (private-bucket slide HTML, Codex round-7 P1)", () => {
  const PPT_BASE = "https://courseware.geekaca.cn/artifact/pptx/0fc324f0fcc3859c382a446710924a64";
  const slideUrl = (n: number): string => `${PPT_BASE}/html/slide_${n}.html`;

  const makePptScene = (): Scene => ({
    ...makeScene(),
    slide_elements: [
      baseElement({
        element_type: "slide",
        element_id: "el_slide_ppt",
        children_elements: [
          baseElement({
            element_type: "ppt",
            element_id: "el_ppt",
            src: PPT_BASE,
            slide_count: 3,
            slide_ranges: [],
          }),
        ],
      }) as Scene["slide_elements"][number],
    ],
  });

  const pptElement = (scene: Scene): Extract<CourseElement, { element_type: "ppt" }> =>
    scene.slide_elements[0].children_elements[0] as Extract<CourseElement, { element_type: "ppt" }>;

  it("collects per-slide URLs (the base alone cannot carry a slide signature)", () => {
    expect(collectSignableUrlsForPresign(makePptScene())).toEqual(
      expect.arrayContaining([slideUrl(1), slideUrl(2), slideUrl(3)]),
    );
    // the bare artifact base is not collected — it is not a renderable object
    expect(collectSignableUrlsForPresign(makePptScene())).not.toContain(PPT_BASE);
  });

  it("honors slide_ranges when expanding slides", () => {
    const scene = makePptScene();
    (scene.slide_elements[0].children_elements[0] as Extract<CourseElement, { element_type: "ppt" }>).slide_ranges = [
      { start: 2, end: 3 },
    ];
    const urls = collectSignableUrlsForPresign(scene);
    expect(urls).toEqual(expect.arrayContaining([slideUrl(2), slideUrl(3)]));
    expect(urls).not.toContain(slideUrl(1));
  });

  it("fills the transient signed_slide_urls cache and strips it on persistence", () => {
    const signedByOriginal: Record<string, string> = {
      [slideUrl(1)]: "https://signed/slide_1.html?Signature=a",
      [slideUrl(2)]: "https://signed/slide_2.html?Signature=b",
      [slideUrl(3)]: "https://signed/slide_3.html?Signature=c",
    };
    const next = applySignedUrlsToSceneElements(makePptScene(), signedByOriginal);
    expect(pptElement(next).signed_slide_urls).toEqual({
      "1": signedByOriginal[slideUrl(1)],
      "2": signedByOriginal[slideUrl(2)],
      "3": signedByOriginal[slideUrl(3)],
    });
    // src itself stays the unsigned base (never a signature-bearing URL)
    expect(pptElement(next).src).toBe(PPT_BASE);

    const persisted = prepareSceneAssetUrlsForPersistence(next);
    expect(pptElement(persisted)).not.toHaveProperty("signed_slide_urls");
    expect(pptElement(persisted).src).toBe(PPT_BASE);
  });

  it("leaves ppt elements untouched when nothing was signed", () => {
    const next = applySignedUrlsToSceneElements(makePptScene(), {});
    expect(pptElement(next)).not.toHaveProperty("signed_slide_urls");
  });
});

describe("batchPresignUrlsInChunks (server filePaths limit is 100, Codex round-8 P1)", () => {
  const makeApi = () => {
    const calls: string[][] = [];
    const api = {
      batchPresignUrls: async (_coursewareId: string, urls: string[]) => {
        calls.push(urls);
        if (urls.length > 100) throw new Error("server would reject: max(100)");
        return Object.fromEntries(urls.map((u) => [u, `signed:${u}`]));
      },
    };
    return { api, calls };
  };

  it("sends a single batch at or below the limit", async () => {
    const { api, calls } = makeApi();
    const urls = Array.from({ length: 100 }, (_, i) => `raw/png/${i}.png`);
    const merged = await presignUrlsInChunks((batch) => api.batchPresignUrls("cw-1", batch), urls);
    expect(calls).toHaveLength(1);
    expect(Object.keys(merged)).toHaveLength(100);
  });

  it("chunks large slide sets and merges the maps", async () => {
    const { api, calls } = makeApi();
    // 120-page ppt + a few assets → 123 urls → 100 + 23
    const urls = [
      ...Array.from({ length: 120 }, (_, i) => `artifact/pptx/${"a".repeat(32)}/html/slide_${i + 1}.html`),
      "tts_outputs/global.mp3",
      "courseware_assets/bg.png",
      "courseware_assets/nested.png",
    ];
    const merged = await presignUrlsInChunks((batch) => api.batchPresignUrls("cw-1", batch), urls);
    expect(calls.map((c) => c.length)).toEqual([100, 23]);
    expect(Object.keys(merged)).toHaveLength(123);
    expect(merged["tts_outputs/global.mp3"]).toBe("signed:tts_outputs/global.mp3");
    expect(merged[urls[119]]).toBe(`signed:${urls[119]}`);
  });
});
