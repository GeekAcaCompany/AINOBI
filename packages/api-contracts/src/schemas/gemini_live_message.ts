// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Gemini Live WS message schemas.
 *
 * Client/server messages of the personal panel's Gemini Live voice session. Aligned with the
 * structure convention of websocket_message.ts (uppercase enum values, inbound `type` alias, outbound
 * `message_type` + `session_id` + `data` + `timestamp` envelope) — so frontend integrators
 * see one consistent protocol shape.
 */

import { z } from "zod";

/** Client message types */
export const ClientMessageType = {
  AUDIO_CHUNK: "AUDIO_CHUNK",
  TEXT: "TEXT",
  INTERRUPT: "INTERRUPT",
  END: "END",
  HEARTBEAT: "HEARTBEAT",
} as const;
export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

/** Server message types */
export const ServerMessageType = {
  READY: "READY",
  AUDIO_CHUNK: "AUDIO_CHUNK",
  TEXT: "TEXT",
  USER_TRANSCRIPT: "USER_TRANSCRIPT",
  TURN_COMPLETE: "TURN_COMPLETE",
  INTERRUPTED: "INTERRUPTED",
  ERROR: "ERROR",
  HEARTBEAT_ACK: "HEARTBEAT_ACK",
} as const;
export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

/** Client message (inbound; type alias, data={} by default) */
export const GeminiLiveClientMessageSchema = z.object({
  message_type: z.enum([
    ClientMessageType.AUDIO_CHUNK,
    ClientMessageType.TEXT,
    ClientMessageType.INTERRUPT,
    ClientMessageType.END,
    ClientMessageType.HEARTBEAT,
  ]),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type GeminiLiveClientMessage = z.infer<typeof GeminiLiveClientMessageSchema>;

/** Server message (outbound envelope) */
export interface GeminiLiveServerMessage {
  message_type: ServerMessageType;
  session_id: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/** Create a server message (timestamp defaults to Date.now()/1000) */
export function createGeminiLiveServerMessage(
  messageType: ServerMessageType,
  sessionId: string,
  data: Record<string, unknown> = {},
  timestamp?: number,
): GeminiLiveServerMessage {
  return {
    message_type: messageType,
    session_id: sessionId,
    data,
    timestamp: timestamp ?? Date.now() / 1000,
  };
}

/** Parse an inbound client message: `type` alias → message_type; throws ZodError on failure */
export function parseGeminiLiveClientMessage(raw: unknown): GeminiLiveClientMessage {
  const payload =
    raw !== null && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (typeof payload.type === "string" && payload.message_type === undefined) {
    payload.message_type = payload.type;
  }
  return GeminiLiveClientMessageSchema.parse(payload);
}
