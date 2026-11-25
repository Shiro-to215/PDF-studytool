import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageStrokes, Stroke, StrokePoint } from '../../types/models';
import { createId, savePageStrokes } from '../../db/database';
import { getIdealRenderWidth, PdfDocumentManager } from '../../utils/pdfEngine';
import { isCircleTouchingStroke } from '../../utils/strokeRenderer';
import {
  recognizeHoldShape,
  sampleShapeToBookPoints,
  splitBookPointsToPages,
  updateSnappedShape,
  type SnappedShape,
} from '../../utils/shapeSnap';
import {
  getNextSpreadPage,
  getPrevSpreadPage,
  getSpreadLayout,
  useViewerStore,
} from '../../stores/useViewerStore';
import {
  SIZE_OPTIONS,
  useToolStore,
  type PageStrokesSnapshot,
} from '../../stores/useToolStore';
import { useBookGestures, type DrawMoveSample } from '../../hooks/useBookGestures';
import { PageSurface } from './PageSurface';

export interface FlipBookViewerHandle {
  flipNext: () => void;
  flipPrev: () => void;
  undo: () => void;
  redo: () => void;
  /** Imperatively apply shared sidebar animation frame t in [0 (closed), 1 (open)] */
  setSidebarAnimFrame: (t: number, layoutShift: number) => void;
  reclampZoom: () => void;
}

interface FlipBookViewerProps {
  workbookId: string;
  pdfManager: PdfDocumentManager | null;
  aspectRatio: number;
  layers: string[];
  allPageStrokes: PageStrokes[];
  /** Settled right-side inset reserved by the open desktop sidebar (0 while closed or animating) */
  rightInset: number;
}

function computeBookDims(
  stageW: number,
  stageH: number,
  aspectRatio: number,
  spreadMode: 'single' | 'double',
): { pageW: number; pageH: number; bookW: number; bookH: number } {
  const padX = stageW < 640 ? 12 : 24;
  const padY = stageH < 520 ? 12 : 20;
  const availW = Math.max(240, stageW - padX);
  const availH = Math.max(240, stageH - padY);
  const safeAspect = Math.max(0.45, Math.min(1.8, aspectRatio || 0.707));

  const slots = spreadMode === 'double' ? 2 : 1;
  let h = availH;
  let w = h * safeAspect;
  if (w * slots > availW) {
    w = availW / slots;
    h = w / safeAspect;
  }

  const pw = Math.floor(w);
  const ph = Math.floor(h);
  return {
    pageW: pw,
    pageH: ph,
    bookW: pw * slots,
    bookH: ph,
  };
}

interface DoubleFlipSession {
  mode: 'double';
  direction: 'next' | 'prev';
  leafSide: 'left' | 'right';
  targetPage: number;
  staticLeft: number | null;
  staticRight: number | null;
  leafFront: number | null;
  leafBack: number | null;
}

interface SingleFlipSession {
  mode: 'single';
  direction: 'next' | 'prev';
  hingeSide: 'left' | 'right';
  targetPage: number;
  underPage: number;
  leafPage: number;
}

type FlipSession = DoubleFlipSession | SingleFlipSession;

export const FlipBookViewer = forwardRef<FlipBookViewerHandle, FlipBookViewerProps>(
  function FlipBookViewer(
    { workbookId, pdfManager, aspectRatio, layers, allPageStrokes, rightInset },
    ref,
  ) {
    const stageRef = useRef<HTMLDivElement | null>(null);
    const bookMotionRef = useRef<HTMLDivElement | null>(null);
    const rightArrowMotionRef = useRef<HTMLDivElement | null>(null);
    const zoomWrapperRef = useRef<HTMLDivElement | null>(null);
    const bookRef = useRef<HTMLDivElement | null>(null);
    const sidebarFrameRef = useRef({ t: 0, layoutShift: 0 });
    const leafRef = useRef<HTMLDivElement | null>(null);
    const frontLeafRef = useRef<HTMLDivElement | null>(null);
    const backLeafRef = useRef<HTMLDivElement | null>(null);
    const frontShadeRef = useRef<HTMLDivElement | null>(null);
    const backShadeRef = useRef<HTMLDivElement | null>(null);
    const underShadowRef = useRef<HTMLDivElement | null>(null);
    const eraserCursorRef = useRef<HTMLDivElement | null>(null);
    const eraserCursorStateRef = useRef<{
      visible: boolean;
      active: boolean;
      pointerType: 'mouse' | 'pen' | 'touch';
      clientX: number;
      clientY: number;
    }>({
      visible: false,
      active: false,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
    });

    const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
    const [committedScale, setCommittedScale] = useState(1);

    const {
      currentPage,
      pageCount,
      spreadMode,
      bindingDirection,
      coverSinglePage,
      showPageTurnButtons,
      zoomResetSeq,
      setCurrentPage,
      setZoomPan,
    } = useViewerStore();

    const {
      interactionMode,
      tool,
      penColor,
      markerColor,
      penSizeIndex,
      markerSizeIndex,
      eraserSizeIndex,
      activeLayer,
      pushHistory,
      popUndo,
      popRedo,
    } = useToolStore();

    const eraserDiameterPx = SIZE_OPTIONS[eraserSizeIndex].eraser;
    const eraserRadiusPx = eraserDiameterPx / 2;

    // Measure stage dimensions for responsive sizing
    useEffect(() => {
      const el = stageRef.current;
      if (!el) return;

      const update = () => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setStageSize({ width: rect.width, height: rect.height });
        }
      };

      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    const effectiveStageW = Math.max(240, stageSize.width - rightInset);

    // Compute exact page dimensions fitting neatly inside the available stage area
    const { pageW, pageH, bookW, bookH } = useMemo(
      () => computeBookDims(effectiveStageW, stageSize.height, aspectRatio, spreadMode),
      [effectiveStageW, stageSize.height, aspectRatio, spreadMode],
    );

    const stageSizeRef = useRef(stageSize);
    stageSizeRef.current = stageSize;
    const rightInsetRef = useRef(rightInset);
    rightInsetRef.current = rightInset;
    const bookWRef = useRef(bookW);
    bookWRef.current = bookW;
    const aspectRatioRef = useRef(aspectRatio);
    aspectRatioRef.current = aspectRatio;
    const spreadModeRef = useRef(spreadMode);
    spreadModeRef.current = spreadMode;

    // Apply unified sidebar animation frame synchronously to both PDF (simultaneous zoom + shift,
    // zero center drift) and right page-turn button (locked 1:1 to sidebar left edge).
    const applySidebarAnimFrame = useCallback((t: number, layoutShift: number) => {
      const clampedT = Math.max(0, Math.min(1, t));
      const safeShift = Math.max(0, layoutShift);
      sidebarFrameRef.current = { t: clampedT, layoutShift: safeShift };

      const arrowEl = rightArrowMotionRef.current;
      if (arrowEl) {
        const dx = -clampedT * safeShift;
        arrowEl.style.transform =
          Math.abs(dx) < 0.05 ? '' : `translate3d(${dx.toFixed(2)}px, 0px, 0)`;
      }

      const motionEl = bookMotionRef.current;
      if (motionEl) {
        const fullW = stageSizeRef.current.width;
        const fullH = stageSizeRef.current.height;
        if (safeShift <= 0.5 || fullW <= 0 || fullH <= 0) {
          motionEl.style.transform = '';
          return;
        }
        const closed = computeBookDims(
          fullW,
          fullH,
          aspectRatioRef.current,
          spreadModeRef.current,
        );
        const open = computeBookDims(
          Math.max(240, fullW - safeShift),
          fullH,
          aspectRatioRef.current,
          spreadModeRef.current,
        );

        const closedCX = fullW / 2;
        const openCX = (fullW - safeShift) / 2;
        const targetCX = closedCX + (openCX - closedCX) * clampedT;
        const targetW = closed.bookW + (open.bookW - closed.bookW) * clampedT;

        const baseCX = (fullW - rightInsetRef.current) / 2;
        const baseW = bookWRef.current;
        const tx = targetCX - baseCX;
        const s = baseW > 0 ? targetW / baseW : 1;
        const isIdentity = Math.abs(tx) < 0.05 && Math.abs(s - 1) < 0.0005;
        motionEl.style.transform = isIdentity
          ? ''
          : `translate3d(${tx.toFixed(2)}px, 0px, 0) scale(${s.toFixed(5)})`;
      }
    }, []);

    // Keep DOM transform strictly in sync before paint whenever rightInset or dimensions settle
    useLayoutEffect(() => {
      applySidebarAnimFrame(sidebarFrameRef.current.t, sidebarFrameRef.current.layoutShift);
    }, [rightInset, bookW, bookH, stageSize.width, stageSize.height, applySidebarAnimFrame]);

    // ===== Native-feel GPU Zoom & Pan Controller =====
    const MAX_ZOOM_SCALE = 8;
    const liveZoomRef = useRef({ scale: 1, panX: 0, panY: 0 });
    const lastZoomFocusRef = useRef({ x: 0, y: 0 });
    const committedScaleRef = useRef(committedScale);
    committedScaleRef.current = committedScale;
    const zoomAnimRef = useRef<number | null>(null);
    const wheelSettleTimerRef = useRef<number | null>(null);

    const stopZoomAnimation = useCallback(() => {
      if (zoomAnimRef.current !== null) {
        cancelAnimationFrame(zoomAnimRef.current);
        zoomAnimRef.current = null;
      }
    }, []);

    // Cap the DOM layout scale so the book's WebKit backing layer matches the maximum crisp
    // PDF canvas pixels (~300 DPI) without blowing up into a giant 8x GPU tile layer (which
    // causes iPadOS Safari OOM crashes when zooming back out to 1x).
    const quantizeCommittedScale = useCallback(
      (s: number) => {
        if (s <= 1.02) return 1;
        const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
        const maxW = spreadMode === 'double' ? 2100 : 2800;
        const maxPixels = spreadMode === 'double' ? 5_800_000 : 9_500_000;
        const basePxW = Math.max(1, pageW * dpr);
        const basePxH = Math.max(1, pageH * dpr);
        const maxByWidth = maxW / basePxW;
        const maxByArea = Math.sqrt(maxPixels / (basePxW * basePxH));
        const maxLayoutScale = Math.max(
          1,
          Math.min(dpr <= 1.25 ? 3.2 : 2.4, maxByWidth, maxByArea),
        );
        return Math.min(maxLayoutScale, Math.round(s * 1000) / 1000);
      },
      [pageW, pageH, spreadMode],
    );

    const clampZoomPan = useCallback(
      (s: number, px: number, py: number, rubberBand: boolean) => {
        const minS = rubberBand ? 0.85 : 1;
        const maxS = rubberBand ? 8.6 : MAX_ZOOM_SCALE;
        const clampedS = Math.max(minS, Math.min(maxS, s));

        if (clampedS <= 1.01) {
          if (!rubberBand) {
            return { scale: 1, panX: 0, panY: 0 };
          }
          const clampSoft = (val: number) => {
            if (Math.abs(val) <= 40) return val;
            const sign = val > 0 ? 1 : -1;
            return sign * (40 + (Math.abs(val) - 40) * 0.35);
          };
          return {
            scale: clampedS,
            panX: clampSoft(px),
            panY: clampSoft(py),
          };
        }

        const ramp = Math.min(1, Math.max(0, (clampedS - 1) / 0.5));
        const marginX = Math.min(96, effectiveStageW * 0.12) * ramp;
        const marginY = Math.min(96, stageSize.height * 0.12) * ramp;

        const maxPanX = Math.max(0, (bookW * clampedS - effectiveStageW) / 2 + marginX);
        const maxPanY = Math.max(0, (bookH * clampedS - stageSize.height) / 2 + marginY);

        const clampAxis = (val: number, max: number) => {
          if (Math.abs(val) <= max) return val;
          const sign = val > 0 ? 1 : -1;
          if (!rubberBand) return sign * max;
          return sign * (max + (Math.abs(val) - max) * 0.28);
        };

        return {
          scale: clampedS,
          panX: clampAxis(px, maxPanX),
          panY: clampAxis(py, maxPanY),
        };
      },
      [bookW, bookH, effectiveStageW, stageSize.height],
    );

    const applyZoomDom = useCallback(
      (s: number, px: number, py: number) => {
        liveZoomRef.current = { scale: s, panX: px, panY: py };
        const el = zoomWrapperRef.current;
        if (el) {
          // Keep zoomWrapperRef permanently on its own GPU compositing layer via translate3d
          // (never toggling to 'none') so iPadOS WebKit never leaves stale shadow/outline ghosts
          // on stageRef behind the PDF, while omitting scale() when settled so <canvas> stays
          // at 1:1 native Retina pixel sharpness.
          const residualScale = s / Math.max(0.01, committedScaleRef.current);
          const needsScale = Math.abs(residualScale - 1) > 0.0005;
          if (!needsScale) {
            el.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
          } else {
            el.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${residualScale.toFixed(4)})`;
          }
          el.style.cursor = eraserCursorStateRef.current.visible
            ? 'none'
            : interactionMode === 'draw'
              ? 'crosshair'
              : s > 1.02
                ? 'grab'
                : 'default';
        }
      },
      [interactionMode],
    );

    const animateZoomTo = useCallback(
      (targetS: number, targetX: number, targetY: number, duration = 260) => {
        stopZoomAnimation();
        const start = { ...liveZoomRef.current };
        const dist =
          Math.abs(targetS - start.scale) * 200 +
          Math.hypot(targetX - start.panX, targetY - start.panY);

        if (dist < 1) {
          applyZoomDom(targetS, targetX, targetY);
          setZoomPan(targetS, targetX, targetY);
          setCommittedScale(quantizeCommittedScale(targetS));
          return;
        }

        const startTime = performance.now();
        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

        const tick = (now: number) => {
          const t = Math.min(1, (now - startTime) / duration);
          const e = easeOutCubic(t);
          const s = start.scale + (targetS - start.scale) * e;
          const x = start.panX + (targetX - start.panX) * e;
          const y = start.panY + (targetY - start.panY) * e;
          applyZoomDom(s, x, y);

          if (t < 1) {
            zoomAnimRef.current = requestAnimationFrame(tick);
          } else {
            zoomAnimRef.current = null;
            setZoomPan(targetS, targetX, targetY);
            setCommittedScale(quantizeCommittedScale(targetS));
          }
        };

        zoomAnimRef.current = requestAnimationFrame(tick);
      },
      [stopZoomAnimation, applyZoomDom, setZoomPan, quantizeCommittedScale],
    );

    // When bookW changes due to sidebar settle (open/close) or viewport resize while zoomed,
    // scale panX/panY by the exact book width ratio so the visual position matches the outer
    // bookMotionRef scale(s) with 0px drift on both open-end and close-start frames.
    const prevBookLayoutRef = useRef({ bookW, spread: spreadMode, page: currentPage });
    useLayoutEffect(() => {
      const prev = prevBookLayoutRef.current;
      prevBookLayoutRef.current = { bookW, spread: spreadMode, page: currentPage };

      if (
        prev.bookW <= 0 ||
        bookW <= 0 ||
        prev.bookW === bookW ||
        prev.spread !== spreadMode ||
        prev.page !== currentPage
      ) {
        return;
      }

      const cur = liveZoomRef.current;
      if (cur.scale <= 1.01) return;

      const ratio = bookW / prev.bookW;
      const nextX = cur.panX * ratio;
      const nextY = cur.panY * ratio;
      lastZoomFocusRef.current = {
        x: lastZoomFocusRef.current.x * ratio,
        y: lastZoomFocusRef.current.y * ratio,
      };

      stopZoomAnimation();
      applyZoomDom(cur.scale, nextX, nextY);

      const nextCommitted = quantizeCommittedScale(cur.scale);
      if (Math.abs(nextCommitted - committedScaleRef.current) > 0.001) {
        setCommittedScale(nextCommitted);
      }

      if (bookW < prev.bookW) {
        const clamped = clampZoomPan(cur.scale, nextX, nextY, false);
        if (Math.hypot(clamped.panX - nextX, clamped.panY - nextY) > 1) {
          animateZoomTo(clamped.scale, clamped.panX, clamped.panY, 180);
          return;
        }
      }

      setZoomPan(cur.scale, nextX, nextY);
    }, [
      bookW,
      spreadMode,
      currentPage,
      stopZoomAnimation,
      applyZoomDom,
      quantizeCommittedScale,
      clampZoomPan,
      animateZoomTo,
      setZoomPan,
    ]);

    // Keep DOM transform and cursor synced with liveZoomRef across any React re-render
    useLayoutEffect(() => {
      const { scale: s, panX: px, panY: py } = liveZoomRef.current;
      applyZoomDom(s, px, py);
    });

    // Reset zoom strictly when page or spread mode actually changes
    const prevPageSpreadRef = useRef({ page: currentPage, spread: spreadMode });
    useEffect(() => {
      const prev = prevPageSpreadRef.current;
      if (prev.page !== currentPage || prev.spread !== spreadMode) {
        prevPageSpreadRef.current = { page: currentPage, spread: spreadMode };
        stopZoomAnimation();
        committedScaleRef.current = 1;
        applyZoomDom(1, 0, 0);
        setCommittedScale(1);
      }
    }, [currentPage, spreadMode, stopZoomAnimation, applyZoomDom]);

    // Smoothly animate back to 100% when reset button is pressed
    const prevResetSeqRef = useRef(zoomResetSeq);
    useEffect(() => {
      if (zoomResetSeq !== prevResetSeqRef.current) {
        prevResetSeqRef.current = zoomResetSeq;
        animateZoomTo(1, 0, 0, 260);
      }
    }, [zoomResetSeq, animateZoomTo]);

    useEffect(() => {
      return () => {
        stopZoomAnimation();
        if (wheelSettleTimerRef.current !== null) {
          window.clearTimeout(wheelSettleTimerRef.current);
        }
      };
    }, [stopZoomAnimation]);

    const handleZoomPanLive = useCallback(
      (nextS: number, nextX: number, nextY: number, focusX?: number, focusY?: number) => {
        stopZoomAnimation();
        const prev = liveZoomRef.current;
        const clamped = clampZoomPan(nextS, nextX, nextY, true);
        if (focusX !== undefined && focusY !== undefined) {
          lastZoomFocusRef.current = { x: focusX, y: focusY };
        } else if (clamped.scale > MAX_ZOOM_SCALE) {
          lastZoomFocusRef.current = {
            x: lastZoomFocusRef.current.x + (clamped.panX - prev.panX),
            y: lastZoomFocusRef.current.y + (clamped.panY - prev.panY),
          };
        }
        applyZoomDom(clamped.scale, clamped.panX, clamped.panY);
      },
      [stopZoomAnimation, clampZoomPan, applyZoomDom],
    );

    const handleZoomPanEnd = useCallback(() => {
      const cur = liveZoomRef.current;
      // Snap smoothly back to 100% if close to or below 1.04x
      if (cur.scale < 1.04) {
        lastZoomFocusRef.current = { x: 0, y: 0 };
        animateZoomTo(1, 0, 0, 240);
        return;
      }

      // If rubber-banding past MAX_ZOOM_SCALE, scale pan back around the exact pinch focal point
      // so snapping back to 8x never drifts away from the spread center.
      let targetPanX = cur.panX;
      let targetPanY = cur.panY;
      if (cur.scale > MAX_ZOOM_SCALE) {
        const ratio = MAX_ZOOM_SCALE / cur.scale;
        const { x: fx, y: fy } = lastZoomFocusRef.current;
        targetPanX = fx - ratio * (fx - cur.panX);
        targetPanY = fy - ratio * (fy - cur.panY);
      }

      const clamped = clampZoomPan(cur.scale, targetPanX, targetPanY, false);
      animateZoomTo(clamped.scale, clamped.panX, clamped.panY, 200);
    }, [animateZoomTo, clampZoomPan]);

    const scheduleWheelSettle = useCallback(() => {
      if (wheelSettleTimerRef.current !== null) {
        window.clearTimeout(wheelSettleTimerRef.current);
      }
      wheelSettleTimerRef.current = window.setTimeout(() => {
        wheelSettleTimerRef.current = null;
        handleZoomPanEnd();
      }, 150);
    }, [handleZoomPanEnd]);

    const handleWheelZoomAt = useCallback(
      (factor: number, clientX: number, clientY: number) => {
        stopZoomAnimation();
        const stageEl = stageRef.current;
        if (!stageEl) return;
        const rect = stageEl.getBoundingClientRect();
        const midOffX = clientX - (rect.left + (rect.width - rightInsetRef.current) / 2);
        const midOffY = clientY - (rect.top + rect.height / 2);

        const cur = liveZoomRef.current;
        const nextS = Math.max(0.92, Math.min(MAX_ZOOM_SCALE, cur.scale * factor));
        const ratio = nextS / cur.scale;
        const nextX = midOffX - ratio * (midOffX - cur.panX);
        const nextY = midOffY - ratio * (midOffY - cur.panY);
        lastZoomFocusRef.current = { x: midOffX, y: midOffY };

        const clamped = clampZoomPan(nextS, nextX, nextY, true);
        applyZoomDom(clamped.scale, clamped.panX, clamped.panY);
        scheduleWheelSettle();
      },
      [stopZoomAnimation, clampZoomPan, applyZoomDom, scheduleWheelSettle],
    );

    const handleWheelPan = useCallback(
      (dx: number, dy: number) => {
        stopZoomAnimation();
        const cur = liveZoomRef.current;
        const clamped = clampZoomPan(cur.scale, cur.panX + dx, cur.panY + dy, false);
        applyZoomDom(clamped.scale, clamped.panX, clamped.panY);
        scheduleWheelSettle();
      },
      [stopZoomAnimation, clampZoomPan, applyZoomDom, scheduleWheelSettle],
    );

    // Current spread layout
    const layout = useMemo(
      () => getSpreadLayout(currentPage, pageCount, spreadMode, bindingDirection, coverSinglePage),
      [currentPage, pageCount, spreadMode, bindingDirection, coverSinglePage],
    );

    const nextTargetPage = useMemo(
      () => getNextSpreadPage(currentPage, pageCount, spreadMode, coverSinglePage),
      [currentPage, pageCount, spreadMode, coverSinglePage],
    );

    const prevTargetPage = useMemo(
      () => getPrevSpreadPage(currentPage, spreadMode, coverSinglePage),
      [currentPage, spreadMode, coverSinglePage],
    );

    // Two-stage prefetch:
    //  1) High-res Retina for current spread + immediate next/prev spreads (0ms crisp turn)
    //  2) Lightweight 360px previews spreading outward up to 6 spreads ahead & 4 spreads behind
    //     so rapid flipping shows an instant preview instead of blank white before sharpening.
    useEffect(() => {
      if (!pdfManager || pageCount <= 0) return;

      const nearPages: number[] = [];
      const farPreviewPages: number[] = [];
      const seen = new Set<number>();

      const pushSpread = (target: number[], anchorPage: number | null) => {
        if (anchorPage === null) return;
        const sp = getSpreadLayout(
          anchorPage,
          pageCount,
          spreadMode,
          bindingDirection,
          coverSinglePage,
        );
        for (const p of [sp.leftPage, sp.rightPage]) {
          if (p !== null && !seen.has(p)) {
            seen.add(p);
            target.push(p);
          }
        }
      };

      pushSpread(nearPages, currentPage);
      pushSpread(nearPages, nextTargetPage);
      pushSpread(nearPages, prevTargetPage);

      let nextCursor = nextTargetPage;
      let prevCursor = prevTargetPage;
      for (let step = 0; step < 6; step++) {
        if (nextCursor !== null) {
          nextCursor = getNextSpreadPage(nextCursor, pageCount, spreadMode, coverSinglePage);
          pushSpread(farPreviewPages, nextCursor);
        }
        if (step < 4 && prevCursor !== null) {
          prevCursor = getPrevSpreadPage(prevCursor, spreadMode, coverSinglePage);
          pushSpread(farPreviewPages, prevCursor);
        }
      }

      pdfManager.prefetchPages(
        nearPages,
        getIdealRenderWidth(pageW, 1, aspectRatio),
        nearPages.length,
        farPreviewPages,
      );
    }, [
      pdfManager,
      currentPage,
      nextTargetPage,
      prevTargetPage,
      pageCount,
      spreadMode,
      bindingDirection,
      coverSinglePage,
      pageW,
      aspectRatio,
    ]);

    // Optimistic local stroke cache so strokes appear instantly with 0ms lag/flicker
    // and rapid consecutive strokes never overwrite each other before IndexedDB finishes.
    const [optimisticStrokes, setOptimisticStrokes] = useState<Record<string, Stroke[]>>({});
    const optimisticRef = useRef<Record<string, Stroke[]>>({});

    useEffect(() => {
      optimisticRef.current = {};
      setOptimisticStrokes({});
    }, [workbookId]);

    const commitLayerStrokes = useCallback(
      (pageNum: number, layerName: string, nextStrokes: Stroke[]) => {
        const layerKey = `${pageNum}:${layerName}`;
        const nextMap = { ...optimisticRef.current, [layerKey]: nextStrokes };
        optimisticRef.current = nextMap;
        setOptimisticStrokes(nextMap);
        void savePageStrokes(workbookId, pageNum, layerName, nextStrokes);
      },
      [workbookId],
    );

    // Build visible strokes lookup for the currently active round only
    const visibleStrokesByPage = useMemo(() => {
      const map = new Map<number, Stroke[]>();
      const targetLayer = layers.includes(activeLayer)
        ? activeLayer
        : layers[0] ?? activeLayer;

      const dbByPage = new Map<number, Stroke[]>();
      const allPages = new Set<number>();
      for (const rec of allPageStrokes) {
        if (rec.layerName !== targetLayer) continue;
        dbByPage.set(rec.pageNumber, rec.strokes);
        allPages.add(rec.pageNumber);
      }
      const suffix = `:${targetLayer}`;
      for (const key of Object.keys(optimisticStrokes)) {
        if (!key.endsWith(suffix)) continue;
        const p = Number(key.slice(0, key.length - suffix.length));
        if (Number.isFinite(p)) allPages.add(p);
      }

      for (const pageNum of allPages) {
        const key = `${pageNum}:${targetLayer}`;
        const list = key in optimisticStrokes ? optimisticStrokes[key] : dbByPage.get(pageNum);
        if (list && list.length > 0) {
          map.set(pageNum, list);
        }
      }
      return map;
    }, [allPageStrokes, optimisticStrokes, layers, activeLayer]);

    const getLayerStrokes = useCallback(
      (pageNum: number, layerName: string): Stroke[] => {
        const key = `${pageNum}:${layerName}`;
        if (key in optimisticRef.current) {
          return optimisticRef.current[key];
        }
        const found = allPageStrokes.find(
          (r) => r.pageNumber === pageNum && r.layerName === layerName,
        );
        return found?.strokes ?? [];
      },
      [allPageStrokes],
    );

    // ===== 3D Flip State & Imperative Transform Updates =====
    const [flipSession, setFlipSession] = useState<FlipSession | null>(null);
    const flipSessionRef = useRef<FlipSession | null>(null);
    const progressRef = useRef(0);
    const flipDragStartXRef = useRef(0);
    const flipDirLockedRef = useRef<'next' | 'prev' | null>(null);
    const animFrameRef = useRef<number | null>(null);

    const applyFlipProgress = useCallback((session: FlipSession, rawProgress: number) => {
      const p = Math.max(0, Math.min(1, rawProgress));
      progressRef.current = p;

      const frontShade = frontShadeRef.current;
      const backShade = backShadeRef.current;
      const underShadow = underShadowRef.current;

      if (session.mode === 'double') {
        const frontLeaf = frontLeafRef.current;
        const backLeaf = backLeafRef.current;
        if (!frontLeaf || !backLeaf) return;

        const foldShadow = Math.sin(p * Math.PI) * 0.22;
        if (p <= 0.5) {
          const deg = session.leafSide === 'right' ? -180 * p : 180 * p;
          frontLeaf.style.display = 'block';
          frontLeaf.style.transform = `rotateY(${deg.toFixed(2)}deg)`;
          backLeaf.style.display = 'none';
        } else {
          // Render back face upright from 90deg -> 0deg on the destination side,
          // avoiding CSS rotateY(180deg) / backface-visibility mirroring bugs in WebKit.
          const deg =
            session.leafSide === 'right' ? 180 * (1 - p) : -180 * (1 - p);
          frontLeaf.style.display = 'none';
          backLeaf.style.display = 'block';
          backLeaf.style.transform = `rotateY(${deg.toFixed(2)}deg)`;
        }

        if (frontShade) frontShade.style.opacity = String(foldShadow);
        if (backShade) backShade.style.opacity = String(foldShadow);
        if (underShadow) underShadow.style.opacity = String(Math.sin(p * Math.PI) * 0.16);
      } else {
        const leafEl = leafRef.current;
        if (!leafEl) return;
        // Single page mode: hinge on binding side
        const maxAngle = 112;
        let deg = 0;
        let opacity = 1;
        if (session.direction === 'next') {
          deg = session.hingeSide === 'left' ? -maxAngle * p : maxAngle * p;
          opacity = p > 0.72 ? Math.max(0, 1 - (p - 0.72) / 0.28) : 1;
        } else {
          // Prev page swings back from -112 deg to 0 deg
          const inv = 1 - p;
          deg = session.hingeSide === 'left' ? -maxAngle * inv : maxAngle * inv;
          opacity = p < 0.28 ? Math.min(1, p / 0.28) : 1;
        }
        leafEl.style.transform = `rotateY(${deg.toFixed(2)}deg)`;
        leafEl.style.opacity = String(opacity);
        if (frontShade) frontShade.style.opacity = String(Math.sin(p * Math.PI) * 0.18);
        if (underShadow) underShadow.style.opacity = String((1 - p) * 0.15);
      }
    }, []);

    // Apply initial angle immediately before paint when flipSession mounts
    useLayoutEffect(() => {
      if (flipSession) {
        applyFlipProgress(flipSession, progressRef.current);
      }
    }, [flipSession, applyFlipProgress]);

    const createFlipSession = useCallback(
      (dir: 'next' | 'prev'): FlipSession | null => {
        const target = dir === 'next' ? nextTargetPage : prevTargetPage;
        if (target === null) return null;

        if (spreadMode === 'single') {
          const hingeSide: 'left' | 'right' = bindingDirection === 'ltr' ? 'left' : 'right';
          return {
            mode: 'single',
            direction: dir,
            hingeSide,
            targetPage: target,
            underPage: dir === 'next' ? target : currentPage,
            leafPage: dir === 'next' ? currentPage : target,
          };
        }

        const targetLayout = getSpreadLayout(
          target,
          pageCount,
          'double',
          bindingDirection,
          coverSinglePage,
        );

        // Determine which half turns over
        const leafSide: 'left' | 'right' =
          bindingDirection === 'ltr'
            ? dir === 'next'
              ? 'right'
              : 'left'
            : dir === 'next'
              ? 'left'
              : 'right';

        if (leafSide === 'right') {
          return {
            mode: 'double',
            direction: dir,
            leafSide: 'right',
            targetPage: target,
            staticLeft: layout.leftPage,
            staticRight: targetLayout.rightPage,
            leafFront: layout.rightPage,
            leafBack: targetLayout.leftPage,
          };
        }

        return {
          mode: 'double',
          direction: dir,
          leafSide: 'left',
          targetPage: target,
          staticLeft: targetLayout.leftPage,
          staticRight: layout.rightPage,
          leafFront: layout.leftPage,
          leafBack: targetLayout.rightPage,
        };
      },
      [
        nextTargetPage,
        prevTargetPage,
        spreadMode,
        bindingDirection,
        currentPage,
        pageCount,
        coverSinglePage,
        layout,
      ],
    );

    const stopFlipAnimation = useCallback(() => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }, []);

    const settleFlip = useCallback(
      (commit: boolean) => {
        const session = flipSessionRef.current;
        if (!session) return;

        stopFlipAnimation();
        const startP = progressRef.current;
        const endP = commit ? 1 : 0;
        const distance = Math.abs(endP - startP);
        const duration = Math.max(150, Math.min(360, distance * 360));
        const startTime = performance.now();

        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

        const tick = (now: number) => {
          const elapsed = now - startTime;
          const t = Math.min(1, elapsed / duration);
          const eased = easeOutCubic(t);
          const p = startP + (endP - startP) * eased;
          applyFlipProgress(session, p);

          if (t < 1) {
            animFrameRef.current = requestAnimationFrame(tick);
          } else {
            animFrameRef.current = null;
            if (commit) {
              setCurrentPage(session.targetPage);
            }
            flipSessionRef.current = null;
            flipDirLockedRef.current = null;
            progressRef.current = 0;
            setFlipSession(null);
          }
        };

        animFrameRef.current = requestAnimationFrame(tick);
      },
      [applyFlipProgress, setCurrentPage, stopFlipAnimation],
    );

    const triggerProgrammaticFlip = useCallback(
      (dir: 'next' | 'prev') => {
        if (flipSessionRef.current) return;
        const session = createFlipSession(dir);
        if (!session) return;
        progressRef.current = 0;
        flipSessionRef.current = session;
        flipDirLockedRef.current = dir;
        setFlipSession(session);
        requestAnimationFrame(() => {
          settleFlip(true);
        });
      },
      [createFlipSession, settleFlip],
    );

    useEffect(() => {
      return () => stopFlipAnimation();
    }, [stopFlipAnimation]);

    // ===== Ink Drawing State (supports cross-spread strokes & 0.6s hold-to-snap shapes) =====
    const HOLD_SNAP_MS = 600;
    const HOLD_STATIONARY_PX = 12;

    const [draftStrokesByPage, setDraftStrokesByPage] = useState<Record<number, Stroke[]>>({});
    const draftSessionRef = useRef<{
      tool: 'pen' | 'marker';
      color: string;
      size: number;
      rawBookPoints: StrokePoint[];
      holdAnchorClient: { x: number; y: number };
      snappedShape: SnappedShape | null;
    } | null>(null);
    const holdTimerRef = useRef<number | null>(null);
    const eraserWorkingRef = useRef<{
      initialByPage: PageStrokesSnapshot;
      currentByPage: PageStrokesSnapshot;
      changed: boolean;
      lastClient: { x: number; y: number } | null;
    } | null>(null);

    const syncStageCursor = useCallback(() => {
      const zoomEl = zoomWrapperRef.current;
      if (!zoomEl) return;
      zoomEl.style.cursor = eraserCursorStateRef.current.visible
        ? 'none'
        : interactionMode === 'draw'
          ? 'crosshair'
          : liveZoomRef.current.scale > 1.02
            ? 'grab'
            : 'default';
    }, [interactionMode]);

    const hideEraserCursor = useCallback(() => {
      if (!eraserCursorStateRef.current.visible && !eraserCursorStateRef.current.active) return;
      eraserCursorStateRef.current.visible = false;
      eraserCursorStateRef.current.active = false;
      const el = eraserCursorRef.current;
      if (el) {
        el.style.opacity = '0';
      }
      syncStageCursor();
    }, [syncStageCursor]);

    const showEraserCursorAt = useCallback(
      (
        clientX: number,
        clientY: number,
        active: boolean,
        pointerType: 'mouse' | 'pen' | 'touch',
      ) => {
        const stageEl = stageRef.current;
        const el = eraserCursorRef.current;
        if (!stageEl || !el) return;
        const stageRect = stageEl.getBoundingClientRect();
        const x = clientX - stageRect.left - eraserRadiusPx;
        const y = clientY - stageRect.top - eraserRadiusPx;

        eraserCursorStateRef.current = {
          visible: true,
          active,
          pointerType,
          clientX,
          clientY,
        };
        el.style.width = `${eraserDiameterPx}px`;
        el.style.height = `${eraserDiameterPx}px`;
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        el.style.backgroundColor = active ? 'rgba(24, 24, 27, 0.11)' : 'rgba(24, 24, 27, 0.05)';
        el.style.opacity = '1';
        syncStageCursor();
      },
      [eraserDiameterPx, eraserRadiusPx, syncStageCursor],
    );

    useLayoutEffect(() => {
      const state = eraserCursorStateRef.current;
      if (tool !== 'eraser') {
        hideEraserCursor();
        return;
      }
      if (!state.active && state.pointerType === 'mouse' && interactionMode !== 'draw') {
        hideEraserCursor();
        return;
      }
      const el = eraserCursorRef.current;
      if (el) {
        el.style.width = `${eraserDiameterPx}px`;
        el.style.height = `${eraserDiameterPx}px`;
      }
      if (state.visible) {
        showEraserCursorAt(state.clientX, state.clientY, state.active, state.pointerType);
      }
    }, [tool, interactionMode, eraserDiameterPx, hideEraserCursor, showEraserCursorAt]);

    useEffect(() => {
      if (flipSession !== null) {
        hideEraserCursor();
      }
    }, [flipSession, hideEraserCursor]);

    const clearHoldTimer = useCallback(() => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    }, []);

    useEffect(() => {
      return () => clearHoldTimer();
    }, [clearHoldTimer]);

    const buildDraftByPage = useCallback(
      (
        bookPoints: StrokePoint[],
        spec: { tool: 'pen' | 'marker'; color: string; size: number },
        shapeKind?: 'line' | 'ellipse',
      ): Record<number, Stroke[]> => {
        const segments = splitBookPointsToPages(
          bookPoints,
          spreadMode,
          layout.leftPage,
          layout.rightPage,
        );
        const byPage: Record<number, Stroke[]> = {};
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const draft: Stroke = {
            id: `draft-${seg.pageNumber}-${i}`,
            tool: spec.tool,
            color: spec.color,
            size: spec.size,
            points: seg.points,
            shapeKind,
          };
          if (!byPage[seg.pageNumber]) {
            byPage[seg.pageNumber] = [draft];
          } else {
            byPage[seg.pageNumber].push(draft);
          }
        }
        return byPage;
      },
      [spreadMode, layout.leftPage, layout.rightPage],
    );

    const scheduleHoldSnap = useCallback(() => {
      clearHoldTimer();
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        const session = draftSessionRef.current;
        if (!session || session.snappedShape) return;

        const shape = recognizeHoldShape(session.rawBookPoints, bookW, bookH);
        if (!shape) return;

        session.snappedShape = shape;
        const snappedBookPoints = sampleShapeToBookPoints(shape, bookW, bookH);
        setDraftStrokesByPage(buildDraftByPage(snappedBookPoints, session, shape.kind));
      }, HOLD_SNAP_MS);
    }, [clearHoldTimer, bookW, bookH, buildDraftByPage]);

    const resolveBookPoint = useCallback(
      (
        clientX: number,
        clientY: number,
        allowOutside = false,
      ): { bx: number; by: number; pageNumber: number | null; nx: number; ny: number } | null => {
        const el = bookRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;

        const relX = (clientX - rect.left) / rect.width;
        const relY = (clientY - rect.top) / rect.height;
        if (!allowOutside && (relX < 0 || relX > 1 || relY < 0 || relY > 1)) return null;

        if (spreadMode === 'single') {
          if (!allowOutside && layout.leftPage === null) return null;
          return {
            bx: relX,
            by: relY,
            pageNumber: layout.leftPage,
            nx: Math.max(0, Math.min(1, relX)),
            ny: Math.max(0, Math.min(1, relY)),
          };
        }

        const isLeftHalf = relX < 0.5;
        const targetPage = isLeftHalf ? layout.leftPage : layout.rightPage;
        if (!allowOutside && targetPage === null) return null;

        return {
          bx: relX,
          by: relY,
          pageNumber: targetPage,
          nx: Math.max(0, Math.min(1, isLeftHalf ? relX * 2 : (relX - 0.5) * 2)),
          ny: Math.max(0, Math.min(1, relY)),
        };
      },
      [spreadMode, layout],
    );

    const eraseSingleSample = useCallback(
      (clientX: number, clientY: number) => {
        const work = eraserWorkingRef.current;
        const el = bookRef.current;
        if (!work || !el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        // Reject only when the entire eraser circle lies outside the book rectangle
        if (
          clientX + eraserRadiusPx < rect.left ||
          clientX - eraserRadiusPx > rect.right ||
          clientY + eraserRadiusPx < rect.top ||
          clientY - eraserRadiusPx > rect.bottom
        ) {
          return;
        }

        const slots = spreadMode === 'double' ? 2 : 1;
        const visualPageW = rect.width / slots;
        const visualPageH = rect.height;
        const cyNorm = (clientY - rect.top) / visualPageH;

        const candidates: Array<{ pageNumber: number; cxNorm: number }> = [];
        if (spreadMode === 'single') {
          if (layout.leftPage !== null) {
            candidates.push({
              pageNumber: layout.leftPage,
              cxNorm: (clientX - rect.left) / visualPageW,
            });
          }
        } else {
          if (layout.leftPage !== null && clientX - eraserRadiusPx <= rect.left + visualPageW) {
            candidates.push({
              pageNumber: layout.leftPage,
              cxNorm: (clientX - rect.left) / visualPageW,
            });
          }
          if (layout.rightPage !== null && clientX + eraserRadiusPx >= rect.left + visualPageW) {
            candidates.push({
              pageNumber: layout.rightPage,
              cxNorm: (clientX - (rect.left + visualPageW)) / visualPageW,
            });
          }
        }

        if (candidates.length === 0) return;

        const ensurePageLoaded = (pageNum: number): Stroke[] => {
          if (!(pageNum in work.currentByPage)) {
            const initial = getLayerStrokes(pageNum, activeLayer);
            work.initialByPage[pageNum] = initial;
            work.currentByPage[pageNum] = initial;
          }
          return work.currentByPage[pageNum];
        };

        const hitGroupIds = new Set<string>();
        const directHitsByPage = new Map<number, Set<number>>();

        for (const cand of candidates) {
          const pageStrokes = ensurePageLoaded(cand.pageNumber);
          for (let i = 0; i < pageStrokes.length; i++) {
            const s = pageStrokes[i];
            if (
              isCircleTouchingStroke(
                cand.cxNorm,
                cyNorm,
                s,
                visualPageW,
                visualPageH,
                eraserRadiusPx,
              )
            ) {
              let set = directHitsByPage.get(cand.pageNumber);
              if (!set) {
                set = new Set<number>();
                directHitsByPage.set(cand.pageNumber, set);
              }
              set.add(i);
              if (s.groupId) {
                hitGroupIds.add(s.groupId);
              }
            }
          }
        }

        if (directHitsByPage.size === 0 && hitGroupIds.size === 0) return;

        const pagesToUpdate = new Set<number>(directHitsByPage.keys());
        if (spreadMode === 'double' && hitGroupIds.size > 0) {
          if (layout.leftPage !== null) pagesToUpdate.add(layout.leftPage);
          if (layout.rightPage !== null) pagesToUpdate.add(layout.rightPage);
        }

        for (const pageNum of pagesToUpdate) {
          const currentPageStrokes = ensurePageLoaded(pageNum);
          const directHitIndices = directHitsByPage.get(pageNum);
          const nextCurrent = currentPageStrokes.filter(
            (s, idx) =>
              !(directHitIndices && directHitIndices.has(idx)) &&
              (!s.groupId || !hitGroupIds.has(s.groupId)),
          );
          if (nextCurrent.length !== currentPageStrokes.length) {
            work.currentByPage[pageNum] = nextCurrent;
            work.changed = true;
            commitLayerStrokes(pageNum, activeLayer, nextCurrent);
          }
        }
      },
      [eraserRadiusPx, spreadMode, layout, getLayerStrokes, activeLayer, commitLayerStrokes],
    );

    const eraseAtPoint = useCallback(
      (clientX: number, clientY: number) => {
        const work = eraserWorkingRef.current;
        if (!work) return;

        if (!work.lastClient) {
          work.lastClient = { x: clientX, y: clientY };
          eraseSingleSample(clientX, clientY);
          return;
        }

        const prev = work.lastClient;
        const dist = Math.hypot(clientX - prev.x, clientY - prev.y);
        const stepPx = Math.max(3, eraserRadiusPx * 0.55);
        const steps = Math.max(1, Math.min(64, Math.ceil(dist / stepPx)));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          eraseSingleSample(
            prev.x + (clientX - prev.x) * t,
            prev.y + (clientY - prev.y) * t,
          );
        }
        work.lastClient = { x: clientX, y: clientY };
      },
      [eraserRadiusPx, eraseSingleSample],
    );

    const handleDrawStart = useCallback(
      (
        clientX: number,
        clientY: number,
        pressure: number,
        pointerType: 'mouse' | 'pen' | 'touch',
      ): boolean => {
        if (flipSessionRef.current) return false;
        const pt = resolveBookPoint(clientX, clientY, false);
        if (!pt || pt.pageNumber === null) return false;

        if (tool === 'eraser') {
          eraserWorkingRef.current = {
            initialByPage: {},
            currentByPage: {},
            changed: false,
            lastClient: null,
          };
          showEraserCursorAt(clientX, clientY, true, pointerType);
          eraseAtPoint(clientX, clientY);
          return true;
        }

        clearHoldTimer();
        const drawTool: 'pen' | 'marker' = tool === 'marker' ? 'marker' : 'pen';
        const color = drawTool === 'marker' ? markerColor : penColor;
        const size =
          drawTool === 'marker'
            ? SIZE_OPTIONS[markerSizeIndex].marker
            : SIZE_OPTIONS[penSizeIndex].pen;
        const initialPoints: StrokePoint[] = [[pt.bx, pt.by, pressure || 0.5]];

        const session = {
          tool: drawTool,
          color,
          size,
          rawBookPoints: initialPoints,
          holdAnchorClient: { x: clientX, y: clientY },
          snappedShape: null as SnappedShape | null,
        };
        draftSessionRef.current = session;
        setDraftStrokesByPage(buildDraftByPage(initialPoints, session));
        return true;
      },
      [
        resolveBookPoint,
        tool,
        eraseAtPoint,
        showEraserCursorAt,
        clearHoldTimer,
        penSizeIndex,
        markerSizeIndex,
        markerColor,
        penColor,
        buildDraftByPage,
      ],
    );

    const handleDrawMovePoints = useCallback(
      (samples: DrawMoveSample[]) => {
        if (samples.length === 0) return;

        if (tool === 'eraser') {
          const last = samples[samples.length - 1];
          showEraserCursorAt(
            last.clientX,
            last.clientY,
            true,
            eraserCursorStateRef.current.pointerType,
          );
          for (const sample of samples) {
            eraseAtPoint(sample.clientX, sample.clientY);
          }
          return;
        }

        const session = draftSessionRef.current;
        if (!session) return;

        // Live adjustment mode after hold-to-snap triggered (Freeform / GoodNotes style)
        if (session.snappedShape) {
          const last = samples[samples.length - 1];
          const pt = resolveBookPoint(last.clientX, last.clientY, true);
          if (!pt) return;
          const updatedShape = updateSnappedShape(
            session.snappedShape,
            pt.bx * bookW,
            pt.by * bookH,
          );
          session.snappedShape = updatedShape;
          const snappedBookPoints = sampleShapeToBookPoints(updatedShape, bookW, bookH);
          setDraftStrokesByPage(buildDraftByPage(snappedBookPoints, session, updatedShape.kind));
          return;
        }

        const appended: StrokePoint[] = [];
        let lastPt = session.rawBookPoints[session.rawBookPoints.length - 1];
        let movedBeyondHoldRadius = false;
        let lastValidClient: { x: number; y: number } | null = null;

        for (const sample of samples) {
          const pt = resolveBookPoint(sample.clientX, sample.clientY, false);
          if (!pt || pt.pageNumber === null) continue;
          lastValidClient = { x: sample.clientX, y: sample.clientY };

          if (
            Math.hypot(
              sample.clientX - session.holdAnchorClient.x,
              sample.clientY - session.holdAnchorClient.y,
            ) > HOLD_STATIONARY_PX
          ) {
            movedBeyondHoldRadius = true;
            session.holdAnchorClient = { x: sample.clientX, y: sample.clientY };
          }

          if (lastPt) {
            const dist = Math.hypot(pt.bx - lastPt[0], pt.by - lastPt[1]);
            if (dist < 0.0005) continue;
          }
          const nextPt: StrokePoint = [pt.bx, pt.by, sample.pressure || 0.5];
          appended.push(nextPt);
          lastPt = nextPt;
        }

        if (appended.length > 0) {
          session.rawBookPoints = [...session.rawBookPoints, ...appended];
          setDraftStrokesByPage(buildDraftByPage(session.rawBookPoints, session));
        }

        if (session.rawBookPoints.length >= 4 && lastValidClient) {
          if (movedBeyondHoldRadius || holdTimerRef.current === null) {
            scheduleHoldSnap();
          }
        }
      },
      [
        tool,
        eraseAtPoint,
        showEraserCursorAt,
        resolveBookPoint,
        bookW,
        bookH,
        buildDraftByPage,
        scheduleHoldSnap,
      ],
    );

    const handleDrawEnd = useCallback(() => {
      clearHoldTimer();

      if (tool === 'eraser') {
        const work = eraserWorkingRef.current;
        eraserWorkingRef.current = null;
        if (work && work.changed) {
          const key = `${workbookId}:${activeLayer}`;
          pushHistory(key, work.initialByPage);
        }
        const cursorState = eraserCursorStateRef.current;
        if (
          cursorState.pointerType === 'mouse' &&
          interactionMode === 'draw'
        ) {
          const pt = resolveBookPoint(cursorState.clientX, cursorState.clientY, false);
          if (pt && pt.pageNumber !== null) {
            showEraserCursorAt(cursorState.clientX, cursorState.clientY, false, 'mouse');
            return;
          }
        }
        hideEraserCursor();
        return;
      }

      const session = draftSessionRef.current;
      draftSessionRef.current = null;
      setDraftStrokesByPage({});
      if (!session) return;

      const finalBookPoints = session.snappedShape
        ? sampleShapeToBookPoints(session.snappedShape, bookW, bookH)
        : session.rawBookPoints;
      const shapeKind = session.snappedShape?.kind;

      const segments = splitBookPointsToPages(
        finalBookPoints,
        spreadMode,
        layout.leftPage,
        layout.rightPage,
      );
      if (segments.length === 0) return;

      const groupId = segments.length > 1 ? createId() : undefined;
      const addedByPage = new Map<number, Stroke[]>();
      for (const seg of segments) {
        const stroke: Stroke = {
          id: createId(),
          tool: session.tool,
          color: session.color,
          size: session.size,
          points: seg.points,
          ...(groupId ? { groupId } : {}),
          ...(shapeKind ? { shapeKind } : {}),
        };
        const list = addedByPage.get(seg.pageNumber);
        if (list) list.push(stroke);
        else addedByPage.set(seg.pageNumber, [stroke]);
      }

      const prevSnapshot: PageStrokesSnapshot = {};
      for (const pageNum of addedByPage.keys()) {
        prevSnapshot[pageNum] = getLayerStrokes(pageNum, activeLayer);
      }

      const key = `${workbookId}:${activeLayer}`;
      pushHistory(key, prevSnapshot);

      for (const [pageNum, added] of addedByPage.entries()) {
        const existing = prevSnapshot[pageNum] ?? [];
        commitLayerStrokes(pageNum, activeLayer, [...existing, ...added]);
      }
    }, [
      clearHoldTimer,
      tool,
      workbookId,
      activeLayer,
      pushHistory,
      bookW,
      bookH,
      spreadMode,
      layout.leftPage,
      layout.rightPage,
      getLayerStrokes,
      commitLayerStrokes,
      interactionMode,
      resolveBookPoint,
      showEraserCursorAt,
      hideEraserCursor,
    ]);

    // ===== Interactive Drag Flip Callbacks =====
    const handleFlipStart = useCallback(
      (clientX: number) => {
        if (flipSessionRef.current) return;
        flipDragStartXRef.current = clientX;
        flipDirLockedRef.current = null;
      },
      [],
    );

    const handleFlipMove = useCallback(
      (clientX: number) => {
        const dx = clientX - flipDragStartXRef.current;
        if (!flipDirLockedRef.current) {
          if (Math.abs(dx) < 10) return;
          // In LTR: dragging left (dx < 0) means next, dragging right means prev
          // In RTL: dragging right (dx > 0) means next, dragging left means prev
          const dir: 'next' | 'prev' =
            bindingDirection === 'ltr'
              ? dx < 0
                ? 'next'
                : 'prev'
              : dx > 0
                ? 'next'
                : 'prev';

          const session = createFlipSession(dir);
          if (!session) return;
          flipDirLockedRef.current = dir;
          flipSessionRef.current = session;
          progressRef.current = 0;
          setFlipSession(session);
        }

        const session = flipSessionRef.current;
        if (!session) return;

        const swipeSpan = Math.max(180, pageW * 0.9);
        const signed =
          bindingDirection === 'ltr'
            ? session.direction === 'next'
              ? -dx
              : dx
            : session.direction === 'next'
              ? dx
              : -dx;
        const p = Math.max(0, Math.min(1, signed / swipeSpan));
        applyFlipProgress(session, p);
      },
      [bindingDirection, createFlipSession, pageW, applyFlipProgress],
    );

    const handleFlipEnd = useCallback(
      (_clientX: number, velocityX: number) => {
        const session = flipSessionRef.current;
        if (!session) return;

        const dirVelocity =
          bindingDirection === 'ltr'
            ? session.direction === 'next'
              ? -velocityX
              : velocityX
            : session.direction === 'next'
              ? velocityX
              : -velocityX;

        const shouldCommit = progressRef.current > 0.28 || (progressRef.current > 0.08 && dirVelocity > 0.35);
        settleFlip(shouldCommit);
      },
      [bindingDirection, settleFlip],
    );

    const handleFlipCancel = useCallback(
      (immediate = false) => {
        if (!flipSessionRef.current) return;
        if (immediate) {
          stopFlipAnimation();
          flipSessionRef.current = null;
          flipDirLockedRef.current = null;
          progressRef.current = 0;
          setFlipSession(null);
          return;
        }
        settleFlip(false);
      },
      [settleFlip, stopFlipAnimation],
    );

    // ===== Undo / Redo (atomic across cross-spread pages) =====
    const visiblePages = useMemo(
      () =>
        spreadMode === 'single'
          ? layout.leftPage !== null
            ? [layout.leftPage]
            : []
          : [layout.leftPage, layout.rightPage].filter((p): p is number => p !== null),
      [spreadMode, layout.leftPage, layout.rightPage],
    );

    const handleUndo = useCallback(() => {
      const key = `${workbookId}:${activeLayer}`;
      const restored = popUndo(key, visiblePages, (p) => getLayerStrokes(p, activeLayer));
      if (restored) {
        for (const [pStr, strokes] of Object.entries(restored)) {
          commitLayerStrokes(Number(pStr), activeLayer, strokes);
        }
      }
    }, [workbookId, activeLayer, popUndo, visiblePages, getLayerStrokes, commitLayerStrokes]);

    const handleRedo = useCallback(() => {
      const key = `${workbookId}:${activeLayer}`;
      const restored = popRedo(key, visiblePages, (p) => getLayerStrokes(p, activeLayer));
      if (restored) {
        for (const [pStr, strokes] of Object.entries(restored)) {
          commitLayerStrokes(Number(pStr), activeLayer, strokes);
        }
      }
    }, [workbookId, activeLayer, popRedo, visiblePages, getLayerStrokes, commitLayerStrokes]);

    useImperativeHandle(
      ref,
      () => ({
        flipNext: () => triggerProgrammaticFlip('next'),
        flipPrev: () => triggerProgrammaticFlip('prev'),
        undo: handleUndo,
        redo: handleRedo,
        setSidebarAnimFrame: applySidebarAnimFrame,
        reclampZoom: () => {
          const cur = liveZoomRef.current;
          if (cur.scale > 1.02) {
            const clamped = clampZoomPan(cur.scale, cur.panX, cur.panY, false);
            applyZoomDom(clamped.scale, clamped.panX, clamped.panY);
            setZoomPan(clamped.scale, clamped.panX, clamped.panY);
          }
        },
      }),
      [
        triggerProgrammaticFlip,
        handleUndo,
        handleRedo,
        applySidebarAnimFrame,
        clampZoomPan,
        applyZoomDom,
        setZoomPan,
      ],
    );

    // Keyboard navigation & Undo/Redo
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
          return;
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault();
          triggerProgrammaticFlip(bindingDirection === 'ltr' ? 'next' : 'prev');
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          triggerProgrammaticFlip(bindingDirection === 'ltr' ? 'prev' : 'next');
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [bindingDirection, triggerProgrammaticFlip, handleUndo, handleRedo]);

    const handleHoverMove = useCallback(
      (clientX: number, clientY: number, pointerType: 'mouse' | 'pen') => {
        if (tool !== 'eraser' || flipSessionRef.current) {
          hideEraserCursor();
          return;
        }
        // Mouse only erases in 'draw' mode; Apple Pencil always erases even in 'flip' mode
        if (pointerType === 'mouse' && interactionMode !== 'draw') {
          hideEraserCursor();
          return;
        }
        const pt = resolveBookPoint(clientX, clientY, false);
        if (!pt || pt.pageNumber === null) {
          hideEraserCursor();
          return;
        }
        showEraserCursorAt(clientX, clientY, false, pointerType);
      },
      [tool, interactionMode, resolveBookPoint, showEraserCursorAt, hideEraserCursor],
    );

    const gestureHandlers = useBookGestures({
      stageRef,
      interactionMode,
      getZoomPan: () => liveZoomRef.current,
      onDrawStart: handleDrawStart,
      onDrawMovePoints: handleDrawMovePoints,
      onDrawEnd: handleDrawEnd,
      onFlipStart: handleFlipStart,
      onFlipMove: handleFlipMove,
      onFlipEnd: handleFlipEnd,
      onFlipCancel: handleFlipCancel,
      onZoomPanLive: handleZoomPanLive,
      onZoomPanEnd: handleZoomPanEnd,
      onWheelZoomAt: handleWheelZoomAt,
      onWheelPan: handleWheelPan,
      onHoverMove: handleHoverMove,
      onHoverEnd: hideEraserCursor,
    });

    const getStrokesForPage = (p: number | null) =>
      p !== null ? visibleStrokesByPage.get(p) ?? [] : [];

    const getDraftsForPage = (p: number | null): Stroke[] | undefined =>
      p !== null ? draftStrokesByPage[p] : undefined;

    const leftArrowIsPrev = bindingDirection === 'ltr';
    const canGoLeft =
      showPageTurnButtons && (leftArrowIsPrev ? prevTargetPage !== null : nextTargetPage !== null);
    const canGoRight =
      showPageTurnButtons && (leftArrowIsPrev ? nextTargetPage !== null : prevTargetPage !== null);

    // Ensure a newly mounted right arrow button immediately inherits the live sidebar offset
    useLayoutEffect(() => {
      if (canGoRight) {
        applySidebarAnimFrame(sidebarFrameRef.current.t, sidebarFrameRef.current.layoutShift);
      }
    }, [canGoRight, applySidebarAnimFrame]);

    // Layout dimensions scaled by committedScale so settled zoom renders at 1:1 native Retina pixels
    const scaledPageW = Math.max(1, Math.round(pageW * committedScale));
    const scaledPageH = Math.max(1, Math.round(pageH * committedScale));
    const scaledBookW = scaledPageW * (spreadMode === 'double' ? 2 : 1);
    const scaledBookH = scaledPageH;
    const isFlipping = flipSession !== null;
    const isZoomedLayout = committedScale > 1.01;

    return (
      <div
        ref={stageRef}
        className="relative flex-1 h-full flex items-center justify-center overflow-hidden bg-base-200 select-none isolate"
        style={{ touchAction: 'none', paddingRight: rightInset }}
        {...gestureHandlers}
      >
        {/* Edge page-turn buttons */}
        {canGoLeft && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={() => triggerProgrammaticFlip(leftArrowIsPrev ? 'prev' : 'next')}
            aria-label={leftArrowIsPrev ? '前のページ' : '次のページ'}
            className="hidden sm:flex absolute left-3.5 top-1/2 -translate-y-1/2 z-30 w-12 h-12 rounded-full items-center justify-center bg-base-100/90 backdrop-blur-md border border-base-300 shadow-md hover:bg-base-100 text-base-content/75 hover:text-base-content transition-colors active:scale-95"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {canGoRight && (
          <div className="hidden sm:block absolute right-3.5 top-1/2 -translate-y-1/2 z-30">
            <div ref={rightArrowMotionRef}>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={() => triggerProgrammaticFlip(leftArrowIsPrev ? 'next' : 'prev')}
                aria-label={leftArrowIsPrev ? '次のページ' : '前のページ'}
                className="w-12 h-12 rounded-full flex items-center justify-center bg-base-100/90 backdrop-blur-md border border-base-300 shadow-md hover:bg-base-100 text-base-content/75 hover:text-base-content transition-colors active:scale-95"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}

        {/* GPU FLIP motion wrapper for smooth sidebar open/close resize */}
        <div
          ref={bookMotionRef}
          className="shrink-0 flex items-center justify-center"
          style={{ transformOrigin: 'center center' }}
        >
        {/* Zoom / Pan wrapper (transform managed imperatively for 60/120fps) */}
        <div
          ref={zoomWrapperRef}
          className={`shrink-0 flex items-center justify-center ${
            isFlipping ? 'book-perspective will-change-transform' : ''
          }`}
          style={{
            transformOrigin: 'center center',
          }}
        >
          <div
            ref={bookRef}
            className={`relative rounded-lg ${
              isZoomedLayout
                ? ''
                : 'shadow-[0_14px_40px_-14px_rgba(15,23,42,0.22)]'
            } ${isFlipping ? 'preserve-3d' : 'overflow-hidden bg-white'}`}
            style={{ width: scaledBookW, height: scaledBookH }}
          >
            {/* Crisp inner border overlay (avoids outer box-shadow / ring-1 repaint ghosts on WebKit) */}
            {!isFlipping && (
              <div className="absolute inset-0 rounded-lg border border-black/8 dark:border-white/10 pointer-events-none z-10" />
            )}
            {/* === DOUBLE SPREAD MODE === */}
            {spreadMode === 'double' && (
              <div className={`relative w-full h-full ${isFlipping ? 'preserve-3d' : ''}`}>
                {/* Left static page */}
                <div
                  className="absolute top-0 left-0 z-0 rounded-l-lg overflow-hidden"
                  style={{ width: scaledPageW, height: scaledPageH }}
                >
                  <PageSurface
                    pageNumber={
                      flipSession?.mode === 'double'
                        ? flipSession.staticLeft
                        : layout.leftPage
                    }
                    pdfManager={pdfManager}
                    width={scaledPageW}
                    height={scaledPageH}
                    strokes={getStrokesForPage(
                      flipSession?.mode === 'double' ? flipSession.staticLeft : layout.leftPage,
                    )}
                    draftStrokes={
                      flipSession
                        ? undefined
                        : getDraftsForPage(layout.leftPage)
                    }
                    hideInk={false}
                    renderScale={1}
                  />
                  <div className="absolute inset-0 spine-shadow-left pointer-events-none" />
                  {flipSession?.mode === 'double' && flipSession.leafSide === 'left' && (
                    <div
                      ref={underShadowRef}
                      className="absolute inset-0 bg-black pointer-events-none"
                      style={{ opacity: 0 }}
                    />
                  )}
                </div>

                {/* Right static page */}
                <div
                  className="absolute top-0 z-[1] rounded-r-lg overflow-hidden"
                  style={{ left: scaledPageW, width: scaledPageW, height: scaledPageH }}
                >
                  <PageSurface
                    pageNumber={
                      flipSession?.mode === 'double'
                        ? flipSession.staticRight
                        : layout.rightPage
                    }
                    pdfManager={pdfManager}
                    width={scaledPageW}
                    height={scaledPageH}
                    strokes={getStrokesForPage(
                      flipSession?.mode === 'double' ? flipSession.staticRight : layout.rightPage,
                    )}
                    draftStrokes={
                      flipSession
                        ? undefined
                        : getDraftsForPage(layout.rightPage)
                    }
                    hideInk={false}
                    renderScale={1}
                  />
                  <div className="absolute inset-0 spine-shadow-right pointer-events-none" />
                  {flipSession?.mode === 'double' && flipSession.leafSide === 'right' && (
                    <div
                      ref={underShadowRef}
                      className="absolute inset-0 bg-black pointer-events-none"
                      style={{ opacity: 0 }}
                    />
                  )}
                </div>

                {/* 3D Turning Leaf (Double Spread Central Axis — Split Front/Back upright halves) */}
                {flipSession?.mode === 'double' && (
                  <>
                    {/* First half (0 -> 90deg): Front face on origin side */}
                    <div
                      ref={frontLeafRef}
                      className={`absolute top-0 pointer-events-none z-20 overflow-hidden ${
                        flipSession.leafSide === 'right' ? 'rounded-r-lg' : 'rounded-l-lg'
                      }`}
                      style={{
                        width: scaledPageW,
                        height: scaledPageH,
                        left: flipSession.leafSide === 'right' ? scaledPageW : 0,
                        transformOrigin:
                          flipSession.leafSide === 'right' ? 'left center' : 'right center',
                      }}
                    >
                      <PageSurface
                        pageNumber={flipSession.leafFront}
                        pdfManager={pdfManager}
                        width={scaledPageW}
                        height={scaledPageH}
                        strokes={getStrokesForPage(flipSession.leafFront)}
                        hideInk={false}
                        renderScale={1}
                      />
                      <div
                        className={`absolute inset-0 pointer-events-none ${
                          flipSession.leafSide === 'right' ? 'spine-shadow-right' : 'spine-shadow-left'
                        }`}
                      />
                      <div
                        ref={frontShadeRef}
                        className="absolute inset-0 bg-slate-900 pointer-events-none"
                        style={{ opacity: 0 }}
                      />
                    </div>

                    {/* Second half (90 -> 0deg): Back face upright on destination side */}
                    <div
                      ref={backLeafRef}
                      className={`absolute top-0 pointer-events-none z-20 overflow-hidden ${
                        flipSession.leafSide === 'right' ? 'rounded-l-lg' : 'rounded-r-lg'
                      }`}
                      style={{
                        width: scaledPageW,
                        height: scaledPageH,
                        left: flipSession.leafSide === 'right' ? 0 : scaledPageW,
                        transformOrigin:
                          flipSession.leafSide === 'right' ? 'right center' : 'left center',
                        display: 'none',
                      }}
                    >
                      <PageSurface
                        pageNumber={flipSession.leafBack}
                        pdfManager={pdfManager}
                        width={scaledPageW}
                        height={scaledPageH}
                        strokes={getStrokesForPage(flipSession.leafBack)}
                        hideInk={false}
                        renderScale={1}
                      />
                      <div
                        className={`absolute inset-0 pointer-events-none ${
                          flipSession.leafSide === 'right' ? 'spine-shadow-left' : 'spine-shadow-right'
                        }`}
                      />
                      <div
                        ref={backShadeRef}
                        className="absolute inset-0 bg-slate-900 pointer-events-none"
                        style={{ opacity: 0 }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* === SINGLE PAGE MODE === */}
            {spreadMode === 'single' && (
              <div className={`relative w-full h-full rounded-lg ${isFlipping ? 'preserve-3d' : ''}`}>
                {/* Underlying static page */}
                <div className="relative w-full h-full rounded-lg overflow-hidden">
                  <PageSurface
                    pageNumber={
                      flipSession?.mode === 'single'
                        ? flipSession.underPage
                        : layout.leftPage
                    }
                    pdfManager={pdfManager}
                    width={scaledPageW}
                    height={scaledPageH}
                    strokes={getStrokesForPage(
                      flipSession?.mode === 'single' ? flipSession.underPage : layout.leftPage,
                    )}
                    draftStrokes={
                      flipSession
                        ? undefined
                        : getDraftsForPage(layout.leftPage)
                    }
                    hideInk={false}
                    renderScale={1}
                    className="rounded-lg"
                  />
                  <div
                    className={`absolute inset-0 rounded-lg pointer-events-none ${
                      bindingDirection === 'ltr' ? 'spine-shadow-right' : 'spine-shadow-left'
                    }`}
                  />
                  {flipSession?.mode === 'single' && (
                    <div
                      ref={underShadowRef}
                      className="absolute inset-0 rounded-lg bg-black pointer-events-none"
                      style={{ opacity: 0 }}
                    />
                  )}
                </div>

                {/* Turning leaf (Edge Axis) */}
                {flipSession?.mode === 'single' && (
                  <div
                    ref={leafRef}
                    className="absolute inset-0 preserve-3d pointer-events-none z-20 rounded-lg"
                    style={{
                      transformOrigin:
                        flipSession.hingeSide === 'left' ? 'left center' : 'right center',
                    }}
                  >
                    <div className="absolute inset-0 backface-hidden overflow-hidden rounded-lg shadow-xl">
                      <PageSurface
                        pageNumber={flipSession.leafPage}
                        pdfManager={pdfManager}
                        width={scaledPageW}
                        height={scaledPageH}
                        strokes={getStrokesForPage(flipSession.leafPage)}
                        hideInk={false}
                        renderScale={1}
                        className="rounded-lg"
                      />
                      <div
                        className={`absolute inset-0 rounded-lg pointer-events-none ${
                          flipSession.hingeSide === 'left' ? 'spine-shadow-right' : 'spine-shadow-left'
                        }`}
                      />
                      <div
                        ref={frontShadeRef}
                        className="absolute inset-0 rounded-lg bg-slate-900 pointer-events-none"
                        style={{ opacity: 0 }}
                      />
                    </div>
                    <div
                      className="absolute inset-0 backface-hidden rounded-lg bg-stone-100 border border-stone-200"
                      style={{ transform: 'rotateY(180deg)' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </div>

        {/* Live screen-space circular eraser outline (dual-contrast ring for white paper & dark ink) */}
        <div
          ref={eraserCursorRef}
          aria-hidden="true"
          className="absolute top-0 left-0 z-[25] rounded-full pointer-events-none will-change-transform"
          style={{
            width: eraserDiameterPx,
            height: eraserDiameterPx,
            opacity: 0,
            border: '1.5px solid rgba(24, 24, 27, 0.82)',
            boxShadow: '0 0 0 1.5px rgba(255, 255, 255, 0.92), 0 1px 4px rgba(15, 23, 42, 0.22)',
            backgroundColor: 'rgba(24, 24, 27, 0.05)',
          }}
        />
      </div>
    );
  },
);
