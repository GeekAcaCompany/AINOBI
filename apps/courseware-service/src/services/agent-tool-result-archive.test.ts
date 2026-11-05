// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveStorageToolUseId,
  buildToolResultStub,
  buildToolUseInputStub,
  isArchivedToolResultStub,
  isArchivedToolUseInputStub,
  isBatchPlanWritePath,
  rewriteAssistantToolUseInputs,
  rewriteEntryToolResults,
  shouldArchiveBatchWriteContent,
  shouldSkipArchiveForReadPath,
  stringifyToolResponse,
  TOOL_RESULT_ARCHIVE_THRESHOLD,
  TOOL_USE_BATCH_WRITE_ARCHIVE_THRESHOLD,
} from "./agent-tool-result-archive.ts";

test("stringifyToolResponse handles string and content blocks", () => {
  assert.equal(stringifyToolResponse("hello"), "hello");
  assert.equal(
    stringifyToolResponse([{ type: "text", text: "a" }, { type: "text", text: "b" }]),
    "a\nb",
  );
});

test("shouldSkipArchiveForReadPath protects L0 SKILL.md", () => {
  assert.equal(
    shouldSkipArchiveForReadPath(".claude/skills/ainobi-courseware-cli/SKILL.md"),
    true,
  );
  assert.equal(
    shouldSkipArchiveForReadPath("/tmp/ws/.claude/skills/ainobi-courseware-cli/SKILL.md"),
    true,
  );
  assert.equal(shouldSkipArchiveForReadPath("references/topics/quiz.md"), false);
});

test("buildToolResultStub keeps decision fields and recall id", () => {
  const raw = JSON.stringify({
    ok: true,
    data: { element_id: "el_text_1", slide_id: "el_slide_1", children: [1, 2, 3] },
    warnings: ["w1"],
  });
  const stub = buildToolResultStub({
    toolUseId: "tool_1",
    toolName: "Bash",
    commandSummary: "ainobi slide get 0",
    rawOutput: raw,
    blobId: "blob-uuid",
  });
  assert.ok(isArchivedToolResultStub(stub));
  assert.match(stub, /el_text_1/);
  assert.match(stub, /children_count":3/);
  assert.match(stub, /ainobi recall blob-uuid/);
});

test("buildToolResultStub keeps image generate source/file_id after fat asset", () => {
  const source =
    "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/499ae0156caf1755a9d00fbb75a0a702.png";
  const raw = JSON.stringify({
    ok: true,
    data: {
      prompt_chars: 200,
      model: "gpt-image-2",
      size: "1536x1024",
      quality: "high",
      asset: {
        fileId: "bf720bae-11ad-4af1-869b-0a00ee700a0a",
        fileUrl: source,
        // pad so preview alone would not reach `source` if decision omitted it
        note: "x".repeat(800),
      },
      source,
      file_id: "bf720bae-11ad-4af1-869b-0a00ee700a0a",
      file_name: "p1_cover_fuji.png",
    },
  });
  const stub = buildToolResultStub({
    toolUseId: "tool_img",
    toolName: "Bash",
    commandSummary: "ainobi image generate --prompt …",
    rawOutput: raw,
    blobId: "blob-img",
  });
  assert.ok(isArchivedToolResultStub(stub));
  assert.match(stub, /499ae0156caf1755a9d00fbb75a0a702\.png/);
  assert.match(stub, /bf720bae-11ad-4af1-869b-0a00ee700a0a/);
  assert.match(stub, /p1_cover_fuji\.png/);
  assert.match(stub, /ainobi recall blob-img/);
});

test("rewriteEntryToolResults replaces oversized tool_result content", () => {
  const stub = "[tool_result archived]\nid: x\nrecall: ainobi recall x";
  const entry = {
    type: "user",
    message: {
      type: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "x".repeat(TOOL_RESULT_ARCHIVE_THRESHOLD + 10) },
      ],
    },
  };
  const out = rewriteEntryToolResults(entry, new Map([["t1", stub]]));
  const content = (out.message as { content: Array<{ content: string }> }).content[0].content;
  assert.equal(content, stub);
});

test("shouldArchiveBatchWriteContent targets work_dir batch plans", () => {
  const path = "/tmp/ainobi-cli/work/sess/batch/s1-elems.json";
  const small = '{"operations":[]}';
  const large = JSON.stringify({
    operations: Array.from({ length: 12 }, (_, i) => ({
      op: "element.insert",
      slide: 0,
      element: {
        element_type: "text",
        text: `Card ${i}`,
        position: { x: 100, y: 100 + i * 40 },
        size: { width: 400, height: 32 },
      },
    })),
  });
  assert.equal(isBatchPlanWritePath(path), true);
  assert.equal(
    shouldArchiveBatchWriteContent(path, "x".repeat(TOOL_USE_BATCH_WRITE_ARCHIVE_THRESHOLD)),
    true,
  );
  assert.equal(shouldArchiveBatchWriteContent(path, small), false);
  assert.equal(shouldArchiveBatchWriteContent(path, large), true);
});

test("buildToolUseInputStub and rewriteAssistantToolUseInputs slim Write input", () => {
  const raw = JSON.stringify({
    operations: [{ op: "element.insert", slide: 0, element: { element_type: "text", text: "hi" } }],
  });
  const stub = buildToolUseInputStub({
    toolUseId: "write_1",
    toolName: "Write",
    filePath: "/tmp/work/batch/s0.json",
    rawContent: raw,
    blobId: "blob-write",
  });
  assert.ok(isArchivedToolUseInputStub(stub));
  assert.match(stub, /operations_count: 1/);
  assert.match(stub, /ainobi recall blob-write/);

  const entry = {
    type: "assistant",
    message: {
      type: "assistant",
      content: [
        {
          type: "tool_use",
          id: "write_1",
          name: "Write",
          input: { file_path: "/tmp/work/batch/s0.json", content: raw },
        },
      ],
    },
  };
  const out = rewriteAssistantToolUseInputs(entry, new Map([["write_1", stub]]));
  const input = (
    (out.message as { content: Array<{ input: { content: string } }> }).content[0].input
  );
  assert.equal(input.content, stub);
});

test("archiveStorageToolUseId namespaces input vs result", () => {
  assert.equal(archiveStorageToolUseId("input", "call_1"), "input:call_1");
  assert.equal(archiveStorageToolUseId("result", "call_1"), "result:call_1");
  assert.equal(archiveStorageToolUseId("input", "input:call_1"), "input:call_1");
  assert.equal(archiveStorageToolUseId("result", "result:call_1"), "result:call_1");
  assert.notEqual(
    archiveStorageToolUseId("input", "call_1"),
    archiveStorageToolUseId("result", "call_1"),
  );
});
