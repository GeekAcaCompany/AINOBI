// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Passing the scene from the courseware editor → the preview page: it used only localStorage (~5MB limit), and large coursewares hit QuotaExceededError.
 * When the quota is short or the write fails it writes to IndexedDB; reads try localStorage first, falling back to IDB.
 */

import {
  cleanupEvictableLocalStorage,
  safeLocalStorageSetItem,
} from "./safe-storage.ts";

export const PREVIEW_STORAGE_KEY_PREFIX = "courseware-preview-scene:";
export const PREVIEW_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

const DB_NAME = "courseware-preview-scenes";
const DB_VERSION = 1;
const STORE_NAME = "bundles";

export type PreviewSceneStorageBundle = {
  createdAt: number;
  revision: string;
  scene: unknown;
  /**
   * The scale (pixels per logical unit) of the editor's main canvas when the preview data was written.
   * The preview page's HTML iframe uses this fixed layout, then CSS-scales by the preview window scale, consistent with the editor.
   */
  htmlIframeLayoutScale?: number;
};

export const makePreviewStorageKey = (id: string): string =>
  `${PREVIEW_STORAGE_KEY_PREFIX}${id}`;

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

const idbPut = async (key: string, value: PreviewSceneStorageBundle): Promise<void> => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.objectStore(STORE_NAME).put(value, key);
  });
};

const idbGet = async (key: string): Promise<PreviewSceneStorageBundle | undefined> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = (): void => resolve(req.result as PreviewSceneStorageBundle | undefined);
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

/** Delete the same preview entry from localStorage + IndexedDB (closing the embedded preview etc.). */
export const removePreviewSceneBundle = async (storageKey: string): Promise<void> => {
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

const cleanupExpiredLocalStorage = (): void => {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREVIEW_STORAGE_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { createdAt?: unknown };
        if (
          typeof parsed.createdAt !== "number" ||
          now - parsed.createdAt > PREVIEW_STORAGE_TTL_MS
        ) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage may be unavailable
  }
};

const cleanupExpiredIdb = async (): Promise<void> => {
  const db = await openDb();
  const now = Date.now();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error("IndexedDB cleanup failed"));
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    req.onsuccess = (): void => {
      const cursor = req.result;
      if (!cursor) return;
      const key = cursor.key;
      if (typeof key === "string" && key.startsWith(PREVIEW_STORAGE_KEY_PREFIX)) {
        const value = cursor.value as PreviewSceneStorageBundle | undefined;
        const createdAt = value?.createdAt;
        if (typeof createdAt !== "number" || now - createdAt > PREVIEW_STORAGE_TTL_MS) {
          cursor.delete();
        }
      }
      cursor.continue();
    };
    req.onerror = (): void => reject(req.error ?? new Error("IndexedDB cursor failed"));
  });
};

/** Clean up expired previews (localStorage + IndexedDB). Await it before writing a preview, so the quota doesn't fill up. */
export const cleanupExpiredPreviewScenesAll = async (): Promise<void> => {
  cleanupExpiredLocalStorage();
  try {
    await cleanupExpiredIdb();
  } catch {
    // IDB unavailable or empty DB — ignore
  }
};

export const readPreviewSceneBundle = async (
  storageKey: string,
): Promise<PreviewSceneStorageBundle | null> => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as PreviewSceneStorageBundle;
      if (parsed && typeof parsed === "object" && "scene" in parsed) {
        return parsed;
      }
    }
  } catch {
    // fall through to IDB
  }
  try {
    const fromIdb = await idbGet(storageKey);
    if (fromIdb && typeof fromIdb === "object" && "scene" in fromIdb) {
      return fromIdb;
    }
  } catch {
    // ignore
  }
  return null;
};

/**
 * Write localStorage first; if the quota is short, store in IndexedDB instead and remove any leftover localStorage entry with the same key.
 */
export const writePreviewSceneBundle = async (
  storageKey: string,
  bundle: PreviewSceneStorageBundle,
): Promise<void> => {
  const json = JSON.stringify(bundle);
  if (safeLocalStorageSetItem(storageKey, json, { exceptKey: storageKey })) {
    try {
      await idbDelete(storageKey);
    } catch {
      // no shadow row — ok
    }
    return;
  }
  cleanupEvictableLocalStorage({ exceptKey: storageKey, aggressive: true });
  if (safeLocalStorageSetItem(storageKey, json, { exceptKey: storageKey })) {
    try {
      await idbDelete(storageKey);
    } catch {
      // no shadow row — ok
    }
    return;
  }
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  await idbPut(storageKey, bundle);
};
