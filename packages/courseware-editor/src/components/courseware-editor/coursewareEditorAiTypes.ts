// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal type matching the structure of tool_calls items in OpenAI Chat Completions, reused by the route layer and API parsing (not shown in the UI).
 */
export type OpenAICompatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** Event shape reserved for use with streaming response parsing */
export type CoursewareAiStreamEvent =
  | { type: "message_delta"; text: string }
  | { type: "tool_calls"; calls: OpenAICompatToolCall[] }
  | { type: "done" };
