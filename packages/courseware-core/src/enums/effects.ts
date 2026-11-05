// SPDX-License-Identifier: AGPL-3.0-only
export const EFFECT_VALUES = [
  "none",
  "fade_in",
  "fade_out",
  "scale_in",
  "scale_out",
  "rotate_in",
  "rotate_out",
  "translate_in",
  "translate_out",
] as const;

export type Effect = (typeof EFFECT_VALUES)[number];

export const Effects = {
  NONE: "none",
  FADE_IN: "fade_in",
  FADE_OUT: "fade_out",
  SCALE_IN: "scale_in",
  SCALE_OUT: "scale_out",
  ROTATE_IN: "rotate_in",
  ROTATE_OUT: "rotate_out",
  TRANSLATE_IN: "translate_in",
  TRANSLATE_OUT: "translate_out",
} as const;
