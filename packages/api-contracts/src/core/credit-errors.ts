// SPDX-License-Identifier: AGPL-3.0-only
/** Codes a client recognizes when a request is refused for lack of credits; hosts without billing never send them. */

/** Terminal frame code in streaming and WebSocket protocols. */
export const INSUFFICIENT_CREDITS_FRAME_CODE = "INSUFFICIENT_CREDITS";

/** Stable prefixes of agent SSE `error` payloads, parsed by the assistant UI. */
export const AINOBI_INSUFFICIENT_ORG_CREDITS = "AINOBI_INSUFFICIENT_ORG_CREDITS";
export const AINOBI_INSUFFICIENT_PERSONAL_CREDITS = "AINOBI_INSUFFICIENT_PERSONAL_CREDITS";
