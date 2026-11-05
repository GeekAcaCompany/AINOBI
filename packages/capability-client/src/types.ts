// SPDX-License-Identifier: AGPL-3.0-only
export interface CapabilityStatus {
  available: boolean;
  package: string;
  label: string;
  reason?: string;
}

export type CapabilityMap = Record<string, CapabilityStatus>;

export interface CapabilityStore {
  load(apiBase: string): Promise<void>;
  isAvailable(key: string): boolean;
  getStatus(key: string): CapabilityStatus | undefined;
  isLoaded(): boolean;
}

