export interface GeneratedPalette {
  red: string;
  blue: string;
  yellow: string;
}

interface OklchColor {
  lightness: number;
  chroma: number;
  hue: number;
}

interface PaletteFamily {
  darkOne: OklchColor;
  darkTwo: OklchColor;
  bright: OklchColor;
}

type LinearSrgb = [red: number, green: number, blue: number];

export const PAPER = 'oklch(97.598% 0.02449 91.61)';
export const INK = 'oklch(20.463% 0 0)';

/** Generated fills carry dark ink text; this is the contrast they must reach (WCAG AA is 4.5). */
export const MINIMUM_INK_CONTRAST = 7;

const INK_LUMINANCE = relativeLuminance(
  oklchToLinearSrgb({ lightness: 0.20463, chroma: 0, hue: 0 })
);

/*
 * Pastel families: each fill is light enough for ink text and low in chroma, so
 * it stays a soft red, blue and yellow (or a neighbouring triad) without losing
 * the Bauhaus feel. `lightness` and `chroma` are starting points that
 * `accessibleColor` raises until the fill reaches MINIMUM_INK_CONTRAST.
 */
const PALETTE_FAMILIES: PaletteFamily[] = [
  {
    darkOne: { lightness: 0.78, chroma: 0.12, hue: 25 },
    darkTwo: { lightness: 0.79, chroma: 0.09, hue: 240 },
    bright: { lightness: 0.92, chroma: 0.13, hue: 95 },
  },
  {
    darkOne: { lightness: 0.78, chroma: 0.11, hue: 330 },
    darkTwo: { lightness: 0.8, chroma: 0.08, hue: 195 },
    bright: { lightness: 0.92, chroma: 0.12, hue: 70 },
  },
  {
    darkOne: { lightness: 0.8, chroma: 0.1, hue: 150 },
    darkTwo: { lightness: 0.78, chroma: 0.1, hue: 295 },
    bright: { lightness: 0.9, chroma: 0.09, hue: 215 },
  },
  {
    darkOne: { lightness: 0.78, chroma: 0.09, hue: 265 },
    darkTwo: { lightness: 0.8, chroma: 0.11, hue: 50 },
    bright: { lightness: 0.9, chroma: 0.09, hue: 160 },
  },
  {
    darkOne: { lightness: 0.78, chroma: 0.1, hue: 350 },
    darkTwo: { lightness: 0.82, chroma: 0.09, hue: 105 },
    bright: { lightness: 0.9, chroma: 0.08, hue: 200 },
  },
  {
    darkOne: { lightness: 0.78, chroma: 0.1, hue: 280 },
    darkTwo: { lightness: 0.8, chroma: 0.09, hue: 165 },
    bright: { lightness: 0.9, chroma: 0.1, hue: 30 },
  },
];

let previousFamily = -1;

function normalizeHue(hue: number) {
  return ((hue % 360) + 360) % 360;
}

function oklchToLinearSrgb({ lightness, chroma, hue }: OklchColor): LinearSrgb {
  const radians = (normalizeHue(hue) * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function relativeLuminance([red, green, blue]: LinearSrgb) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: number, second: number) {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function isInSrgbGamut(color: LinearSrgb) {
  return color.every((channel) => channel >= 0 && channel <= 1);
}

function fitChroma(lightness: number, chroma: number, hue: number) {
  let lower = 0;
  let upper = chroma;

  for (let iteration = 0; iteration < 14; iteration += 1) {
    const candidate = (lower + upper) / 2;
    const rgb = oklchToLinearSrgb({ lightness, chroma: candidate, hue });
    if (isInSrgbGamut(rgb)) lower = candidate;
    else upper = candidate;
  }

  return lower * 0.98;
}

function accessibleColor(
  initialLightness: number,
  initialChroma: number,
  hue: number
) {
  let lightness = Math.min(0.95, initialLightness);
  let chroma = fitChroma(lightness, initialChroma, hue);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const luminance = relativeLuminance(
      oklchToLinearSrgb({ lightness, chroma, hue })
    );
    if (contrastRatio(luminance, INK_LUMINANCE) >= MINIMUM_INK_CONTRAST) break;
    lightness = Math.min(0.97, lightness + 0.01);
    chroma = fitChroma(lightness, initialChroma, hue);
  }

  return `oklch(${(lightness * 100).toFixed(3)}% ${chroma.toFixed(5)} ${normalizeHue(hue).toFixed(3)})`;
}

/** WCAG contrast ratio of two `oklch(L% C H)` strings (as produced here and used in CSS). */
export function contrastBetween(first: string, second: string) {
  const luminance = (value: string) =>
    relativeLuminance(oklchToLinearSrgb(parseOklch(value)));
  return contrastRatio(luminance(first), luminance(second));
}

export function parseOklch(value: string): OklchColor {
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

/**
 * `color-mix(in oklch, <color> <share>%, <other>)` for an achromatic `other`:
 * how CSS derives the readable text accents (`--red-text`, ...) from a fill.
 */
export function mixWithInk(color: string, share: number) {
  const mixed = parseOklch(color);
  const ink = parseOklch(INK);
  return `oklch(${(100 * (mixed.lightness * share + ink.lightness * (1 - share))).toFixed(3)}% ${(mixed.chroma * share).toFixed(5)} ${mixed.hue})`;
}

const jitter = (amount: number) => (Math.random() * 2 - 1) * amount;

function vary(color: OklchColor): OklchColor {
  return {
    lightness: color.lightness + jitter(0.012),
    chroma: color.chroma + jitter(0.012),
    hue: color.hue + jitter(7),
  };
}

function chooseFamily() {
  let index = Math.floor(Math.random() * (PALETTE_FAMILIES.length - 1));
  if (index >= previousFamily) index += 1;
  previousFamily = index;
  return PALETTE_FAMILIES[index];
}

export function generatePalette(): GeneratedPalette {
  const family = chooseFamily();
  const red = vary(family.darkOne);
  const blue = vary(family.darkTwo);
  const yellow = vary(family.bright);

  return {
    red: accessibleColor(red.lightness, red.chroma, red.hue),
    blue: accessibleColor(blue.lightness, blue.chroma, blue.hue),
    yellow: accessibleColor(yellow.lightness, yellow.chroma, yellow.hue),
  };
}
