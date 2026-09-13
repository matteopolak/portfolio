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

const PAPER_LUMINANCE = relativeLuminance(
  oklchToLinearSrgb({ lightness: 0.97598, chroma: 0.02449, hue: 91.61 })
);
const INK_LUMINANCE = relativeLuminance(
  oklchToLinearSrgb({ lightness: 0.20463, chroma: 0, hue: 0 })
);

const PALETTE_FAMILIES: PaletteFamily[] = [
  {
    darkOne: { lightness: 0.6, chroma: 0.23, hue: 31 },
    darkTwo: { lightness: 0.5, chroma: 0.16, hue: 252 },
    bright: { lightness: 0.84, chroma: 0.17, hue: 84 },
  },
  {
    darkOne: { lightness: 0.5, chroma: 0.2, hue: 320 },
    darkTwo: { lightness: 0.47, chroma: 0.12, hue: 188 },
    bright: { lightness: 0.84, chroma: 0.14, hue: 55 },
  },
  {
    darkOne: { lightness: 0.47, chroma: 0.14, hue: 145 },
    darkTwo: { lightness: 0.49, chroma: 0.18, hue: 295 },
    bright: { lightness: 0.83, chroma: 0.11, hue: 210 },
  },
  {
    darkOne: { lightness: 0.47, chroma: 0.16, hue: 265 },
    darkTwo: { lightness: 0.53, chroma: 0.17, hue: 45 },
    bright: { lightness: 0.85, chroma: 0.11, hue: 155 },
  },
  {
    darkOne: { lightness: 0.48, chroma: 0.16, hue: 345 },
    darkTwo: { lightness: 0.49, chroma: 0.12, hue: 100 },
    bright: { lightness: 0.84, chroma: 0.11, hue: 195 },
  },
  {
    darkOne: { lightness: 0.49, chroma: 0.18, hue: 270 },
    darkTwo: { lightness: 0.47, chroma: 0.13, hue: 160 },
    bright: { lightness: 0.82, chroma: 0.16, hue: 25 },
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
  hue: number,
  foregroundLuminance: number,
  direction: -1 | 1
) {
  let lightness = initialLightness;
  let chroma = fitChroma(lightness, initialChroma, hue);

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const luminance = relativeLuminance(
      oklchToLinearSrgb({ lightness, chroma, hue })
    );
    if (contrastRatio(luminance, foregroundLuminance) >= 4.5) break;
    lightness = Math.min(0.9, Math.max(0.35, lightness + direction * 0.012));
    chroma = fitChroma(lightness, initialChroma, hue);
  }

  return `oklch(${(lightness * 100).toFixed(3)}% ${chroma.toFixed(5)} ${normalizeHue(hue).toFixed(3)})`;
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
  const darkOne = vary(family.darkOne);
  const darkTwo = vary(family.darkTwo);
  const bright = vary(family.bright);

  return {
    red: accessibleColor(
      darkOne.lightness,
      darkOne.chroma,
      darkOne.hue,
      PAPER_LUMINANCE,
      -1
    ),
    blue: accessibleColor(
      darkTwo.lightness,
      darkTwo.chroma,
      darkTwo.hue,
      PAPER_LUMINANCE,
      -1
    ),
    yellow: accessibleColor(
      bright.lightness,
      bright.chroma,
      bright.hue,
      INK_LUMINANCE,
      1
    ),
  };
}
