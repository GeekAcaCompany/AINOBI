// SPDX-License-Identifier: AGPL-3.0-only
/** Remove `undefined` keys recursively so JSON round-trips omit optional fields. */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child !== undefined) {
        out[key] = stripUndefinedDeep(child);
      }
    }
    return out as T;
  }
  return value;
}
