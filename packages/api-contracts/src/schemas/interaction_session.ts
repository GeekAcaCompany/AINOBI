// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Interaction session state (the dataclass family).
 *
 * The full session state stored in Redis (read and written by websocket_session_manager).
 * The serialized form matches the production format key by key
 * (shared-Redis interop — each side reads sessions the other wrote).
 */

import type { ComponentType } from "./websocket_message.ts";

/** Session status */
export const SessionStatus = {
  INITIALIZING: "INITIALIZING",
  RUNNING: "RUNNING",
  WAITING: "WAITING",
  PROCESSING: "PROCESSING",
  COMPLETE: "COMPLETE",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
} as const;
export type SessionStatus =
  (typeof SessionStatus)[keyof typeof SessionStatus];

/** Interaction component definition */
export interface InteractionComponent {
  type: ComponentType;
  order: number;
  content?: unknown;
  question_id?: string | null;
  /** Interaction section ID (the flow builder appends a ":N" cluster suffix) */
  interaction_section_id?: string | null;
  config: Record<string, unknown>;
}

/** Session config (per-field defaults) */
export interface SessionConfig {
  temperature: number;
  language: string;
  auto_continue: boolean;
  answer_timeout: number;
  llm_timeout: number;
}

/** SessionConfig defaults (dataclass field defaults) */
export function defaultSessionConfig(): SessionConfig {
  return {
    temperature: 0.7,
    language: "zh",
    auto_continue: true,
    answer_timeout: 600,
    llm_timeout: 30,
  };
}

/** Interaction session state */
export class InteractionSessionState {
  session_id: string;
  org_id: string;
  course_id: string;
  chapter_id: string;
  section_id: string;
  user_id: string;
  student_id: string | null = null;
  use_organization_asset: boolean = true;

  components: InteractionComponent[] = [];
  current_index = 0;

  system_prompt: string | null = null;
  temperature = 0.7;
  language = "zh";
  generated_history: string[] = [];

  /** question_id → {answer, score} */
  answers: Record<string, { answer: unknown; score: number }> = {};
  total_score = 0;

  status: SessionStatus = SessionStatus.INITIALIZING;

  error_message: string | null = null;
  error_code: string | null = null;

  created_at: number;
  updated_at: number;
  started_at: number | null = null;
  completed_at: number | null = null;

  constructor(params: {
    session_id: string;
    org_id: string;
    course_id: string;
    chapter_id: string;
    section_id: string;
    user_id: string;
  }) {
    this.session_id = params.session_id;
    this.org_id = params.org_id;
    this.course_id = params.course_id;
    this.chapter_id = params.chapter_id;
    this.section_id = params.section_id;
    this.user_id = params.user_id;
    // Default = the current UTC epoch seconds
    this.created_at = Date.now() / 1000;
    this.updated_at = this.created_at;
  }

  /** Redis storage form (matches the production format key by key) */
  toDict(): Record<string, unknown> {
    return {
      session_id: this.session_id,
      org_id: this.org_id,
      course_id: this.course_id,
      chapter_id: this.chapter_id,
      section_id: this.section_id,
      user_id: this.user_id,
      student_id: this.student_id,
      use_organization_asset: this.use_organization_asset,
      components: this.components.map((component) => ({
        type: component.type,
        order: component.order,
        content: component.content ?? null,
        question_id: component.question_id ?? null,
        interaction_section_id: component.interaction_section_id ?? null,
        config: component.config,
      })),
      current_index: this.current_index,
      system_prompt: this.system_prompt,
      temperature: this.temperature,
      language: this.language,
      generated_history: this.generated_history,
      answers: this.answers,
      total_score: this.total_score,
      status: this.status,
      error_message: this.error_message,
      error_code: this.error_code,
      created_at: this.created_at,
      updated_at: this.updated_at,
      started_at: this.started_at,
      completed_at: this.completed_at,
    };
  }

  /** Restore from Redis JSON (matches the production format key by key) */
  static fromDict(data: Record<string, unknown>): InteractionSessionState {
    const state = new InteractionSessionState({
      session_id: String(data["session_id"] ?? ""),
      org_id: String(data["org_id"] ?? ""),
      course_id: String(data["course_id"] ?? ""),
      chapter_id: String(data["chapter_id"] ?? ""),
      section_id: String(data["section_id"] ?? ""),
      user_id: String(data["user_id"] ?? ""),
    });
    const components: InteractionComponent[] = [];
    const rawComponents = Array.isArray(data["components"]) ? data["components"] : [];
    for (const raw of rawComponents as Array<Record<string, unknown>>) {
      components.push({
        type: raw["type"] as ComponentType,
        order: Number(raw["order"] ?? 0),
        content: raw["content"] ?? null,
        question_id: (raw["question_id"] as string | null) ?? null,
        interaction_section_id: (raw["interaction_section_id"] as string | null) ?? null,
        config: (raw["config"] as Record<string, unknown>) ?? {},
      });
    }
    state.student_id = (data["student_id"] as string | null) ?? null;
    state.use_organization_asset = data["use_organization_asset"] !== false;
    state.components = components;
    state.current_index = Number(data["current_index"] ?? 0);
    state.system_prompt = (data["system_prompt"] as string | null) ?? null;
    state.temperature = Number(data["temperature"] ?? 0.7);
    state.language = String(data["language"] ?? "zh");
    state.generated_history = Array.isArray(data["generated_history"])
      ? (data["generated_history"] as string[])
      : [];
    state.answers = (data["answers"] as Record<string, { answer: unknown; score: number }>) ?? {};
    state.total_score = Number(data["total_score"] ?? 0);
    state.status = (data["status"] as SessionStatus) ?? SessionStatus.INITIALIZING;
    state.error_message = (data["error_message"] as string | null) ?? null;
    state.error_code = (data["error_code"] as string | null) ?? null;
    state.created_at = Number(data["created_at"] ?? Date.now() / 1000);
    state.updated_at = Number(data["updated_at"] ?? Date.now() / 1000);
    state.started_at =
      data["started_at"] === null || data["started_at"] === undefined
        ? null
        : Number(data["started_at"]);
    state.completed_at =
      data["completed_at"] === null || data["completed_at"] === undefined
        ? null
        : Number(data["completed_at"]);
    return state;
  }

  /** Add an answer and accumulate the total score (total_score += score) */
  addAnswer(questionId: string, answer: unknown, score = 0): void {
    this.answers[questionId] = { answer, score };
    this.total_score += score;
    this.updated_at = Date.now() / 1000;
  }

  /** Soft-delete an answer in the session (score subtracted back, clamped at 0) */
  removeAnswer(questionId: string): boolean {
    const existing = this.answers[questionId];
    if (existing === undefined) {
      return false;
    }
    delete this.answers[questionId];
    const scoreValue = existing.score;
    if (typeof scoreValue === "number") {
      this.total_score = Math.max(0, this.total_score - Math.trunc(scoreValue));
    }
    this.updated_at = Date.now() / 1000;
    return true;
  }

  /** Progress info (completed = idx + 1) */
  getProgress(currentIndex?: number): {
    total: number;
    completed: number;
    percentage: number;
    current_index: number;
  } {
    const total = this.components.length;
    const idx = currentIndex ?? this.current_index;
    const completed = idx + 1;
    return {
      total,
      completed,
      percentage: total > 0 ? Math.trunc((completed / total) * 100) : 0,
      current_index: idx,
    };
  }

  /** Update the status (first entry into RUNNING seeds started_at; COMPLETE seeds completed_at) */
  updateStatus(status: SessionStatus, errorMessage?: string | null): void {
    this.status = status;
    this.error_message = errorMessage ?? null;
    this.updated_at = Date.now() / 1000;

    if (status === SessionStatus.RUNNING && this.started_at === null) {
      this.started_at = this.updated_at;
    } else if (status === SessionStatus.COMPLETE) {
      this.completed_at = this.updated_at;
    }
  }
}

/** Create a new session state */
export function createSessionState(params: {
  sessionId: string;
  orgId: string;
  courseId: string;
  chapterId: string;
  sectionId: string;
  userId: string;
  components: InteractionComponent[];
  systemPrompt?: string | null;
  config?: Partial<SessionConfig> | null;
  useOrganizationAsset?: boolean;
}): InteractionSessionState {
  const cfg = { ...defaultSessionConfig(), ...params.config };
  const state = new InteractionSessionState({
    session_id: params.sessionId,
    org_id: params.orgId,
    course_id: params.courseId,
    chapter_id: params.chapterId,
    section_id: params.sectionId,
    user_id: params.userId,
  });
  state.components = params.components;
  state.system_prompt = params.systemPrompt ?? null;
  state.temperature = cfg.temperature;
  state.language = cfg.language;
  state.status = SessionStatus.INITIALIZING;
  state.use_organization_asset = params.useOrganizationAsset ?? true;
  return state;
}
