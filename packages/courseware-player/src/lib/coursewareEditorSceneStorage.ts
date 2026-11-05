// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Editor local draft: `localStorage` has a ~5MB limit, and large coursewares hit QuotaExceededError.
 * When the quota is short it writes to IndexedDB; reads try localStorage first, falling back to IDB (the same strategy as preview storage).
 */

import {
  cleanupEvictableLocalStorage,
  safeLocalStorageSetItem,
} from "./safe-storage.ts";

export const EDITOR_STORAGE_KEY_PREFIX = "courseware-editor-scene:";

export const makeEditorStorageKey = (coursewareId: string): string =>
  `${EDITOR_STORAGE_KEY_PREFIX}${coursewareId}`;

const DB_NAME = "courseware-editor-scenes";
const DB_VERSION = 1;
const STORE_NAME = "bundles";

/** Same as the old `localStorage` JSON structure (`scene` is the `serializeScene` result). */
export type EditorSceneStorageRecord = {
  savedAt: string;
  scene: unknown;
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = (): void => {
      reject(req.error ?? new Error("IndexedDB open failed"));
    };
    req.onsuccess = (): void => {
      resolve(req.result);
    };
    req.onupgradeneeded = (): void => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });

const idbPut = async (key: string, value: EditorSceneStorageRecord): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.objectStore(STORE_NAME).put(value, key);
  });
};

const idbGet = async (key: string): Promise<EditorSceneStorageRecord | undefined> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = (): void => resolve(req.result as EditorSceneStorageRecord | undefined);
    req.onerror = (): void => reject(req.error ?? new Error("IndexedDB get failed"));
  });
};

const idbDelete = async (key: string): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.objectStore(STORE_NAME).delete(key);
  });
};

/** The parsed JSON (may be `{ savedAt, scene }` or an old whole-scene package). */
export const readEditorSceneRecord = async (storageKey: string): Promise<unknown | null> => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      return JSON.parse(raw) as unknown;
    }
  } catch {
    // fall through to IDB
  }
  try {
    const fromIdb = await idbGet(storageKey);
    if (fromIdb && typeof fromIdb === "object" && "scene" in fromIdb) {
      return fromIdb as unknown;
    }
  } catch {
    // ignore
  }
  return null;
};

/**
 * Write localStorage first (compact JSON); when the quota is short, clean other caches and retry, and if it still fails write to IndexedDB.
 */
export const writeEditorSceneRecord = async (
  storageKey: string,
  record: EditorSceneStorageRecord,
): Promise<void> => {
  const json = JSON.stringify(record);
  if (safeLocalStorageSetItem(storageKey, json, { exceptKey: storageKey })) {
    try {
      await idbDelete(storageKey);
    } catch {
      // ok
    }
    return;
  }
  cleanupEvictableLocalStorage({ exceptKey: storageKey, aggressive: true });
  if (safeLocalStorageSetItem(storageKey, json, { exceptKey: storageKey })) {
    try {
      await idbDelete(storageKey);
    } catch {
      // ok
    }
    return;
  }
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  await idbPut(storageKey, record);
};

/** Delete the editor draft from localStorage + IndexedDB (avoids leftovers in cases such as no permission / not public). */
export const removeEditorSceneRecord = async (storageKey: string): Promise<void> => {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  try {
    await idbDelete(storageKey);
  } catch {
    // ignore
  }
};

/** Clear the editor scene local draft by courseware_id (without the agent conversation cache). */
export const clearEditorSceneLocalDraft = async (coursewareId: string): Promise<void> => {
  const id = coursewareId.trim();
  if (!id) return;
  await removeEditorSceneRecord(makeEditorStorageKey(id));
};
