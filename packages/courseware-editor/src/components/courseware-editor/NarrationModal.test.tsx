// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NarrationModal } from "./NarrationModal.tsx";
import type { NarrationElement, SlideElement, VtuberElement } from "@ainobi/courseware-player/lib/courseware/index";

const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("@ainobi/courseware-player/hooks/useI18nNew", () => ({ useI18nNew: () => ({ t: mocks.t, language: "en" }) }));
vi.mock("@ainobi/courseware-player/host/ai-teacher-api", () => ({ default: {
  getAITeacher: async () => ({ ai_teacher_id: "teacher", ai_teacher_name: "Teacher", ai_teacher_tts_id: "voice" }),
} }));
vi.mock("@ainobi/courseware-player/host/tts-api", () => ({
  default: {
    getTTSList: async () => ({ data: [] }),
    // Return a valid non-empty catalog so the normal initialization path runs.
    getTtsStyles: async () => ({
      default_style_key: "friendly_teacher",
      recommended: [
        { style_key: "friendly_teacher", label: "亲切教学", label_en: "Friendly Teacher" },
      ],
      styles: [],
    }),
    getAllTTS: async () => [
      {
        tts_id: "11111111-1111-4111-8111-111111111111",
        tts_name: "Kore · 坚定权威（女）",
        tts_provider: "google",
        tts_model: "gemini-3.8-flash-tts",
        tts_voice: "kore",
        tts_language: "zh",
        tts_status: "active",
      },
    ],
  },
}));
vi.mock("@ainobi/courseware-player/api/courseware_assets", () => ({ default: {
  synthesizeAiTeacherTts: mocks.synthesize,
  batchPresignUrls: async () => ({}),
} }));
vi.mock("@ainobi/courseware-player/api/courseware", () => ({ stripCoursewareAssetSignatureFromUrl: (url: string) => url }));
vi.mock("@ainobi/courseware-player/lib/courseware/narration-audio-duration", () => ({ measureNarrationAudioDurationMs: async () => 2000 }));
vi.mock("./NarrationPronunciationDictPanel.tsx", () => ({ NarrationPronunciationDictModal: () => null }));

const vtuber = { element_id: "vtuber", element_type: "vtuber", metadata: { ai_teacher_id: "teacher" } } as unknown as VtuberElement;
const narration = {
  element_id: "narration", element_type: "narration", vtuber_element_id: "vtuber",
  ai_teacher_id: "teacher", ai_teacher_tts_id: "voice", script: "First\nSecond", transcript: "First\nSecond",
  timeline: { start_at: 0, end_at: 2200 },
  segments: ["First", "Second"].map((text, i) => ({ text, audio_url: `old-${i}`, duration_ms: 1000, gap_ms: i ? 200 : 0, source: "tts" })),
} as NarrationElement;
const slide = { element_id: "slide", timeline: { start_at: 0, end_at: 5000 }, children_elements: [vtuber, narration] } as SlideElement;
function setup(existing = narration) {
  const onSegmentSave = vi.fn();
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const props = { coursewareId: "cw", coursewareOrgId: "org", slide: { ...slide, children_elements: [vtuber, existing] }, vtubers: [vtuber], initialVtuberId: "vtuber", initialNarrationElementId: "narration", onSegmentSave, onConfirm, onClose, onSwitchNarrator: vi.fn() };
  const view = render(<NarrationModal {...props} />);
  return { ...view, props, onSegmentSave, onConfirm, onClose };
}
async function regenerate(index = 0) {
  await waitFor(() => expect(screen.getAllByRole("button", { name: "coursewareEditor.narration.regenerateTts" })[index]).not.toBeDisabled());
  fireEvent.click(screen.getAllByRole("button", { name: "coursewareEditor.narration.regenerateTts" })[index]);
}
afterEach(cleanup);
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.synthesize.mockReset().mockResolvedValue({ tts_url: "new-audio" });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("regenerated narration segment persistence", () => {
  it.each(["script", "transcript"] as const)("preserves committed %s fallback until all restored paragraphs have audio", async (field) => {
    const existing = { ...narration, segments: [], script: "", transcript: "", [field]: "First\nSecond\nThird" };
    const view = setup(existing);
    fireEvent.change(screen.getByDisplayValue("Second"), { target: { value: "Updated second" } });
    await regenerate(1);
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(1));
    const saved = view.onSegmentSave.mock.calls[0][0] as NarrationElement;
    expect(saved.script).toBe(existing.script);
    expect(saved.transcript).toBe(existing.transcript);
    expect(saved.segments.map((s) => s.text)).toEqual(["Updated second"]);
    view.rerender(<NarrationModal {...view.props} slide={{ ...slide, children_elements: [vtuber, saved] }} />);
    await regenerate(0);
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(2));
    expect(view.onSegmentSave.mock.calls[1][0][field]).toBe(existing[field]);
    await regenerate(2);
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(3));
    const complete = view.onSegmentSave.mock.calls[2][0] as NarrationElement;
    expect(complete.script).toBe("First\nUpdated second\nThird");
    expect(complete.transcript).toBe(complete.script);
  });

  it("retains fallback text when a later paragraph fails and the modal closes", async () => {
    mocks.synthesize.mockResolvedValueOnce({ tts_url: "new-audio" }).mockRejectedValueOnce(new Error("TTS failed"));
    const view = setup({ ...narration, segments: [] });
    await regenerate();
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(1));
    await regenerate(1);
    await screen.findByText("TTS failed");
    fireEvent.click(screen.getByRole("button", { name: "coursewareEditor.common.cancel" }));
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSegmentSave).toHaveBeenCalledTimes(1);
    const saved = view.onSegmentSave.mock.calls[0][0] as NarrationElement;
    expect(saved.script).toBe(narration.script);
    expect(saved.transcript).toBe(narration.transcript);
    expect(saved.segments).toHaveLength(1);
  });

  it("commits the generated segment without confirming or closing, retaining other drafts on parent update", async () => {
    const view = setup();
    fireEvent.change(screen.getByDisplayValue("Second"), { target: { value: "Unsaved second" } });
    await regenerate();
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(1));
    const saved = view.onSegmentSave.mock.calls[0][0] as NarrationElement;
    expect(saved.segments[0].audio_url).toBe("new-audio");
    expect(saved.segments[1]).toEqual(narration.segments[1]);
    expect(saved.transcript).toBe("First\nSecond");
    expect(saved.timeline.end_at).toBe(3200);
    expect(view.onConfirm).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    view.rerender(<NarrationModal {...view.props} slide={{ ...slide, children_elements: [{ ...vtuber }, { ...saved }] }} vtubers={[{ ...vtuber }]} />);
    expect(screen.getByDisplayValue("Unsaved second")).toBeInTheDocument();
    await regenerate(1);
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(2));
    expect(view.onSegmentSave.mock.calls[1][0].segments.map((s: { audio_url: string }) => s.audio_url)).toEqual(["new-audio", "new-audio"]);
  });

  it("saves each successful batch result without losing earlier results", async () => {
    const view = setup();
    const button = screen.getByRole("button", { name: "coursewareEditor.narration.generateAudioRegenerateAll" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(2));
    expect(view.onSegmentSave.mock.calls[1][0].segments.map((s: { audio_url: string }) => s.audio_url)).toEqual(["new-audio", "new-audio"]);
  });

  it("inserts a newly generated paragraph in place and keeps existing paragraph identities", async () => {
    const view = setup();
    fireEvent.click(screen.getAllByTitle("coursewareEditor.narration.insertSegmentAfter")[0]);
    const textareas = document.querySelectorAll("textarea");
    fireEvent.change(textareas[1], { target: { value: "Inserted" } });
    await regenerate(1);
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(1));
    expect(view.onSegmentSave.mock.calls[0][0].segments.map((s: { text: string }) => s.text)).toEqual(["First", "Inserted", "Second"]);
    await regenerate(2);
    await waitFor(() => expect(view.onSegmentSave).toHaveBeenCalledTimes(2));
    expect(view.onSegmentSave.mock.calls[1][0].segments.map((s: { text: string }) => s.text)).toEqual(["First", "Inserted", "Second"]);
  });

  it("does not commit failed generation", async () => {
    mocks.synthesize.mockRejectedValue(new Error("TTS failed"));
    const view = setup();
    await regenerate();
    await screen.findByText("TTS failed");
    expect(view.onSegmentSave).not.toHaveBeenCalled();
  });

  it("discards a result when the text changed during synthesis", async () => {
    let resolve!: (value: { tts_url: string }) => void;
    mocks.synthesize.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = setup();
    await regenerate();
    fireEvent.change(screen.getByDisplayValue("First"), { target: { value: "Changed while generating" } });
    await act(async () => { resolve({ tts_url: "stale" }); });
    expect(view.onSegmentSave).not.toHaveBeenCalled();
  });

  it("does not commit after the modal unmounts", async () => {
    let resolve!: (value: { tts_url: string }) => void;
    mocks.synthesize.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = setup();
    await regenerate();
    view.unmount();
    await act(async () => { resolve({ tts_url: "late" }); });
    expect(view.onSegmentSave).not.toHaveBeenCalled();
  });
});
