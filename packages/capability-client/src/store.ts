// SPDX-License-Identifier: AGPL-3.0-only
import { fetchCapabilities } from './client.ts';
import type { CapabilityMap, CapabilityStatus, CapabilityStore } from './types.ts';

/**
 * Create a framework-agnostic capability store. Call `load()` once on app
 * mount; query with `isAvailable(key)` or `getStatus(key)` thereafter.
 */
export function createCapabilityStore(): CapabilityStore {
  let capabilities: CapabilityMap = {};
  let loaded = false;

  return {
    async load(apiBase: string): Promise<void> {
      capabilities = await fetchCapabilities(apiBase);
      loaded = true;
    },

    isAvailable(key: string): boolean {
      return capabilities[key]?.available ?? false;
    },

    getStatus(key: string): CapabilityStatus | undefined {
      return capabilities[key];
    },

    isLoaded(): boolean {
      return loaded;
    },
  };
}
