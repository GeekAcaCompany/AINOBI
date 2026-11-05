// SPDX-License-Identifier: AGPL-3.0-only
export type Rgb = { r: number; g: number; b: number };

export type ParsedCssColor = Rgb & { alpha: number };

/** Parse hex / rgb(a). Gradients and hsl return null. */
export function parseCssColor(input: string | undefined): ParsedCssColor | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  if (s[0] === "#") {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length === 6 && /^[0-9a-fA-F]+$/.test(hex)) {
      const n = Number.parseInt(hex, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
    }
    return null;
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if (!Number.isFinite(alpha)) return null;
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      alpha: Math.min(1, Math.max(0, alpha)),
    };
  }
  return null;
}

export function relativeLuminance(rgb: Rgb): number {
  const linearize = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const r = linearize(rgb.r);
  const g = linearize(rgb.g);
  const b = linearize(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function compositeOverBackground(foreground: ParsedCssColor, background: Rgb): Rgb {
  const alpha = foreground.alpha;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
  };
}

/** WCAG 2.x contrast ratio (1 = identical, higher = more distinct). */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const clampByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

export function rgbToHex(rgb: Rgb): string {
  const toHex = (channel: number): string => clampByte(channel).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/** Normalize css color strings to opaque `#rrggbb` for editor pickers. */
// oxlint-disable-next-line only-used-in-recursion -- the fallback is normalized through the same path
export function normalizeColorToHex(input: string | undefined, fallback = "#000000"): string {
  const trimmed = input?.trim();
  if (!trimmed || trimmed.toLowerCase() === "transparent") {
    return normalizeColorToHex(fallback, "#000000");
  }
  const parsed = parseCssColor(trimmed);
  if (!parsed) {
    return normalizeColorToHex(fallback, "#000000");
  }
  return rgbToHex(parsed);
}
