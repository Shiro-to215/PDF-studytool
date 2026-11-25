import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { getPdfDocumentOptions, pdfjsLib } from './pdfWorker';

export type CachedPageSource = ImageBitmap | HTMLCanvasElement;

interface CachedPageEntry {
  source: CachedPageSource;
  renderWidth: number;
  pixels: number;
  aspectRatio: number;
  lastUsed: number;
}

interface InFlightRender {
  width: number;
  tier: 'full' | 'preview';
  priority: 'foreground' | 'prefetch';
  task: RenderTask | null;
  promise: Promise<CachedPageEntry>;
}

/**
 * Safe upper bounds for high-DPI rendering on iPadOS Safari / WebKit
 * (keeps single-canvas pixels and total GPU backing memory well inside iPadOS Jetsam limits).
 */
export const MAX_RENDER_WIDTH = 3000;
export const MAX_CANVAS_PIXELS = 9_500_000;
export const MAX_INK_CANVAS_PIXELS = 4_500_000;
export const MAX_TILE_PIXELS = 4_500_000;

/** Compact low-resolution preview width for wide prefetch & instant flip display */
const PREVIEW_RENDER_WIDTH = 360;

export function computeContainRect(
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
): { x: number; y: number; w: number; h: number } {
  if (sourceW <= 0 || sourceH <= 0 || destW <= 0 || destH <= 0) {
    return { x: 0, y: 0, w: destW, h: destH };
  }
  const srcAspect = sourceW / sourceH;
  const dstAspect = destW / destH;
  if (Math.abs(srcAspect - dstAspect) / Math.max(0.001, dstAspect) <= 0.015) {
    return { x: 0, y: 0, w: destW, h: destH };
  }
  if (srcAspect > dstAspect) {
    const w = destW;
    const h = w / srcAspect;
    return { x: 0, y: (destH - h) / 2, w, h };
  }
  const h = destH;
  const w = h * srcAspect;
  return { x: (destW - w) / 2, y: 0, w, h };
}

function releaseSource(src: CachedPageSource): void {
  if (src instanceof HTMLCanvasElement) {
    src.width = 0;
    src.height = 0;
  } else {
    src.close();
  }
}

async function canvasToCachedSource(canvas: HTMLCanvasElement): Promise<CachedPageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(canvas);
      canvas.width = 0;
      canvas.height = 0;
      return bmp;
    } catch {
      // Fall back to canvas if createImageBitmap fails on this platform
    }
  }
  return canvas;
}

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
  private loadingTask: PDFDocumentLoadingTask | null = null;
  /** Tier 1: full Retina-resolution page cache (current + immediate neighbors) */
  private cache = new Map<number, CachedPageEntry>();
  /** Tier 2: lightweight 360px preview cache covering wide surrounding spreads & recently visited pages */
  private previewCache = new Map<number, CachedPageEntry>();
  private pageInFlight = new Map<number, InFlightRender>();
  private pageActiveCount = new Map<number, number>();
  private activeRenderTasks = new Set<RenderTask>();
  private activePrefetchTask: RenderTask | null = null;
  private activePrefetchPage: number | null = null;
  private foregroundInFlight = 0;
  private protectedPages = new Set<number>();
  private protectedPreviewPages = new Set<number>();
  private accessCounter = 0;
  private prefetchSeq = 0;
  private destroyed = false;
  private readonly maxCachePages = 10;
  private readonly maxCachePixels = 28_000_000;
  private readonly maxPreviewPages = 28;
  private readonly maxPreviewPixels = 6_000_000;
  private cachedAspectRatio = 1 / 1.414;

  async load(source: Blob | ArrayBuffer | Uint8Array): Promise<{ pageCount: number; aspectRatio: number }> {
    let data: Uint8Array;
    if (source instanceof Uint8Array) {
      data = source;
    } else if (source instanceof ArrayBuffer) {
      data = new Uint8Array(source);
    } else {
      const buf = await source.arrayBuffer();
      data = new Uint8Array(buf);
    }
    const loadingTask = pdfjsLib.getDocument(getPdfDocumentOptions(data));
    this.loadingTask = loadingTask;
    const doc = await loadingTask.promise;
    if (this.loadingTask === loadingTask) {
      this.loadingTask = null;
    }

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

  /** Return the highest-resolution cached source available (high-res ImageBitmap/canvas first, then preview) */
  getCachedCanvas(pageNumber: number): CachedPageSource | null {
    const entry = this.cache.get(pageNumber);
    if (entry) {
      entry.lastUsed = ++this.accessCounter;
      return entry.source;
    }
    const preview = this.previewCache.get(pageNumber);
    if (preview) {
      preview.lastUsed = ++this.accessCounter;
      return preview.source;
    }
    return null;
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

  private hasAnyPreviewOrFull(pageNumber: number): boolean {
    return this.cache.has(pageNumber) || this.previewCache.has(pageNumber);
  }

  /** Cancel an off-screen background prefetch task when a visible foreground page needs the PDF worker */
  private cancelOffscreenPrefetch(neededPageNumber: number): void {
    if (this.activePrefetchTask && this.activePrefetchPage !== neededPageNumber) {
      const task = this.activePrefetchTask;
      this.activePrefetchTask = null;
      this.activePrefetchPage = null;
      try {
        task.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
  }

  async renderPage(
    pageNumber: number,
    targetPixelWidth = 1200,
    priority: 'foreground' | 'prefetch' = 'foreground',
  ): Promise<CachedPageSource | null> {
    if (this.destroyed || !this.pdfDoc) return null;
    if (pageNumber < 1 || pageNumber > this.pdfDoc.numPages) return null;

    const existing = this.cache.get(pageNumber);
    const cappedWidth = this.getCappedWidthForPage(
      targetPixelWidth,
      existing?.aspectRatio ?? this.cachedAspectRatio,
    );
    if (existing && existing.renderWidth >= cappedWidth * 0.96) {
      existing.lastUsed = ++this.accessCounter;
      return existing.source;
    }

    const pending = this.pageInFlight.get(pageNumber);
    if (pending) {
      if (pending.tier === 'full' && pending.width >= cappedWidth * 0.96) {
        if (priority === 'foreground') {
          pending.priority = 'foreground';
          if (this.activePrefetchPage === pageNumber) {
            this.activePrefetchTask = null;
            this.activePrefetchPage = null;
          }
        }
        const entry = await pending.promise;
        return entry.source;
      }

      if (priority === 'foreground') {
        if (pending.task) {
          try {
            pending.task.cancel();
          } catch {
            // Ignore cancel errors
          }
        }
      } else {
        const entry = await pending.promise;
        return entry.source;
      }
    }

    if (priority === 'foreground') {
      this.cancelOffscreenPrefetch(pageNumber);
      this.foregroundInFlight++;
    }

    const slot: InFlightRender = {
      width: cappedWidth,
      tier: 'full',
      priority,
      task: null,
      promise: null as unknown as Promise<CachedPageEntry>,
    };
    const promise = this.performRender(pageNumber, cappedWidth, 'full', priority === 'prefetch', slot);
    slot.promise = promise;
    this.pageInFlight.set(pageNumber, slot);

    try {
      const entry = await promise;
      return entry.source;
    } finally {
      if (this.pageInFlight.get(pageNumber) === slot) {
        this.pageInFlight.delete(pageNumber);
      }
      if (priority === 'foreground') {
        this.foregroundInFlight = Math.max(0, this.foregroundInFlight - 1);
      }
    }
  }

  private async renderPreviewPage(pageNumber: number): Promise<CachedPageSource | null> {
    if (this.destroyed || !this.pdfDoc) return null;
    if (pageNumber < 1 || pageNumber > this.pdfDoc.numPages) return null;
    if (this.hasAnyPreviewOrFull(pageNumber)) {
      return this.getCachedCanvas(pageNumber);
    }

    const pending = this.pageInFlight.get(pageNumber);
    if (pending) {
      const entry = await pending.promise;
      return entry.source;
    }

    const slot: InFlightRender = {
      width: PREVIEW_RENDER_WIDTH,
      tier: 'preview',
      priority: 'prefetch',
      task: null,
      promise: null as unknown as Promise<CachedPageEntry>,
    };
    const promise = this.performRender(pageNumber, PREVIEW_RENDER_WIDTH, 'preview', true, slot);
    slot.promise = promise;
    this.pageInFlight.set(pageNumber, slot);

    try {
      const entry = await promise;
      return entry.source;
    } finally {
      if (this.pageInFlight.get(pageNumber) === slot) {
        this.pageInFlight.delete(pageNumber);
      }
    }
  }

  private async performRender(
    pageNumber: number,
    targetPixelWidth: number,
    tier: 'full' | 'preview',
    isPrefetch: boolean,
    slot?: InFlightRender,
  ): Promise<CachedPageEntry> {
    if (this.destroyed || !this.pdfDoc) {
      throw new Error('PdfDocumentManager destroyed');
    }

    this.pageActiveCount.set(pageNumber, (this.pageActiveCount.get(pageNumber) ?? 0) + 1);
    const page = await this.pdfDoc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const aspectRatio =
      baseViewport.height > 0 ? baseViewport.width / baseViewport.height : this.cachedAspectRatio;
    const cappedW =
      tier === 'preview'
        ? Math.max(200, Math.min(PREVIEW_RENDER_WIDTH, Math.round(targetPixelWidth)))
        : this.getCappedWidthForPage(targetPixelWidth, aspectRatio);
    const scale = cappedW / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      const rem = (this.pageActiveCount.get(pageNumber) ?? 1) - 1;
      if (rem <= 0) {
        this.pageActiveCount.delete(pageNumber);
        page.cleanup();
      } else {
        this.pageActiveCount.set(pageNumber, rem);
      }
      throw new Error('Could not create 2D canvas context');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderTask = page.render({ canvasContext: ctx, viewport });
    if (slot) slot.task = renderTask;
    this.activeRenderTasks.add(renderTask);
    if (isPrefetch && (!slot || slot.priority === 'prefetch')) {
      this.activePrefetchTask = renderTask;
      this.activePrefetchPage = pageNumber;
    }

    try {
      await renderTask.promise;
    } catch (err) {
      canvas.width = 0;
      canvas.height = 0;
      throw err;
    } finally {
      this.activeRenderTasks.delete(renderTask);
      if (this.activePrefetchTask === renderTask) {
        this.activePrefetchTask = null;
        this.activePrefetchPage = null;
      }
      const rem = (this.pageActiveCount.get(pageNumber) ?? 1) - 1;
      if (rem <= 0) {
        this.pageActiveCount.delete(pageNumber);
        page.cleanup();
      } else {
        this.pageActiveCount.set(pageNumber, rem);
      }
    }

    const renderWidth = canvas.width;
    const pixels = canvas.width * canvas.height;
    const source = this.destroyed
      ? canvas
      : tier === 'full'
        ? await canvasToCachedSource(canvas)
        : canvas;

    const entry: CachedPageEntry = {
      source,
      renderWidth,
      pixels,
      aspectRatio,
      lastUsed: ++this.accessCounter,
    };

    if (!this.destroyed) {
      if (tier === 'full') {
        const prev = this.cache.get(pageNumber);
        if (prev && prev.renderWidth > entry.renderWidth) {
          releaseSource(entry.source);
          return prev;
        }
        if (prev && prev.source !== source) {
          releaseSource(prev.source);
        }
        this.cache.set(pageNumber, entry);
        this.evictIfNeeded();
      } else {
        const prev = this.previewCache.get(pageNumber);
        if (prev && prev.source !== source) {
          releaseSource(prev.source);
        }
        this.previewCache.set(pageNumber, entry);
        this.evictPreviewsIfNeeded();
      }
    } else {
      releaseSource(source);
    }

    return entry;
  }

  /**
   * Render only the visible viewport sub-region of a page at full native DPR resolution
   * so 3x-8x zoomed reading stays vector-crisp without exceeding iPadOS Jetsam memory limits.
   */
  async renderPageRegion(
    pageNumber: number,
    normX: number,
    normY: number,
    normW: number,
    normH: number,
    tilePixelW: number,
    tilePixelH: number,
    signal?: AbortSignal,
  ): Promise<CachedPageSource | null> {
    if (this.destroyed || !this.pdfDoc || signal?.aborted) return null;
    if (pageNumber < 1 || pageNumber > this.pdfDoc.numPages) return null;
    if (normW <= 0 || normH <= 0) return null;

    const { width: cappedW, height: cappedH } = getCappedCanvasSize(
      tilePixelW,
      tilePixelH,
      MAX_RENDER_WIDTH,
      MAX_TILE_PIXELS,
    );

    this.pageActiveCount.set(pageNumber, (this.pageActiveCount.get(pageNumber) ?? 0) + 1);
    const page = await this.pdfDoc.getPage(pageNumber);
    if (this.destroyed || signal?.aborted) {
      const rem = (this.pageActiveCount.get(pageNumber) ?? 1) - 1;
      if (rem <= 0) {
        this.pageActiveCount.delete(pageNumber);
        page.cleanup();
      } else {
        this.pageActiveCount.set(pageNumber, rem);
      }
      return null;
    }

    const baseViewport = page.getViewport({ scale: 1 });
    const fullSlotW = cappedW / normW;
    const fullSlotH = cappedH / normH;
    const fit = computeContainRect(baseViewport.width, baseViewport.height, fullSlotW, fullSlotH);
    const scale = fit.w / Math.max(1, baseViewport.width);
    const offsetX = fit.x - normX * fullSlotW;
    const offsetY = fit.y - normY * fullSlotH;
    const viewport = page.getViewport({ scale, offsetX, offsetY });

    const canvas = document.createElement('canvas');
    canvas.width = cappedW;
    canvas.height = cappedH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      const rem = (this.pageActiveCount.get(pageNumber) ?? 1) - 1;
      if (rem <= 0) {
        this.pageActiveCount.delete(pageNumber);
        page.cleanup();
      } else {
        this.pageActiveCount.set(pageNumber, rem);
      }
      return null;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cappedW, cappedH);

    const renderTask = page.render({ canvasContext: ctx, viewport });
    this.activeRenderTasks.add(renderTask);
    const onAbort = () => {
      try {
        renderTask.cancel();
      } catch {
        // Ignore cancel errors
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await renderTask.promise;
    } catch {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.activeRenderTasks.delete(renderTask);
      const rem = (this.pageActiveCount.get(pageNumber) ?? 1) - 1;
      if (rem <= 0) {
        this.pageActiveCount.delete(pageNumber);
        page.cleanup();
      } else {
        this.pageActiveCount.set(pageNumber, rem);
      }
    }

    if (this.destroyed || signal?.aborted) {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }

    return canvasToCachedSource(canvas);
  }

  /** Downsample an evicted high-res source into the lightweight preview cache at ~0ms cost */
  private demoteToPreview(pageNumber: number, entry: CachedPageEntry): void {
    const srcW = entry.source.width;
    const srcH = entry.source.height;
    if (this.previewCache.has(pageNumber) || srcW <= 0 || srcH <= 0) {
      return;
    }
    const targetW = Math.min(PREVIEW_RENDER_WIDTH, srcW);
    const targetH = Math.max(1, Math.round((targetW / srcW) * srcH));
    const small = document.createElement('canvas');
    small.width = targetW;
    small.height = targetH;
    const ctx = small.getContext('2d', { alpha: false });
    if (!ctx) {
      small.width = 0;
      small.height = 0;
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(entry.source, 0, 0, targetW, targetH);

    this.previewCache.set(pageNumber, {
      source: small,
      renderWidth: targetW,
      pixels: targetW * targetH,
      aspectRatio: entry.aspectRatio,
      lastUsed: entry.lastUsed,
    });
    this.evictPreviewsIfNeeded();
  }

  private getTotalPixels(map: Map<number, CachedPageEntry>): number {
    let total = 0;
    for (const entry of map.values()) {
      total += entry.pixels;
    }
    return total;
  }

  private evictIfNeeded(): void {
    while (
      this.cache.size > 2 &&
      (this.cache.size > this.maxCachePages || this.getTotalPixels(this.cache) > this.maxCachePixels)
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
        this.demoteToPreview(oldestPage, evicted);
        releaseSource(evicted.source);
      }
      this.cache.delete(oldestPage);
    }
  }

  private evictPreviewsIfNeeded(): void {
    while (
      this.previewCache.size > 4 &&
      (this.previewCache.size > this.maxPreviewPages ||
        this.getTotalPixels(this.previewCache) > this.maxPreviewPixels)
    ) {
      let oldestPage: number | null = null;
      let oldestTime = Infinity;
      for (const [pageNum, entry] of this.previewCache.entries()) {
        if (this.protectedPreviewPages.has(pageNum)) continue;
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestPage = pageNum;
        }
      }
      if (oldestPage === null) {
        for (const [pageNum, entry] of this.previewCache.entries()) {
          if (entry.lastUsed < oldestTime) {
            oldestTime = entry.lastUsed;
            oldestPage = pageNum;
          }
        }
      }
      if (oldestPage === null) break;
      const evicted = this.previewCache.get(oldestPage);
      if (evicted) {
        releaseSource(evicted.source);
      }
      this.previewCache.delete(oldestPage);
    }
  }

  /**
   * Two-stage prefetch:
   *  1) Render `pageNumbers` (current + immediate next/prev spreads) at full Retina resolution.
   *  2) Spread outward over `previewPageNumbers` at lightweight 360px preview resolution so rapid
   *     flipping shows an instant preview instead of blank white before sharpening to Retina.
   */
  prefetchPages(
    pageNumbers: number[],
    targetPixelWidth = 1200,
    protectCount = 6,
    previewPageNumbers: number[] = [],
  ): void {
    if (this.destroyed || !this.pdfDoc) return;
    const total = this.pdfDoc.numPages;

    const dedupe = (list: number[], exclude?: Set<number>): number[] => {
      const seen = new Set<number>(exclude);
      const out: number[] = [];
      for (const p of list) {
        if (p < 1 || p > total || seen.has(p)) continue;
        seen.add(p);
        out.push(p);
      }
      return out;
    };

    const validFullPages = dedupe(pageNumbers);
    const fullSet = new Set(validFullPages);
    const validPreviewPages = dedupe(previewPageNumbers, fullSet);

    // Protect current + immediately adjacent spreads from high-res eviction
    this.protectedPages = new Set(validFullPages.slice(0, protectCount));
    this.protectedPreviewPages = new Set([
      ...validFullPages,
      ...validPreviewPages.slice(0, 16),
    ]);

    // Touch already-cached priority pages (in reverse so highest-priority stays newest)
    for (let i = validFullPages.length - 1; i >= 0; i--) {
      const existing = this.cache.get(validFullPages[i]);
      if (existing) {
        existing.lastUsed = ++this.accessCounter;
      }
    }
    for (let i = validPreviewPages.length - 1; i >= 0; i--) {
      const existing = this.previewCache.get(validPreviewPages[i]);
      if (existing) {
        existing.lastUsed = ++this.accessCounter;
      }
    }

    const queue: Array<{ page: number; tier: 'full' | 'preview' }> = [];
    for (const p of validFullPages) {
      if (!this.hasAdequateCache(p, targetPixelWidth)) {
        queue.push({ page: p, tier: 'full' });
      }
    }
    for (const p of validPreviewPages) {
      if (!this.hasAnyPreviewOrFull(p)) {
        queue.push({ page: p, tier: 'preview' });
      }
    }

    const seq = ++this.prefetchSeq;
    if (queue.length === 0) return;

    const scheduleStep = (cb: () => void, delayMs: number) => {
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (
          window as unknown as {
            requestIdleCallback: (fn: () => void, opts?: { timeout: number }) => void;
          }
        ).requestIdleCallback(cb, { timeout: delayMs });
      } else {
        setTimeout(cb, Math.min(delayMs, 32));
      }
    };

    const runNext = (idx: number) => {
      if (this.destroyed || seq !== this.prefetchSeq || idx >= queue.length) return;
      const item = queue[idx];

      const execute = () => {
        if (this.destroyed || seq !== this.prefetchSeq) return;

        // Yield while visible foreground pages are actively rendering so user-visible pages finish first
        if (this.foregroundInFlight > 0 && !this.protectedPages.has(item.page)) {
          setTimeout(() => runNext(idx), 60);
          return;
        }

        if (item.tier === 'full') {
          if (
            !this.protectedPages.has(item.page) &&
            this.getTotalPixels(this.cache) > this.maxCachePixels * 0.85
          ) {
            runNext(idx + 1);
            return;
          }
          void this.renderPage(item.page, targetPixelWidth, 'prefetch')
            .catch(() => {})
            .finally(() => runNext(idx + 1));
        } else {
          if (this.hasAnyPreviewOrFull(item.page)) {
            runNext(idx + 1);
            return;
          }
          void this.renderPreviewPage(item.page)
            .catch(() => {})
            .finally(() => runNext(idx + 1));
        }
      };

      scheduleStep(execute, item.tier === 'full' ? 100 : 180);
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
    this.prefetchSeq++;
    this.activePrefetchTask = null;
    this.activePrefetchPage = null;
    if (this.loadingTask) {
      try {
        await this.loadingTask.destroy();
      } catch {
        // Ignore loading task destroy errors
      }
      this.loadingTask = null;
    }
    for (const task of this.activeRenderTasks) {
      try {
        task.cancel();
      } catch {
        // Ignore cancel errors
      }
    }
    this.activeRenderTasks.clear();
    for (const entry of this.cache.values()) {
      releaseSource(entry.source);
    }
    this.cache.clear();
    for (const entry of this.previewCache.values()) {
      releaseSource(entry.source);
    }
    this.previewCache.clear();
    this.pageInFlight.clear();
    this.pageActiveCount.clear();
    if (this.pdfDoc) {
      await this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
  }
}
