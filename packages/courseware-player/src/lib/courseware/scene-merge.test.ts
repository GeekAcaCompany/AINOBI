// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { cloneCoursewareScene, mergeCoursewareScenesThreeWay } from "./scene-merge.ts";
import { createDefaultQuestionWithAst } from "@ainobi/courseware-core/quiz-default-asts.ts";
import { createDefaultQuizConfig } from "@ainobi/courseware-core/quiz.ts";
import { deserializeScene, type Scene } from "@ainobi/courseware-core/scene.ts";

function makeScene(overrides?: {
  name?: string;
  slideChildren?: Record<string, unknown>[];
}): Scene {
  return deserializeScene({
    audio_elements: [],
    scene_id: "sc_merge",
    name: overrides?.name ?? "base",
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
    slide_elements: [
      {
        action_mappings: {},
        event_scripts: {},
        preset_script: "",
        element_type: "slide",
        element_id: "el_slide_0",
        name: "slide",
        fps: 30,
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        timeline: { start_at: 0, end_at: 5000 },
        style: { opacity: 1, rotation_deg: 0, z_index: 0 },
        enter_effect: "none",
        exit_effect: "none",
        animations: [],
        keyframes: [],
        event_bindings: [],
        metadata: {},
        background_color: "#000",
        children_elements: overrides?.slideChildren ?? [],
      },
    ],
    vtuber_elements: [],
  });
}

function textChild(id: string, text: string): Record<string, unknown> {
  return {
    element_type: "text",
    element_id: id,
    name: id,
    html: "",
    fps: 30,
    position: { x: 10, y: 10 },
    size: { width: 200, height: 40 },
    timeline: { start_at: 0, end_at: 5000 },
    style: { opacity: 1, rotation_deg: 0, z_index: 1 },
    enter_effect: "none",
    exit_effect: "none",
    animations: [],
    keyframes: [],
    highlight_segments: [],
    event_bindings: [],
    metadata: {},
    action_mappings: {},
    event_scripts: {},
    preset_script: "",
    text,
    font_size: 24,
    font_family: "sans-serif",
    color: "#fff",
    align: "left",
    bold: false,
  };
}

describe("mergeCoursewareScenesThreeWay", () => {
  it("keeps local-only and remote-only child edits on different elements", () => {
    const base = makeScene({
      slideChildren: [textChild("el_a", "a"), textChild("el_b", "b")],
    });
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    local.slide_elements[0].children_elements[0] = textChild("el_a", "user-a") as never;
    remote.slide_elements[0].children_elements[1] = textChild("el_b", "agent-b") as never;

    const { scene, conflictElementIds } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(conflictElementIds).toEqual([]);
    expect(scene.slide_elements[0].children_elements[0].element_id).toBe("el_a");
    expect((scene.slide_elements[0].children_elements[0] as { text: string }).text).toBe(
      "user-a",
    );
    expect((scene.slide_elements[0].children_elements[1] as { text: string }).text).toBe(
      "agent-b",
    );
  });

  it("prefers remote when the same element diverged on both sides", () => {
    const base = makeScene({ slideChildren: [textChild("el_a", "base")] });
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    local.slide_elements[0].children_elements[0] = textChild("el_a", "user") as never;
    remote.slide_elements[0].children_elements[0] = textChild("el_a", "agent") as never;

    const { scene, conflictElementIds } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(conflictElementIds).toContain("el_a");
    expect((scene.slide_elements[0].children_elements[0] as { text: string }).text).toBe(
      "agent",
    );
  });

  it("includes agent-added child elements", () => {
    const base = makeScene({ slideChildren: [] });
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    remote.slide_elements[0].children_elements = [textChild("el_new", "agent-new") as never];

    const { scene } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(scene.slide_elements[0].children_elements).toHaveLength(1);
    expect(scene.slide_elements[0].children_elements[0].element_id).toBe("el_new");
  });

  it("keeps user-added child elements when remote did not touch them", () => {
    const base = makeScene({ slideChildren: [] });
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    local.slide_elements[0].children_elements = [textChild("el_user", "user-new") as never];

    const { scene } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(scene.slide_elements[0].children_elements[0].element_id).toBe("el_user");
  });

  it("drops slides deleted on remote unless user edited them (conflict, remote wins)", () => {
    const base = makeScene();
    const local = cloneCoursewareScene(base);
    const remote = makeScene({ name: "remote-empty" });
    remote.slide_elements = [];
    local.slide_elements[0].background_color = "#111";

    const { scene, conflictElementIds } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(conflictElementIds).toContain("el_slide_0");
    expect(scene.slide_elements).toHaveLength(0);
  });

  it("merges scene name independently from slide children", () => {
    const base = makeScene({ name: "title-base" });
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    local.name = "title-user";
    remote.name = "title-agent";

    const { scene, conflictElementIds } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(conflictElementIds).toContain("scene:name");
    expect(scene.name).toBe("title-agent");
  });

  it("preserves local child order when remote order matches base", () => {
    const base = makeScene({
      slideChildren: [textChild("el_a", "a"), textChild("el_b", "b"), textChild("el_c", "c")],
    });
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    local.slide_elements[0].children_elements = [
      textChild("el_c", "a") as never,
      textChild("el_a", "a") as never,
      textChild("el_b", "b") as never,
    ];
    remote.slide_elements[0].children_elements[1] = textChild("el_b", "agent-b") as never;

    const { scene } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(scene.slide_elements[0].children_elements.map((el) => el.element_id)).toEqual([
      "el_c",
      "el_a",
      "el_b",
    ]);
    expect((scene.slide_elements[0].children_elements[2] as { text: string }).text).toBe(
      "agent-b",
    );
  });

  it("merges quiz questions independently", () => {
    const q1 = createDefaultQuestionWithAst("single_choice", "en");
    q1.title = "Base Q1";
    const q2 = createDefaultQuestionWithAst("single_choice", "en");
    q2.title = "Agent Q2";

    const base = makeScene();
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    const baseQuiz = createDefaultQuizConfig();
    baseQuiz.questions = [q1];
    base.quiz = baseQuiz;

    const localQuiz = createDefaultQuizConfig();
    localQuiz.questions = [{ ...q1, title: "User Q1" }];
    local.quiz = localQuiz;

    const remoteQuiz = createDefaultQuizConfig();
    remoteQuiz.questions = [q1, q2];
    remote.quiz = remoteQuiz;

    const { scene, conflictElementIds } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(conflictElementIds).toEqual([]);
    expect(scene.quiz?.questions).toHaveLength(2);
    expect(scene.quiz?.questions[0]?.title).toBe("User Q1");
    expect(scene.quiz?.questions[1]?.title).toBe("Agent Q2");
  });

  it("drops quiz when user clears it while remote quiz is unchanged", () => {
    const base = makeScene();
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    const baseQuiz = createDefaultQuizConfig();
    base.quiz = baseQuiz;
    remote.quiz = createDefaultQuizConfig();
    remote.quiz!.questions = [...baseQuiz.questions];
    local.quiz = null;

    const { scene } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(scene.quiz).toBeNull();
  });

  it("advancing merge base preserves user edits across sequential agent patches", () => {
    const base = makeScene({ slideChildren: [textChild("el_a", "seed")] });
    let mergeBase = cloneCoursewareScene(base);
    const agentRemote = cloneCoursewareScene(base);

    agentRemote.slide_elements[0].children_elements[0] = textChild("el_a", "agent-a") as never;
    let local = cloneCoursewareScene(base);
    let merged = mergeCoursewareScenesThreeWay(
      mergeBase,
      local,
      agentRemote,
    ).scene;
    mergeBase = cloneCoursewareScene(merged);

    local = cloneCoursewareScene(merged);
    local.slide_elements[0].children_elements[0] = textChild("el_a", "user-a") as never;
    agentRemote.slide_elements[0].children_elements.push(textChild("el_b", "agent-b") as never);

    merged = mergeCoursewareScenesThreeWay(mergeBase, local, agentRemote).scene;
    expect((merged.slide_elements[0].children_elements[0] as { text: string }).text).toBe(
      "user-a",
    );
    expect(merged.slide_elements[0].children_elements[1]?.element_id).toBe("el_b");
  });

  it("keeps quiz shell fields when agent adds quiz on a scene without local quiz config", () => {
    const base = makeScene();
    const local = cloneCoursewareScene(base);
    const remote = cloneCoursewareScene(base);
    const remoteQuiz = createDefaultQuizConfig();
    const q1 = createDefaultQuestionWithAst("single_choice", "en");
    q1.title = "Agent Q1";
    remoteQuiz.questions = [q1];
    remote.quiz = remoteQuiz;

    const { scene, conflictElementIds } = mergeCoursewareScenesThreeWay(base, local, remote);
    expect(conflictElementIds).toEqual([]);
    expect(scene.quiz?.enabled).toBe(true);
    expect(scene.quiz?.total_score).toBe(100);
    expect(scene.quiz?.score_allocation).toBe("even_split");
    expect(scene.quiz?.questions).toHaveLength(1);
    expect(scene.quiz?.questions[0]?.title).toBe("Agent Q1");
  });
});
