import { type BundledLanguage, type BundledTheme, createHighlighter, type Highlighter } from "shiki";

const LANGS: BundledLanguage[] = [
  "typescript", "tsx", "javascript", "jsx",
  "json", "bash", "sh", "html", "css",
  "markdown", "sql", "python", "go", "yaml", "diff",
];

const THEMES: BundledTheme[] = ["github-dark", "github-light"];

let highlighterPromise: Promise<Highlighter> | null = null;

export function getShikiHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: THEMES, langs: LANGS });
  }
  return highlighterPromise;
}

export function highlightCode(
  highlighter: Highlighter,
  code: string,
  lang: string,
  isDark: boolean,
): string {
  const resolvedLang = LANGS.includes(lang as BundledLanguage) ? (lang as BundledLanguage) : "markdown";
  return highlighter.codeToHtml(code, {
    lang: resolvedLang,
    theme: isDark ? "github-dark" : "github-light",
  });
}
