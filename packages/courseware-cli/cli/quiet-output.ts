// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shrink mutation success payloads for agent context.
 * Read commands should not rely on this — only apply when OutputOptions.quiet
 * is set on mutation paths (withSceneTransaction / element insert|update).
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const IDISH_KEY =
  /(?:^|_)(id|ids|index|at|count|kind|op|type|name|applied|animated|skipped|dirty|dry_run|fields|status|from|to)$/i;

/** Paths/URLs needed after quiet slim (e.g. `image generate` → element `source`). */
const PATH_OR_URL_KEY = /^(source|file_url|html_path|image_path|markdown_path)$/i;
const PATH_OR_URL_MAX_CHARS = 2048;

const keepScalar = (key: string, value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") {
    if (PATH_OR_URL_KEY.test(key) && value.length <= PATH_OR_URL_MAX_CHARS) return true;
    if (value.length > 120) return false;
    return IDISH_KEY.test(key) || key === "updated_fields" || key === "inserted_at";
  }
  if (Array.isArray(value)) {
    if (!IDISH_KEY.test(key) && key !== "updated_fields") return false;
    return value.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
  }
  return false;
};

/** When quiet batch applies at least this many ops, omit the per-op `results` array entirely. */
export const BATCH_QUIET_OMIT_RESULTS_MIN_OPS = 3;

/** Slim one batch OperationApplyResult into op/id + id-like scalars. */
export const slimBatchOperationResult = (result: unknown): Record<string, unknown> => {
  if (!isPlainObject(result)) return { result };
  const out: Record<string, unknown> = { op: result.op };
  if (result.id !== undefined) out.id = result.id;
  const data = isPlainObject(result.data) ? result.data : {};
  for (const [key, value] of Object.entries(data)) {
    if (!keepScalar(key, value)) continue;
    out[key] = value;
  }
  return out;
};

/**
 * Quiet mutation success: drop bulky echoes (`element`, `asset`, full batch
 * result bodies) while keeping ids, counts, dry_run/dirty.
 */
export const slimMutationSuccessData = <T>(
  data: T,
  options: { omitBatchResults?: boolean } = {},
): T => {
  if (!isPlainObject(data)) return data;
  const out: Record<string, unknown> = { ...data };
  delete out.element;
  delete out.asset;
  if (Array.isArray(out.results)) {
    const applied =
      typeof out.operations_applied === "number"
        ? out.operations_applied
        : out.results.length;
    const omitResults =
      options.omitBatchResults === true ||
      applied >= BATCH_QUIET_OMIT_RESULTS_MIN_OPS;
    if (omitResults) {
      delete out.results;
    } else {
      out.results = out.results.map(slimBatchOperationResult);
    }
  }
  return out as T;
};

export const maybeQuietMutationData = <T>(data: T, quiet: boolean | undefined): T =>
  quiet ? slimMutationSuccessData(data) : data;
