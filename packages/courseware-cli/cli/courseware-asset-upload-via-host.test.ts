// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getFileAssetViaHost, uploadFileAssetViaHost } from "./courseware-asset-upload-via-host.ts";

test("uploadFileAssetViaHost POSTs multipart to host and maps response", async () => {
  const coursewareId = "11111111-1111-4111-8111-111111111111";
  const contentMd5 = "a".repeat(32);
  const mock = createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/courseware/assets/upload");
    assert.match(req.headers.authorization ?? "", /^Bearer test-token$/);
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      assert.match(body, /name="coursewareId"/);
      assert.match(body, new RegExp(coursewareId));
      assert.match(body, /name="file"/);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          asset: {
            fileId: "22222222-2222-4222-8222-222222222222",
            contentMd5,
            coursewareId,
            fileName: "logo.png",
            fileSize: 4,
            contentType: "image/png",
            filePath: `raw/png/${contentMd5}.png`,
            fileUrl: `https://cdn.example.com/raw/png/${contentMd5}.png`,
            fileArtifactUrl: null,
            fileArtifactMetadata: null,
          },
          upload: { existed: false },
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    mock.listen(0, () => resolve());
    mock.on("error", reject);
  });
  const addr = mock.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected server address");
  }

  const dir = await mkdtemp(join(tmpdir(), "ainobi-asset-host-"));
  const filePath = join(dir, "logo.png");
  await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const saved = {
    AINOBI_CLI_RUNTIME: process.env.AINOBI_CLI_RUNTIME,
    AINOBI_ASSET_HOST_FLUSH: process.env.AINOBI_ASSET_HOST_FLUSH,
    AINOBI_COURSEWARE_ID: process.env.AINOBI_COURSEWARE_ID,
    AINOBI_COURSEWARE_ASSET_UPLOAD_URL: process.env.AINOBI_COURSEWARE_ASSET_UPLOAD_URL,
    AINOBI_AGENT_API_KEY: process.env.AINOBI_AGENT_API_KEY,
  };

  process.env.AINOBI_CLI_RUNTIME = "agent";
  process.env.AINOBI_ASSET_HOST_FLUSH = "1";
  process.env.AINOBI_COURSEWARE_ID = coursewareId;
  process.env.AINOBI_COURSEWARE_ASSET_UPLOAD_URL = `http://127.0.0.1:${addr.port}/courseware/assets/upload`;
  process.env.AINOBI_AGENT_API_KEY = "test-token";

  try {
    const asset = await uploadFileAssetViaHost(filePath);
    assert.equal(asset.file_id, contentMd5);
    assert.equal(asset.file_name, "logo.png");
    assert.equal(asset.extension, ".png");
    assert.equal(asset.url, `https://cdn.example.com/raw/png/${contentMd5}.png`);
    assert.equal(asset.existed, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await new Promise<void>((resolve, reject) => {
      mock.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("getFileAssetViaHost POSTs JSON to host /get and maps signed url", async () => {
  const coursewareId = "11111111-1111-4111-8111-111111111111";
  const fileId = "22222222-2222-4222-8222-222222222222";
  const contentMd5 = "b".repeat(32);
  const mock = createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/courseware/assets/get");
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        coursewareId?: string;
        fileId?: string;
      };
      assert.equal(body.coursewareId, coursewareId);
      assert.equal(body.fileId, fileId);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          asset: {
            fileId,
            contentMd5,
            coursewareId,
            fileName: "clip.mp3",
            fileSize: 128,
            contentType: "audio/mpeg",
            filePath: `raw/mp3/${contentMd5}.mp3`,
            fileUrl: `https://cdn.example.com/raw/mp3/${contentMd5}.mp3?sig=1`,
            fileArtifactUrl: null,
            fileArtifactMetadata: null,
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    mock.listen(0, () => resolve());
    mock.on("error", reject);
  });
  const addr = mock.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected server address");
  }

  const saved = {
    AINOBI_COURSEWARE_ID: process.env.AINOBI_COURSEWARE_ID,
    AINOBI_COURSEWARE_ASSET_GET_URL: process.env.AINOBI_COURSEWARE_ASSET_GET_URL,
    AINOBI_AGENT_API_KEY: process.env.AINOBI_AGENT_API_KEY,
  };

  process.env.AINOBI_COURSEWARE_ID = coursewareId;
  process.env.AINOBI_COURSEWARE_ASSET_GET_URL = `http://127.0.0.1:${addr.port}/courseware/assets/get`;
  process.env.AINOBI_AGENT_API_KEY = "test-token";

  try {
    const asset = await getFileAssetViaHost(fileId);
    assert.equal(asset.file_id, fileId);
    assert.equal(asset.file_name, "clip.mp3");
    assert.equal(asset.extension, ".mp3");
    assert.equal(asset.url, `https://cdn.example.com/raw/mp3/${contentMd5}.mp3?sig=1`);
    assert.equal(asset.existed, true);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await new Promise<void>((resolve, reject) => {
      mock.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
