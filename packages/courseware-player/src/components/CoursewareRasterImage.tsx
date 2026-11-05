// SPDX-License-Identifier: AGPL-3.0-only
import { deriveImageObjectFit, type ImageElement } from "../lib/courseware/index.ts";
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";

/**
 * Renders a courseware `image` element and optionally reports natural pixel size on load
 * (for persisting `source_intrinsic_width` / `source_intrinsic_height` on the model).
 */
export function CoursewareRasterImage({
  element,
  className = "h-full w-full",
  style,
  draggable = false,
  onIntrinsicSize,
  onClick,
  title,
  role: imgRole,
  /** When true with {@link onPlaybackLoadingChange}, signals preview should pause the timeline until decode. */
  playbackGateActive,
  onPlaybackLoadingChange,
}: {
  element: ImageElement;
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
  onIntrinsicSize?: (width: number, height: number) => void;
  onClick?: () => void;
  title?: string;
  role?: ImgHTMLAttributes<HTMLImageElement>["role"];
  playbackGateActive?: boolean;
  onPlaybackLoadingChange?: (isBuffering: boolean) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>): void => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (w > 0 && h > 0) onIntrinsicSize?.(w, h);
  };

  useLayoutEffect(() => {
    if (!onPlaybackLoadingChange) return;
    if (!playbackGateActive) {
      onPlaybackLoadingChange(false);
      return;
    }
    const img = imgRef.current;
    if (!img) {
      onPlaybackLoadingChange(true);
      return;
    }
    const report = (): void => {
      if (img.complete && img.naturalWidth > 0) {
        onPlaybackLoadingChange(false);
      } else {
        onPlaybackLoadingChange(true);
      }
    };
    report();
    const onLoad = (): void => onPlaybackLoadingChange(false);
    const onError = (): void => onPlaybackLoadingChange(false);
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    return () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      onPlaybackLoadingChange(false);
    };
  }, [playbackGateActive, element.source, onPlaybackLoadingChange]);

  return (
    <img
      ref={imgRef}
      src={element.source}
      alt={element.name}
      className={className}
      style={{
        objectFit: deriveImageObjectFit(element),
        ...style,
      }}
      draggable={draggable}
      onLoad={handleLoad}
      onClick={onClick}
      title={title}
      role={imgRole}
    />
  );
}
