declare module 'prismjs' {
  type Grammar = Record<string, unknown>;
  interface PrismApi {
    languages: Record<string, Grammar>;
    highlight(code: string, grammar: Grammar, language: string): string;
  }
  const Prism: PrismApi;
  export default Prism;
}

declare module 'prismjs/components/prism-rust';
