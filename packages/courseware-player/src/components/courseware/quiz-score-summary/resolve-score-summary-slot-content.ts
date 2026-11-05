// SPDX-License-Identifier: AGPL-3.0-only
import { Children, type ReactNode } from "react";

/** Empty children / only blank interpolations fall back to the context snapshot text. */
export const resolveScoreSummarySlotContent = (
  children: ReactNode,
  fallback: string,
): ReactNode => {
  if (children === null || children === undefined || children === false) {
    return fallback || null;
  }
  const nodes = Children.toArray(children);
  if (nodes.length === 0) {
    return fallback || null;
  }
  const hasMeaningfulContent = nodes.some((child) => {
    if (child == null) return false;
    if (typeof child === "string") return child.trim().length > 0;
    return true;
  });
  if (!hasMeaningfulContent) {
    return fallback || null;
  }
  return children;
};
