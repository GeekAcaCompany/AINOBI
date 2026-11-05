// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

/** Keys that carry authored visual identity — do not override when set in AST `style`. */
const APPEARANCE_KEYS: ReadonlyArray<keyof CSSProperties> = [
  "backgroundColor",
  "background",
  "color",
  "borderColor",
  "border",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "boxShadow",
  "opacity",
  "filter",
  "textShadow",
];

export const authorStyleHasCustomAppearance = (author?: CSSProperties): boolean => {
  if (!author) return false;
  return APPEARANCE_KEYS.some((key) => {
    const value = author[key];
    return value !== undefined && value !== null && value !== "";
  });
};

const BORDER_SHORTHAND_KEYS: ReadonlyArray<keyof CSSProperties> = [
  "borderWidth",
  "borderStyle",
  "borderColor",
  "borderTop",
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderRight",
  "borderRightWidth",
  "borderRightStyle",
  "borderRightColor",
  "borderBottom",
  "borderBottomWidth",
  "borderBottomStyle",
  "borderBottomColor",
  "borderLeft",
  "borderLeftWidth",
  "borderLeftStyle",
  "borderLeftColor",
];

/** Drop default entries when the author already set the same CSS key. */
export const omitAuthorSetKeys = (
  defaults: CSSProperties,
  author?: CSSProperties,
): CSSProperties => {
  if (!author) return defaults;
  const out: CSSProperties = { ...defaults };
  for (const key of Object.keys(author) as Array<keyof CSSProperties>) {
    if (author[key] !== undefined) {
      delete out[key];
    }
  }
  if (author.border !== undefined) {
    for (const key of BORDER_SHORTHAND_KEYS) {
      delete out[key];
    }
  }
  if (author.background !== undefined) {
    delete out.backgroundColor;
  }
  if (author.backgroundColor !== undefined) {
    delete out.background;
  }
  return out;
};

/** Subtle hover / press / disabled feedback that does not replace author colors. */
export const authorInteractiveFeedback = (
  visualState: "idle" | "hover" | "active" | "disabled" | "submitting",
): CSSProperties => {
  switch (visualState) {
    case "hover":
      return { filter: "brightness(0.96)" };
    case "active":
      return { filter: "brightness(0.9)", transform: "scale(0.98)" };
    case "disabled":
      return { opacity: 0.5, cursor: "not-allowed" };
    case "submitting":
      return { opacity: 0.72, cursor: "wait" };
    default:
      return {};
  }
};
