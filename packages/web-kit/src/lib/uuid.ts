// SPDX-License-Identifier: AGPL-3.0-only
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 4122 v4 UUID (doesn't depend on a Secure Context, so it works in HTTP test environments too). */
export function generateUuidV4(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // Some browsers throw outside a secure context
    }
  }
  return uuidV4FromMathRandom();
}

function uuidV4FromMathRandom(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isUuidV4(value: string | null | undefined): boolean {
  const t = value?.trim();
  return Boolean(t && UUID_V4_RE.test(t));
}
