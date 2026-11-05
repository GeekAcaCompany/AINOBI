// SPDX-License-Identifier: AGPL-3.0-only
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { coursewareOrgIdFromEnv } from "./courseware-persistence-org.ts";
import { cliEnv } from "./env.ts";
import { AinobiCliError } from "./errors.ts";

export type CoursewarePersistenceSaveResult = {
  key: string;
  title: string | null;
  updatedAt: string;
  versionCount: number;
};

type PersistenceResponse = {
  ok?: boolean;
  error?: string;
  courseware?: {
    key?: string;
    title?: string | null;
    updatedAt?: string;
    versions?: unknown[];
  };
};

const persistenceEndpoint = (): string => {
  const raw = cliEnv().AINOBI_COURSEWARE_PERSISTENCE_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent persistence save requires `AINOBI_COURSEWARE_PERSISTENCE_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi save` from the courseware agent chat environment, or configure the host to inject persistence URL and courseware key.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const coursewareKey = (): string => {
  const key = cliEnv().AINOBI_COURSEWARE_KEY?.trim();
  if (!key) {
    throw new AinobiCliError(
      "USAGE",
      "Agent persistence save requires `AINOBI_COURSEWARE_KEY` (set by the AINOBI host for this chat).",
      {
        hint:
          "Bind the chat to a courseware record before saving, or use `ainobi save --stdout` for a local JSON dump only.",
      },
    );
  }
  return key;
};

const persistenceAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const putJson = (url: URL, body: string): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "PUT",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          ...persistenceAuthHeaders(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 500, text: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.setTimeout(30_000, () => {
      req.destroy(new Error("Courseware persistence request timed out after 30s"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

/**
 * PUT scene JSON to the host courseware persistence API (`/courseware?key=…`).
 */
export async function saveCoursewareViaPersistence(
  content: Record<string, unknown>,
  options?: { title?: string | null },
): Promise<CoursewarePersistenceSaveResult> {
  const key = coursewareKey();
  const endpoint = persistenceEndpoint();
  const url = new URL(`${endpoint}?key=${encodeURIComponent(key)}`);
  const payload: {
    content: Record<string, unknown>;
    title?: string | null;
    orgId?: string;
  } = { content };
  if (options?.title !== undefined) {
    payload.title = options.title;
  }
  const orgId = coursewareOrgIdFromEnv();
  if (orgId) {
    payload.orgId = orgId;
  }
  const body = JSON.stringify(payload);

  let response: { status: number; text: string };
  try {
    response = await putJson(url, body);
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Courseware persistence request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: `PUT ${url.toString()}` },
    );
  }

  let parsed: PersistenceResponse;
  try {
    parsed = JSON.parse(response.text) as PersistenceResponse;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Courseware persistence returned non-JSON (HTTP ${response.status}).`,
      { hint: `PUT ${url.toString()}` },
    );
  }

  if (response.status < 200 || response.status >= 300 || parsed.ok === false) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error ?? `Courseware persistence failed (HTTP ${response.status}).`,
      { hint: `PUT ${url.toString()}` },
    );
  }

  const cw = parsed.courseware;
  if (!cw?.key) {
    throw new AinobiCliError("IO_ERROR", "Courseware persistence response missing `courseware.key`.");
  }

  return {
    key: cw.key,
    title: cw.title ?? null,
    updatedAt: cw.updatedAt ?? new Date().toISOString(),
    versionCount: Array.isArray(cw.versions) ? cw.versions.length : 0,
  };
}
