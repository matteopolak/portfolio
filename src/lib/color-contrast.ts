/*
 * WCAG contrast for the colours the site uses (`#rrggbb` and `oklch(L% C H)`),
 * plus the oklch helpers the contrast test needs to resolve `color-mix()`.
 * Pure functions, shared with tests/palette-contrast.test.ts.
 */

export interface Oklch {
  lightness: number;
  chroma: number;
  hue: number;
}

type Linear = [number, number, number];

const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

function hexToLinear(hex: string): Linear {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
  const value = parseInt(match[1], 16);
  return [
    srgbToLinear(((value >> 16) & 255) / 255),
    srgbToLinear(((value >> 8) & 255) / 255),
    srgbToLinear((value & 255) / 255),
  ];
}

function oklchToLinear({ lightness, chroma, hue }: Oklch): Linear {
  const radians = (((hue % 360) + 360) % 360) * (Math.PI / 180);
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function parseOklch(value: string): Oklch {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/u.exec(
    value.trim()
  );
  if (!match) throw new Error(`Not an oklch() color: ${value}`);
  return {
    lightness: Number(match[1]) / 100,
    chroma: Number(match[2]),
    hue: Number(match[3]),
  };
}

export function formatOklch(color: Oklch) {
  return `oklch(${(color.lightness * 100).toFixed(3)}% ${color.chroma.toFixed(5)} ${color.hue.toFixed(3)})`;
}

/** Hex colour to oklch (sRGB -> OKLab -> polar). */
export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToLinear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness,
    chroma: Math.hypot(a, bb),
    hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

/** Parses `#rrggbb` or `oklch(...)`. */
export function toOklch(value: string): Oklch {
  return value.trim().startsWith('#') ? hexToOklch(value) : parseOklch(value);
}

function luminance(value: string) {
  const [r, g, b] = value.trim().startsWith('#')
    ? hexToLinear(value)
    : oklchToLinear(parseOklch(value));
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

/** WCAG 2 contrast ratio between two `#rrggbb` / `oklch()` colours. */
export function contrastBetween(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
