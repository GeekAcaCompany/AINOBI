// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "vitest";

import { createGoogleAccessToken, hasGoogleCredentials, readGoogleServiceAccount } from "./google-auth.ts";
import { GoogleTTSProvider } from "./provider.ts";
import { googleTtsInteractionsUrl } from "./speech.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  client_email: "tts@proj.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  project_id: "proj-from-key",
  token_uri: "https://oauth2.test/token",
};

test("mints a signed JWT bearer token from a service account, caches it, and refreshes it before it expires", async () => {
  let now = 1_000_000;
  const assertions: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, "https://oauth2.test/token");
    assertions.push(new URLSearchParams(String(init.body)).get("assertion")!);
    return new Response(JSON.stringify({ access_token: `token-${assertions.length}`, expires_in: 3600 }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const token = createGoogleAccessToken({ credentialsJson: JSON.stringify(account) }, { fetch, now: () => now });

  assert.equal(await token(), "token-1");
  assert.equal(await token(), "token-1");
  const [header, claim, signature] = assertions[0]!.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${claim}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(signature!, "base64url")));
  assert.equal(JSON.parse(Buffer.from(claim!, "base64url").toString()).iss, account.client_email);

  now += 3600 * 1000 - 30_000;
  assert.equal(await token(), "token-2");
});

test("reads a key file, takes a ready token as is, and says what is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "google-auth-"));
  const path = join(dir, "sa.json");
  writeFileSync(path, JSON.stringify(account));
  assert.equal((await readGoogleServiceAccount({ credentialsPath: path }))?.project_id, "proj-from-key");
  assert.equal(await createGoogleAccessToken({ accessToken: " ready " })(), "ready");
  assert.equal(hasGoogleCredentials({}), false);
  await assert.rejects(createGoogleAccessToken({})(), /GOOGLE_APPLICATION_CREDENTIALS/);
  await assert.rejects(readGoogleServiceAccount({ credentialsJson: '{"type":"api_key"}' }), /not a service account key/);
});

test("the provider needs credentials, and takes the project from the service account", async () => {
  assert.throws(() => new GoogleTTSProvider({ settings: {} }), /GOOGLE_APPLICATION_CREDENTIALS/);
  const provider = new GoogleTTSProvider({ settings: { credentials_json: JSON.stringify(account) } });
  assert.equal(await (provider as unknown as { resolveProject(): Promise<string> }).resolveProject(), "proj-from-key");
});

test("a regional location uses that region's endpoint", () => {
  assert.equal(
    googleTtsInteractionsUrl({ project: "p", location: "us-central1" }),
    "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-central1/interactions",
  );
  assert.equal(
    googleTtsInteractionsUrl({ project: "p", apiBase: "https://relay.test/vertexai/" }),
    "https://relay.test/vertexai/v1beta1/projects/p/locations/global/interactions",
  );
});
