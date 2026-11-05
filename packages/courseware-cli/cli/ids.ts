// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";

const rand = (): string => randomUUID().replace(/-/g, "");

/**
 * All ID generation lives in one place so the CLI can guarantee that no
 * caller (i.e. the AI agent) is allowed to specify them externally. We use
 * the same `el_` / `eb_` / `sc_` namespacing as the runtime types.
 */
export const newSceneId = (): string => `sc_${rand().slice(0, 12)}`;
export const newElementId = (kind?: string): string => {
  const tag = kind ? kind.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const suffix = rand().slice(0, 10);
  return tag ? `el_${tag}_${suffix}` : `el_${rand().slice(0, 12)}`;
};
export const newBindingId = (): string => `eb_${rand().slice(0, 12)}`;
export const newPauseId = (): string => `pause_${rand().slice(0, 10)}`;
