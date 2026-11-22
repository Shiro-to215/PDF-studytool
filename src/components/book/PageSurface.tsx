import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  getCappedCanvasSize,
  MAX_INK_CANVAS_PIXELS,
  MAX_RENDER_WIDTH,
  type PdfDocumentManager,
} from '../../utils/pdfEngine';
import type { Stroke } from '../../types/models';
import { renderStrokesToCanvas } from '../../utils/strokeRenderer';

interface PageSurfaceProps {
  pageNumber: number | null;
  pdfManager: PdfDocumentManager | null;
  width: number;
  height: number;
  strokes: Stroke[];
  draftStrokes?: Stroke[];
  hideInk?: boolean;
  /** Render a slightly higher resolution backing store for crisp zoom */
  renderScale?: number;
  className?: string;
}

const EMPTY_STROKES: Stroke[] = [];

export function PageSurface({
  pageNumber,
  pdfManager,
  width,
  height,
  strokes,
  draftStrokes = EMPTY_STROKES,
  hideInk = false,
  renderScale = 1,
  className = '',
}: PageSurfaceProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Layer 1: Render PDF page onto background canvas synchronously before paint when cached
  useLayoutEffect(() => {
    const canvas = pdfCanvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const qualityMult = Math.max(1, Math.min(8, renderScale));
    const { width: pixelW, height: pixelH } = getCappedCanvasSize(
      width * dpr * qualityMult,
      height * dpr * qualityMult,
    );

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (pageNumber === null || !pdfManager) {
      ctx.fillStyle = '#fafaf9';
      ctx.fillRect(0, 0, pixelW, pixelH);
      return;
    }

    const drawFromSource = (source: HTMLCanvasElement) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelW, pixelH);
      ctx.drawImage(source, 0, 0, pixelW, pixelH);
    };

    const targetRequestW = pixelW;
    const cached = pdfManager.getCachedCanvas(pageNumber);
    if (cached) {
      drawFromSource(cached);
      if (pdfManager.hasAdequateCache(pageNumber, targetRequestW)) {
        return;
      }
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelW, pixelH);
    }

    let cancelled = false;
    void pdfManager
      .renderPage(pageNumber, targetRequestW)
      .then((rendered) => {
        if (!cancelled && rendered) {
          drawFromSource(rendered);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pageNumber, pdfManager, width, height, renderScale]);

  // Immediately release WebKit canvas GPU backing memory on unmount
  useEffect(() => {
    const pdfCanvas = pdfCanvasRef.current;
    const inkCanvas = inkCanvasRef.current;
    const draftCanvas = draftCanvasRef.current;
    return () => {
      if (pdfCanvas) {
        pdfCanvas.width = 0;
        pdfCanvas.height = 0;
      }
      if (inkCanvas) {
        inkCanvas.width = 0;
        inkCanvas.height = 0;
      }
      if (draftCanvas) {
        draftCanvas.width = 0;
        draftCanvas.height = 0;
      }
    };
  }, []);

  // Layer 2: Committed strokes only (never re-runs while actively drawing a draft stroke!)
  useLayoutEffect(() => {
    const canvas = inkCanvasRef.current;
    if (!canvas) return;

    // Avoid allocating multi-megabyte backing stores for pages with no visible strokes
    if (pageNumber === null || hideInk || strokes.length === 0) {
      if (canvas.width !== 1 || canvas.height !== 1) {
        canvas.width = 1;
        canvas.height = 1;
      } else {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, 1, 1);
      }
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const qualityMult = Math.max(1, Math.min(8, renderScale));
    const { width: pixelW, height: pixelH } = getCappedCanvasSize(
      width * dpr * qualityMult,
      height * dpr * qualityMult,
      MAX_RENDER_WIDTH,
      MAX_INK_CANVAS_PIXELS,
    );

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderStrokesToCanvas(ctx, strokes, pixelW, pixelH, {
      clear: true,
      multiplyMarkers: false,
    });
  }, [pageNumber, strokes, hideInk, width, height, renderScale]);

  // Layer 3: Active in-progress stroke(s) only (constant O(1) cost regardless of total stroke count)
  useLayoutEffect(() => {
    const canvas = draftCanvasRef.current;
    if (!canvas) return;

    // Release backing store whenever no stroke is actively being drawn
    if (pageNumber === null || hideInk || draftStrokes.length === 0) {
      if (canvas.width !== 1 || canvas.height !== 1) {
        canvas.width = 1;
        canvas.height = 1;
      } else {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, 1, 1);
      }
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const qualityMult = Math.max(1, Math.min(8, renderScale));
    const { width: pixelW, height: pixelH } = getCappedCanvasSize(
      width * dpr * qualityMult,
      height * dpr * qualityMult,
      MAX_RENDER_WIDTH,
      MAX_INK_CANVAS_PIXELS,
    );

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderStrokesToCanvas(ctx, draftStrokes, pixelW, pixelH, {
      clear: true,
      multiplyMarkers: false,
    });
  }, [pageNumber, draftStrokes, hideInk, width, height, renderScale]);

  return (
    <div
      className={`relative overflow-hidden bg-white select-none ${className}`}
      style={{ width, height }}
    >
      <canvas
        ref={pdfCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none rounded-[inherit]"
      />
      <canvas
        ref={inkCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none rounded-[inherit]"
      />
      <canvas
        ref={draftCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none rounded-[inherit]"
      />
    </div>
  );
}
