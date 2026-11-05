// SPDX-License-Identifier: AGPL-3.0-only
import { currentHost } from './host.ts';

const agent = () => currentHost().interactionAgent;

export type InteractionConversationHistoryResult = any;
export const buildInteractionAgentChatStreamBody = (...args: any[]) => agent().buildInteractionAgentChatStreamBody(...args);
export const fetchInteractionConversationHistory = (...args: any[]) => agent().fetchInteractionConversationHistory(...args);
export const isInteractionApiConfigured = (...args: any[]) => agent().isInteractionApiConfigured(...args);
export const postInteractionChatStream = (...args: any[]) => agent().postInteractionChatStream(...args);
export const postInteractionChatStreamAbort = (...args: any[]) => agent().postInteractionChatStreamAbort(...args);
export const postInteractionPermissionAnswer = (...args: any[]) => agent().postInteractionPermissionAnswer(...args);
export const readInteractionAgentSseSessionFields = (...args: any[]) => agent().readInteractionAgentSseSessionFields(...args);
