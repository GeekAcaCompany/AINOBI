// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { saveCoursewareViaPersistence } from "./courseware-persistence-save.ts";
import { handleSave } from "./commands/save.ts";
import { parseArgs } from "./args.ts";

const startMockPersistence = (
  expectedKey: string,
): Promise<{ server: Server; port: number; getLastPut: () => { key: string; body: unknown } | null }> =>
  new Promise((resolve, reject) => {
    let lastPut: { key: string; body: unknown } | null = null;
    const server = createServer((req, res) => {
      if (req.method === "PUT" && req.url?.startsWith(`/courseware?key=${encodeURIComponent(expectedKey)}`)) {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          lastPut = { key: expectedKey, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              courseware: {
                key: expectedKey,
                title: "AgentSave",
                updatedAt: "2026-05-17T00:00:00.000Z",
                versions: [{ id: "v1", revision: 1, createdAt: "2026-05-17T00:00:00.000Z" }],
              },
            }),
          );
        });
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind mock persistence server"));
        return;
      }
      resolve({
        server,
        port: address.port,
        getLastPut: () => lastPut,
      });
    });
    server.on("error", reject);
  });

const restoreEnv = (keys: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(keys)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

test("saveCoursewareViaPersistence PUTs scene JSON to host API", async () => {
  const coursewareKey = "agent-save-test-key";
  const mock = await startMockPersistence(coursewareKey);
  const savedEnv = {
    AINOBI_COURSEWARE_KEY: process.env.AINOBI_COURSEWARE_KEY,
    AINOBI_COURSEWARE_PERSISTENCE_URL: process.env.AINOBI_COURSEWARE_PERSISTENCE_URL,
    AINOBI_COURSEWARE_ORG_ID: process.env.AINOBI_COURSEWARE_ORG_ID,
  };
  process.env.AINOBI_COURSEWARE_KEY = coursewareKey;
  process.env.AINOBI_COURSEWARE_PERSISTENCE_URL = `http://127.0.0.1:${mock.port}/courseware`;
  process.env.AINOBI_COURSEWARE_ORG_ID = "8cdf6f92-b8ea-42c7-a060-5c808090e37a";

  try {
    const result = await saveCoursewareViaPersistence({ name: "AgentSave", scene_id: "sc_test" });
    assert.equal(result.key, coursewareKey);
    const put = mock.getLastPut();
    assert.ok(put);
    const body = put!.body as { content?: { name?: string }; orgId?: string };
    assert.equal(body.content?.name, "AgentSave");
    assert.equal(body.orgId, "8cdf6f92-b8ea-42c7-a060-5c808090e37a");
  } finally {
    restoreEnv(savedEnv);
    await new Promise<void>((resolve, reject) => {
      mock.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("handleSave uses host flush in agent runtime without HTTP PUT", async () => {
  const coursewareKey = "agent-save-host-flush";
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-save-host-flush-"));
  const sessionId = "save-agent-host-flush";
  const scene = {
    scene_id: "sc_host_flush",
    name: "HostFlushSave",
    slide_elements: [],
    vtuber_elements: [],
    audio_elements: [],
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
    metadata: { theme: "default", canvas: { width: 1920, height: 1080 } },
  };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, `${sessionId}.json`),
    `${JSON.stringify({
      version: 1,
      session_id: sessionId,
      source_path: null,
      loaded_at: new Date().toISOString(),
      saved_at: null,
      dirty: true,
      work_dir: null,
      scene,
    })}\n`,
    "utf-8",
  );

  const savedEnv = {
    AINOBI_CLI_RUNTIME: process.env.AINOBI_CLI_RUNTIME,
    AINOBI_PERSISTENCE_HOST_FLUSH: process.env.AINOBI_PERSISTENCE_HOST_FLUSH,
    AINOBI_COURSEWARE_KEY: process.env.AINOBI_COURSEWARE_KEY,
    AINOBI_COURSEWARE_PERSISTENCE_URL: process.env.AINOBI_COURSEWARE_PERSISTENCE_URL,
    AINOBI_SESSION: process.env.AINOBI_SESSION,
    AINOBI_STATE_DIR: process.env.AINOBI_STATE_DIR,
  };
  process.env.AINOBI_CLI_RUNTIME = "agent";
  process.env.AINOBI_PERSISTENCE_HOST_FLUSH = "1";
  process.env.AINOBI_COURSEWARE_KEY = coursewareKey;
  delete process.env.AINOBI_COURSEWARE_PERSISTENCE_URL;
  process.env.AINOBI_SESSION = sessionId;
  process.env.AINOBI_STATE_DIR = stateDir;

  try {
    await handleSave(parseArgs(["save", "--pretty=false"]), { pretty: false });
  } finally {
    restoreEnv(savedEnv);
  }
});

test("handleSave uses persistence in agent runtime (in-process)", async () => {
  const coursewareKey = "agent-save-handle";
  const mock = await startMockPersistence(coursewareKey);
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-save-agent-"));
  const sessionId = "save-agent-inproc";
  const scene = {
    scene_id: "sc_inproc",
    name: "AgentSave",
    slide_elements: [],
    vtuber_elements: [],
    audio_elements: [],
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
    metadata: { theme: "default", canvas: { width: 1920, height: 1080 } },
  };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, `${sessionId}.json`),
    `${JSON.stringify({
      version: 1,
      session_id: sessionId,
      source_path: null,
      loaded_at: new Date().toISOString(),
      saved_at: null,
      dirty: true,
      work_dir: null,
      scene,
    })}\n`,
    "utf-8",
  );

  const savedEnv = {
    AINOBI_CLI_RUNTIME: process.env.AINOBI_CLI_RUNTIME,
    AINOBI_COURSEWARE_KEY: process.env.AINOBI_COURSEWARE_KEY,
    AINOBI_COURSEWARE_PERSISTENCE_URL: process.env.AINOBI_COURSEWARE_PERSISTENCE_URL,
    AINOBI_COURSEWARE_ORG_ID: process.env.AINOBI_COURSEWARE_ORG_ID,
    AINOBI_SESSION: process.env.AINOBI_SESSION,
    AINOBI_STATE_DIR: process.env.AINOBI_STATE_DIR,
  };
  process.env.AINOBI_CLI_RUNTIME = "agent";
  process.env.AINOBI_COURSEWARE_KEY = coursewareKey;
  process.env.AINOBI_COURSEWARE_PERSISTENCE_URL = `http://127.0.0.1:${mock.port}/courseware`;
  process.env.AINOBI_COURSEWARE_ORG_ID = "8cdf6f92-b8ea-42c7-a060-5c808090e37a";
  process.env.AINOBI_SESSION = sessionId;
  process.env.AINOBI_STATE_DIR = stateDir;

  try {
    await handleSave(parseArgs(["save", "--pretty=false"]), { pretty: false });
    const put = mock.getLastPut();
    assert.ok(put);
    const body = put!.body as { content?: { name?: string }; title?: string; orgId?: string };
    assert.equal(body.content?.name, "AgentSave");
    assert.equal(body.title, "AgentSave");
    assert.equal(body.orgId, "8cdf6f92-b8ea-42c7-a060-5c808090e37a");
  } finally {
    restoreEnv(savedEnv);
    await new Promise<void>((resolve, reject) => {
      mock.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("save --stdout still works in agent runtime (subprocess)", () => {
  const cliRoot = fileURLToPath(new URL("..", import.meta.url));
  const bin = join(cliRoot, "bin", "ainobi.mjs");
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-save-agent-stdout-"));

  const env = {
    ...process.env,
    AINOBI_SESSION: "save-agent-stdout",
    AINOBI_SHELL_SESSION: "save-agent-stdout-shell",
    AINOBI_STATE_DIR: stateDir,
    AINOBI_CLI_RUNTIME: "agent",
  };

  const run = (args: string[]) =>
    spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
      cwd: cliRoot,
      encoding: "utf-8",
      env,
      timeout: 15_000,
    });

  let r = run(["init", "--name", "AgentSave", "--language", "en", "--first-slide"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = run(["save", "--stdout"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const scene = JSON.parse(r.stdout.trim()) as { scene_id?: string; name?: string };
  assert.ok(typeof scene.scene_id === "string" && scene.scene_id.length > 0);
  assert.equal(scene.name, "AgentSave");
});

test("agent runtime rejects ainobi load when a scene is already bound", () => {
  const cliRoot = fileURLToPath(new URL("..", import.meta.url));
  const bin = join(cliRoot, "bin", "ainobi.mjs");
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-agent-rebootstrap-"));
  const scenePath = join(stateDir, "other.scene.json");
  writeFileSync(
    scenePath,
    `${JSON.stringify({
      scene_id: "sc_other",
      name: "Other",
      slide_elements: [],
      vtuber_elements: [],
    })}\n`,
    "utf-8",
  );

  const env = {
    ...process.env,
    AINOBI_SHELL_SESSION: "agent-rebootstrap-shell",
    AINOBI_STATE_DIR: stateDir,
    AINOBI_CLI_RUNTIME: "agent",
  };

  const run = (args: string[]) =>
    spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
      cwd: cliRoot,
      encoding: "utf-8",
      env,
      timeout: 15_000,
    });

  let r = run(["init", "--name", "Bound", "--language", "en", "--first-slide"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = run(["load", scenePath]);
  assert.notEqual(r.status, 0, "expected second load to be rejected");
  const err = JSON.parse((r.stderr || r.stdout).trim()) as {
    ok?: boolean;
    error?: { code?: string; message?: string };
  };
  assert.equal(err.ok, false);
  assert.equal(err.error?.code, "INVALID_INPUT");
  assert.match(err.error?.message ?? "", /already loaded/i);
});
