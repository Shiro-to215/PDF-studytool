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
import type { PageStrokes, Stroke } from '../../types/models';
import { createId, savePageStrokes } from '../../db/database';
import { getIdealRenderWidth, PdfDocumentManager } from '../../utils/pdfEngine';
import { isPointNearStroke } from '../../utils/strokeRenderer';
import {
  getNextSpreadPage,
  getPrevSpreadPage,
  getSpreadLayout,
  useViewerStore,
} from '../../stores/useViewerStore';
import {
  SIZE_OPTIONS,
  useToolStore,
} from '../../stores/useToolStore';
import { useBookGestures, type DrawMoveSample } from '../../hooks/useBookGestures';
import { PageSurface } from './PageSurface';

export interface FlipBookViewerHandle {
  flipNext: () => void;
  flipPrev: () => void;
  undo: () => void;
  redo: () => void;
}

interface FlipBookViewerProps {
  workbookId: string;
  pdfManager: PdfDocumentManager | null;
  aspectRatio: number;
  layers: string[];
  allPageStrokes: PageStrokes[];
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
  function FlipBookViewer({ workbookId, pdfManager, aspectRatio, layers, allPageStrokes }, ref) {
    const stageRef = useRef<HTMLDivElement | null>(null);
    const zoomWrapperRef = useRef<HTMLDivElement | null>(null);
    const bookRef = useRef<HTMLDivElement | null>(null);
    const leafRef = useRef<HTMLDivElement | null>(null);
    const frontLeafRef = useRef<HTMLDivElement | null>(null);
    const backLeafRef = useRef<HTMLDivElement | null>(null);
    const frontShadeRef = useRef<HTMLDivElement | null>(null);
    const backShadeRef = useRef<HTMLDivElement | null>(null);
    const underShadowRef = useRef<HTMLDivElement | null>(null);

    const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
    const [committedScale, setCommittedScale] = useState(1);

    const {
      currentPage,
      pageCount,
      spreadMode,
      bindingDirection,
      coverSinglePage,
      zoomResetSeq,
      setCurrentPage,
      setZoomPan,
      setSelectedSpreadSide,
    } = useViewerStore();

    const {
      interactionMode,
      tool,
      penColor,
      markerColor,
      sizeIndex,
      activeLayer,
      hiddenLayers,
      allInkHidden,
      pushHistory,
      popUndo,
      popRedo,
    } = useToolStore();

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

    // Compute exact page dimensions fitting neatly inside the stage
    const { pageW, pageH, bookW, bookH } = useMemo(() => {
      const padX = stageSize.width < 640 ? 16 : 48;
      const padY = stageSize.height < 520 ? 16 : 40;
      const availW = Math.max(240, stageSize.width - padX);
      const availH = Math.max(240, stageSize.height - padY);
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
    }, [stageSize, aspectRatio, spreadMode]);

    // ===== Native-feel GPU Zoom & Pan Controller =====
    const liveZoomRef = useRef({ scale: 1, panX: 0, panY: 0 });
    const zoomAnimRef = useRef<number | null>(null);
    const wheelSettleTimerRef = useRef<number | null>(null);

    const stopZoomAnimation = useCallback(() => {
      if (zoomAnimRef.current !== null) {
        cancelAnimationFrame(zoomAnimRef.current);
        zoomAnimRef.current = null;
      }
    }, []);

    // Quantize PDF backing-store re-renders to 0.5x steps so pure panning never triggers heavy canvas redraws
    const quantizeCommittedScale = (s: number) =>
      s <= 1.02 ? 1 : Math.min(2.2, Math.round(s * 2) / 2);

    const clampZoomPan = useCallback(
      (s: number, px: number, py: number, rubberBand: boolean) => {
        const minS = rubberBand ? 0.85 : 1;
        const maxS = rubberBand ? 3.8 : 3.5;
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
        const marginX = Math.min(96, stageSize.width * 0.12) * ramp;
        const marginY = Math.min(96, stageSize.height * 0.12) * ramp;

        const maxPanX = Math.max(0, (bookW * clampedS - stageSize.width) / 2 + marginX);
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
      [bookW, bookH, stageSize.width, stageSize.height],
    );

    const applyZoomDom = useCallback(
      (s: number, px: number, py: number) => {
        liveZoomRef.current = { scale: s, panX: px, panY: py };
        const el = zoomWrapperRef.current;
        if (el) {
          el.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
          el.style.cursor =
            interactionMode === 'draw' ? 'crosshair' : s > 1.02 ? 'grab' : 'default';
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
      [stopZoomAnimation, applyZoomDom, setZoomPan],
    );

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
      (nextS: number, nextX: number, nextY: number) => {
        stopZoomAnimation();
        const clamped = clampZoomPan(nextS, nextX, nextY, true);
        applyZoomDom(clamped.scale, clamped.panX, clamped.panY);
      },
      [stopZoomAnimation, clampZoomPan, applyZoomDom],
    );

    const handleZoomPanEnd = useCallback(() => {
      const cur = liveZoomRef.current;
      // Snap smoothly back to 100% if close to or below 1.04x
      if (cur.scale < 1.04) {
        animateZoomTo(1, 0, 0, 240);
        return;
      }
      const clamped = clampZoomPan(cur.scale, cur.panX, cur.panY, false);
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
        const midOffX = clientX - (rect.left + rect.width / 2);
        const midOffY = clientY - (rect.top + rect.height / 2);

        const cur = liveZoomRef.current;
        const nextS = Math.max(0.92, Math.min(3.5, cur.scale * factor));
        const ratio = nextS / cur.scale;
        const nextX = midOffX - ratio * (midOffX - cur.panX);
        const nextY = midOffY - ratio * (midOffY - cur.panY);

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

    // Prefetch surrounding PDF pages using the exact same ideal resolution as PageSurface
    useEffect(() => {
      if (!pdfManager) return;
      pdfManager.prefetchAround(currentPage, getIdealRenderWidth(pageW, 1));
    }, [pdfManager, currentPage, pageW]);

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

    // Build visible strokes lookup by pageNumber (preferring optimistic cache over DB)
    const visibleStrokesByPage = useMemo(() => {
      const map = new Map<number, Stroke[]>();
      if (allInkHidden) return map;

      const dbByKey = new Map<string, Stroke[]>();
      const allPages = new Set<number>();
      for (const rec of allPageStrokes) {
        dbByKey.set(`${rec.pageNumber}:${rec.layerName}`, rec.strokes);
        allPages.add(rec.pageNumber);
      }
      for (const key of Object.keys(optimisticStrokes)) {
        const sep = key.indexOf(':');
        if (sep > 0) {
          const p = Number(key.slice(0, sep));
          if (Number.isFinite(p)) allPages.add(p);
        }
      }

      const visibleOrder = layers.filter((l) => !hiddenLayers.includes(l));
      for (const pageNum of allPages) {
        const merged: Stroke[] = [];
        for (const layerName of visibleOrder) {
          const key = `${pageNum}:${layerName}`;
          const list = key in optimisticStrokes ? optimisticStrokes[key] : dbByKey.get(key);
          if (list && list.length > 0) {
            merged.push(...list);
          }
        }
        if (merged.length > 0) {
          map.set(pageNum, merged);
        }
      }
      return map;
    }, [allPageStrokes, optimisticStrokes, layers, hiddenLayers, allInkHidden]);

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

    // ===== Ink Drawing State =====
    const [draftStroke, setDraftStroke] = useState<{
      pageNumber: number;
      stroke: Stroke;
    } | null>(null);
    const activeDrawPageRef = useRef<number | null>(null);
    const draftStrokeRef = useRef<Stroke | null>(null);
    const eraserWorkingRef = useRef<{
      pageNumber: number;
      initialStrokes: Stroke[];
      currentStrokes: Stroke[];
      changed: boolean;
    } | null>(null);

    const resolveBookPoint = useCallback(
      (clientX: number, clientY: number): { pageNumber: number; nx: number; ny: number } | null => {
        const el = bookRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;

        const relX = (clientX - rect.left) / rect.width;
        const relY = (clientY - rect.top) / rect.height;
        if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;

        if (spreadMode === 'single') {
          if (layout.leftPage === null) return null;
          return {
            pageNumber: layout.leftPage,
            nx: Math.max(0, Math.min(1, relX)),
            ny: Math.max(0, Math.min(1, relY)),
          };
        }

        const isLeftHalf = relX < 0.5;
        const targetPage = isLeftHalf ? layout.leftPage : layout.rightPage;
        if (targetPage === null) return null;

        return {
          pageNumber: targetPage,
          nx: Math.max(0, Math.min(1, isLeftHalf ? relX * 2 : (relX - 0.5) * 2)),
          ny: Math.max(0, Math.min(1, relY)),
        };
      },
      [spreadMode, layout],
    );

    const handleDrawStart = useCallback(
      (clientX: number, clientY: number, pressure: number): boolean => {
        if (flipSessionRef.current) return false;
        const pt = resolveBookPoint(clientX, clientY);
        if (!pt) return false;

        // Sync active sidebar side only if it actually changed
        if (spreadMode === 'double') {
          const nextSide = layout.leftPage === pt.pageNumber ? 'left' : 'right';
          if (useViewerStore.getState().selectedSpreadSide !== nextSide) {
            setSelectedSpreadSide(nextSide);
          }
        }

        if (tool === 'eraser') {
          const initial = getLayerStrokes(pt.pageNumber, activeLayer);
          const filtered = initial.filter((s) => !isPointNearStroke(pt.nx, pt.ny, s));
          const changed = filtered.length !== initial.length;
          eraserWorkingRef.current = {
            pageNumber: pt.pageNumber,
            initialStrokes: initial,
            currentStrokes: filtered,
            changed,
          };
          if (changed) {
            commitLayerStrokes(pt.pageNumber, activeLayer, filtered);
          }
          return true;
        }

        const sizeSpec = SIZE_OPTIONS[sizeIndex];
        const newStroke: Stroke = {
          id: createId(),
          tool: tool === 'marker' ? 'marker' : 'pen',
          color: tool === 'marker' ? markerColor : penColor,
          size: tool === 'marker' ? sizeSpec.marker : sizeSpec.pen,
          points: [[pt.nx, pt.ny, pressure || 0.5]],
        };

        activeDrawPageRef.current = pt.pageNumber;
        draftStrokeRef.current = newStroke;
        setDraftStroke({ pageNumber: pt.pageNumber, stroke: newStroke });
        return true;
      },
      [
        resolveBookPoint,
        spreadMode,
        setSelectedSpreadSide,
        layout.leftPage,
        tool,
        getLayerStrokes,
        activeLayer,
        commitLayerStrokes,
        sizeIndex,
        markerColor,
        penColor,
      ],
    );

    const handleDrawMovePoints = useCallback(
      (samples: DrawMoveSample[]) => {
        if (samples.length === 0) return;

        if (tool === 'eraser') {
          const work = eraserWorkingRef.current;
          if (!work) return;
          let working = work.currentStrokes;
          let erasedAny = false;
          for (const sample of samples) {
            const pt = resolveBookPoint(sample.clientX, sample.clientY);
            if (!pt || pt.pageNumber !== work.pageNumber) continue;
            const nextFiltered = working.filter((s) => !isPointNearStroke(pt.nx, pt.ny, s));
            if (nextFiltered.length !== working.length) {
              working = nextFiltered;
              erasedAny = true;
            }
          }
          if (erasedAny) {
            work.currentStrokes = working;
            work.changed = true;
            commitLayerStrokes(work.pageNumber, activeLayer, working);
          }
          return;
        }

        const pageNum = activeDrawPageRef.current;
        const current = draftStrokeRef.current;
        if (pageNum === null || !current) return;

        const appended: [number, number, number][] = [];
        let lastPt = current.points[current.points.length - 1];

        for (const sample of samples) {
          const pt = resolveBookPoint(sample.clientX, sample.clientY);
          if (!pt || pt.pageNumber !== pageNum) continue;
          if (lastPt) {
            const dist = Math.hypot(pt.nx - lastPt[0], pt.ny - lastPt[1]);
            if (dist < 0.0008) continue;
          }
          const nextPt: [number, number, number] = [pt.nx, pt.ny, sample.pressure || 0.5];
          appended.push(nextPt);
          lastPt = nextPt;
        }

        if (appended.length === 0) return;

        const updated: Stroke = {
          ...current,
          points: [...current.points, ...appended],
        };
        draftStrokeRef.current = updated;
        setDraftStroke({ pageNumber: pageNum, stroke: updated });
      },
      [resolveBookPoint, tool, commitLayerStrokes, activeLayer],
    );

    const handleDrawEnd = useCallback(() => {
      if (tool === 'eraser') {
        const work = eraserWorkingRef.current;
        eraserWorkingRef.current = null;
        if (work && work.changed) {
          const key = `${workbookId}:${work.pageNumber}:${activeLayer}`;
          pushHistory(key, work.initialStrokes);
        }
        return;
      }

      const pageNum = activeDrawPageRef.current;
      const finished = draftStrokeRef.current;
      activeDrawPageRef.current = null;
      draftStrokeRef.current = null;

      if (pageNum !== null && finished) {
        const existing = getLayerStrokes(pageNum, activeLayer);
        const key = `${workbookId}:${pageNum}:${activeLayer}`;
        pushHistory(key, existing);
        commitLayerStrokes(pageNum, activeLayer, [...existing, finished]);
      }
      setDraftStroke(null);
    }, [tool, workbookId, activeLayer, pushHistory, getLayerStrokes, commitLayerStrokes]);

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

    // ===== Undo / Redo =====
    const getTargetPageForHistory = useCallback((): number => {
      if (spreadMode === 'single') return layout.leftPage ?? currentPage;
      const side = useViewerStore.getState().selectedSpreadSide;
      if (side === 'left') return layout.leftPage ?? layout.rightPage ?? currentPage;
      return layout.rightPage ?? layout.leftPage ?? currentPage;
    }, [spreadMode, layout, currentPage]);

    const handleUndo = useCallback(() => {
      const targetPage = getTargetPageForHistory();
      const key = `${workbookId}:${targetPage}:${activeLayer}`;
      const current = getLayerStrokes(targetPage, activeLayer);
      const prev = popUndo(key, current);
      if (prev !== null) {
        commitLayerStrokes(targetPage, activeLayer, prev);
      }
    }, [getTargetPageForHistory, workbookId, activeLayer, getLayerStrokes, popUndo, commitLayerStrokes]);

    const handleRedo = useCallback(() => {
      const targetPage = getTargetPageForHistory();
      const key = `${workbookId}:${targetPage}:${activeLayer}`;
      const current = getLayerStrokes(targetPage, activeLayer);
      const next = popRedo(key, current);
      if (next !== null) {
        commitLayerStrokes(targetPage, activeLayer, next);
      }
    }, [getTargetPageForHistory, workbookId, activeLayer, getLayerStrokes, popRedo, commitLayerStrokes]);

    useImperativeHandle(
      ref,
      () => ({
        flipNext: () => triggerProgrammaticFlip('next'),
        flipPrev: () => triggerProgrammaticFlip('prev'),
        undo: handleUndo,
        redo: handleRedo,
      }),
      [triggerProgrammaticFlip, handleUndo, handleRedo],
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
    });

    const getStrokesForPage = (p: number | null) =>
      p !== null ? visibleStrokesByPage.get(p) ?? [] : [];

    const getDraftForPage = (p: number | null) =>
      p !== null && draftStroke?.pageNumber === p ? draftStroke.stroke : null;

    const leftArrowIsPrev = bindingDirection === 'ltr';
    const canGoLeft = leftArrowIsPrev ? prevTargetPage !== null : nextTargetPage !== null;
    const canGoRight = leftArrowIsPrev ? nextTargetPage !== null : prevTargetPage !== null;

    return (
      <div
        ref={stageRef}
        className="relative flex-1 h-full flex items-center justify-center overflow-hidden bg-base-200 select-none"
        style={{ touchAction: 'none' }}
        {...gestureHandlers}
      >
        {/* Subtle edge page-turn buttons */}
        {canGoLeft && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => triggerProgrammaticFlip(leftArrowIsPrev ? 'prev' : 'next')}
            aria-label={leftArrowIsPrev ? '前のページ' : '次のページ'}
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-30 btn btn-circle btn-sm bg-base-100/90 border border-base-300 shadow-sm hover:bg-base-100 text-base-content/70"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        {canGoRight && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => triggerProgrammaticFlip(leftArrowIsPrev ? 'next' : 'prev')}
            aria-label={leftArrowIsPrev ? '次のページ' : '前のページ'}
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-30 btn btn-circle btn-sm bg-base-100/90 border border-base-300 shadow-sm hover:bg-base-100 text-base-content/70"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Zoom / Pan wrapper (transform managed imperatively for 60/120fps) */}
        <div
          ref={zoomWrapperRef}
          className="book-perspective flex items-center justify-center will-change-transform"
          style={{
            transformOrigin: 'center center',
          }}
        >
          <div
            ref={bookRef}
            className="relative preserve-3d rounded-lg shadow-[0_14px_40px_-14px_rgba(15,23,42,0.22)] ring-1 ring-black/8 dark:ring-white/10"
            style={{ width: bookW, height: bookH }}
          >
            {/* === DOUBLE SPREAD MODE === */}
            {spreadMode === 'double' && (
              <div className="relative w-full h-full flex preserve-3d">
                {/* Left static page */}
                <div className="relative rounded-l-lg overflow-hidden border-r border-black/10" style={{ width: pageW, height: pageH }}>
                  <PageSurface
                    pageNumber={
                      flipSession?.mode === 'double'
                        ? flipSession.staticLeft
                        : layout.leftPage
                    }
                    pdfManager={pdfManager}
                    width={pageW}
                    height={pageH}
                    strokes={getStrokesForPage(
                      flipSession?.mode === 'double' ? flipSession.staticLeft : layout.leftPage,
                    )}
                    draftStroke={
                      flipSession
                        ? null
                        : getDraftForPage(layout.leftPage)
                    }
                    hideInk={allInkHidden}
                    renderScale={committedScale}
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
                <div className="relative rounded-r-lg overflow-hidden" style={{ width: pageW, height: pageH }}>
                  <PageSurface
                    pageNumber={
                      flipSession?.mode === 'double'
                        ? flipSession.staticRight
                        : layout.rightPage
                    }
                    pdfManager={pdfManager}
                    width={pageW}
                    height={pageH}
                    strokes={getStrokesForPage(
                      flipSession?.mode === 'double' ? flipSession.staticRight : layout.rightPage,
                    )}
                    draftStroke={
                      flipSession
                        ? null
                        : getDraftForPage(layout.rightPage)
                    }
                    hideInk={allInkHidden}
                    renderScale={committedScale}
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
                        width: pageW,
                        height: pageH,
                        left: flipSession.leafSide === 'right' ? pageW : 0,
                        transformOrigin:
                          flipSession.leafSide === 'right' ? 'left center' : 'right center',
                      }}
                    >
                      <PageSurface
                        pageNumber={flipSession.leafFront}
                        pdfManager={pdfManager}
                        width={pageW}
                        height={pageH}
                        strokes={getStrokesForPage(flipSession.leafFront)}
                        hideInk={allInkHidden}
                        renderScale={committedScale}
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
                        width: pageW,
                        height: pageH,
                        left: flipSession.leafSide === 'right' ? 0 : pageW,
                        transformOrigin:
                          flipSession.leafSide === 'right' ? 'right center' : 'left center',
                        display: 'none',
                      }}
                    >
                      <PageSurface
                        pageNumber={flipSession.leafBack}
                        pdfManager={pdfManager}
                        width={pageW}
                        height={pageH}
                        strokes={getStrokesForPage(flipSession.leafBack)}
                        hideInk={allInkHidden}
                        renderScale={committedScale}
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
              <div className="relative w-full h-full preserve-3d rounded-lg">
                {/* Underlying static page */}
                <div className="relative w-full h-full rounded-lg overflow-hidden">
                  <PageSurface
                    pageNumber={
                      flipSession?.mode === 'single'
                        ? flipSession.underPage
                        : layout.leftPage
                    }
                    pdfManager={pdfManager}
                    width={pageW}
                    height={pageH}
                    strokes={getStrokesForPage(
                      flipSession?.mode === 'single' ? flipSession.underPage : layout.leftPage,
                    )}
                    draftStroke={
                      flipSession
                        ? null
                        : getDraftForPage(layout.leftPage)
                    }
                    hideInk={allInkHidden}
                    renderScale={committedScale}
                  />
                  <div
                    className={`absolute inset-0 pointer-events-none ${
                      bindingDirection === 'ltr' ? 'spine-shadow-right' : 'spine-shadow-left'
                    }`}
                  />
                  {flipSession?.mode === 'single' && (
                    <div
                      ref={underShadowRef}
                      className="absolute inset-0 bg-black pointer-events-none"
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
                        width={pageW}
                        height={pageH}
                        strokes={getStrokesForPage(flipSession.leafPage)}
                        hideInk={allInkHidden}
                        renderScale={committedScale}
                      />
                      <div
                        className={`absolute inset-0 pointer-events-none ${
                          flipSession.hingeSide === 'left' ? 'spine-shadow-right' : 'spine-shadow-left'
                        }`}
                      />
                      <div
                        ref={frontShadeRef}
                        className="absolute inset-0 bg-slate-900 pointer-events-none"
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
    );
  },
);
