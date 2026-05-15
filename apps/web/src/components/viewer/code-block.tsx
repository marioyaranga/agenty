"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { type Highlighter } from "shiki";
import { getShikiHighlighter, highlightCode } from "@/lib/markdown/shiki";
import { useIsDark } from "@/lib/hooks/use-is-dark";
import { cn } from "@/lib/utils";

type CodeBlockProps = React.HTMLAttributes<HTMLPreElement> & {
  children?: React.ReactNode;
};

export function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  const isDark = useIsDark();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const highlighterRef = useRef<Highlighter | null>(null);
  const langRef = useRef<string>("text");
  const rawCodeRef = useRef<string>("");

  // Extraer el código y lenguaje de children (un <code className="language-xyz">)
  useEffect(() => {
    const codeEl = (children as React.ReactElement<{ className?: string; children?: string }>);
    if (!codeEl) return;
    const codeClass = codeEl.props?.className ?? "";
    const lang = /language-(\w+)/.exec(codeClass)?.[1] ?? "text";
    const raw = String(codeEl.props?.children ?? "").replace(/\n$/, "");
    langRef.current = lang;
    rawCodeRef.current = raw;

    getShikiHighlighter().then((hl) => {
      highlighterRef.current = hl;
      setHtml(highlightCode(hl, raw, lang, isDark));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  // Re-highlight cuando cambia el tema
  useEffect(() => {
    if (!highlighterRef.current || !rawCodeRef.current) return;
    setHtml(
      highlightCode(highlighterRef.current, rawCodeRef.current, langRef.current, isDark),
    );
  }, [isDark]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(rawCodeRef.current).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="group relative my-2.5">
      {/* Header con lenguaje y copia */}
      <div className="flex items-center justify-between rounded-t-lg border border-border/50 border-b-0 bg-muted/50 px-3 py-1.5 text-xs">
        <span className="font-medium text-muted-foreground lowercase">
          {langRef.current !== "text" ? langRef.current : ""}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "Copiado" : "Copiar"}</span>
        </button>
      </div>

      {html ? (
        <div
          className={cn(
            "overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 text-xs leading-relaxed",
            "[&_pre]:!bg-transparent [&_pre]:p-3 [&_pre]:m-0",
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre
          className={cn(
            "overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 bg-muted/30 p-3 text-xs leading-relaxed",
            className,
          )}
          {...props}
        >
          {children}
        </pre>
      )}
    </div>
  );
}
