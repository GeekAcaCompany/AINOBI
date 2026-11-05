// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "bin", "ainobi.mjs");

const run = (stateDir: string, args: string[], envOverrides: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
    cwd: root,
    encoding: "utf-8",
    env: {
      ...process.env,
      AINOBI_SESSION: "cli-smoke",
      AINOBI_STATE_DIR: stateDir,
      ...envOverrides,
    },
  });
  const text = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error(`CLI output was not JSON:\n${text}`);
  }
  assert.equal(result.status, 0, text);
  assert.equal((parsed as { ok?: unknown }).ok, true, text);
  return parsed as { ok: true; data: Record<string, unknown> };
};

const runBoundToShell = (
  stateDir: string,
  shellSession: string,
  args: string[],
  envOverrides: Record<string, string> = {},
) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AINOBI_STATE_DIR: stateDir,
    AINOBI_SHELL_SESSION: shellSession,
    ...envOverrides,
  };
  delete env.AINOBI_SESSION;

  const result = spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
    cwd: root,
    encoding: "utf-8",
    env,
  });
  const text = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error(`CLI output was not JSON:\n${text}`);
  }
  assert.equal(result.status, 0, text);
  assert.equal((parsed as { ok?: unknown }).ok, true, text);
  return parsed as { ok: true; data: Record<string, unknown> };
};

const runBoundToShellExpectFailure = (
  stateDir: string,
  shellSession: string,
  args: string[],
  expectedStatus = 2,
  envOverrides: Record<string, string> = {},
) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AINOBI_STATE_DIR: stateDir,
    AINOBI_SHELL_SESSION: shellSession,
    ...envOverrides,
  };
  delete env.AINOBI_SESSION;

  const result = spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
    cwd: root,
    encoding: "utf-8",
    env,
  });
  const text = result.stderr || result.stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error(`CLI output was not JSON:\n${text}`);
  }
  assert.notEqual(result.status, 0, text);
  assert.equal((parsed as { ok?: unknown }).ok, false, text);
  if (expectedStatus !== undefined) {
    assert.equal(result.status, expectedStatus, text);
  }
  return parsed as { ok: false; error: { code: string; message: string; hint?: string } };
};

const runExpectFailure = (
  stateDir: string,
  args: string[],
  expectedStatus = 2,
  envOverrides: Record<string, string> = {},
) => {
  const result = spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
    cwd: root,
    encoding: "utf-8",
    env: {
      ...process.env,
      AINOBI_SESSION: "cli-smoke",
      AINOBI_STATE_DIR: stateDir,
      ...envOverrides,
    },
  });
  const text = result.stderr || result.stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error(`CLI output was not JSON:\n${text}`);
  }
  assert.notEqual(result.status, 0, text);
  assert.equal((parsed as { ok?: unknown }).ok, false, text);
  if (expectedStatus !== undefined) {
    assert.equal(result.status, expectedStatus, text);
  }
  return parsed as { ok: false; error: { code: string; message: string; hint?: string } };
};

test("init creates a unique session and binds it to the shell", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-auto-session-"));
  const shellSession = "cli-smoke-auto-shell";

  const init = runBoundToShell(stateDir, shellSession, ["init", "--name", "Auto", "--language", "en", "--first-slide"]).data;
  const sessionId = init.session_id as string;
  assert.match(sessionId, /^ainobi-/);
  const initWorkDir = init.work_dir as string;
  assert.ok(existsSync(initWorkDir));

  const status = runBoundToShell(stateDir, shellSession, ["status"]).data;
  assert.equal(status.session_id, sessionId);
  assert.equal(status.loaded, true);
  assert.equal(status.work_dir, initWorkDir);
  assert.equal((status.scene as { name: string }).name, "Auto");

  runBoundToShell(stateDir, shellSession, [
    "element",
    "insert",
    "0",
    "--type",
    "text",
    "--set",
    "text=Bound session",
  ]);
  const inserted = runBoundToShell(stateDir, shellSession, ["element", "get", "0", "0"]).data.element as {
    text: string;
    name: string;
  };
  assert.equal(inserted.text, "Bound session");
  assert.equal(inserted.name, "文本1");

  const imageInsert = runBoundToShell(stateDir, shellSession, [
    "element",
    "insert",
    "0",
    "--type",
    "image",
    "--set",
    `source=${process.env.AINOBI_COURSEWARE_ASSET_BASE_URL ?? "https://example-courseware.oss-ap-northeast-1.aliyuncs.com"}/raw/png/example.png`,
  ]);
  const imageWarnings = (imageInsert as { warnings?: Array<{ message?: string }> }).warnings ?? [];
  assert.ok(
    imageWarnings.some((w) => typeof w.message === "string" && w.message.includes("Assigned default name")),
    "expected default-name warning",
  );
  const imageEl = runBoundToShell(stateDir, shellSession, ["element", "get", "0", "1"]).data.element as {
    name: string;
  };
  assert.equal(imageEl.name, "图片1");

  const secondInit = runBoundToShell(stateDir, shellSession, ["init", "--name", "Next", "--language", "en"]).data;
  assert.notEqual(secondInit.session_id, sessionId);
  assert.notEqual(secondInit.work_dir, initWorkDir);
  assert.equal(existsSync(initWorkDir), false);
  assert.ok(existsSync(secondInit.work_dir as string));
  const nextStatus = runBoundToShell(stateDir, shellSession, ["status"]).data;
  assert.equal(nextStatus.session_id, secondInit.session_id);
  assert.equal((nextStatus.scene as { name: string }).name, "Next");
});

test("agent authoring smoke flow", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-smoke-"));
  const batchFile = join(stateDir, "batch.json");
  writeFileSync(
    batchFile,
    JSON.stringify({
      operations: [
        { op: "slide.template", kind: "hero", title: "Intro", subtitle: "Smoke" },
      ],
    }),
  );

  const initData = run(stateDir, ["init", "--name", "Smoke", "--language", "en", "--first-slide"]).data;
  const workDir = initData.work_dir as string;
  assert.ok(existsSync(workDir));
  const initScene = initData.scene as { slide_count: number };
  assert.equal(initScene.slide_count, 1);
  // The auto-created first slide carries no language-specific placeholder name;
  // the student editor renders a localized label for empty slide names.
  const initSlides = run(stateDir, ["slide", "list"]).data.slides as Array<{ name: string }>;
  assert.equal(initSlides[0]?.name, "");
  const timedInsert = run(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "text",
    "--start",
    "1200",
    "--duration",
    "2400",
    "--set",
    "text=Line 1\\nLine 2",
  ]).data.element as { timeline: { start_at: number; end_at: number } };
  assert.deepEqual(timedInsert.timeline, { start_at: 1200, end_at: 3600 });
  const multilineElement = run(stateDir, ["element", "get", "0", "0"]).data.element as { text: string };
  assert.equal(multilineElement.text, "Line 1\nLine 2");
  run(stateDir, ["animation", "preset", "0", "0", "--kind", "fade-in", "--start", "1400", "--to", "2000"]);
  const animatedElement = run(stateDir, ["element", "get", "0", "0"]).data.element as {
    keyframes: Array<{ at: number }>;
  };
  assert.deepEqual(animatedElement.keyframes.map((keyframe) => keyframe.at), [1400, 2000]);
  const coverage = run(stateDir, ["inspect", "timeline", "--coverage"]).data as {
    coverage: Array<{ visual_start_at: number; visual_end_at: number; empty_gaps: unknown[] }>;
  };
  assert.equal(coverage.coverage[0]?.visual_start_at, 1200);
  assert.equal(coverage.coverage[0]?.visual_end_at, 3600);
  assert.ok(Array.isArray(coverage.coverage[0]?.empty_gaps));
  const savedScenePath = join(stateDir, "multiline.scene.json");
  const saveResult = run(stateDir, ["save", savedScenePath]).data;
  assert.equal(saveResult.work_dir, workDir);
  assert.equal(saveResult.work_dir_cleaned, true);
  assert.equal(existsSync(workDir), false);
  const savedScene = JSON.parse(readFileSync(savedScenePath, "utf-8")) as {
    slide_elements: Array<{ children_elements: Array<{ text?: string }> }>;
  };
  assert.equal(savedScene.slide_elements[0]?.children_elements[0]?.text, "Line 1\nLine 2");
  assert.equal(readFileSync(savedScenePath, "utf-8").includes("Line 1\\\\nLine 2"), false);
  const teachersFile = join(stateDir, "teachers.json");
  writeFileSync(
    teachersFile,
    JSON.stringify({
      ai_teachers: [
        {
          ai_teacher_id: "teacher-custom",
          ai_teacher_name: "Custom Teacher",
          model_url: "https://example.com/custom-teacher.model3.json",
          ai_teacher_tts_id: "voice-custom",
          ai_teacher_tts_speed: 1.1,
          ai_teacher_tts_volume: 0.8,
          ai_teacher_tts_pitch: 2,
          ai_teacher_language: "Chinese",
        },
      ],
    }),
  );
  const loadedData = run(stateDir, ["load", savedScenePath, "--teacher-file", teachersFile]).data;
  assert.equal(loadedData.ai_teacher_count, 1);
  assert.ok(existsSync(loadedData.work_dir as string));
  const narrationInsert = run(stateDir, [
    "narration",
    "insert",
    "0",
    "--teacher-id",
    "teacher-custom",
    "--script",
    "Hello from teacher",
    "--transcript",
    "老师讲解",
  ], { AINOBI_TTS_STUB: "1" }).data as { teacher_source: string; vtuber_element_id: string };
  assert.equal(narrationInsert.teacher_source, "external");
  const lectureElements = run(stateDir, ["element", "list", "0", "--verbose"]).data.elements as Array<{
    element_type: string;
    locked?: boolean;
    ai_teacher_id?: string;
    ai_teacher_tts_id?: string;
    ai_teacher_tts_speed?: number;
    ai_teacher_tts_volume?: number;
    ai_teacher_tts_pitch?: number;
    ai_teacher_language?: string;
    vtuber_element_id?: string;
    metadata?: Record<string, unknown>;
    model_id?: string;
  }>;
  const vtuber = lectureElements.find((element) => element.element_type === "vtuber");
  const narration = lectureElements.find((element) => element.element_type === "narration");
  assert.equal(vtuber?.locked, true);
  assert.equal(narration?.locked, true);
  assert.equal(vtuber?.model_id, "teacher-custom");
  assert.equal(vtuber?.metadata?.runtime, "live2d");
  assert.equal(vtuber?.ai_teacher_tts_id, "voice-custom");
  assert.equal(narration?.ai_teacher_id, "teacher-custom");
  assert.equal(narration?.ai_teacher_tts_speed, 1.1);
  assert.equal(narration?.ai_teacher_tts_volume, 0.8);
  assert.equal(narration?.ai_teacher_tts_pitch, 2);
  assert.equal(narration?.ai_teacher_language, "Chinese");
  assert.equal(narration?.vtuber_element_id, narrationInsert.vtuber_element_id);
  assert.equal(run(stateDir, ["batch", "dry-run", batchFile]).data.dirty, false);
  assert.equal(run(stateDir, ["batch", "apply", batchFile]).data.operations_applied, 1);
  assert.equal(run(stateDir, ["slide", "duplicate", "1"]).data.source_index, 1);

  const quizSlideInsert = run(stateDir, [
    "slide",
    "insert",
    "--set",
    "name=Quiz",
    "--set",
    "background_color=#0F172A",
  ]).data as { inserted_at: number };
  const quizSlideIndex = quizSlideInsert.inserted_at as number;
  assert.equal(run(stateDir, ["quiz", "init", "--total-score", "100"]).data.total_score, 100);
  assert.ok(
    run(stateDir, [
      "quiz",
      "insert",
      String(quizSlideIndex),
      "--type",
      "single_choice",
      "--title",
      "2+2?",
      // Two questions on one slide: side by side (the default box is full-slide, so
      // leaving both at the default stacks them — validate reports a content overlap).
      "--position-x",
      "80",
      "--size-w",
      "860",
    ]).data.quiz_element_id,
  );
  assert.ok(
    run(stateDir, [
      "quiz",
      "insert",
      String(quizSlideIndex),
      "--type",
      "single_choice",
      "--title",
      "3+3?",
      "--position-x",
      "980",
      "--size-w",
      "860",
    ]).data.quiz_element_id,
  );
  const quizSlideElements = run(stateDir, ["element", "list", String(quizSlideIndex), "--verbose"]).data
    .elements as Array<{
    element_type: string;
    timeline?: { start_at: number };
  }>;
  const questionElements = quizSlideElements.filter((element) => element.element_type === "quiz");
  assert.equal(questionElements.length, 2);
  assert.equal(questionElements[0]?.timeline?.start_at, 0);
  assert.equal(questionElements[1]?.timeline?.start_at, 0);
  const slideCount = (run(stateDir, ["slide", "list"]).data.slide_count as number) ?? 0;
  const staggerSkipTypes = new Set(["html", "quiz", "quiz_score_summary", "vtuber", "narration"]);
  for (let slideIndex = 0; slideIndex < slideCount; slideIndex += 1) {
    const elements = run(stateDir, ["element", "list", String(slideIndex)]).data.elements as Array<{
      element_id: string;
      element_type: string;
      locked?: boolean;
    }>;
    const staggerable = elements.filter(
      (element) => !staggerSkipTypes.has(element.element_type) && element.locked !== true,
    );
    if (staggerable.length === 0) continue;
    const ids = staggerable.map((element) => element.element_id).join(",");
    assert.equal(
      run(stateDir, ["animation", "stagger", String(slideIndex), "--ids", ids]).data.animated,
      staggerable.length,
    );
  }
  const validateResult = run(stateDir, ["validate", "--publish"]).data as {
    valid: boolean;
    no_motion_slide_count?: number;
  };
  assert.equal(validateResult.valid, true);
  assert.equal(validateResult.no_motion_slide_count ?? 0, 0);
  assert.ok(Array.isArray(run(stateDir, ["inspect", "timeline"]).data.slides));
});

test("publish validation accepts html assets on courseware html cdn base url", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-html-url-policy-"));
  run(stateDir, ["init", "--name", "HTML URL Policy", "--language", "en", "--first-slide"]);
  run(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "html",
    "--set",
    "src=https://courseware.example.com/raw/html/example.html",
  ]);
  run(stateDir, ["animation", "preset", "0", "0", "--start", "0", "--to", "800"]);

  const valid = run(stateDir, ["validate", "--publish"]).data as { valid: boolean };
  assert.equal(valid.valid, true);
});

test("publish validation rejects hallucinated external asset urls", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-url-policy-"));
  run(stateDir, ["init", "--name", "URL Policy", "--language", "en", "--first-slide"]);
  run(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "audio",
    "--set",
    "source=https://example.com/audio.mp3",
  ]);
  run(stateDir, ["animation", "preset", "0", "0", "--start", "0", "--to", "800"]);

  const invalid = run(stateDir, ["validate", "--publish"]).data as {
    valid: boolean;
    issues: Array<{ path: string; message: string; value: string }>;
  };
  assert.equal(invalid.valid, false);
  assert.equal(invalid.issues[0]?.path.includes(".source"), true);
  assert.match(invalid.issues[0]?.message ?? "", /External courseware asset URL/);
  assert.equal(invalid.issues[0]?.value, "https://example.com/audio.mp3");

  // The base-URL override env var is `AINOBI_COURSEWARE_ASSET_BASE_URLS`
  // (plural, comma-separated). Multiple bases can be allow-listed at once.
  const validWithOverride = run(stateDir, ["validate", "--publish"], {
    AINOBI_COURSEWARE_ASSET_BASE_URLS: "https://example.com",
  }).data as { valid: boolean };
  assert.equal(validWithOverride.valid, true);
});

test("element insert --json decodes literal \\\\n in text field", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-json-newlines-"));
  run(stateDir, ["init", "--name", "JSON NL", "--language", "en", "--first-slide"]);
  run(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "text",
    "--json",
    '{"text":"JSON Line 1\\\\nJSON Line 2","font_size":28}',
  ]);
  const element = run(stateDir, ["element", "get", "0", "0"]).data.element as { text: string };
  assert.equal(element.text, "JSON Line 1\nJSON Line 2");
});

test("narration insert decodes \\\\n in --transcript and --script flags", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-narration-newlines-"));
  run(stateDir, ["init", "--name", "NL", "--language", "en", "--first-slide"]);
  const teachersFile = join(stateDir, "teachers.json");
  writeFileSync(
    teachersFile,
    JSON.stringify({
      ai_teachers: [
        {
          ai_teacher_id: "teacher-newline",
          ai_teacher_name: "Newline Teacher",
          model_url: "https://example.com/newline-teacher.model3.json",
        },
      ],
    }),
  );
  run(
    stateDir,
    [
      "narration",
      "insert",
      "0",
      "--teacher-file",
      teachersFile,
      "--teacher-id",
      "teacher-newline",
      "--script",
      "脚本第一行\\n脚本第二行",
      "--transcript",
      "字幕第一行\\n字幕第二行",
    ],
    { AINOBI_TTS_STUB: "1" },
  );
  const narration = run(stateDir, ["element", "list", "0", "--verbose"]).data.elements as Array<{
    element_type: string;
    script?: string;
    transcript?: string;
    segments?: unknown[];
  }>;
  const row = narration.find((element) => element.element_type === "narration");
  assert.equal(row?.script, "脚本第一行\n脚本第二行");
  assert.equal(row?.transcript, "字幕第一行\n字幕第二行");
  assert.equal(JSON.stringify(row).includes("\\\\n"), false);
});

test("element update fills partial keyframes and numeric text instead of failing validation", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-gaps-"));
  run(stateDir, ["init", "--name", "Gaps", "--language", "zh", "--first-slide"]);
  run(stateDir, ["element", "insert", "0", "--type", "text", "--name", "数字", "--set", "text=1"]);
  const updated = run(stateDir, [
    "element",
    "update",
    "0",
    "0",
    "--json",
    JSON.stringify({ text: 2026, keyframes: [{ at: 0, opacity: 0 }, { at: 400, opacity: 1 }] }),
  ]) as { ok: true; data: Record<string, unknown>; warnings?: Array<{ message: string }> };
  assert.ok(updated.warnings?.some((w) => /Auto-fixed input: .*text was a number.*keyframes missing/.test(w.message)));
  const element = run(stateDir, ["element", "get", "0", "0"]).data.element as {
    text: string;
    keyframes: Array<{ easing: string; size: { width: number } }>;
  };
  assert.equal(element.text, "2026");
  assert.equal(element.keyframes.length, 2);
  assert.equal(element.keyframes[0]!.easing, "linear");
});

test("asset-backed insert with corrupt text fails before the asset is uploaded", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-fffd-asset-"));
  run(stateDir, ["init", "--name", "Asset", "--language", "zh", "--first-slide"]);
  const png = join(stateDir, "pixel.png");
  writeFileSync(
    png,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
  );
  const failure = runExpectFailure(
    stateDir,
    ["element", "insert", "0", "--type", "image", "--asset", png, "--name", "bad\uFFFDname"],
    6,
  );
  assert.equal(failure.error.code, "INVALID_INPUT");
  assert.match(failure.error.message, /U\+FFFD/);
});

test("root width is normalized before --center-x so centering uses the final size", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-center-width-"));
  run(stateDir, ["init", "--name", "Center", "--language", "zh", "--first-slide"]);
  run(stateDir, ["element", "insert", "0", "--type", "text", "--name", "t", "--set", "text=x", "--set", "width=1000", "--center-x"]);
  const inserted = run(stateDir, ["element", "get", "0", "0"]).data.element as { position: { x: number }; size: { width: number } };
  assert.equal(inserted.size.width, 1000);
  assert.equal(inserted.position.x, 460);
  run(stateDir, ["element", "update", "0", "0", "--set", "width=600", "--center-x"]);
  const updated = run(stateDir, ["element", "get", "0", "0"]).data.element as { position: { x: number }; size: { width: number } };
  assert.equal(updated.size.width, 600);
  assert.equal(updated.position.x, 660);
});

test("batch surfaces element input auto-fixes as warnings even in quiet mode", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-batch-gaps-"));
  run(stateDir, ["init", "--name", "BatchGaps", "--language", "zh", "--first-slide"]);
  const planFile = join(stateDir, "plan.json");
  writeFileSync(
    planFile,
    JSON.stringify({
      operations: [
        { op: "element.insert", slide: 0, type: "text", element: { name: "a", text: 1 } },
        { op: "element.insert", slide: 0, type: "text", element: { name: "b", text: "x", height: 90 } },
        { op: "element.insert", slide: 0, type: "text", element: { name: "c", text: "y" } },
      ],
    }),
  );
  const applied = run(stateDir, ["batch", "apply", "--file", planFile, "--quiet"]) as {
    ok: true;
    warnings?: Array<{ path: string; message: string }>;
  };
  const fixes = (applied.warnings ?? []).filter((w) => /Auto-fixed input/.test(w.message));
  assert.deepEqual(fixes.map((w) => w.path), ["operations[0]", "operations[1]"]);
});

test("quiz get --layout returns round-trippable JSX; a new question can reuse it; insert reports the real box", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-layout-"));
  run(stateDir, ["init", "--name", "QuizLayout", "--language", "zh", "--first-slide"]);
  run(stateDir, ["quiz", "init", "--enabled", "--total-score", "100"]);
  const example = readFileSync(join(root, "references", "quiz-styled-layout.example.jsx"), "utf-8");
  const q1Jsx = example
    .slice(example.indexOf("<QuizContainer"))
    .replace("REPLACE_WITH_qz_op_1", "q1_a")
    .replace("REPLACE_WITH_qz_op_2", "q1_b");
  const q1File = join(stateDir, "q1.jsx");
  writeFileSync(q1File, q1Jsx);
  const inserted = run(stateDir, [
    "quiz", "insert", "0", "--type", "single_choice", "--title", "选择题1. Q1",
    "--set", 'options:json=[{"option_id":"q1_a","is_correct":true},{"option_id":"q1_b","is_correct":false}]',
    "--jsx-file", q1File, "--size-w", "520", "--size-h", "680", "--position-x", "140",
  ]).data as { quiz_element_id: string; quiz_element_size: { width: number; height: number }; quiz_element_position: { x: number } };
  assert.deepEqual(inserted.quiz_element_size, { width: 520, height: 680 });
  assert.equal(inserted.quiz_element_position.x, 140);

  // Quiet mode is the agent default; --layout must still return the JSX.
  const layout = run(stateDir, ["quiz", "get", "0", inserted.quiz_element_id, "--layout", "--quiet"]).data as {
    layout_jsx: string;
    layout_jsx_lossless: boolean;
    react_layout?: unknown;
  };
  assert.equal(layout.layout_jsx_lossless, true);
  assert.equal(layout.react_layout, undefined);
  assert.match(layout.layout_jsx, /^<QuizContainer padding=\{32\}/);
  assert.match(layout.layout_jsx, /<QuizOption value="q1_a"/);

  const q2File = join(stateDir, "q2.jsx");
  writeFileSync(q2File, layout.layout_jsx.replace("q1_a", "q2_a").replace("q1_b", "q2_b").replace("选项 A", "甲").replace("选项 B", "乙"));
  run(stateDir, [
    "quiz", "insert", "0", "--type", "single_choice", "--title", "选择题2. Q2",
    "--set", 'options:json=[{"option_id":"q2_a","is_correct":true},{"option_id":"q2_b","is_correct":false}]',
    "--jsx-file", q2File, "--size-w", "520", "--size-h", "680", "--position-x", "700",
  ]);
  const listed = run(stateDir, ["quiz", "list"]).data as { quiz_elements: Array<{ element_id: string; ast_node_count: number }> };
  assert.equal(listed.quiz_elements.length, 2);
  assert.equal(listed.quiz_elements[0]!.ast_node_count, listed.quiz_elements[1]!.ast_node_count);
  const q2Layout = run(stateDir, ["quiz", "get", "0", listed.quiz_elements[1]!.element_id, "--layout"]).data as { layout_jsx: string };
  assert.equal(
    q2Layout.layout_jsx.replace("q2_a", "X").replace("q2_b", "Y").replace("甲", "LA").replace("乙", "LB"),
    layout.layout_jsx.replace("q1_a", "X").replace("q1_b", "Y").replace("选项 A", "LA").replace("选项 B", "LB"),
  );
  assert.equal((run(stateDir, ["quiz", "validate"]).data as { valid: boolean }).valid, true);
});

test("non-lossless quiz layouts are reused through react_layout (documented fallback)", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-layout-json-"));
  run(stateDir, ["init", "--name", "QuizJson", "--language", "zh", "--first-slide"]);
  run(stateDir, ["quiz", "init", "--enabled", "--total-score", "100"]);
  const example = readFileSync(join(root, "references", "quiz-styled-layout.example.jsx"), "utf-8");
  const q1File = join(stateDir, "q1.jsx");
  writeFileSync(q1File, example.slice(example.search(/^<QuizContainer/m)).replace("REPLACE_WITH_qz_op_1", "q1_a").replace("REPLACE_WITH_qz_op_2", "q1_b"));
  const q1 = run(stateDir, [
    "quiz", "insert", "0", "--type", "single_choice", "--title", "选择题1. Q",
    "--set", 'options:json=[{"option_id":"q1_a","is_correct":true},{"option_id":"q1_b","is_correct":false}]',
    "--jsx-file", q1File,
  ]).data as { quiz_element_id: string };
  const ast = run(stateDir, ["quiz", "get", "0", q1.quiz_element_id, "--verbose", "--no-quiet"]).data.react_layout as Record<string, unknown>;
  const withLt = JSON.parse(JSON.stringify(ast).replace('"text":"选项 A"', '"text":"a < b"')) as Record<string, unknown>;
  const astFile = join(stateDir, "q1.json");
  writeFileSync(astFile, JSON.stringify(withLt));
  run(stateDir, ["quiz", "update", "0", q1.quiz_element_id, "--react-layout-file", astFile]);

  const layout = run(stateDir, ["quiz", "get", "0", q1.quiz_element_id, "--layout", "--quiet"]).data as {
    layout_jsx_lossless: boolean;
    react_layout?: unknown;
  };
  assert.equal(layout.layout_jsx_lossless, false);
  assert.ok(layout.react_layout);
  const q2File = join(stateDir, "q2.json");
  writeFileSync(q2File, JSON.stringify(layout.react_layout).replace('"q1_a"', '"q2_a"').replace('"q1_b"', '"q2_b"'));
  const q2 = run(stateDir, [
    "quiz", "insert", "0", "--type", "single_choice", "--title", "选择题2. Q",
    "--set", 'options:json=[{"option_id":"q2_a","is_correct":true},{"option_id":"q2_b","is_correct":false}]',
    "--react-layout-file", q2File, "--position-x", "980", "--size-w", "860",
  ]).data as { quiz_element_id: string };
  const q2Layout = run(stateDir, ["quiz", "get", "0", q2.quiz_element_id, "--layout"]).data as { react_layout?: unknown };
  assert.match(JSON.stringify(q2Layout.react_layout), /"text":"a < b"/);
  assert.equal((run(stateDir, ["quiz", "validate"]).data as { valid: boolean }).valid, true);
});

test("validate --publish reports text/text content overlaps", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-content-overlap-"));
  run(stateDir, ["init", "--name", "Overlap", "--language", "zh", "--first-slide"]);
  run(stateDir, ["element", "insert", "0", "--type", "text", "--name", "练习-标题", "--set", "text=动手练一练",
    "--set", "position.x=140", "--set", "position.y=158", "--set", "size.width=1200", "--set", "size.height=84"]);
  run(stateDir, ["element", "insert", "0", "--type", "text", "--name", "提示", "--set", "text=提交后查看解析",
    "--set", "position.x=1280", "--set", "position.y=230", "--set", "size.width=400", "--set", "size.height=40"]);
  const result = run(stateDir, ["validate", "--publish"]) as {
    ok: true;
    data: { valid: boolean; content_overlap_count: number };
    warnings?: Array<{ message: string }>;
  };
  assert.equal(result.data.valid, false);
  assert.equal(result.data.content_overlap_count, 1);
  assert.ok(result.warnings?.some((w) => /Content overlap: "练习-标题".*"提示"/.test(w.message)));
});

test("--select prints part of data; a bad path keeps the full result plus a warning", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-select-"));
  run(stateDir, ["init", "--name", "Select", "--language", "zh", "--first-slide"]);
  run(stateDir, ["element", "insert", "0", "--type", "text", "--name", "标题", "--set", "text=你好"]);

  const exec = (args: string[]) =>
    spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, AINOBI_SESSION: "cli-smoke", AINOBI_STATE_DIR: stateDir },
    });

  const names = exec(["slide", "get", "0", "--with-children", "--select", "slide.children_elements[]{name,text}"]);
  assert.equal(names.status, 0, names.stderr);
  assert.deepEqual(JSON.parse(names.stdout), [{ name: "标题", text: "你好" }]);

  const scalar = exec(["slide", "get", "0", "--with-children", "--select", "slide.children_elements[0].text"]);
  assert.equal(scalar.stdout.trim(), "你好");

  // Bad path on a large read: stays ok:true, lists top-level keys, does not dump the slide.
  for (const name of ["a", "b", "c"]) {
    run(stateDir, ["element", "insert", "0", "--type", "text", "--name", name, "--set", `text=${name}`]);
  }
  const bad = exec(["slide", "get", "0", "--with-children", "--select", "slide.nope"]);
  assert.equal(bad.status, 0, bad.stderr);
  const envelope = JSON.parse(bad.stdout) as {
    ok: boolean;
    data?: unknown;
    data_keys?: string[];
    warnings?: Array<{ path: string; message: string }>;
  };
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data, undefined);
  assert.ok(envelope.data_keys?.includes("slide"));
  assert.ok(envelope.warnings?.some((w) => w.path === "--select" && /no key "nope".*Result omitted/.test(w.message)));
  assert.ok(bad.stdout.length < 2000, `fallback output too large: ${bad.stdout.length}`);

  // Bad path on a small payload: the full data is still shown.
  const small = exec(["scene", "info", "--select", "nope"]);
  const smallEnvelope = JSON.parse(small.stdout) as { ok: boolean; data?: unknown; warnings?: Array<{ message: string }> };
  assert.equal(smallEnvelope.ok, true);
  assert.ok(smallEnvelope.data);
  assert.ok(smallEnvelope.warnings?.some((w) => /Showing the full result instead/.test(w.message)));

  // Nested projection used by agents in a real session.
  const nested = exec(["slide", "get", "0", "--with-children", "--select", "slide.{name,children_elements[]{name,text}}"]);
  const slideName = exec(["slide", "get", "0", "--select", "slide.name"]).stdout.trim();
  assert.deepEqual(JSON.parse(nested.stdout), {
    name: slideName,
    children_elements: [
      { name: "标题", text: "你好" },
      { name: "a", text: "a" },
      { name: "b", text: "b" },
      { name: "c", text: "c" },
    ],
  });
});

test("writes that introduce U+FFFD are rejected before touching the scene", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-fffd-"));
  run(stateDir, ["init", "--name", "FFFD", "--language", "zh", "--first-slide"]);
  const corrupted = "\uFFFD户，申请时要特别关注企业类别、语\uFFFD";

  const elementFailure = runExpectFailure(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "text",
    "--json",
    JSON.stringify({ text: corrupted, font_size: 28 }),
  ], 6);
  assert.equal(elementFailure.error.code, "INVALID_INPUT");
  assert.match(elementFailure.error.message, /U\+FFFD/);
  const elements = run(stateDir, ["element", "list", "0"]).data.elements as unknown[];
  assert.equal(elements.length, 0);

  // Rejected up front: no TTS is synthesized for corrupted narration text.
  const narrationFailure = runExpectFailure(
    stateDir,
    ["narration", "insert", "0", "--teacher-id", "t", "--transcript", corrupted],
    6,
    { AINOBI_TTS_STUB: "1" },
  );
  assert.equal(narrationFailure.error.code, "INVALID_INPUT");
  assert.match(narrationFailure.error.hint ?? "", /awk substr/);
});

test("narration insert rejects unsupported flags and missing required text", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-narration-args-"));
  run(stateDir, ["init", "--name", "Narration Args", "--language", "en", "--first-slide"]);

  const unknownText = runExpectFailure(stateDir, [
    "narration",
    "insert",
    "0",
    "--text",
    "Hello",
    "--fit-slide",
  ]);
  assert.equal(unknownText.error.code, "USAGE");
  assert.match(unknownText.error.message, /--text/);
  assert.match(unknownText.error.hint ?? "", /--transcript/);

  const unknownVoice = runExpectFailure(stateDir, [
    "narration",
    "insert",
    "0",
    "--transcript",
    "Hello",
    "--voice",
    "zh-CN-XiaoxiaoNeural",
  ]);
  assert.equal(unknownVoice.error.code, "USAGE");
  assert.match(unknownVoice.error.message, /--voice/);
  assert.match(unknownVoice.error.hint ?? "", /teacher-file/);

  const missingText = runExpectFailure(stateDir, ["narration", "insert", "0"]);
  assert.equal(missingText.error.code, "USAGE");
  assert.match(missingText.error.message, /--script|transcript/i);
  assert.match(missingText.error.hint ?? "", /ainobi narration insert/);

  const missingSlide = runExpectFailure(stateDir, ["narration", "insert", "--transcript", "Hello"]);
  assert.equal(missingSlide.error.code, "USAGE");
  assert.match(missingSlide.error.message, /slide/i);
});

test("validate fails when quiz questions are not inserted on a slide; quiz insert/delete keep them in sync", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-slide-validate-"));
  run(stateDir, ["init", "--name", "Quiz Slide", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert", "--set", "name=Quiz", "--set", "background_color=#0F172A"]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);

  const inserted = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "single_choice",
    "--title",
    "2+2?",
  ]).data as { slide_index: number; quiz_element_id: string; question_id: string };
  assert.equal(inserted.slide_index, 1);
  assert.ok(inserted.quiz_element_id);
  assert.ok(inserted.question_id);

  const valid = run(stateDir, ["validate"]).data as {
    valid: boolean;
    issues: Array<{ path: string; message: string }>;
  };
  assert.ok(!valid.issues.some((issue) => issue.path.startsWith("quiz.questions[")));

  const listed = run(stateDir, ["quiz", "list"]).data as {
    count: number;
    quiz_elements: Array<{ quiz_question_id: string; ast_node_count: number }>;
  };
  assert.equal(listed.count, 1);
  assert.equal(listed.quiz_elements[0]?.quiz_question_id, inserted.question_id);
  assert.ok((listed.quiz_elements[0]?.ast_node_count ?? 0) > 1);

  const deleted = run(stateDir, ["quiz", "delete", "1", inserted.quiz_element_id]).data as {
    removed_question_id: string | null;
  };
  assert.equal(deleted.removed_question_id, inserted.question_id);
  const afterDelete = run(stateDir, ["quiz", "list"]).data as { count: number };
  assert.equal(afterDelete.count, 0);
});

test("slide delete cascades bound quiz questions; prune-orphans clears leftovers", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-slide-cascade-"));
  run(stateDir, ["init", "--name", "Quiz Cascade", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert", "--set", "name=Quiz", "--set", "background_color=#0F172A"]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);

  const inserted = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "essay",
    "--title",
    "Translate this.",
  ]).data as { quiz_element_id: string; question_id: string };

  const deleted = run(stateDir, ["slide", "delete", "1"]).data as {
    removed_question_ids: string[];
  };
  assert.deepEqual(deleted.removed_question_ids, [inserted.question_id]);

  const afterSlideDelete = run(stateDir, ["quiz", "validate"]).data as {
    valid: boolean;
    issues: Array<{ path: string; message: string }>;
  };
  // Cascade succeeded: no orphan bindings. Empty questions[] may still fail
  // "Add at least one question" while quiz remains enabled — that is unrelated.
  assert.ok(
    !afterSlideDelete.issues.some((issue) => /is not inserted on any slide/.test(issue.message)),
  );

  // Re-create a quiz, then simulate a legacy delete that left an orphan question.
  run(stateDir, ["slide", "insert", "--set", "name=Quiz2", "--set", "background_color=#0F172A"]);
  const orphaned = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "essay",
    "--title",
    "Will become orphan",
  ]).data as { quiz_element_id: string; question_id: string };

  const sessionFile = join(stateDir, "cli-smoke.json");
  const session = JSON.parse(readFileSync(sessionFile, "utf-8")) as {
    scene: {
      quiz: { questions: Array<{ question_id: string }> };
      slide_elements: Array<{ children_elements: Array<{ element_id: string }> }>;
    };
  };
  const slide = session.scene.slide_elements[1];
  assert.ok(slide);
  slide.children_elements = slide.children_elements.filter(
    (el) => el.element_id !== orphaned.quiz_element_id,
  );
  assert.ok(session.scene.quiz.questions.some((q) => q.question_id === orphaned.question_id));
  writeFileSync(sessionFile, JSON.stringify(session));

  const invalid = run(stateDir, ["quiz", "validate"]).data as {
    valid: boolean;
    issue_count: number;
    issues: Array<{ message: string }>;
  };
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => /is not inserted on any slide/.test(issue.message)));

  const saveFail = runExpectFailure(stateDir, ["save", "--stdout"], 5);
  assert.equal(saveFail.error.code, "VALIDATION_ERROR");
  assert.match(saveFail.error.message, /orphan quiz question/i);

  const pruned = run(stateDir, ["quiz", "prune-orphans"]).data as {
    removed_count: number;
    removed_question_ids: string[];
  };
  assert.equal(pruned.removed_count, 1);
  assert.deepEqual(pruned.removed_question_ids, [orphaned.question_id]);

  const afterPrune = run(stateDir, ["quiz", "validate"]).data as {
    issues: Array<{ message: string }>;
  };
  assert.ok(!afterPrune.issues.some((issue) => /is not inserted on any slide/.test(issue.message)));

  // Re-insert a bound question so the scene is fully valid again.
  run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "single_choice",
    "--title",
    "Bound again",
  ]);
  const finalValidate = run(stateDir, ["quiz", "validate"]).data as {
    valid: boolean;
    issues: Array<{ message: string }>;
  };
  assert.equal(finalValidate.valid, true);
  assert.ok(!finalValidate.issues.some((issue) => /is not inserted on any slide/.test(issue.message)));
});

test("element delete on a quiz cascades the bound question", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-element-cascade-"));
  run(stateDir, ["init", "--name", "Quiz Element Cascade", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert", "--set", "name=Quiz", "--set", "background_color=#0F172A"]);
  run(stateDir, ["quiz", "init"]);

  const inserted = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "single_choice",
    "--title",
    "Pick one",
  ]).data as { quiz_element_id: string; question_id: string };

  const deleted = run(stateDir, ["element", "delete", "1", inserted.quiz_element_id]).data as {
    removed_question_ids: string[];
  };
  assert.deepEqual(deleted.removed_question_ids, [inserted.question_id]);

  const after = run(stateDir, ["quiz", "validate"]).data as {
    issues: Array<{ message: string }>;
  };
  assert.ok(!after.issues.some((issue) => /is not inserted on any slide/.test(issue.message)));
});

test("quiz insert accepts legacy option_text via --set and builds valid AST", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-option-text-"));
  run(stateDir, ["init", "--name", "Quiz Option Text", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert", "--set", "name=Quiz", "--set", "background_color=#0F172A"]);
  run(stateDir, ["quiz", "init"]);

  const inserted = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "single_choice",
    "--title",
    "最大的洋？",
    "--set",
    "options[0].option_text=大西洋",
    "--set",
    "options[0].is_correct=false",
    "--set",
    "options[1].option_text=太平洋",
    "--set",
    "options[1].is_correct=true",
    "--set",
    "options[2].option_text=印度洋",
    "--set",
    "options[2].is_correct=false",
    "--set",
    "options[3].option_text=北冰洋",
    "--set",
    "options[3].is_correct=false",
  ]).data as { question_id: string };

  const sessionFile = join(stateDir, "cli-smoke.json");
  const session = JSON.parse(readFileSync(sessionFile, "utf-8")) as {
    scene: {
      quiz: {
        questions: Array<{
          question_id: string;
          options: Array<{ option_id: string; value: string }>;
          react_layout: { kind: string; tag?: string; children?: unknown[] };
        }>;
      };
    };
  };
  const question = session.scene.quiz.questions.find((q) => q.question_id === inserted.question_id);
  assert.ok(question);
  for (const opt of question!.options) {
    assert.equal(opt.value, opt.option_id);
  }
  run(stateDir, ["quiz", "validate"]);
});

test("quiz insert fill_blank coerces acceptable_answers and applies title blanks", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-fill-blank-"));
  run(stateDir, ["init", "--name", "Quiz Fill Blank", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert", "--set", "name=Quiz", "--set", "background_color=#faf9f6"]);
  run(stateDir, ["quiz", "init", "--total-score", "10"]);

  const inserted = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "fill_blank",
    "--title",
    "日本的___美学认为，在质朴与残缺中见出深味。",
    "--set",
    "blanks[0].answer=侘寂",
    "--set",
    "blanks[0].acceptable_answers[0]=侘寂",
    "--set",
    "blanks[0].acceptable_answers[1]=wabi-sabi",
    "--set",
    "explanation=侘寂强调不完美与无常之美。",
  ]).data as { question_id: string; quiz_element_id: string };

  const sessionFile = join(stateDir, "cli-smoke.json");
  const session = JSON.parse(readFileSync(sessionFile, "utf-8")) as {
    scene: {
      quiz: {
        questions: Array<{
          question_id: string;
          type: string;
          title: string;
          blanks: Array<{ answer: string; aliases: string[] }>;
          react_layout: { children: Array<{ tag?: string; children?: unknown[] }> };
        }>;
      };
    };
  };
  const question = session.scene.quiz.questions.find((q) => q.question_id === inserted.question_id);
  assert.ok(question);
  assert.equal(question!.type, "fill_blank");
  assert.ok(question!.title.includes("___"));
  assert.equal(question!.blanks[0]?.answer, "侘寂");
  assert.deepEqual(question!.blanks[0]?.aliases, ["侘寂", "wabi-sabi"]);
  const titleNode = question!.react_layout.children.find((c) => c.tag === "QuizTitle");
  assert.ok(titleNode);
  const hasInlineInput = JSON.stringify(titleNode).includes('"tag":"QuizInput"');
  assert.ok(hasInlineInput);
  run(stateDir, ["quiz", "validate"]);
});

test("quiz update --jsx replaces react_layout and validates against question data", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-update-"));
  run(stateDir, ["init", "--name", "Quiz Update", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert", "--set", "name=Quiz", "--set", "background_color=#0F172A"]);
  run(stateDir, ["quiz", "init"]);

  const inserted = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "single_choice",
    "--title",
    "1 + 1 = ?",
  ]).data as { slide_index: number; quiz_element_id: string; question_id: string };

  // The CLI inserts default options on `single_choice`; capture them so we can
  // author a layout that references real option_ids. We read them directly
  // from the persisted session file (the source of truth for the scene).
  const sessionFile = join(stateDir, "cli-smoke.json");
  const sessionBefore = JSON.parse(readFileSync(sessionFile, "utf-8")) as {
    scene: {
      quiz: { questions: Array<{ question_id: string; options: Array<{ option_id: string }> }> };
    };
  };
  const question = sessionBefore.scene.quiz.questions.find((q) => q.question_id === inserted.question_id);
  assert.ok(question, "newly inserted question should exist");
  const optionIds = question!.options.map((o) => o.option_id);
  assert.ok(optionIds.length >= 2, "default single_choice should seed >= 2 options");

  // Author a new layout that includes a media node and a styled wrapper. The
  // CLI parses + validates AST against the question (option_ids must match).
  const jsxFile = join(stateDir, "layout.jsx");
  const optionMarkup = optionIds
    .map((id, idx) => `    <QuizOption value="${id}">选项 ${String.fromCharCode(65 + idx)}</QuizOption>`)
    .join("\n");
  writeFileSync(
    jsxFile,
    [
      '<QuizContainer padding={24} gap={12} className="bg-slate-900">',
      '  <QuizTitle><h2>{$title}</h2></QuizTitle>',
      '  <QuizMedia type="image" src="https://example.com/hint.png" />',
      '  <QuizOptionGroup>',
      optionMarkup,
      '  </QuizOptionGroup>',
      '  <QuizSubmitButton>提交</QuizSubmitButton>',
      '  <QuizExplanation>',
      '    <p>{$explanation}</p>',
      '  </QuizExplanation>',
      '</QuizContainer>',
    ].join("\n"),
  );

  const updated = run(stateDir, [
    "quiz",
    "update",
    "1",
    inserted.quiz_element_id,
    "--jsx-file",
    jsxFile,
    "--set",
    "explanation=两者相加得 2",
  ]).data as { slide_index: number; quiz_element_id: string; question_id: string };
  assert.equal(updated.question_id, inserted.question_id);

  // Verify the AST replaced and the explanation patch landed by reading the
  // persisted session JSON directly.
  const sessionAfter = JSON.parse(readFileSync(sessionFile, "utf-8")) as {
    scene: {
      quiz: {
        questions: Array<{
          question_id: string;
          explanation: string;
          react_layout: { kind: string; tag: string; children: Array<{ kind: string; tag?: string }> };
        }>;
      };
    };
  };
  const next = sessionAfter.scene.quiz.questions.find((q) => q.question_id === inserted.question_id);
  assert.ok(next, "question should still exist after update");
  assert.equal(next!.explanation, "两者相加得 2");
  assert.equal(next!.react_layout.kind, "element");
  assert.equal(next!.react_layout.tag, "QuizContainer");
  assert.ok(
    next!.react_layout.children.some((c) => c.kind === "element" && c.tag === "QuizMedia"),
    "<QuizMedia> from the new JSX should be present in react_layout",
  );

  // Final scene-level validate must have no hard issues (warnings about
  // unrelated motion presets are allowed; they're not gating).
  const valid = run(stateDir, ["validate"]).data as {
    issue_count: number;
    issues: Array<{ path: string }>;
  };
  assert.equal(valid.issue_count, 0);
  assert.ok(!valid.issues.some((issue) => issue.path.startsWith("quiz.")));
});

test("quiz update --jsx rejects a layout whose <QuizOption value=> misses an option_id", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-update-fail-"));
  run(stateDir, ["init", "--name", "Quiz Update Fail", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert"]);
  run(stateDir, ["quiz", "init"]);
  const inserted = run(stateDir, [
    "quiz",
    "insert",
    "1",
    "--type",
    "single_choice",
  ]).data as { quiz_element_id: string };

  const result = spawnSync(
    process.execPath,
    [
      bin,
      "quiz",
      "update",
      "1",
      inserted.quiz_element_id,
      "--jsx",
      '<QuizContainer><QuizTitle>题</QuizTitle><QuizOptionGroup><QuizOption value="qz_op_does_not_exist">x</QuizOption></QuizOptionGroup><QuizSubmitButton>提交</QuizSubmitButton></QuizContainer>',
      "--pretty=false",
    ],
    {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, AINOBI_SESSION: "cli-smoke", AINOBI_STATE_DIR: stateDir },
    },
  );
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const out = result.stderr || result.stdout;
  // Both the missing-id and the "options not covered" issues should surface.
  assert.match(out, /react_layout/);
  assert.match(out, /does not match any options\[\]\.option_id|must include a <QuizOption/);
});

test("slide info aliases slide get; element get rejects lone child id; unknown slide subcommand lists valid subs", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-ux-"));
  run(stateDir, ["init", "--name", "UX", "--language", "en", "--first-slide"]);

  const viaInfo = run(stateDir, ["slide", "info", "0"]);
  const viaGet = run(stateDir, ["slide", "get", "0"]);
  assert.deepEqual(viaInfo.data?.slide, viaGet.data?.slide);

  const badElementGet = runExpectFailure(stateDir, ["element", "get", "el_svg_notreal123"], 2);
  assert.equal(badElementGet.error.code, "USAGE");
  assert.match(badElementGet.error.message, /two arguments/i);
  assert.match(badElementGet.error.hint ?? "", /ainobi element get 0 el_svg_notreal123/);

  const badSub = runExpectFailure(stateDir, ["slide", "frobnicate"], 2);
  assert.equal(badSub.error.code, "USAGE");
  assert.match(badSub.error.message, /Unknown slide subcommand/);
  assert.match(badSub.error.hint ?? "", /Valid `slide` subcommands/);
  assert.match(badSub.error.hint ?? "", /\binfo\b/);
});

test("element add --help routes to insert help; unknown layout flags fail with --set hints", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-element-help-"));
  run(stateDir, ["init", "--name", "EH", "--language", "en", "--first-slide"]);

  const viaHelp = run(stateDir, ["element", "add", "--help"]);
  assert.match((viaHelp.data as { usage?: string }).usage ?? "", /element insert/);
  assert.match(JSON.stringify(viaHelp.data), /--set/);

  const badText = runExpectFailure(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "text",
    "--text",
    "Hello",
  ]);
  assert.equal(badText.error.code, "USAGE");
  assert.match(badText.error.message, /--text/);
  assert.match(badText.error.hint ?? "", /--set text/);

  const badLayout = runExpectFailure(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "text",
    "--left",
    "100",
    "--top",
    "50",
  ]);
  assert.equal(badLayout.error.code, "USAGE");
  assert.match(badLayout.error.message, /--left|--top/);
  assert.match(badLayout.error.hint ?? "", /position\.x/);

  const ok = run(stateDir, [
    "element",
    "insert",
    "0",
    "--type",
    "text",
    "--set",
    "text=Hello",
    "--set",
    "position.x=100",
    "--set",
    "position.y=50",
  ]);
  const el = (ok.data as { element?: { position?: { x?: number; y?: number } } }).element;
  assert.equal(el?.position?.x, 100);
  assert.equal(el?.position?.y, 50);
});

test("help falls back to the command registry for groups like batch / animation", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-help-registry-"));
  const batch = run(stateDir, ["help", "batch"]).data as { commands: Array<{ command: string }>; read_next?: string[] };
  assert.ok(batch.commands.some((c) => c.command.startsWith("ainobi batch apply")));
  assert.deepEqual(batch.read_next, ["references/batch-operations.md"]);
  const preset = run(stateDir, ["help", "animation", "preset"]).data as { commands: Array<{ command: string }> };
  assert.equal(preset.commands.length, 1);
  assert.match(preset.commands[0]!.command, /^ainobi animation preset/);
  const unknown = runExpectFailure(stateDir, ["help", "nosuch"]);
  assert.match(unknown.error.hint ?? "", /command group: .*batch/);
});

test("narration insert --help routes to narration help", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-narration-help-"));
  const help = run(stateDir, ["narration", "insert", "--help"]);
  assert.match((help.data as { usage?: string }).usage ?? "", /narration insert/);
  assert.match(JSON.stringify(help.data), /--transcript/);
});

test("help element lists verbs; help element align documents align command", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-help-element-"));
  const overview = run(stateDir, ["help", "element"]);
  assert.ok(Array.isArray((overview.data as { element_verbs?: unknown }).element_verbs));
  assert.match(JSON.stringify(overview.data), /element align/);

  const align = run(stateDir, ["help", "element", "align"]);
  assert.match((align.data as { usage?: string }).usage ?? "", /element align/);
  assert.match(JSON.stringify(align.data), /center-x/);
});

test("scene info --verbose includes session_id and work_dir", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-scene-verbose-"));
  run(stateDir, ["init", "--name", "WD", "--language", "en", "--first-slide"]);
  const info = run(stateDir, ["scene", "info", "--verbose"]);
  const data = info.data as { session_id?: string; work_dir?: string | null };
  assert.ok(typeof data.session_id === "string" && data.session_id.length > 0);
  assert.ok(typeof data.work_dir === "string" && data.work_dir.length > 0);
});

test("quiz score-summary insert/update/get configure scene.quiz.score_summary and slide element", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-score-summary-"));
  run(stateDir, ["init", "--name", "Score Summary", "--language", "en", "--first-slide"]);
  run(stateDir, ["slide", "insert", "--set", "name=Results", "--set", "background_color=#faf9f6"]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);

  const inserted = run(stateDir, ["quiz", "score-summary", "insert", "1"]).data as {
    slide_index: number;
    score_summary_element_id: string;
    ast_node_count: number;
  };
  assert.equal(inserted.slide_index, 1);
  assert.ok(inserted.score_summary_element_id);
  assert.ok((inserted.ast_node_count ?? 0) > 5);

  const got = run(stateDir, ["quiz", "score-summary", "get"]).data as {
    score_summary_configured: boolean;
    interp_keys_present: string[];
    score_summary_elements: Array<{ element_id: string }>;
  };
  assert.equal(got.score_summary_configured, true);
  assert.ok(got.interp_keys_present.includes("answered_count"));
  assert.ok(got.interp_keys_present.includes("grade_label"));
  assert.equal(got.score_summary_elements[0]?.element_id, inserted.score_summary_element_id);

  const jsx = `<QuizScoreSummaryContainer padding={24} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
  <h2>成绩</h2>
  <QuizTotalScore />
  <p>{$answered_count} / {$question_count}</p>
</QuizScoreSummaryContainer>`;
  const jsxPath = join(stateDir, "score-summary.jsx");
  writeFileSync(jsxPath, jsx, "utf-8");
  const updated = run(stateDir, [
    "quiz",
    "score-summary",
    "update",
    "--jsx-file",
    jsxPath,
  ]).data as { ast_node_count: number };
  assert.ok((updated.ast_node_count ?? 0) > 3);

  const selfClosingJsx = `<QuizScoreSummaryContainer style={{ width: "100%", height: "100%" }}>
  <QuizGradeLabel />
  <QuizGradeDescription />
</QuizScoreSummaryContainer>`;
  const selfClosingPath = join(stateDir, "score-summary-self-closing.jsx");
  writeFileSync(selfClosingPath, selfClosingJsx, "utf-8");
  const repaired = run(stateDir, [
    "quiz",
    "score-summary",
    "update",
    "--jsx-file",
    selfClosingPath,
  ]).data as { layout_interp_fixes: string[] };
  assert.ok(repaired.layout_interp_fixes.length >= 2);

  run(stateDir, ["quiz", "validate"]);
});

test("element rich insert/update stores a validated react_layout and round-trips through save", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-rich-"));
  run(stateDir, ["init", "--name", "Rich", "--language", "en", "--first-slide"]);

  const cardJsx = join(stateDir, "card.jsx");
  writeFileSync(
    cardJsx,
    [
      '<div className="grid h-full w-full grid-cols-2 gap-8 p-12">',
      '  <div className="rounded-2xl bg-blue-50 p-8">',
      '    <p className="text-3xl font-semibold text-blue-700">方案 A</p>',
      '    <p className="mt-3 text-2xl text-slate-600" style={{ lineHeight: 1.4 }}>嵌套容器内文本自动换行。</p>',
      "  </div>",
      '  <div className="rounded-2xl bg-amber-50 p-8">',
      '    <p className="text-3xl font-semibold text-amber-700">方案 B</p>',
      '    <img src="https://courseware.example.com/raw/png/example.png" alt="demo" />',
      "  </div>",
      "</div>",
    ].join("\n"),
    "utf-8",
  );

  const inserted = run(stateDir, [
    "element",
    "rich",
    "insert",
    "0",
    "--jsx-file",
    cardJsx,
    "--set",
    "size.width=1200",
    "--set",
    "size.height=600",
    "--start",
    "0",
    "--duration",
    "5000",
  ]).data as { element_id: string; element: { element_type: string; size: { width: number } } };
  assert.equal(inserted.element.element_type, "rich");
  assert.equal(inserted.element.size.width, 1200);

  const got = run(stateDir, ["element", "get", "0", inserted.element_id]).data.element as {
    element_type: "rich";
    react_layout: { kind: string; tag?: string; children?: unknown[] };
  };
  assert.equal(got.element_type, "rich");
  assert.equal(got.react_layout.kind, "element");
  assert.equal(got.react_layout.tag, "div");
  assert.ok((got.react_layout.children?.length ?? 0) >= 2);

  // Box-only update keeps the layout; --jsx update replaces it.
  const resized = run(stateDir, [
    "element",
    "rich",
    "update",
    "0",
    inserted.element_id,
    "--set",
    "size.height=680",
  ]).data.element as { size: { height: number } };
  assert.equal(resized.size.height, 680);

  const newJsx = join(stateDir, "card2.jsx");
  writeFileSync(newJsx, '<section className="flex h-full w-full items-center justify-center"><h1 className="text-7xl font-black text-slate-900">改</h1></section>', "utf-8");
  run(stateDir, ["element", "rich", "update", "0", inserted.element_id, "--jsx-file", newJsx]);
  const afterUpdate = run(stateDir, ["element", "get", "0", inserted.element_id]).data.element as {
    react_layout: { tag?: string };
  };
  assert.equal(afterUpdate.react_layout.tag, "section");

  // Persisted scene keeps react_layout and drops children_elements for rich.
  const savePath = join(stateDir, "rich.scene.json");
  run(stateDir, ["save", savePath]);
  const saved = JSON.parse(readFileSync(savePath, "utf-8")) as {
    slide_elements: Array<{ children_elements: Array<Record<string, unknown>> }>;
  };
  const richEl = saved.slide_elements[0]?.children_elements.find(
    (c) => c.element_type === "rich",
  );
  assert.ok(richEl, "saved scene should contain the rich element");
  assert.ok(richEl!.react_layout, "rich element keeps react_layout after save round-trip");
  assert.equal("children_elements" in richEl!, false);
});

test("element rich insert rejects custom tags and event handlers with structured issues", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-rich-reject-"));
  run(stateDir, ["init", "--name", "Rich Reject", "--language", "en", "--first-slide"]);

  const badTag = runExpectFailure(
    stateDir,
    ["element", "rich", "insert", "0", "--jsx", "<Foo>bad</Foo>"],
    6,
  );
  assert.equal(badTag.error.code, "INVALID_INPUT");
  assert.match(badTag.error.message, /not allowed in a rich component/);

  const badEvent = runExpectFailure(
    stateDir,
    ["element", "rich", "insert", "0", "--jsx", '<div onClick="x">bad</div>'],
    5,
  );
  assert.equal(badEvent.error.code, "VALIDATION_ERROR");
  assert.match(JSON.stringify(badEvent.error), /event props are not allowed/);
});

test("validate rejects duplicate element_id across slides without --publish", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-dup-ids-"));
  const shellSession = "dup-id-shell";
  runBoundToShell(stateDir, shellSession, ["init", "--name", "Dup", "--language", "en", "--first-slide"]);
  const initScenePath = join(stateDir, "init.scene.json");
  runBoundToShell(stateDir, shellSession, ["save", initScenePath]);
  const scene = JSON.parse(readFileSync(initScenePath, "utf-8")) as Record<string, unknown>;
  const slides = scene.slide_elements as Array<Record<string, unknown>>;
  slides.push(structuredClone(slides[0]));
  const dupScenePath = join(stateDir, "dup-scene.json");
  writeFileSync(dupScenePath, JSON.stringify(scene));
  const load = runBoundToShell(stateDir, shellSession, ["load", dupScenePath]);
  assert.ok((load.data.duplicate_element_id_count as number) > 0);
  const invalid = runBoundToShell(stateDir, shellSession, ["validate"]).data as {
    valid: boolean;
    issues: Array<{ message: string }>;
  };
  assert.equal(invalid.valid, false);
  assert.match(invalid.issues[0]?.message ?? "", /Duplicate element_id/);
  const saveFail = runBoundToShellExpectFailure(stateDir, shellSession, ["save", join(stateDir, "out.json")], 5);
  assert.equal(saveFail.error?.code, "VALIDATION_ERROR");
});


test("init requires --language and records it in scene metadata", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-content-language-"));
  const missing = runExpectFailure(stateDir, ["init", "--name", "NoLang", "--first-slide"]);
  assert.equal(missing.error.code, "USAGE");
  assert.match(missing.error.message, /--language/);
  const invalid = runExpectFailure(stateDir, ["init", "--name", "BadLang", "--language", "fr", "--first-slide"]);
  assert.equal(invalid.error.code, "USAGE");
  assert.match(invalid.error.message, /--language/);
  const init = run(stateDir, ["init", "--name", "Lang", "--language", "ja", "--first-slide"]).data;
  const metadata = (init.scene as { metadata: Record<string, unknown> }).metadata;
  assert.equal(metadata.language, "ja");
});

test("quiz insert bakes default copy in the scene content language", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-language-ja-"));
  run(stateDir, ["init", "--name", "Quiz Lang", "--language", "ja", "--first-slide"]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);
  run(stateDir, ["quiz", "insert", "0", "--type", "shadowing", "--title", "Repeat after me"]);
  const scenePath = join(stateDir, "ja.scene.json");
  run(stateDir, ["save", scenePath]);
  const scene = JSON.parse(readFileSync(scenePath, "utf-8")) as {
    quiz: { questions: Array<{ react_layout: unknown }> };
  };
  const layout = JSON.stringify(scene.quiz.questions[0]?.react_layout);
  assert.match(layout, /録音開始/);
  assert.match(layout, /録音停止/);
  assert.match(layout, /送信/);
  assert.match(layout, /解答解説/);
  assert.doesNotMatch(layout, /开始录音|暂停录音|提交|解析/);
});

test("quiz insert/update custom layouts fill unlabeled buttons in the scene content language", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-jsx-language-"));
  run(stateDir, ["init", "--name", "Jsx Lang", "--language", "en", "--first-slide"]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);
  const jsx =
    '<QuizContainer><QuizTitle>{$title}</QuizTitle><QuizTextarea name="answer" /><QuizSubmitButton /><QuizSkipButton /><QuizExplanation><p>{$explanation}</p></QuizExplanation></QuizContainer>';
  const inserted = run(stateDir, ["quiz", "insert", "0", "--type", "essay", "--title", "Describe it", "--jsx", jsx]).data as {
    quiz_element_id: string;
    layout_interp_fixes: string[];
  };
  assert.ok(inserted.layout_interp_fixes.some((m) => m.includes('<QuizSubmitButton> had no label — defaulted to "Submit"')));
  assert.ok(inserted.layout_interp_fixes.some((m) => m.includes('"Skip"')));

  // react_layout (JSON) goes through the other repair path.
  const layoutFile = join(stateDir, "layout.json");
  writeFileSync(
    layoutFile,
    JSON.stringify({
      kind: "element",
      tag: "QuizContainer",
      props: {},
      children: [
        { kind: "element", tag: "QuizTitle", props: {}, children: [{ kind: "interp", key: "title" }] },
        { kind: "element", tag: "QuizTextarea", props: { name: "answer" }, children: [] },
        { kind: "element", tag: "QuizSubmitButton", props: {}, children: [] },
        {
          kind: "element",
          tag: "QuizExplanation",
          props: {},
          children: [{ kind: "element", tag: "p", props: {}, children: [{ kind: "interp", key: "explanation" }] }],
        },
      ],
    }),
  );
  const updated = run(stateDir, ["quiz", "update", "0", inserted.quiz_element_id, "--react-layout-file", layoutFile]).data as {
    layout_interp_fixes: string[];
  };
  assert.deepEqual(updated.layout_interp_fixes, ['<QuizSubmitButton> had no label — defaulted to "Submit"']);

  const scenePath = join(stateDir, "en.scene.json");
  run(stateDir, ["save", scenePath]);
  const scene = JSON.parse(readFileSync(scenePath, "utf-8")) as {
    quiz: { questions: Array<{ react_layout: unknown }> };
  };
  const layout = JSON.stringify(scene.quiz.questions[0]?.react_layout);
  assert.match(layout, /"Submit"/);
  assert.doesNotMatch(layout, /提交|跳过/);
});

test("quiz update requires metadata.language only when a custom layout is supplied", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-update-language-"));
  run(stateDir, ["init", "--name", "Update Lang", "--language", "en", "--first-slide"]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);
  const inserted = run(stateDir, ["quiz", "insert", "0", "--type", "essay", "--title", "Describe it"]).data as {
    quiz_element_id: string;
  };
  const scenePath = join(stateDir, "legacy.scene.json");
  run(stateDir, ["save", scenePath]);
  const legacy = JSON.parse(readFileSync(scenePath, "utf-8")) as { metadata: Record<string, unknown> };
  delete legacy.metadata.language;
  writeFileSync(scenePath, JSON.stringify(legacy));
  run(stateDir, ["load", scenePath]);

  // Plain patches never touch default copy — no language needed.
  run(stateDir, ["quiz", "update", "0", inserted.quiz_element_id, "--title", "Renamed"]);

  const jsx = '<QuizContainer><QuizTitle>{$title}</QuizTitle><QuizTextarea name="answer" /><QuizSubmitButton /></QuizContainer>';
  const refused = runExpectFailure(stateDir, ["quiz", "update", "0", inserted.quiz_element_id, "--jsx", jsx]);
  assert.equal(refused.error.code, "USAGE");
  assert.match(refused.error.message, /metadata\.language/);

  run(stateDir, ["scene", "update", "--json", JSON.stringify({ metadata: { language: "ja" } })]);
  const updated = run(stateDir, ["quiz", "update", "0", inserted.quiz_element_id, "--jsx", jsx]).data as {
    layout_interp_fixes: string[];
  };
  assert.deepEqual(updated.layout_interp_fixes, ['<QuizSubmitButton> had no label — defaulted to "送信"']);
});

test("quiz insert refuses a scene without metadata.language until scene update sets it", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-quiz-language-legacy-"));
  run(stateDir, ["init", "--name", "Legacy", "--language", "en", "--first-slide"]);
  const scenePath = join(stateDir, "legacy.scene.json");
  run(stateDir, ["save", scenePath]);
  const legacy = JSON.parse(readFileSync(scenePath, "utf-8")) as { metadata: Record<string, unknown> };
  delete legacy.metadata.language;
  writeFileSync(scenePath, JSON.stringify(legacy));

  run(stateDir, ["load", scenePath]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);
  const refused = runExpectFailure(stateDir, ["quiz", "insert", "0", "--type", "shadowing", "--title", "Repeat"]);
  assert.equal(refused.error.code, "USAGE");
  assert.match(refused.error.message, /metadata\.language/);
  assert.match(refused.error.message, /scene\.update|scene update/);
  const untouched = run(stateDir, ["quiz", "list"]).data as { count: number };
  assert.equal(untouched.count, 0);

  // INVALID_INPUT exits 6 (USAGE exits 2).
  const badUpdate = runExpectFailure(stateDir, ["scene", "update", "--json", JSON.stringify({ metadata: { language: "fr" } })], 6);
  assert.equal(badUpdate.error.code, "INVALID_INPUT");

  run(stateDir, ["scene", "update", "--json", JSON.stringify({ metadata: { language: "en" } })]);
  run(stateDir, ["quiz", "insert", "0", "--type", "shadowing", "--title", "Repeat"]);
  const outPath = join(stateDir, "en.scene.json");
  run(stateDir, ["save", outPath]);
  const scene = JSON.parse(readFileSync(outPath, "utf-8")) as {
    quiz: { questions: Array<{ title: string; react_layout: unknown }> };
  };
  assert.equal(scene.quiz.questions[0]?.title, "Repeat");
  const layout = JSON.stringify(scene.quiz.questions[0]?.react_layout);
  assert.match(layout, /Start recording/);
  assert.match(layout, /Stop recording/);
  assert.doesNotMatch(layout, /开始录音|提交/);
});

test("batch scene.update validates metadata.language and unblocks quiz insert once set", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-batch-language-"));
  run(stateDir, ["init", "--name", "Batch Lang", "--language", "en", "--first-slide"]);
  const scenePath = join(stateDir, "legacy.scene.json");
  run(stateDir, ["save", scenePath]);
  const legacy = JSON.parse(readFileSync(scenePath, "utf-8")) as { metadata: Record<string, unknown> };
  delete legacy.metadata.language;
  writeFileSync(scenePath, JSON.stringify(legacy));
  run(stateDir, ["load", scenePath]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);

  const badBatch = join(stateDir, "bad-language.json");
  writeFileSync(
    badBatch,
    JSON.stringify({ operations: [{ op: "scene.update", patch: { metadata: { language: "fr" } } }] }),
  );
  // INVALID_INPUT exits 6.
  const rejected = runExpectFailure(stateDir, ["batch", "apply", badBatch], 6);
  assert.equal(rejected.error.code, "INVALID_INPUT");
  assert.match(rejected.error.message, /metadata\.language/);

  const goodBatch = join(stateDir, "ja-language.json");
  writeFileSync(
    goodBatch,
    JSON.stringify({ operations: [{ op: "scene.update", patch: { metadata: { language: "ja" } } }] }),
  );
  assert.equal(run(stateDir, ["batch", "apply", goodBatch]).data.operations_applied, 1);
  run(stateDir, ["quiz", "insert", "0", "--type", "shadowing", "--title", "Repeat"]);
  const outPath = join(stateDir, "ja.scene.json");
  run(stateDir, ["save", outPath]);
  const scene = JSON.parse(readFileSync(outPath, "utf-8")) as {
    metadata: Record<string, unknown>;
    quiz: { questions: Array<{ react_layout: unknown }> };
  };
  assert.equal(scene.metadata.language, "ja");
  assert.match(JSON.stringify(scene.quiz.questions[0]?.react_layout), /録音開始/);
});

test("quiz score-summary insert bakes the default card in the scene language and requires it", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-cli-score-summary-language-"));
  run(stateDir, ["init", "--name", "Score Summary Lang", "--language", "ja", "--first-slide"]);
  run(stateDir, ["quiz", "init", "--total-score", "100"]);
  run(stateDir, ["quiz", "score-summary", "insert", "0"]);
  const scenePath = join(stateDir, "scene.json");
  run(stateDir, ["save", scenePath]);
  const scene = JSON.parse(readFileSync(scenePath, "utf-8")) as {
    quiz: { score_summary: { react_layout: unknown } | null };
  };
  const layoutText = JSON.stringify(scene.quiz.score_summary?.react_layout);
  assert.ok(layoutText.includes("クイズ結果"));
  assert.ok(!layoutText.includes("测验成绩"));

  // Legacy scene without metadata.language: the default card cannot pick its copy.
  const legacyDir = mkdtempSync(join(tmpdir(), "ainobi-cli-score-summary-no-language-"));
  run(legacyDir, ["init", "--name", "Legacy", "--language", "en", "--first-slide"]);
  run(legacyDir, ["quiz", "init", "--total-score", "100"]);
  const legacyPath = join(legacyDir, "legacy.scene.json");
  run(legacyDir, ["save", legacyPath]);
  const legacy = JSON.parse(readFileSync(legacyPath, "utf-8")) as { metadata: Record<string, unknown> };
  delete legacy.metadata.language;
  writeFileSync(legacyPath, JSON.stringify(legacy));
  run(legacyDir, ["load", legacyPath]);
  const refused = runExpectFailure(legacyDir, ["quiz", "score-summary", "insert", "0"]);
  assert.equal(refused.error.code, "USAGE");
  assert.match(refused.error.message, /metadata\.language/);
});
