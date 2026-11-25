import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  computeContainRect,
  getCappedCanvasSize,
  MAX_INK_CANVAS_PIXELS,
  MAX_RENDER_WIDTH,
  MAX_TILE_PIXELS,
  type CachedPageSource,
  type PdfDocumentManager,
} from '../../utils/pdfEngine';
import type { Stroke } from '../../types/models';
import { renderStrokesToCanvas } from '../../utils/strokeRenderer';

export interface ZoomTileSpec {
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  pixelW: number;
  pixelH: number;
}

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
  /** Viewport-clipped hi-DPI overlay tile shown when settled at high zoom */
  zoomTile?: ZoomTileSpec | null;
  /** Freeze async PDF re-render requests (used on 3D turning leaves during flip) */
  freezeRender?: boolean;
  className?: string;
}

const EMPTY_STROKES: Stroke[] = [];

function clearCanvasBacking(canvas: HTMLCanvasElement | null, resetSize = true): void {
  if (!canvas) return;
  if (resetSize) {
    if (canvas.width !== 1 || canvas.height !== 1) {
      canvas.width = 1;
      canvas.height = 1;
    } else {
      canvas.getContext('2d')?.clearRect(0, 0, 1, 1);
    }
  } else {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function PageSurface({
  pageNumber,
  pdfManager,
  width,
  height,
  strokes,
  draftStrokes = EMPTY_STROKES,
  hideInk = false,
  renderScale = 1,
  zoomTile = null,
  freezeRender = false,
  className = '',
}: PageSurfaceProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const penCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const pdfTileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerTileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const penTileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftTileCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const markerStrokes = useMemo(
    () => strokes.filter((s) => s.tool === 'marker'),
    [strokes],
  );
  const penStrokes = useMemo(
    () => strokes.filter((s) => s.tool === 'pen'),
    [strokes],
  );
  const draftHasMarker =
    draftStrokes.length > 0 && draftStrokes[0].tool === 'marker';

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

    const drawFromSource = (source: CachedPageSource) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelW, pixelH);
      const fit = computeContainRect(source.width, source.height, pixelW, pixelH);
      ctx.drawImage(source, fit.x, fit.y, fit.w, fit.h);
    };

    const targetRequestW = pixelW;
    const cached = pdfManager.getCachedCanvas(pageNumber);
    if (cached) {
      drawFromSource(cached);
      if (freezeRender || pdfManager.hasAdequateCache(pageNumber, targetRequestW)) {
        return;
      }
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelW, pixelH);
      if (freezeRender) {
        return;
      }
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
  }, [pageNumber, pdfManager, width, height, renderScale, freezeRender]);

  // Immediately release WebKit canvas GPU backing memory on unmount
  useEffect(() => {
    const canvases = [
      pdfCanvasRef.current,
      markerCanvasRef.current,
      penCanvasRef.current,
      draftCanvasRef.current,
      pdfTileCanvasRef.current,
      markerTileCanvasRef.current,
      penTileCanvasRef.current,
      draftTileCanvasRef.current,
    ];
    return () => {
      for (const c of canvases) {
        if (c) {
          c.width = 0;
          c.height = 0;
        }
      }
    };
  }, []);

  // Layer 2a: Committed marker strokes (isolated multiply blend keeps PDF black text 100% crisp)
  useLayoutEffect(() => {
    const canvas = markerCanvasRef.current;
    if (!canvas) return;

    if (pageNumber === null || hideInk || markerStrokes.length === 0) {
      clearCanvasBacking(canvas, true);
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

    renderStrokesToCanvas(ctx, markerStrokes, pixelW, pixelH, {
      clear: true,
      toolFilter: 'marker',
    });
  }, [pageNumber, markerStrokes, hideInk, width, height, renderScale]);

  // Layer 2b: Committed pen strokes (sit crisply above markers)
  useLayoutEffect(() => {
    const canvas = penCanvasRef.current;
    if (!canvas) return;

    if (pageNumber === null || hideInk || penStrokes.length === 0) {
      clearCanvasBacking(canvas, true);
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

    renderStrokesToCanvas(ctx, penStrokes, pixelW, pixelH, {
      clear: true,
      toolFilter: 'pen',
    });
  }, [pageNumber, penStrokes, hideInk, width, height, renderScale]);

  // Layer 3: Active in-progress stroke(s) only (constant O(1) cost regardless of total stroke count)
  useLayoutEffect(() => {
    const canvas = draftCanvasRef.current;
    if (!canvas) return;

    if (pageNumber === null || hideInk || draftStrokes.length === 0) {
      clearCanvasBacking(canvas, true);
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
    });
  }, [pageNumber, draftStrokes, hideInk, width, height, renderScale]);

  // Layer 4a: Viewport-clipped hi-DPI PDF overlay tile (async, shown seamlessly when ready)
  useEffect(() => {
    const canvas = pdfTileCanvasRef.current;
    if (!canvas) return;

    if (!zoomTile || pageNumber === null || !pdfManager || freezeRender) {
      canvas.style.opacity = '0';
      clearCanvasBacking(canvas, false);
      return;
    }

    const controller = new AbortController();
    canvas.style.opacity = '0';

    const { width: tileW, height: tileH } = getCappedCanvasSize(
      zoomTile.pixelW,
      zoomTile.pixelH,
      MAX_RENDER_WIDTH,
      MAX_TILE_PIXELS,
    );

    void pdfManager
      .renderPageRegion(
        pageNumber,
        zoomTile.normX,
        zoomTile.normY,
        zoomTile.normW,
        zoomTile.normH,
        tileW,
        tileH,
        controller.signal,
      )
      .then((source) => {
        if (controller.signal.aborted || !source) {
          if (source && typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
            source.close();
          }
          return;
        }
        if (canvas.width !== source.width || canvas.height !== source.height) {
          canvas.width = source.width;
          canvas.height = source.height;
        }
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
          canvas.style.opacity = '1';
        }
        if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
          source.close();
        }
      })
      .catch(() => {});

    return () => {
      controller.abort();
      canvas.style.opacity = '0';
    };
  }, [zoomTile, pageNumber, pdfManager, freezeRender]);

  // Layer 4b: Viewport-clipped hi-DPI Ink & Draft tiles (synchronous, 1:1 native screen DPR)
  useLayoutEffect(() => {
    const markerTile = markerTileCanvasRef.current;
    const penTile = penTileCanvasRef.current;
    const draftTile = draftTileCanvasRef.current;

    if (!zoomTile || pageNumber === null || hideInk || freezeRender) {
      clearCanvasBacking(markerTile, false);
      clearCanvasBacking(penTile, false);
      clearCanvasBacking(draftTile, false);
      return;
    }

    const { width: tileW, height: tileH } = getCappedCanvasSize(
      zoomTile.pixelW,
      zoomTile.pixelH,
      MAX_RENDER_WIDTH,
      MAX_TILE_PIXELS,
    );
    const region = {
      normX: zoomTile.normX,
      normY: zoomTile.normY,
      normW: zoomTile.normW,
      normH: zoomTile.normH,
    };

    if (markerTile) {
      if (markerStrokes.length === 0) {
        clearCanvasBacking(markerTile, false);
      } else {
        if (markerTile.width !== tileW || markerTile.height !== tileH) {
          markerTile.width = tileW;
          markerTile.height = tileH;
        }
        const ctx = markerTile.getContext('2d');
        if (ctx) {
          renderStrokesToCanvas(ctx, markerStrokes, tileW, tileH, {
            clear: true,
            toolFilter: 'marker',
            region,
          });
        }
      }
    }

    if (penTile) {
      if (penStrokes.length === 0) {
        clearCanvasBacking(penTile, false);
      } else {
        if (penTile.width !== tileW || penTile.height !== tileH) {
          penTile.width = tileW;
          penTile.height = tileH;
        }
        const ctx = penTile.getContext('2d');
        if (ctx) {
          renderStrokesToCanvas(ctx, penStrokes, tileW, tileH, {
            clear: true,
            toolFilter: 'pen',
            region,
          });
        }
      }
    }

    if (draftTile) {
      if (draftStrokes.length === 0) {
        clearCanvasBacking(draftTile, false);
      } else {
        if (draftTile.width !== tileW || draftTile.height !== tileH) {
          draftTile.width = tileW;
          draftTile.height = tileH;
        }
        const ctx = draftTile.getContext('2d');
        if (ctx) {
          renderStrokesToCanvas(ctx, draftStrokes, tileW, tileH, {
            clear: true,
            region,
          });
        }
      }
    }
  }, [zoomTile, pageNumber, hideInk, freezeRender, markerStrokes, penStrokes, draftStrokes]);

  const tileStyle = zoomTile
    ? {
        left: `${(zoomTile.normX * 100).toFixed(4)}%`,
        top: `${(zoomTile.normY * 100).toFixed(4)}%`,
        width: `${(zoomTile.normW * 100).toFixed(4)}%`,
        height: `${(zoomTile.normH * 100).toFixed(4)}%`,
      }
    : undefined;

  const hasTileOverlay = Boolean(zoomTile && !freezeRender && pageNumber !== null);

  return (
    <div
      className={`relative isolate overflow-hidden bg-white select-none ${className}`}
      style={{ width, height }}
    >
      <canvas
        ref={pdfCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none rounded-[inherit]"
      />
      <canvas
        ref={pdfTileCanvasRef}
        className="absolute block pointer-events-none transition-opacity duration-75"
        style={{
          ...(tileStyle ?? { left: 0, top: 0, width: 0, height: 0 }),
          opacity: 0,
        }}
      />

      <canvas
        ref={markerCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none rounded-[inherit]"
        style={{
          mixBlendMode: 'multiply',
          opacity: hasTileOverlay && markerStrokes.length > 0 ? 0 : 1,
        }}
      />
      <canvas
        ref={markerTileCanvasRef}
        className="absolute block pointer-events-none"
        style={{
          ...(tileStyle ?? { left: 0, top: 0, width: 0, height: 0 }),
          mixBlendMode: 'multiply',
          display: hasTileOverlay && markerStrokes.length > 0 ? 'block' : 'none',
        }}
      />

      <canvas
        ref={penCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none rounded-[inherit]"
        style={{
          opacity: hasTileOverlay && penStrokes.length > 0 ? 0 : 1,
        }}
      />
      <canvas
        ref={penTileCanvasRef}
        className="absolute block pointer-events-none"
        style={{
          ...(tileStyle ?? { left: 0, top: 0, width: 0, height: 0 }),
          display: hasTileOverlay && penStrokes.length > 0 ? 'block' : 'none',
        }}
      />

      <canvas
        ref={draftCanvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none rounded-[inherit]"
        style={{
          mixBlendMode: draftHasMarker ? 'multiply' : 'normal',
          opacity: hasTileOverlay && draftStrokes.length > 0 ? 0 : 1,
        }}
      />
      <canvas
        ref={draftTileCanvasRef}
        className="absolute block pointer-events-none"
        style={{
          ...(tileStyle ?? { left: 0, top: 0, width: 0, height: 0 }),
          mixBlendMode: draftHasMarker ? 'multiply' : 'normal',
          display: hasTileOverlay && draftStrokes.length > 0 ? 'block' : 'none',
        }}
      />
    </div>
  );
}
