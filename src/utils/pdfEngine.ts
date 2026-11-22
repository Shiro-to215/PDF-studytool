import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ensurePdfWorker, pdfjsLib } from './pdfWorker';

interface CachedPageEntry {
  canvas: HTMLCanvasElement;
  renderWidth: number;
  pixels: number;
  aspectRatio: number;
  lastUsed: number;
}

/**
 * Safe upper bounds for high-DPI rendering on iPadOS Safari / WebKit
 * (keeps single-canvas pixels and total GPU backing memory well inside iPadOS Jetsam limits).
 */
export const MAX_RENDER_WIDTH = 3000;
export const MAX_CANVAS_PIXELS = 9_500_000;
export const MAX_INK_CANVAS_PIXELS = 4_500_000;

export function getCappedCanvasSize(
  desiredWidth: number,
  desiredHeight: number,
  maxWidth = MAX_RENDER_WIDTH,
  maxPixels = MAX_CANVAS_PIXELS,
): { width: number; height: number } {
  let w = Math.max(1, desiredWidth);
  let h = Math.max(1, desiredHeight);

  if (w > maxWidth) {
    const ratio = maxWidth / w;
    w = maxWidth;
    h *= ratio;
  }

  const area = w * h;
  if (area > maxPixels) {
    const ratio = Math.sqrt(maxPixels / area);
    w *= ratio;
    h *= ratio;
  }

  return {
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h)),
  };
}

export function getIdealRenderWidth(cssWidth: number, zoomScale = 1, aspectRatio?: number): number {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
  const qualityMult = Math.max(1, Math.min(8, zoomScale));
  const desiredW = Math.max(320, cssWidth * dpr * qualityMult);
  if (aspectRatio && aspectRatio > 0) {
    return getCappedCanvasSize(desiredW, desiredW / aspectRatio).width;
  }
  return Math.min(MAX_RENDER_WIDTH, Math.round(desiredW));
}

export class PdfDocumentManager {
  private pdfDoc: PDFDocumentProxy | null = null;
  private cache = new Map<number, CachedPageEntry>();
  private inFlight = new Map<string, Promise<CachedPageEntry>>();
  private activeRenderTasks = new Set<RenderTask>();
  private protectedPages = new Set<number>();
  private accessCounter = 0;
  private prefetchSeq = 0;
  private destroyed = false;
  private readonly maxCachePages = 10;
  private readonly maxCachePixels = 28_000_000;
  private cachedAspectRatio = 1 / 1.414;

  async load(source: Blob | ArrayBuffer | Uint8Array): Promise<{ pageCount: number; aspectRatio: number }> {
    ensurePdfWorker();
    let data: Uint8Array;
    if (source instanceof Uint8Array) {
      data = new Uint8Array(source);
    } else if (source instanceof ArrayBuffer) {
      data = new Uint8Array(source.slice(0));
    } else {
      const buf = await source.arrayBuffer();
      data = new Uint8Array(buf.slice(0));
    }
    const loadingTask = pdfjsLib.getDocument({ data });
    const doc = await loadingTask.promise;

    if (this.destroyed) {
      await doc.destroy();
      return { pageCount: 0, aspectRatio: this.cachedAspectRatio };
    }

    this.pdfDoc = doc;

    if (doc.numPages >= 1) {
      try {
        const firstPage = await doc.getPage(1);
        const vp = firstPage.getViewport({ scale: 1 });
        if (vp.height > 0) {
          this.cachedAspectRatio = vp.width / vp.height;
        }
        firstPage.cleanup();
      } catch {
        // Keep default aspect ratio
      }
    }

    return { pageCount: doc.numPages, aspectRatio: this.cachedAspectRatio };
  }

  getAspectRatio(): number {
    return this.cachedAspectRatio;
  }

  getCachedCanvas(pageNumber: number): HTMLCanvasElement | null {
    const entry = this.cache.get(pageNumber);
    if (!entry) return null;
    entry.lastUsed = ++this.accessCounter;
    return entry.canvas;
  }

  private getCappedWidthForPage(targetPixelWidth: number, aspectRatio: number): number {
    const safeAspect = aspectRatio > 0 ? aspectRatio : this.cachedAspectRatio;
    const rawW = Math.max(320, Math.round(targetPixelWidth));
    return getCappedCanvasSize(rawW, rawW / safeAspect).width;
  }

  hasAdequateCache(pageNumber: number, targetPixelWidth: number): boolean {
    const entry = this.cache.get(pageNumber);
    if (!entry) return false;
    const cappedWidth = this.getCappedWidthForPage(targetPixelWidth, entry.aspectRatio);
    return entry.renderWidth >= cappedWidth * 0.96;
  }

  async renderPage(pageNumber: number, targetPixelWidth = 1200): Promise<HTMLCanvasElement | null> {
    if (this.destroyed || !this.pdfDoc) return null;
    if (pageNumber < 1 || pageNumber > this.pdfDoc.numPages) return null;

    const existing = this.cache.get(pageNumber);
    const cappedWidth = this.getCappedWidthForPage(
      targetPixelWidth,
      existing?.aspectRatio ?? this.cachedAspectRatio,
    );
    if (existing && existing.renderWidth >= cappedWidth * 0.96) {
      existing.lastUsed = ++this.accessCounter;
      return existing.canvas;
    }

    const key = `${pageNumber}:${cappedWidth}`;
    const pending = this.inFlight.get(key);
    if (pending) {
      const entry = await pending;
      return entry.canvas;
    }

    const promise = this.performRender(pageNumber, cappedWidth);
    this.inFlight.set(key, promise);

    try {
      const entry = await promise;
      return entry.canvas;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async performRender(
    pageNumber: number,
    targetPixelWidth: number,
  ): Promise<CachedPageEntry> {
    if (this.destroyed || !this.pdfDoc) {
      throw new Error('PdfDocumentManager destroyed');
    }

    const page = await this.pdfDoc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const aspectRatio =
      baseViewport.height > 0 ? baseViewport.width / baseViewport.height : this.cachedAspectRatio;
    const cappedW = this.getCappedWidthForPage(targetPixelWidth, aspectRatio);
    const scale = cappedW / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      page.cleanup();
      throw new Error('Could not create 2D canvas context');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderTask = page.render({ canvasContext: ctx, viewport });
    this.activeRenderTasks.add(renderTask);

    try {
      await renderTask.promise;
    } finally {
      this.activeRenderTasks.delete(renderTask);
      page.cleanup();
    }

    const entry: CachedPageEntry = {
      canvas,
      renderWidth: canvas.width,
      pixels: canvas.width * canvas.height,
      aspectRatio,
      lastUsed: ++this.accessCounter,
    };

    if (!this.destroyed) {
      const prev = this.cache.get(pageNumber);
      if (prev && prev.canvas !== canvas) {
        prev.canvas.width = 0;
        prev.canvas.height = 0;
      }
      this.cache.set(pageNumber, entry);
      this.evictIfNeeded();
    } else {
      canvas.width = 0;
      canvas.height = 0;
    }

    return entry;
  }

  private getTotalCachedPixels(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.pixels;
    }
    return total;
  }

  private evictIfNeeded(): void {
    while (
      this.cache.size > 2 &&
      (this.cache.size > this.maxCachePages || this.getTotalCachedPixels() > this.maxCachePixels)
    ) {
      let oldestPage: number | null = null;
      let oldestTime = Infinity;
      // First pass: prefer evicting non-protected pages (outside current + immediate next/prev spreads)
      for (const [pageNum, entry] of this.cache.entries()) {
        if (this.protectedPages.has(pageNum)) continue;
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestPage = pageNum;
        }
      }
      // Fallback pass: if only protected pages remain and memory budget is exceeded, evict oldest
      if (oldestPage === null) {
        for (const [pageNum, entry] of this.cache.entries()) {
          if (entry.lastUsed < oldestTime) {
            oldestTime = entry.lastUsed;
            oldestPage = pageNum;
          }
        }
      }
      if (oldestPage === null) break;
      const evicted = this.cache.get(oldestPage);
      if (evicted) {
        evicted.canvas.width = 0;
        evicted.canvas.height = 0;
      }
      this.cache.delete(oldestPage);
    }
  }

  prefetchPages(pageNumbers: number[], targetPixelWidth = 1200, protectCount = 6): void {
    if (this.destroyed || !this.pdfDoc) return;
    const total = this.pdfDoc.numPages;
    const seen = new Set<number>();
    const validPages: number[] = [];

    for (const p of pageNumbers) {
      if (p < 1 || p > total || seen.has(p)) continue;
      seen.add(p);
      validPages.push(p);
    }

    // Protect current + immediately adjacent spreads from being evicted by farther prefetches
    this.protectedPages = new Set(validPages.slice(0, protectCount));

    // Touch already-cached priority pages (in reverse so highest-priority stays newest)
    for (let i = validPages.length - 1; i >= 0; i--) {
      const existing = this.cache.get(validPages[i]);
      if (existing) {
        existing.lastUsed = ++this.accessCounter;
      }
    }

    const targets = validPages.filter((p) => !this.hasAdequateCache(p, targetPixelWidth));
    const seq = ++this.prefetchSeq;
    if (targets.length === 0) return;

    const runNext = (idx: number) => {
      if (this.destroyed || seq !== this.prefetchSeq || idx >= targets.length) return;
      const p = targets[idx];
      const schedule = () => {
        if (this.destroyed || seq !== this.prefetchSeq) return;
        // Don't prefetch non-protected farther spreads if pixel budget is already tight
        if (
          !this.protectedPages.has(p) &&
          this.getTotalCachedPixels() > this.maxCachePixels * 0.85
        ) {
          return;
        }
        void this.renderPage(p, targetPixelWidth)
          .catch(() => {})
          .finally(() => runNext(idx + 1));
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (
          window as unknown as {
            requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void;
          }
        ).requestIdleCallback(schedule, { timeout: 120 });
      } else {
        setTimeout(schedule, 16);
      }
    };

    runNext(0);
  }

  prefetchAround(centerPage: number, targetPixelWidth = 1200): void {
    const offsets = [0, 1, 2, 3, -1, -2, -3];
    this.prefetchPages(
      offsets.map((off) => centerPage + off),
      targetPixelWidth,
    );
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const task of this.activeRenderTasks) {
      try {
        task.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
    this.activeRenderTasks.clear();
    for (const entry of this.cache.values()) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    this.cache.clear();
    this.inFlight.clear();
    if (this.pdfDoc) {
      await this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
  }
}
