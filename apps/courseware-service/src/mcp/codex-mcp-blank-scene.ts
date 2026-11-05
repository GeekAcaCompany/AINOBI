// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';

import { newElementId, newSceneId } from '@ainobi/courseware-cli/cli/ids.ts';
import type { ContentLanguage } from '@ainobi/courseware-core/content-language.ts';

const controllerDefaults = {
  play: true,
  next: true,
  back: true,
  seekBar: true,
  time: true,
  slideNumber: true,
  volume: true,
  fullScreen: true,
  brand: true,
  playbackRate: true,
};

/**
 * Minimal blank scene used when MCP creates a new courseware.
 * `language` is the content language the user confirmed (`scene.metadata.language`);
 * it is omitted only by the legacy repair path that has no user to ask — the CLI then
 * refuses to bake default copy until `scene.update` sets it.
 */
export function createBlankCoursewareScene(
  title?: string | null,
  language?: ContentLanguage,
): Record<string, unknown> {
  const name = title?.trim() || 'Untitled Courseware';
  return {
    scene_id: newSceneId(),
    name,
    slide_elements: [
      {
        element_type: 'slide',
        element_id: newElementId('slide'),
        // Intentionally unnamed: the student editor renders a localized page
        // label for empty slide names instead of a hardcoded Chinese placeholder.
        name: '',
        action_mappings: {},
        event_scripts: {},
        preset_script: '',
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        timeline: { start_at: 0, end_at: 10000 },
        style: { opacity: 1, rotation_deg: 0, z_index: 0 },
        enter_effect: 'none',
        exit_effect: 'none',
        animations: [],
        keyframes: [],
        event_bindings: [],
        fps: 30,
        metadata: {},
        background_color: '#FFFFFF',
        background_image_url: '',
        background_image_fit: 'cover',
        children_elements: [],
      },
    ],
    vtuber_elements: [],
    audio_elements: [],
    controller: controllerDefaults,
    transitions: [],
    preset_script: '',
    metadata: {
      theme: 'default',
      canvas: { width: 1920, height: 1080 },
      ...(language ? { language } : {}),
      generated_by: 'ainobi-codex-mcp',
    },
  };
}

/** Business key for new courseware rows (UUID v4; editor-compatible). */
export function newCoursewareBusinessKey(): string {
  return randomUUID();
}
