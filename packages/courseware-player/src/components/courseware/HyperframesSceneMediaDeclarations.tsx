// SPDX-License-Identifier: AGPL-3.0-only
import type {
  HyperframesAudioDeclaration,
  HyperframesMediaDeclarations,
  HyperframesVideoAudioDeclaration,
} from "../../lib/courseware-renderer/hyperframes-media-declarations.ts";

export function HyperframesSceneMediaDeclarations({
  declarations,
}: {
  declarations: HyperframesMediaDeclarations;
}) {
  if (declarations.audios.length === 0 && declarations.videoAudios.length === 0) {
    return null;
  }

  return (
    <div aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden">
      {declarations.audios.map((track) => (
        <HyperframesDeclaredAudio key={track.id} track={track} />
      ))}
      {declarations.videoAudios.map((track) => (
        <HyperframesDeclaredVideoAudio key={track.id} track={track} />
      ))}
    </div>
  );
}

function HyperframesDeclaredAudio({ track }: { track: HyperframesAudioDeclaration }) {
  return (
    <audio
      id={track.id}
      src={track.src}
      preload="auto"
      playsInline
      data-start={formatSec(track.startSec)}
      data-end={formatSec(track.endSec)}
      data-volume={String(track.volume)}
      {...(track.mediaStartSec != null
        ? { "data-media-start": formatSec(track.mediaStartSec) }
        : {})}
      {...(track.loop ? { loop: true } : {})}
    />
  );
}

function HyperframesDeclaredVideoAudio({ track }: { track: HyperframesVideoAudioDeclaration }) {
  return (
    <video
      id={track.id}
      src={track.src}
      preload="auto"
      playsInline
      data-has-audio="true"
      data-start={formatSec(track.startSec)}
      data-end={formatSec(track.endSec)}
      data-volume={String(track.volume)}
      {...(track.loop ? { loop: true } : {})}
    />
  );
}

function formatSec(seconds: number): string {
  return String(Number(seconds.toFixed(6)));
}
