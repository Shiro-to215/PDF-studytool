import { useMemo } from 'react';
import katex from 'katex';
import { stripLatexDelimiters } from '../../utils/answerFormat';

interface MathTextProps {
  text: string;
  latex: boolean;
  className?: string;
}

export function MathText({ text, latex, className = '' }: MathTextProps) {
  const html = useMemo(() => {
    if (!latex) return null;
    const expr = stripLatexDelimiters(text);
    if (!expr) return '';
    try {
      return katex.renderToString(expr, {
        throwOnError: false,
        displayMode: false,
        strict: false,
        trust: false,
      });
    } catch {
      return null;
    }
  }, [text, latex]);

  if (!latex || html === null) {
    return (
      <div className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${className}`}>
        {text}
      </div>
    );
  }

  return (
    <div
      className={`overflow-x-auto overflow-y-hidden thin-scrollbar py-0.5 leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
