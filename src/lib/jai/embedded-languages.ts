// Here-strings whose terminator names a language: `#string WGSL` ... `WGSL` highlights the
// body as WGSL. The terminator is compared ignoring case; any other terminator (END, DONE, ...)
// leaves a plain string. This is the playground's subset of the convention the compiler's VS Code
// extension follows (EMBEDDED_LANGUAGES in the jai repository's
// editors/vscode/scripts/build-grammar.mjs, documented in docs/tools/vscode-extension.md): keep
// the tags of a language listed here the same as there.

export type EmbeddedLanguage = 'wgsl' | 'jai';

export const EMBEDDED_LANGUAGES: readonly {
  tags: readonly string[];
  language: EmbeddedLanguage;
}[] = [
  { tags: ['WGSL'], language: 'wgsl' },
  // Jai inside Jai: code for `#insert`, or a metaprogram's source.
  { tags: ['JAI'], language: 'jai' },
];

/** The language a here-string terminator names, if it names one. */
export function embeddedLanguageFor(tag: string): EmbeddedLanguage | null {
  const upper = tag.toUpperCase();
  return (
    EMBEDDED_LANGUAGES.find(({ tags }) => tags.includes(upper))?.language ??
    null
  );
}
