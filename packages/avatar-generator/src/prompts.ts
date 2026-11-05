// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Avatar generation prompts.
 *
 * Base generation forces a pure green screen at full frame (the prerequisite of deterministic chroma keying); the mouth-opening variant stresses
 * "change only the mouth, keep everything else bit for bit", and the retry version maxes out the mouth opening after the first round fails.
 */

/** v3 green screen (the background color of base generation and mouth-opening edits) */
export const GREEN_SCREEN = "#00FF00";

export const AVATAR_BASE_PROMPT = `
Anime VTuber character, full body standing portrait, front facing view.
Flat cel-shading, clean thin lineart, closed mouth with a small neutral
smile, arms relaxed. The ENTIRE background must be a flat solid uniform
${GREEN_SCREEN} green screen, edge to edge — no gradients, no shadows on the
background, no props. No text, watermark, or logo.
`.trim();

export const AVATAR_MOUTH_OPEN_PROMPT = `
Using the provided image as the exact reference: same character, same pose,
same framing, same art style and colors, same ${GREEN_SCREEN} background.
ONLY CHANGE: open the mouth wide in a clear "A" vowel shape — lips parted,
a clearly visible DARK mouth interior (deep red/black cavity, teeth only as
a thin upper strip). This must be an obvious, unmissable change to the
mouth. Keep the head, hair, eyes, body and outline at exactly the same
position and scale. No text or watermark.
`.trim();

export const AVATAR_MOUTH_OPEN_RETRY_PROMPT = `
CRITICAL: your previous attempt did NOT open the mouth. Try again.
Using the provided image as the exact reference: same character, same pose,
same framing, same art style and colors, same ${GREEN_SCREEN} background.
ONLY CHANGE: the character is now SHOUTING / singing a loud high note —
mouth WIDE OPEN in an exaggerated anime "A" vowel, jaw dropped low, lips
parted far, with a large dark-red / near-black mouth cavity filling most
of the opening (classic anime open-mouth close-up). The open mouth must be
the most obvious feature of the image. Everything else stays at exactly
the same position and scale. No text or watermark.
`.trim();

/** User description + base generation template (description first) */
export function buildAvatarPrompt(description: string): string {
  return `${description.trim()}\n${AVATAR_BASE_PROMPT}`;
}
