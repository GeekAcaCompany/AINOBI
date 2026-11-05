// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Spectrum bars driven by the microphone AnalyserNode.
 * Before initialization finishes, a flat empty waveform is drawn on the canvas (not a CSS fake animation).
 */

import { useCallback, useEffect, useState } from "react";

export interface MicAnalyserWaveformProps {
  /** Whether the waveform area is shown (false when the microphone is off). */
  active: boolean;
  getAnalyser: () => AnalyserNode | null;
  /** Spectrum bar color (a CSS color value). */
  barColor?: string;
  className?: string;
  barCount?: number;
}

const IDLE_BAR_HEIGHT_PX = 2;

function drawWaveformBars(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  barCount: number,
  barColor: string,
  values: Uint8Array | null,
): void {
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const bars = barCount;
  const gap = 2;
  const barWidth = cssWidth / bars - gap;
  const bufferLength = values?.length ?? 0;
  const step =
    values && bufferLength > 0
      ? Math.max(1, Math.floor(bufferLength / bars))
      : 1;

  for (let i = 0; i < bars; i++) {
    const value =
      values && bufferLength > 0 ? values[i * step] / 255 : 0;
    const h =
      value > 0
        ? Math.max(IDLE_BAR_HEIGHT_PX, value * cssHeight * 0.95)
        : IDLE_BAR_HEIGHT_PX;
    const x = i * (barWidth + gap);
    const y = (cssHeight - h) / 2;
    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, Math.max(1, barWidth), h);
  }
}

export function MicAnalyserWaveform({
  active,
  getAnalyser,
  barColor = "#ef4444",
  className = "",
  barCount = 20,
}: MicAnalyserWaveformProps) {
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useCallback((el: HTMLCanvasElement | null) => {
    setCanvasEl((prev) => (prev === el ? prev : el));
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasEl;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let frequencyBuffer: Uint8Array<ArrayBuffer> | null = null;

    const draw = (): void => {
      raf = requestAnimationFrame(draw);

      const analyser = getAnalyser();
      if (analyser) {
        if (
          !frequencyBuffer ||
          frequencyBuffer.length !== analyser.frequencyBinCount
        ) {
          frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(frequencyBuffer);
      }

      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth <= 0 || cssHeight <= 0) return;
      if (canvas.width !== cssWidth * dpr) canvas.width = cssWidth * dpr;
      if (canvas.height !== cssHeight * dpr) canvas.height = cssHeight * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      drawWaveformBars(
        ctx,
        cssWidth,
        cssHeight,
        barCount,
        barColor,
        analyser ? frequencyBuffer : null,
      );
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, barColor, barCount, canvasEl, getAnalyser]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`block min-w-0 ${className}`}
      aria-hidden
    />
  );
}
