// SPDX-License-Identifier: AGPL-3.0-only
import type { CapabilityMap } from './types.ts';

/**
 * Fetch the capability map from the backend's public endpoint.
 * Falls back to an empty map on error (fail-open: all features show as unavailable).
 */
export async function fetchCapabilities(apiBase: string): Promise<CapabilityMap> {
  try {
    const url = `${apiBase.replace(/\/+$/, '')}/public/capabilities`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const json = (await res.json()) as { code?: number; data?: CapabilityMap };
    return json.data ?? {};
  } catch {
    return {};
  }
}

