// SPDX-License-Identifier: AGPL-3.0-only
import type { CSSProperties } from "react";

export interface QuizMediaProps {
  type: "image" | "audio";
  src: string;
  alt?: string;
  loop?: boolean;
  controls?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/**
 * Lightweight media wrapper. The AST validator already ensures `src` is
 * either a `data:` URI or an https URL; the renderer assumes presign / CDN
 * rewriting happened at scene-load time.
 */
export const QuizMedia = ({
  type,
  src,
  alt,
  loop,
  controls,
  className,
  style,
  id,
}: QuizMediaProps) => {
  if (type === "image") {
    return (
      <img
        id={id}
        className={className}
        style={style}
        src={src}
        alt={alt ?? ""}
        data-quiz-media="image"
        loading="lazy"
      />
    );
  }
  return (
    <audio
      id={id}
      className={className}
      style={style}
      src={src}
      loop={loop}
      controls={controls ?? true}
      data-quiz-media="audio"
    />
  );
};
