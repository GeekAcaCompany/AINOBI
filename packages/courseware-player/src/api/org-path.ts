// SPDX-License-Identifier: AGPL-3.0-only
export const requireResourceOrgId = (orgId: string): string => {
  const value = orgId.trim();
  if (!value) {
    throw new Error("Missing resource organization ID");
  }
  return value;
};
