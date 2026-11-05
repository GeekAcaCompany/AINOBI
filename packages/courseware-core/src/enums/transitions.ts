// SPDX-License-Identifier: AGPL-3.0-only
export const TRANSITION_VALUES = [
  "none",
  "fade",
  "dissolve",
  "push_left",
  "push_right",
  "push_up",
  "push_down",
  "wipe_left",
  "wipe_right",
  "wipe_up",
  "wipe_down",
  "zoom_in",
  "zoom_out",
  "cross_fade",
] as const;

export type Transition = (typeof TRANSITION_VALUES)[number];

export const Transitions = {
  NONE: "none",
  FADE: "fade",
  DISSOLVE: "dissolve",
  PUSH_LEFT: "push_left",
  PUSH_RIGHT: "push_right",
  PUSH_UP: "push_up",
  PUSH_DOWN: "push_down",
  WIPE_LEFT: "wipe_left",
  WIPE_RIGHT: "wipe_right",
  WIPE_UP: "wipe_up",
  WIPE_DOWN: "wipe_down",
  ZOOM_IN: "zoom_in",
  ZOOM_OUT: "zoom_out",
  CROSS_FADE: "cross_fade",
} as const;
