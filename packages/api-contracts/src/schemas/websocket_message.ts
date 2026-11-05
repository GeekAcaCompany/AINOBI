// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Teaching WS message schemas.
 *
 * The message types client and server exchange in an interactive teaching WS session. Envelope alignment:
 * inbound `type` alias + outbound `message_type` + `session_id` + `data` +
 * `timestamp` (same shape as gemini_live_message.ts — the frontend sees one consistent protocol).
 */

import { z } from "zod";

/** Client message types */
export const ClientMessageType = {
  START_SESSION: "START_SESSION",
  START_COUNTDOWN: "START_COUNTDOWN",
  CONTINUE: "CONTINUE",
  SUBMIT_ANSWER: "SUBMIT_ANSWER",
  SUBMIT_AUDIO: "SUBMIT_AUDIO",
  CANCEL: "CANCEL",
  HEARTBEAT: "HEARTBEAT",
} as const;
export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

/** Server message types */
export const ServerMessageType = {
  SESSION_STARTED: "SESSION_STARTED",
  COMPONENT_START: "COMPONENT_START",
  LLM_STREAM: "LLM_STREAM",
  STATIC_CONTENT: "STATIC_CONTENT",
  COMPONENT_COMPLETE: "COMPONENT_COMPLETE",
  QUESTION_PUSHED: "QUESTION_PUSHED",
  QUESTION_SET_COMPLETE: "QUESTION_SET_COMPLETE",
  ANSWER_FEEDBACK: "ANSWER_FEEDBACK",
  SESSION_COMPLETE: "SESSION_COMPLETE",
  ERROR: "ERROR",
  HEARTBEAT_ACK: "HEARTBEAT_ACK",
} as const;
export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

/** Component types */
export const ComponentType = {
  LLM_EXPLANATION: "llm_explanation",
  MULTIPLE_CHOICE: "multiple_choice",
  TEXT_QUESTION: "text_question",
  AUDIO_QUESTION: "audio_question",
  QUESTION_GROUP: "question_group",
  STATIC_CONTENT: "static_content",
} as const;
export type ComponentType = (typeof ComponentType)[keyof typeof ComponentType];

/** Client message (inbound; type is an alias of message_type, data={} by default) */
export const ClientMessageSchema = z.object({
  message_type: z.enum([
    ClientMessageType.START_SESSION,
    ClientMessageType.START_COUNTDOWN,
    ClientMessageType.CONTINUE,
    ClientMessageType.SUBMIT_ANSWER,
    ClientMessageType.SUBMIT_AUDIO,
    ClientMessageType.CANCEL,
    ClientMessageType.HEARTBEAT,
  ]),
  session_id: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Server message (outbound envelope) */
export interface ServerMessage {
  message_type: ServerMessageType;
  session_id: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/** Create a server message (timestamp defaults to Date.now()/1000) */
export function createServerMessage(
  messageType: ServerMessageType,
  sessionId: string,
  data: Record<string, unknown>,
  timestamp?: number,
): ServerMessage {
  return {
    message_type: messageType,
    session_id: sessionId,
    data,
    timestamp: timestamp ?? Date.now() / 1000,
  };
}

/** Parse an inbound client message: `type` alias → message_type; throws ZodError on failure */
export function parseClientMessage(raw: unknown): ClientMessage {
  const payload =
    raw !== null && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (typeof payload.type === "string" && payload.message_type === undefined) {
    payload.message_type = payload.type;
  }
  return ClientMessageSchema.parse(payload);
}
