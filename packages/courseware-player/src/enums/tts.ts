// SPDX-License-Identifier: AGPL-3.0-only
export enum TTSProvider {
  Google = "google",
  FishAudio = "fishaudio",
  MiniMax = "minimax",
}

export enum TTSStatus {
  Active = "active",
  Inactive = "inactive",
  Deleted = "deleted",
}

export enum TTSModel {
  S1 = "s1",
  Speech28Hd = "speech-2.8-hd",
}

export const TTSModelMap = {
  [TTSProvider.FishAudio]: [TTSModel.S1],
  [TTSProvider.MiniMax]: [TTSModel.Speech28Hd],
};

export const TTSVoiceMap = {
  [TTSModel.S1]: ["92c556e1a13e4ac7add3d1a8665c3cb8"],
  [TTSModel.Speech28Hd]: ["Chinese (Mandarin)_Gentleman"],
};
