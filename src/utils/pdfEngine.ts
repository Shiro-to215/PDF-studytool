import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ensurePdfWorker, pdfjsLib } from './pdfWorker';

interface CachedPageEntry {
  canvas: HTMLCanvasElement;
  renderWidth: number;
  aspectRatio: number;
  lastUsed: number;
}

export function getIdealRenderWidth(cssWidth: number, zoomScale = 1): number {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.5) : 1;
  const qualityMult = Math.max(1, Math.min(2.2, zoomScale));
  return Math.max(900, Math.min(1800, Math.round(cssWidth * dpr * qualityMult)));
}

export class PdfDocumentManager {
  private pdfDoc: PDFDocumentProxy | null = null;
  private cache = new Map<number, CachedPageEntry>();
  private inFlight = new Map<string, Promise<CachedPageEntry>>();
  private activeRenderTasks = new Set<RenderTask>();
  private accessCounter = 0;
  private destroyed = false;
  private readonly maxCachePages = 32;
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

  hasAdequateCache(pageNumber: number, targetPixelWidth: number): boolean {
    const clampedWidth = Math.max(480, Math.min(1800, Math.round(targetPixelWidth)));
    const entry = this.cache.get(pageNumber);
    return Boolean(entry && entry.renderWidth >= clampedWidth * 0.85);
  }

  async renderPage(pageNumber: number, targetPixelWidth = 1200): Promise<HTMLCanvasElement | null> {
    if (this.destroyed || !this.pdfDoc) return null;
    if (pageNumber < 1 || pageNumber > this.pdfDoc.numPages) return null;

    const clampedWidth = Math.max(480, Math.min(1800, Math.round(targetPixelWidth)));
    const existing = this.cache.get(pageNumber);
    if (existing && existing.renderWidth >= clampedWidth * 0.85) {
      existing.lastUsed = ++this.accessCounter;
      return existing.canvas;
    }

    const key = `${pageNumber}:${clampedWidth}`;
    const pending = this.inFlight.get(key);
    if (pending) {
      const entry = await pending;
      return entry.canvas;
    }

    const promise = this.performRender(pageNumber, clampedWidth);
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
    const scale = targetPixelWidth / baseViewport.width;
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
      aspectRatio: baseViewport.height > 0 ? baseViewport.width / baseViewport.height : this.cachedAspectRatio,
      lastUsed: ++this.accessCounter,
    };

    if (!this.destroyed) {
      this.cache.set(pageNumber, entry);
      this.evictIfNeeded();
    }

    return entry;
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxCachePages) return;
    let oldestPage: number | null = null;
    let oldestTime = Infinity;
    for (const [pageNum, entry] of this.cache.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestPage = pageNum;
      }
    }
    if (oldestPage !== null) {
      this.cache.delete(oldestPage);
    }
  }

  prefetchAround(centerPage: number, targetPixelWidth = 1200): void {
    if (this.destroyed || !this.pdfDoc) return;
    const total = this.pdfDoc.numPages;
    const offsets = [0, 1, 2, 3, -1, -2, 4, 5, -3, -4];
    const targets = offsets
      .map((off) => centerPage + off)
      .filter((p) => p >= 1 && p <= total && !this.hasAdequateCache(p, targetPixelWidth));

    const runNext = (idx: number) => {
      if (this.destroyed || idx >= targets.length) return;
      const p = targets[idx];
      const schedule = () => {
        if (this.destroyed) return;
        void this.renderPage(p, targetPixelWidth)
          .catch(() => {})
          .finally(() => runNext(idx + 1));
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback(
          schedule,
          { timeout: 150 },
        );
      } else {
        setTimeout(schedule, 16);
      }
    };

    runNext(0);
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
    this.cache.clear();
    this.inFlight.clear();
    if (this.pdfDoc) {
      await this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
  }
}
