// SPDX-License-Identifier: AGPL-3.0-only
import { currentHost } from './host.ts';

export type WhisperVoiceDictationState = 'idle' | 'connecting' | 'listening' | 'recognizing' | 'error';
export type WhisperVoiceDictationError = { code: string; message: string };
export const useWhisperVoiceDictation = (options: any) => currentHost().useWhisperVoiceDictation(options);
