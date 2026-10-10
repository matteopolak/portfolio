import {
  defaultTheme,
  THEME_STORAGE_KEY,
  themeById,
  type Theme,
} from './themes.ts';

/*
 * Browser side of the theme system (themes.ts has the data and the CSS):
 * reading, applying and saving the current theme. The nav button and the
 * WebMCP `set_theme` tool both go through here, and `SITE_THEME_EVENT` lets
 * the button follow changes it did not make.
 */
export const SITE_THEME_EVENT = 'site-theme-change';

export function currentTheme(): Theme {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    /* Blocked storage: the choice lasts for this page. */
  }
  return (
    themeById(document.documentElement.dataset.siteTheme ?? saved) ??
    defaultTheme
  );
}

// The logo marks get their fill directly: an inherited registered colour that
// animates inside an SVG mask can drop paint, so the CSS variables are not used for them.
function paintMarks(theme: Theme) {
  theme.accents.forEach((accent, index) => {
    document
      .querySelectorAll<SVGElement>(`.mark-${index + 1}`)
      .forEach((element) => {
        element.style.fill = accent.fill;
      });
  });
}

/** Applies a theme to the document (no storage, no event). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === defaultTheme) delete root.dataset.siteTheme;
  else root.dataset.siteTheme = theme.id;
  paintMarks(theme);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme.paper);
}

/** Applies, saves and announces a theme the visitor (or an agent) chose. */
export function chooseTheme(theme: Theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    /* Blocked storage: the choice lasts for this page. */
  }
  document.dispatchEvent(
    new CustomEvent(SITE_THEME_EVENT, { detail: { theme } })
  );
}
