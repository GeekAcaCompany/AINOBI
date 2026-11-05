// SPDX-License-Identifier: AGPL-3.0-only
export type JsonPatchOperation =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string; old_value?: unknown }
  | { op: "replace"; path: string; value: unknown; old_value?: unknown };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const escapePointerSegment = (segment: string): string =>
  segment.replace(/~/g, "~0").replace(/\//g, "~1");

const joinPath = (base: string, segment: string | number): string =>
  `${base}/${escapePointerSegment(String(segment))}`;

const jsonEquals = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const elementIdOf = (value: unknown): string | null => {
  if (!isPlainObject(value)) return null;
  const id = value.element_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
};

/** Courseware element arrays are keyed by element_id; index-only diff breaks on delete/insert. */
const shouldDiffArrayByElementId = (before: unknown[], after: unknown[]): boolean => {
  const sample = [...before, ...after].find((item) => elementIdOf(item) !== null);
  return sample !== undefined;
};

const createElementIdKeyedArrayPatch = (
  before: unknown[],
  after: unknown[],
  path: string,
): JsonPatchOperation[] => {
  const operations: JsonPatchOperation[] = [];
  const beforeEntries = before
    .map((item, index) => ({ index, item, id: elementIdOf(item) }))
    .filter((entry): entry is { index: number; item: unknown; id: string } => entry.id !== null);
  const afterEntries = after
    .map((item, index) => ({ index, item, id: elementIdOf(item) }))
    .filter((entry): entry is { index: number; item: unknown; id: string } => entry.id !== null);

  const beforeById = new Map(beforeEntries.map((entry) => [entry.id, entry]));
  const afterById = new Map(afterEntries.map((entry) => [entry.id, entry]));

  const removed = [...beforeById.values()]
    .filter((entry) => !afterById.has(entry.id))
    .sort((a, b) => b.index - a.index);
  for (const entry of removed) {
    operations.push({
      op: "remove",
      path: joinPath(path, entry.index),
      old_value: entry.item,
    });
  }

  // RFC 6902: add index must be <= current array length — apply low→high (unlike remove).
  const added = [...afterById.values()]
    .filter((entry) => !beforeById.has(entry.id))
    .sort((a, b) => a.index - b.index);
  for (const entry of added) {
    operations.push({
      op: "add",
      path: joinPath(path, entry.index),
      value: entry.item,
    });
  }

  for (const [id, afterEntry] of afterById) {
    const beforeEntry = beforeById.get(id);
    if (!beforeEntry) continue;
    operations.push(...createJsonPatch(beforeEntry.item, afterEntry.item, joinPath(path, afterEntry.index)));
  }

  return operations;
};

export const createJsonPatch = (
  before: unknown,
  after: unknown,
  path = "",
): JsonPatchOperation[] => {
  if (jsonEquals(before, after)) return [];

  // Serialized courseware may include optional keys with value `undefined`.
  // Editors omit those paths, so RFC "add" (not "replace") is required.
  if (before === undefined || before === null) {
    if (after === undefined) return [];
    return [{ op: "add", path: path || "", value: after }];
  }
  if (after === undefined) {
    return [{ op: "remove", path: path || "", old_value: before }];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (shouldDiffArrayByElementId(before, after)) {
      return createElementIdKeyedArrayPatch(before, after, path);
    }
    const operations: JsonPatchOperation[] = [];
    const common = Math.min(before.length, after.length);
    for (let index = 0; index < common; index += 1) {
      operations.push(...createJsonPatch(before[index], after[index], joinPath(path, index)));
    }
    for (let index = common; index < after.length; index += 1) {
      operations.push({ op: "add", path: joinPath(path, index), value: after[index] });
    }
    for (let index = before.length - 1; index >= after.length; index -= 1) {
      operations.push({ op: "remove", path: joinPath(path, index), old_value: before[index] });
    }
    return operations;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const operations: JsonPatchOperation[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const nextPath = joinPath(path, key);
      if (!(key in after)) {
        operations.push({ op: "remove", path: nextPath, old_value: before[key] });
      } else if (!(key in before)) {
        const value = after[key];
        if (value !== undefined) {
          operations.push({ op: "add", path: nextPath, value });
        }
      } else {
        operations.push(...createJsonPatch(before[key], after[key], nextPath));
      }
    }
    return operations;
  }

  return [{ op: "replace", path: path || "", value: after, old_value: before }];
};
