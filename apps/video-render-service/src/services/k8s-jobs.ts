// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";

/**
 * K8s Job dispatch (the "one render = one pod" model, replacing fire-and-forget
 * HTTP fan-out against a shared worker Deployment).
 *
 * Each unit of work — a full run, one distributed chunk, or an assemble — is a
 * short-lived Job cloned from the `video-render-worker` Deployment's pod template
 * (image / env / resources / node placement stay in sync with the Deployment),
 * with the worker command pointed at the job entrypoint. Exclusivity is then
 * guaranteed by the scheduler: one Job pod renders exactly one unit and exits.
 *
 * Requires the pod's service account to have `jobs` create/get/list/delete and
 * `deployments` get on this namespace (see the RBAC in the K8s manifests).
 */

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

export type RenderJobType = "run" | "chunk" | "assemble";

export type CreateRenderJobResult = {
  jobName: string;
  created: boolean;
  reason?: "exists-active" | "recreated-failed";
};

export function resolveRenderJobDispatchEnabled(): boolean {
  return process.env.AINOBI_RENDER_JOB_DISPATCH?.trim().toLowerCase() === "true";
}

function resolveNamespace(): string {
  return process.env.AINOBI_POD_NAMESPACE?.trim() || readFileSync(join(SA_DIR, "namespace"), "utf8").trim();
}

function inClusterApiAvailable(): boolean {
  return Boolean(process.env.KUBERNETES_SERVICE_HOST) && Boolean(process.env.KUBERNETES_SERVICE_PORT);
}

let cachedApi: { api: string; token: string; ca: Buffer; ns: string } | null = null;

function k8sApi(): { api: string; token: string; ca: Buffer; ns: string } {
  if (cachedApi) {
    return cachedApi;
  }
  if (!inClusterApiAvailable()) {
    throw new Error("k8s jobs: not running in-cluster (KUBERNETES_SERVICE_HOST unset)");
  }
  cachedApi = {
    api:
      `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`,
    token: readFileSync(join(SA_DIR, "token"), "utf8").trim(),
    ca: readFileSync(join(SA_DIR, "ca.crt")),
    ns: resolveNamespace(),
  };
  return cachedApi;
}

function k8sRequest<T = unknown>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const { api, token, ca } = k8sApi();
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      api + path,
      {
        method,
        ca,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(payload !== undefined ? { "content-type": "application/json" } : {}),
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data: unknown = text;
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            /* non-JSON body */
          }
          resolve({ status: res.statusCode ?? 0, data: data as T });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`k8s api timeout: ${method} ${path}`)));
    req.on("error", reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

/** Clone the worker Deployment's pod template so Jobs inherit image/env/placement. */
type WorkerTemplate = {
  image: string;
  env: Array<Record<string, unknown>>;
  resources: Record<string, unknown>;
  nodeSelector?: Record<string, string>;
  tolerations?: Array<Record<string, unknown>>;
  imagePullSecrets?: Array<Record<string, unknown>>;
};

let templateCache: { at: number; value: WorkerTemplate } | null = null;
const TEMPLATE_CACHE_MS = 5 * 60_000;

async function getWorkerPodTemplate(namespace: string): Promise<WorkerTemplate> {
  if (templateCache && Date.now() - templateCache.at < TEMPLATE_CACHE_MS) {
    return templateCache.value;
  }
  const { status, data } = await k8sRequest<{
    spec?: { template?: { spec?: Record<string, unknown> } };
  }>(`GET`, `/apis/apps/v1/namespaces/${namespace}/deployments/video-render-worker`);
  if (status !== 200) {
    throw new Error(`k8s jobs: worker deployment read failed (HTTP ${status})`);
  }
  const podSpec = (data.spec?.template?.spec ?? {}) as Record<string, unknown>;
  const container = (podSpec.containers as Array<Record<string, unknown>> | undefined)?.[0];
  if (!container) {
    throw new Error("k8s jobs: worker deployment has no container");
  }
  const value: WorkerTemplate = {
    image: String(container.image),
    env: (container.env as Array<Record<string, unknown>> | undefined) ?? [],
    resources: (container.resources as Record<string, unknown>) ?? {},
    nodeSelector: podSpec.nodeSelector as Record<string, string> | undefined,
    tolerations: podSpec.tolerations as Array<Record<string, unknown>> | undefined,
    imagePullSecrets: podSpec.imagePullSecrets as Array<Record<string, unknown>> | undefined,
  };
  templateCache = { at: Date.now(), value };
  return value;
}

export function renderJobName(type: RenderJobType, taskId: string, chunkIndex?: number): string {
  const prefix = type === "chunk" ? `render-chunk-${taskId}-c${chunkIndex ?? 0}` : `render-${type}-${taskId}`;
  return prefix.slice(0, 253);
}

const JOB_ACTIVE_DEADLINE_SECONDS = 8 * 60 * 60; // matches the FC wall-clock budget
const JOB_BACKOFF_LIMIT = 2;
const JOB_TTL_SECONDS_AFTER_FINISHED = 3600;

/**
 * Exclusive hardware per Job: request the whole video node so the scheduler can
 * never co-locate two render pods (SwiftShader is memory-bandwidth-bound — two
 * pages on one 4-OCPU node halve each other's capture rate). Values must stay
 * under the node's allocatable (4 OCPU/16GB → ~7.6 CPU / ~13.1Gi after reserve).
 */
function exclusiveNodeResources(): Record<string, unknown> {
  return {
    requests: {
      cpu: process.env.AINOBI_RENDER_JOB_NODE_CPU_MILLIS?.trim() || "7000m",
      memory: process.env.AINOBI_RENDER_JOB_NODE_MEM_MI?.trim() || "12500Mi",
    },
    limits: {
      cpu: process.env.AINOBI_RENDER_JOB_NODE_CPU_MILLIS?.trim() || "7000m",
      memory: process.env.AINOBI_RENDER_JOB_NODE_MEM_MI?.trim() || "12500Mi",
    },
  };
}

/** Create (or reuse) the Job for one render unit. Idempotent by name. */
export async function createRenderJob(options: {
  type: RenderJobType;
  taskId: string;
  chunkIndex?: number;
}): Promise<CreateRenderJobResult> {
  const { type, taskId, chunkIndex } = options;
  const { ns } = k8sApi();
  const name = renderJobName(type, taskId, chunkIndex);
  const jobPath = `/apis/batch/v1/namespaces/${ns}/jobs/${name}`;

  const existing = await k8sRequest<{
    status?: { active?: number; failed?: number; succeeded?: number };
    spec?: { backoffLimit?: number };
  }>("GET", jobPath);
  if (existing.status === 200) {
    const failed = existing.data.status?.failed ?? 0;
    const backoffLimit = existing.data.spec?.backoffLimit ?? JOB_BACKOFF_LIMIT;
    if (failed >= backoffLimit) {
      // Exhausted: delete so a fresh Job can be created below.
      await k8sRequest("DELETE", jobPath).catch(() => undefined);
    } else {
      return { jobName: name, created: false, reason: "exists-active" };
    }
  }

  const template = await getWorkerPodTemplate(ns);
  // Job pods always dispatch their own children (chunks/assemble) as Jobs — the
  // cloned worker env must not carry a stale job-dispatch flag.
  const jobEnv: Array<Record<string, unknown>> = [
    ...template.env.filter(
      (e) =>
        e.name !== "AINOBI_RENDER_JOB_DISPATCH" &&
        e.name !== "AINOBI_RENDER_JOB_NODE_CPU_MILLIS" &&
        e.name !== "AINOBI_RENDER_JOB_NODE_MEM_MI",
    ),
    { name: "AINOBI_RENDER_JOB_DISPATCH", value: "true" },
    { name: "AINOBI_RENDER_JOB_TYPE", value: type },
    { name: "AINOBI_RENDER_JOB_TASK_ID", value: taskId },
    { name: "AINOBI_RENDER_JOB_NODE_CPU_MILLIS", value: process.env.AINOBI_RENDER_JOB_NODE_CPU_MILLIS?.trim() || "7000m" },
    { name: "AINOBI_RENDER_JOB_NODE_MEM_MI", value: process.env.AINOBI_RENDER_JOB_NODE_MEM_MI?.trim() || "12500Mi" },
    ...(chunkIndex !== undefined
      ? [{ name: "AINOBI_RENDER_JOB_CHUNK_INDEX", value: String(chunkIndex) }]
      : []),
  ];

  const job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      labels: { app: "video-render-job", "render-task-id": taskId, "render-job-type": type },
    },
    spec: {
      backoffLimit: JOB_BACKOFF_LIMIT,
      activeDeadlineSeconds: JOB_ACTIVE_DEADLINE_SECONDS,
      ttlSecondsAfterFinished: JOB_TTL_SECONDS_AFTER_FINISHED,
      template: {
        metadata: {
          labels: { app: "video-render-job", "render-task-id": taskId },
          // Cluster autoscaler must never recycle a node under a render pod:
          // a scale-down during a pending/running render once cost a 25-min
          // scheduling stall (2026-09-07 render latency audit).
          annotations: { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" },
        },
        spec: {
          restartPolicy: "OnFailure",
          serviceAccountName: process.env.AINOBI_RENDER_JOB_SERVICE_ACCOUNT?.trim() || "video-render-jobs",
          ...(template.imagePullSecrets ? { imagePullSecrets: template.imagePullSecrets } : {}),
          ...(template.nodeSelector ? { nodeSelector: template.nodeSelector } : {}),
          ...(template.tolerations ? { tolerations: template.tolerations } : {}),
          containers: [
            {
              name: "main",
              image: template.image,
              command: ["node", "--enable-source-maps", "--no-node-snapshot", "dist/jobs/job-entry.js"],
              env: jobEnv,
              // Full-node requests+limits → Guaranteed QoS, one render pod per node.
              resources: exclusiveNodeResources(),
            },
          ],
        },
      },
    },
  };

  const created = await k8sRequest<{ kind?: string; reason?: string; message?: string }>(
    "POST",
    `/apis/batch/v1/namespaces/${ns}/jobs`,
    job,
  );
  // 409 Conflict = someone else created it between GET and POST — treat as exists.
  if (created.status !== 200 && created.status !== 201 && created.status !== 409) {
    throw new Error(
      `k8s jobs: create ${name} failed (HTTP ${created.status}): ` +
        `${(created.data as { message?: string }).message ?? ""}`.slice(0, 300),
    );
  }
  return {
    jobName: name,
    created: created.status === 201,
    reason: created.status === 409 ? "exists-active" : created.status === 200 ? "recreated-failed" : undefined,
  };
}
