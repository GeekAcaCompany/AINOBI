// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { assertRenderUrlAllowed, RenderUrlBlockedError } from "./render-url-guard.ts";

async function assertBlocked(url: string): Promise<void> {
  await assert.rejects(
    () => assertRenderUrlAllowed(url),
    (error: unknown) => {
      assert.ok(error instanceof RenderUrlBlockedError);
      return true;
    },
  );
}

test("assertRenderUrlAllowed blocks loopback IPv4 literal", async () => {
  await assertBlocked("http://127.0.0.1:8080/page");
});

test("assertRenderUrlAllowed blocks cloud metadata address", async () => {
  await assertBlocked("http://169.254.169.254/latest/meta-data/");
});

test("assertRenderUrlAllowed blocks RFC1918 private ranges", async () => {
  await assertBlocked("http://10.0.0.5/internal");
  await assertBlocked("http://172.16.0.5/internal");
  await assertBlocked("http://192.168.1.5/internal");
});

test("assertRenderUrlAllowed blocks localhost hostname", async () => {
  await assertBlocked("http://localhost:3000/render");
});

test("assertRenderUrlAllowed allows localhost when AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS is set", async () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS;
  process.env.AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS = "true";
  try {
    await assertRenderUrlAllowed("http://localhost:5173/courseware-renderer");
    await assertRenderUrlAllowed("http://127.0.0.1:5173/courseware-renderer");
  } finally {
    if (previous === undefined) {
      delete process.env.AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS;
    } else {
      process.env.AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS = previous;
    }
  }
});

test("assertRenderUrlAllowed blocks IPv6 loopback and unique-local", async () => {
  await assertBlocked("http://[::1]/page");
  await assertBlocked("http://[fd00::1]/page");
});

test("assertRenderUrlAllowed blocks unsupported protocols", async () => {
  await assertBlocked("file:///etc/passwd");
});

test("assertRenderUrlAllowed rejects invalid URLs", async () => {
  await assertBlocked("not-a-url");
});

test("assertRenderUrlAllowed allows a public IPv4 literal", async () => {
  await assertRenderUrlAllowed("http://8.8.8.8/page");
});

test("assertRenderUrlAllowed enforces AINOBI_VIDEO_RENDER_ALLOWED_HOSTS when configured", async () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS;
  process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS = "app.example.com";

  try {
    await assertBlocked("https://evil.example.com/page");
    // Subdomain of the allowed host should pass (network lookup best-effort;
    // if DNS is unavailable in CI the function still validates protocol/host).
    await assertRenderUrlAllowed("https://app.example.com/courseware-renderer");
  } finally {
    if (previous === undefined) {
      delete process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS;
    } else {
      process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS = previous;
    }
  }
});

test("courseware + OCI object storage hosts pass the render guard (no code-level domain block)", async () => {
  // Render workers load courseware HTML from courseware.example.com and, after
  // the OCI storage migration, from objectstorage.<region>.oraclecloud.com
  // (native public URLs) / the S3-compat endpoint (presigned GETs). The guard
  // must accept all three: DNS resolves public, no certificate pinning exists
  // anywhere in the worker, and the allowlist is env-only (unset in prod).
  const previous = process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS;
  delete process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS;
  try {
    await assertRenderUrlAllowed("https://courseware.example.com/courseware-renderer?hf=1");
    await assertRenderUrlAllowed(
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/html/a.html",
    );
    await assertRenderUrlAllowed(
      "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/raw/html/a.html?X-Amz-Signature=abc",
    );
  } finally {
    if (previous === undefined) delete process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS;
    else process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS = previous;
  }
});

test("OCI object storage hosts are accepted when an allowlist explicitly names them", async () => {
  const previous = process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS;
  process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS =
    "courseware.example.com,objectstorage.ap-tokyo-1.oraclecloud.com";
  try {
    await assertRenderUrlAllowed(
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/html/a.html",
    );
    // Unrelated hosts stay blocked (allowlist matching permits subdomains of
    // listed hosts, so the OCI host itself + its subdomains are the scope).
    await assertBlocked("https://evil.example.com/a.html");
  } finally {
    if (previous === undefined) delete process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS;
    else process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS = previous;
  }
});
