import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { stripLatexDelimiters } from '../../utils/answerFormat';

interface MathTextProps {
  text: string;
  latex: boolean;
  /** Disable horizontal scroll container while blurred to prevent WebKit filter:blur artifacts */
  scrollable?: boolean;
  className?: string;
}

export function MathText({ text, latex, scrollable = true, className = '' }: MathTextProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didScrollRef = useRef(false);
  const [edges, setEdges] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const html = useMemo(() => {
    if (!latex) return null;
    const expr = stripLatexDelimiters(text);
    if (!expr) return '';
    const styledExpr = /^\\(?:displaystyle|textstyle|scriptstyle)\b/.test(expr)
      ? expr
      : `\\displaystyle ${expr}`;
    try {
      return katex.renderToString(styledExpr, {
        throwOnError: false,
        displayMode: false,
        strict: false,
        trust: false,
      });
    } catch {
      return null;
    }
  }, [text, latex]);

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !scrollable) {
      setEdges((prev) => (prev.left || prev.right ? { left: false, right: false } : prev));
      return;
    }
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    const left = hasOverflow && el.scrollLeft > 2;
    const right = hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, [scrollable]);

  useLayoutEffect(() => {
    if (!latex || html === null) return;
    const el = scrollRef.current;
    if (!el) return;

    updateEdges();
    if (!scrollable || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => updateEdges());
    ro.observe(el);
    return () => ro.disconnect();
  }, [latex, html, scrollable, updateEdges]);

  if (!latex || html === null) {
    return (
      <div className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${className}`}>
        {text}
      </div>
    );
  }

  let maskImage: string | undefined;
  if (scrollable) {
    if (edges.left && edges.right) {
      maskImage =
        'linear-gradient(to right, transparent 0, black 20px, black calc(100% - 20px), transparent 100%)';
    } else if (edges.right) {
      maskImage =
        'linear-gradient(to right, black 0, black calc(100% - 24px), transparent 100%)';
    } else if (edges.left) {
      maskImage = 'linear-gradient(to right, transparent 0, black 24px, black 100%)';
    }
  }

  return (
    <div
      ref={scrollRef}
      onPointerDown={() => {
        didScrollRef.current = false;
      }}
      onScroll={() => {
        didScrollRef.current = true;
        updateEdges();
      }}
      onClick={(e) => {
        if (didScrollRef.current) {
          e.stopPropagation();
          didScrollRef.current = false;
        }
      }}
      style={
        maskImage
          ? {
              maskImage,
              WebkitMaskImage: maskImage,
            }
          : undefined
      }
      className={`${
        scrollable ? 'overflow-x-auto overflow-y-hidden math-scroll' : 'overflow-hidden'
      } whitespace-nowrap py-0.5 leading-relaxed ${className}`}
    >
      <span
        className="inline-block whitespace-nowrap pr-2"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
