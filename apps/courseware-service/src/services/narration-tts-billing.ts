// SPDX-License-Identifier: AGPL-3.0-only
import { billFishAudioNarrationCredits } from './fishaudio-narration-credits.ts';
import {
  billGoogleNarrationCredits,
  type BillGoogleNarrationCreditsArgs,
} from './google-narration-credits.ts';
import { billMinimaxNarrationCredits } from './minimax-narration-credits.ts';
import type {
  NarrationTtsBillingOutcome,
  NarrationTtsProvider,
} from './narration-tts-credits.ts';

/** Pre-charge narration / synthesis TTS credits with the provider's billing code. */
export function billNarrationTtsCredits(
  provider: NarrationTtsProvider,
  args: BillGoogleNarrationCreditsArgs,
): Promise<NarrationTtsBillingOutcome | null> {
  if (provider === 'fishaudio') {
    return billFishAudioNarrationCredits(args);
  }
  if (provider === 'minimax') {
    return billMinimaxNarrationCredits(args);
  }
  return billGoogleNarrationCredits(args);
}
