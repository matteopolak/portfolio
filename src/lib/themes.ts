/*
 * The site's curated colour themes (see docs/theme-switching.md). Each theme
 * has paper and ink, a muted grey, and three accents: a fill, the text colour
 * to use on that fill (`on`) and the colour for accent-coloured text on paper
 * (`text`). Every pair is checked for WCAG AAA by tests/palette-contrast.test.ts.
 *
 * The first theme is the default: it is what the server renders, and what
 * crawlers and visitors without JavaScript see.
 */

export interface ThemeAccent {
  fill: string;
  /** Text and icons on `fill`. */
  on: string;
  /** Accent-coloured text, glyphs and focus rings on paper. */
  text: string;
  /** The accent as editor syntax colour: readable on the dark editor surfaces. */
  light: string;
}

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  paper: string;
  paperBright: string;
  ink: string;
  muted: string;
  accents: [ThemeAccent, ThemeAccent, ThemeAccent];
}

export const THEME_STORAGE_KEY = 'site-theme';

export const themes: readonly Theme[] = [
  {
    id: 'ember',
    name: 'Ember',
    dark: false,
    paper: '#fdf7e5',
    paperBright: '#fffdf6',
    ink: '#171717',
    muted: '#4b4f5e',
    accents: [
      { fill: '#9a2e16', on: '#fffdf6', text: '#972d16', light: '#d9b0a6' },
      { fill: '#e0a526', on: '#141414', text: '#694e12', light: '#e4b142' },
      { fill: '#0d5e65', on: '#fffdf6', text: '#0d5b62', light: '#9ebfc1' },
    ],
  },
  {
    id: 'moss',
    name: 'Moss',
    dark: false,
    paper: '#f4f6ec',
    paperBright: '#fbfcf6',
    ink: '#14201a',
    muted: '#44503f',
    accents: [
      { fill: '#2a6034', on: '#fffdf6', text: '#285c32', light: '#aabfae' },
      { fill: '#f2b134', on: '#141414', text: '#684c16', light: '#f2b134' },
      { fill: '#7a3b6e', on: '#fffdf6', text: '#793a6d', light: '#cbb3c6' },
    ],
  },
  {
    id: 'slate',
    name: 'Slate',
    dark: false,
    paper: '#eef1f5',
    paperBright: '#f8fafc',
    ink: '#10151c',
    muted: '#444c59',
    accents: [
      { fill: '#1d3a6e', on: '#fffdf6', text: '#1d3a6e', light: '#b0bacc' },
      { fill: '#de9256', on: '#141414', text: '#6b4629', light: '#e6ad80' },
      { fill: '#91aa97', on: '#141414', text: '#465248', light: '#aabeaf' },
    ],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    paper: '#16171c',
    paperBright: '#1d1f26',
    ink: '#f3efe4',
    muted: '#b5b8c4',
    accents: [
      { fill: '#ff8a73', on: '#141414', text: '#ff8b74', light: '#ffa08e' },
      { fill: '#f5c85a', on: '#141414', text: '#f5c85a', light: '#f5c85a' },
      { fill: '#5fd0c4', on: '#141414', text: '#5fd0c4', light: '#5fd0c4' },
    ],
  },
  {
    id: 'cotton',
    name: 'Cotton',
    dark: true,
    paper: '#1d1a24',
    paperBright: '#26222f',
    ink: '#f6f2f8',
    muted: '#bdb6c9',
    accents: [
      { fill: '#5bcefa', on: '#141414', text: '#5bcefa', light: '#5bcefa' },
      { fill: '#f5a9b8', on: '#141414', text: '#f5a9b8', light: '#f5a9b8' },
      { fill: '#ffffff', on: '#141414', text: '#ffffff', light: '#ffffff' },
    ],
  },
  {
    id: 'dusk',
    name: 'Dusk',
    dark: false,
    paper: '#faf5f8',
    paperBright: '#fffcfd',
    ink: '#1a1220',
    muted: '#5a4a62',
    accents: [
      { fill: '#a8005c', on: '#fffdf6', text: '#a30059', light: '#e2abc9' },
      { fill: '#6b3f8c', on: '#fffdf6', text: '#6a3e8b', light: '#c5b4d2' },
      { fill: '#1f3f9e', on: '#fffdf6', text: '#1f3f9e', light: '#aebadc' },
    ],
  },
  {
    id: 'prism',
    name: 'Prism',
    dark: false,
    paper: '#fbf8ef',
    paperBright: '#fffdf7',
    ink: '#16161a',
    muted: '#4d4d57',
    accents: [
      { fill: '#af0000', on: '#fffdf6', text: '#aa0000', light: '#e5abab' },
      { fill: '#f5d800', on: '#141414', text: '#5d5200', light: '#f5d800' },
      { fill: '#1746cf', on: '#fffdf6', text: '#1644c9', light: '#a7b9ed' },
    ],
  },
];

export const defaultTheme = themes[0];

export const themeById = (id: string | null | undefined) =>
  themes.find((theme) => theme.id === id);

/** The theme after `id` in the cycle (wraps; an unknown id gives the default). */
export function nextTheme(id: string | null | undefined) {
  const index = themes.findIndex((theme) => theme.id === id);
  return themes[(index + 1) % themes.length];
}

/** CSS custom properties for a theme, as [name, value] pairs. */
export function themeProperties(theme: Theme): [string, string][] {
  const properties: [string, string][] = [
    ['--paper', theme.paper],
    ['--paper-bright', theme.paperBright],
    ['--ink', theme.ink],
    ['--muted', theme.muted],
    // Black brand marks (GitHub, MAI) are inverted on dark themes.
    ['--mono-logo-filter', theme.dark ? 'invert(1)' : 'none'],
  ];
  theme.accents.forEach((accent, index) => {
    const n = index + 1;
    properties.push(
      [`--accent-${n}`, accent.fill],
      [`--accent-${n}-on`, accent.on],
      [`--accent-${n}-text`, accent.text],
      [`--accent-${n}-light`, accent.light]
    );
  });
  return properties;
}

/**
 * The stylesheet that defines every theme: `@property` registrations (so
 * switching transitions smoothly), the default theme on `:root` and the others
 * under `:root[data-site-theme='<id>']`.
 */
export function themeCss(): string {
  const registrations = themeProperties(defaultTheme)
    .filter(([name]) => name !== '--mono-logo-filter')
    .map(
      ([name, value]) =>
        `@property ${name}{syntax:'<color>';inherits:true;initial-value:${value}}`
    )
    .join('');
  const block = (selector: string, theme: Theme) =>
    `${selector}{${themeProperties(theme)
      .map(([name, value]) => `${name}:${value}`)
      .join(';')};color-scheme:${theme.dark ? 'dark' : 'light'}}`;
  const transition = themeProperties(defaultTheme)
    .filter(([name]) => name !== '--mono-logo-filter')
    .map(([name]) => `${name} 500ms ease`)
    .join(',');
  return (
    registrations +
    block(':root', defaultTheme) +
    themes
      .slice(1)
      .map((theme) => block(`:root[data-site-theme='${theme.id}']`, theme))
      .join('') +
    // Code blocks carry both Shiki palettes as variables; dark themes use the dark one.
    themes
      .filter((theme) => theme.dark)
      .map(
        (theme) =>
          `:root[data-site-theme='${theme.id}'] .astro-code,:root[data-site-theme='${theme.id}'] .astro-code span{color:var(--shiki-dark);font-style:var(--shiki-dark-font-style);font-weight:var(--shiki-dark-font-weight)}`
      )
      .join('') +
    `:root{transition:${transition}}` +
    '@media (prefers-reduced-motion:reduce){:root{transition:none}}'
  );
}
