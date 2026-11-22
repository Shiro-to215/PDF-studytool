import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  BookOpen,
  Eraser,
  GripHorizontal,
  GripVertical,
  Highlighter,
  Minimize2,
  Pen,
  Redo2,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import {
  MARKER_COLOR_OPTIONS,
  PEN_COLOR_OPTIONS,
  SIZE_OPTIONS,
  useToolStore,
} from '../../stores/useToolStore';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';

type DockEdge = 'bottom' | 'top' | 'left' | 'right';
type CornerPos = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type SnapTarget =
  | { kind: 'edge'; edge: DockEdge }
  | { kind: 'corner'; corner: CornerPos };

interface PaletteState {
  collapsed: boolean;
  dock: DockEdge;
  corner: CornerPos;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  leftInBounds: number;
  topInBounds: number;
  elW: number;
  elH: number;
  moved: boolean;
  preview: SnapTarget | null;
}

const PALETTE_STORAGE_KEY = 'paperwork-palette-state';

function loadPaletteState(): PaletteState {
  if (typeof window === 'undefined') {
    return { collapsed: false, dock: 'bottom', corner: 'bottom-right' };
  }
  try {
    const raw = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PaletteState>;
      const validDocks: DockEdge[] = ['bottom', 'top', 'left', 'right'];
      const validCorners: CornerPos[] = [
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ];
      return {
        collapsed: Boolean(parsed.collapsed),
        dock: validDocks.includes(parsed.dock as DockEdge)
          ? (parsed.dock as DockEdge)
          : 'bottom',
        corner: validCorners.includes(parsed.corner as CornerPos)
          ? (parsed.corner as CornerPos)
          : 'bottom-right',
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return { collapsed: false, dock: 'bottom', corner: 'bottom-right' };
}

function getCornerForDock(dock: DockEdge, prevCorner: CornerPos): CornerPos {
  const vSide: 'top' | 'bottom' = prevCorner.startsWith('top') ? 'top' : 'bottom';
  const hSide: 'left' | 'right' = prevCorner.endsWith('left') ? 'left' : 'right';

  switch (dock) {
    case 'top':
      return `top-${hSide}`;
    case 'bottom':
      return `bottom-${hSide}`;
    case 'left':
      return `${vSide}-left`;
    case 'right':
      return `${vSide}-right`;
  }
}

function getExpandDockForCorner(corner: CornerPos, lastDock: DockEdge): DockEdge {
  if (corner === 'top-left' && (lastDock === 'top' || lastDock === 'left')) return lastDock;
  if (corner === 'top-right' && (lastDock === 'top' || lastDock === 'right')) return lastDock;
  if (corner === 'bottom-left' && (lastDock === 'bottom' || lastDock === 'left')) return lastDock;
  if (corner === 'bottom-right' && (lastDock === 'bottom' || lastDock === 'right')) return lastDock;
  return corner.startsWith('top') ? 'top' : 'bottom';
}

function resolveSnapTarget(
  dragLeft: number,
  dragTop: number,
  elW: number,
  elH: number,
  boundsRect: DOMRect,
): SnapTarget {
  // Use the palette's position within its available travel range (center & outer bounds),
  // so grabbing an edge handle never requires dragging farther than grabbing the center.
  const availW = boundsRect.width - elW;
  const availH = boundsRect.height - elH;

  const normX =
    availW > 24
      ? Math.max(0, Math.min(1, dragLeft / availW))
      : Math.max(0, Math.min(1, (dragLeft + elW / 2) / Math.max(1, boundsRect.width)));
  const normY =
    availH > 24
      ? Math.max(0, Math.min(1, dragTop / availH))
      : Math.max(0, Math.min(1, (dragTop + elH / 2) / Math.max(1, boundsRect.height)));

  const nearLeft = normX < 0.16;
  const nearRight = normX > 0.84;
  const nearTop = normY < 0.16;
  const nearBottom = normY > 0.84;

  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    const corner: CornerPos = nearTop
      ? nearLeft
        ? 'top-left'
        : 'top-right'
      : nearLeft
        ? 'bottom-left'
        : 'bottom-right';
    return { kind: 'corner', corner };
  }

  const dists: Array<{ edge: DockEdge; d: number }> = [
    { edge: 'top', d: normY },
    { edge: 'bottom', d: 1 - normY },
    { edge: 'left', d: normX },
    { edge: 'right', d: 1 - normX },
  ];
  dists.sort((a, b) => a.d - b.d);
  return { kind: 'edge', edge: dists[0].edge };
}

function computeTargetPosition(
  target: SnapTarget,
  elW: number,
  elH: number,
  boundsW: number,
  boundsH: number,
  safeBottom: number,
): { x: number; y: number } {
  const margin = 14;
  const bottomMargin = 14 + safeBottom;

  let x = 0;
  let y = 0;

  if (target.kind === 'corner') {
    x = target.corner.endsWith('left') ? margin : boundsW - elW - margin;
    y = target.corner.startsWith('top') ? margin : boundsH - elH - bottomMargin;
  } else {
    switch (target.edge) {
      case 'top':
        x = (boundsW - elW) / 2;
        y = margin;
        break;
      case 'bottom':
        x = (boundsW - elW) / 2;
        y = boundsH - elH - bottomMargin;
        break;
      case 'left':
        x = margin;
        y = (boundsH - elH) / 2;
        break;
      case 'right':
        x = boundsW - elW - margin;
        y = (boundsH - elH) / 2;
        break;
    }
  }

  const maxX = Math.max(8, boundsW - elW - 8);
  const maxY = Math.max(8, boundsH - elH - 8);
  return {
    x: Math.max(8, Math.min(maxX, x)),
    y: Math.max(8, Math.min(maxY, y)),
  };
}

interface FloatingToolPaletteProps {
  workbookId: string;
  boundsRef: RefObject<HTMLElement | null>;
  onUndo: () => void;
  onRedo: () => void;
}

export function FloatingToolPalette({
  workbookId,
  boundsRef,
  onUndo,
  onRedo,
}: FloatingToolPaletteProps) {
  const {
    interactionMode,
    tool,
    penColor,
    markerColor,
    penSizeIndex,
    markerSizeIndex,
    activeLayer,
    canUndo,
    canRedo,
    setInteractionMode,
    setTool,
    setPenColor,
    setMarkerColor,
    setPenSizeIndex,
    setMarkerSizeIndex,
  } = useToolStore();

  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    scale,
    resetZoom,
  } = useViewerStore();

  const [paletteState, setPaletteState] = useState<PaletteState>(loadPaletteState);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragEndNonce, setDragEndNonce] = useState(0);
  const [boundsSize, setBoundsSize] = useState({ w: 800, h: 600 });
  const [sizePopover, setSizePopover] = useState<{
    tool: 'pen' | 'marker';
    anchorX: number;
    anchorY: number;
    dock: DockEdge;
  } | null>(null);

  const paletteElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const penBtnRef = useRef<HTMLButtonElement | null>(null);
  const markerBtnRef = useRef<HTMLButtonElement | null>(null);
  const sizePopoverRef = useRef<HTMLDivElement | null>(null);
  const safeBottomRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;
  const paletteStateRef = useRef<PaletteState>(paletteState);
  paletteStateRef.current = paletteState;
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const activeAnimsRef = useRef<Animation[]>([]);
  const flipOriginRef = useRef<{
    cx: number;
    cy: number;
    w: number;
    h: number;
    wasCollapsed: boolean;
    wasVertical: boolean;
  } | null>(null);

  const clearMorphStyles = () => {
    for (const anim of activeAnimsRef.current) {
      try {
        anim.cancel();
      } catch {
        // Ignore
      }
    }
    activeAnimsRef.current = [];
    const el = paletteElRef.current;
    if (el) {
      el.style.width = '';
      el.style.height = '';
      el.style.overflow = '';
      el.style.maxWidth = '';
      el.style.maxHeight = '';
    }
    const content = contentElRef.current;
    if (content) {
      content.style.flexShrink = '';
    }
  };

  useEffect(() => {
    return () => {
      for (const anim of activeAnimsRef.current) {
        try {
          anim.cancel();
        } catch {
          // Ignore
        }
      }
      activeAnimsRef.current = [];
    };
  }, []);

  // Auto-close thickness popover when tapping outside or starting to draw on the PDF
  useEffect(() => {
    if (!sizePopover) return;
    const handleOutside = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (sizePopoverRef.current?.contains(target)) return;
      if (penBtnRef.current?.contains(target) || markerBtnRef.current?.contains(target)) return;
      setSizePopover(null);
    };
    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('touchstart', handleOutside, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('touchstart', handleOutside, true);
    };
  }, [sizePopover]);

  useEffect(() => {
    setSizePopover(null);
  }, [boundsSize, paletteState]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(paletteState));
    } catch {
      // Ignore storage errors
    }
  }, [paletteState]);

  // Track container dimensions for accurate pixel-based snapping
  useEffect(() => {
    const el = boundsRef.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setBoundsSize({ w: r.width, h: r.height });
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [boundsRef]);

  const getSafeBottom = () =>
    safeBottomRef.current?.getBoundingClientRect().height ?? 0;

  const isDraggingMoved = Boolean(dragState?.moved);

  // Unified pixel positioning + smooth glide/unfold/liquid-morph animation on release/toggle
  useLayoutEffect(() => {
    const el = paletteElRef.current;
    const boundsEl = boundsRef.current;
    if (!el || !boundsEl) return;

    clearMorphStyles();

    if (isDraggingMoved && dragState) {
      const x = dragState.leftInBounds + (dragState.curX - dragState.startX);
      const y = dragState.topInBounds + (dragState.curY - dragState.startY);
      el.style.transition = 'none';
      el.style.opacity = '';
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      return;
    }

    const boundsRect = boundsEl.getBoundingClientRect();
    const elW = el.offsetWidth || el.getBoundingClientRect().width;
    const elH = el.offsetHeight || el.getBoundingClientRect().height;
    const target: SnapTarget = paletteState.collapsed
      ? { kind: 'corner', corner: paletteState.corner }
      : { kind: 'edge', edge: paletteState.dock };

    const { x: targetX, y: targetY } = computeTargetPosition(
      target,
      elW,
      elH,
      boundsRect.width,
      boundsRect.height,
      getSafeBottom(),
    );

    const origin = flipOriginRef.current;
    if (origin) {
      flipOriginRef.current = null;
      const isVert = paletteState.dock === 'left' || paletteState.dock === 'right';
      const isExpand = origin.wasCollapsed && !paletteState.collapsed;
      const isCollapse =
        !origin.wasCollapsed && paletteState.collapsed && typeof el.animate === 'function';
      const isOrientationMorph =
        !origin.wasCollapsed &&
        !paletteState.collapsed &&
        origin.wasVertical !== isVert &&
        typeof el.animate === 'function';

      const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

      if (isOrientationMorph) {
        // Ease-out water-like liquid morph when moving directly between vertical <-> horizontal
        const startCX = origin.cx - boundsRect.left;
        const startCY = origin.cy - boundsRect.top;
        const endCX = targetX + elW / 2;
        const endCY = targetY + elH / 2;
        const startW = origin.w;
        const startH = origin.h;
        const endW = elW;
        const endH = elH;
        const wShrinking = startW > endW;
        const hShrinking = startH > endH;

        const STEPS = 20;
        const shellKeyframes: Keyframe[] = [];
        for (let i = 0; i <= STEPS; i++) {
          const u = i / STEPS;
          // Smooth, slightly gentler ease-out deceleration
          const posT = 1 - Math.pow(1 - u, 3.1);

          const liquidWave = Math.pow(u, 2) * Math.sin(u * Math.PI * 2 - Math.PI);
          const shrinkT = 1 - Math.pow(1 - u, 3.9) + 0.004 * liquidWave;
          const growT = 1 - Math.pow(1 - u, 2.6) + 0.014 * liquidWave;

          const wt = wShrinking ? shrinkT : growT;
          const ht = hShrinking ? shrinkT : growT;

          const curW = Math.max(44, startW + (endW - startW) * wt);
          const curH = Math.max(44, startH + (endH - startH) * ht);
          const curCX = startCX + (endCX - startCX) * posT;
          const curCY = startCY + (endCY - startCY) * posT;

          let curX = curCX - curW / 2;
          let curY = curCY - curH / 2;
          if (i > 0 && i < STEPS) {
            curX = Math.max(6, Math.min(boundsRect.width - curW - 6, curX));
            curY = Math.max(6, Math.min(boundsRect.height - curH - 6, curY));
          }

          shellKeyframes.push({
            offset: u,
            width: `${curW.toFixed(1)}px`,
            height: `${curH.toFixed(1)}px`,
            transform: `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0)`,
          });
        }

        el.style.transition = 'none';
        el.style.opacity = '';
        el.style.overflow = 'hidden';
        el.style.maxWidth = 'none';
        el.style.maxHeight = 'none';
        el.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0)`;

        const content = contentElRef.current;
        if (content) {
          content.style.flexShrink = '0';
        }

        const shellAnim = el.animate(shellKeyframes, {
          duration: 400,
          easing: 'linear',
        });
        const anims: Animation[] = [shellAnim];

        if (content && typeof content.animate === 'function') {
          const contentAnim = content.animate(
            [
              { offset: 0, opacity: 0, transform: 'scale(0.9)' },
              { offset: 0.16, opacity: 0.2, transform: 'scale(0.94)' },
              { offset: 0.72, opacity: 0.96, transform: 'scale(1.006)' },
              { offset: 1, opacity: 1, transform: 'scale(1)' },
            ],
            {
              duration: 400,
              easing: EASE_OUT,
            },
          );
          anims.push(contentAnim);
        }

        activeAnimsRef.current = anims;
        shellAnim.onfinish = () => {
          if (activeAnimsRef.current.includes(shellAnim)) {
            clearMorphStyles();
          }
        };
      } else if (isCollapse) {
        // Smooth ease-out liquid shrink from horizontal/vertical bar into corner circle
        const startW = origin.w;
        const startH = origin.h;
        const startX = origin.cx - boundsRect.left - startW / 2;
        const startY = origin.cy - boundsRect.top - startH / 2;

        el.style.transition = 'none';
        el.style.opacity = '';
        el.style.overflow = 'hidden';
        el.style.maxWidth = 'none';
        el.style.maxHeight = 'none';
        el.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0)`;

        const shellAnim = el.animate(
          [
            {
              width: `${startW.toFixed(1)}px`,
              height: `${startH.toFixed(1)}px`,
              transform: `translate3d(${startX.toFixed(1)}px, ${startY.toFixed(1)}px, 0)`,
            },
            {
              width: `${elW.toFixed(1)}px`,
              height: `${elH.toFixed(1)}px`,
              transform: `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0)`,
            },
          ],
          {
            duration: 400,
            easing: EASE_OUT,
          },
        );
        const anims: Animation[] = [shellAnim];

        const content = contentElRef.current;
        if (content && typeof content.animate === 'function') {
          const contentAnim = content.animate(
            [
              { opacity: 0, transform: 'scale(0.72)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            {
              duration: 400,
              easing: EASE_OUT,
            },
          );
          anims.push(contentAnim);
        }

        activeAnimsRef.current = anims;
        shellAnim.onfinish = () => {
          if (activeAnimsRef.current.includes(shellAnim)) {
            clearMorphStyles();
          }
        };
      } else if (isExpand) {
        const sx = Math.max(isVert ? 0.85 : 0.16, Math.min(1, origin.w / Math.max(1, elW)));
        const sy = Math.max(isVert ? 0.16 : 0.85, Math.min(1, origin.h / Math.max(1, elH)));
        const visW = elW * sx;
        const visH = elH * sy;
        const halfWDiff = (elW - visW) / 2;
        const halfHDiff = (elH - visH) / 2;

        const minStartX = 8 - halfWDiff;
        const maxStartX = boundsRect.width - 8 - elW + halfWDiff;
        const minStartY = 8 - halfHDiff;
        const maxStartY = boundsRect.height - 8 - elH + halfHDiff;

        const startX = Math.max(
          minStartX,
          Math.min(maxStartX, origin.cx - boundsRect.left - elW / 2),
        );
        const startY = Math.max(
          minStartY,
          Math.min(maxStartY, origin.cy - boundsRect.top - elH / 2),
        );

        el.style.transition = 'none';
        el.style.opacity = '0.5';
        el.style.transform = `translate3d(${startX.toFixed(1)}px, ${startY.toFixed(1)}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        // Force layout flush so the collapsed corner frame is committed before unfolding
        void el.offsetWidth;

        el.style.transition = `transform 400ms ${EASE_OUT}, opacity 260ms ${EASE_OUT}`;
        el.style.opacity = '1';
        el.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0) scale(1, 1)`;
      } else {
        const startX = Math.max(
          0,
          Math.min(boundsRect.width - elW, origin.cx - boundsRect.left - elW / 2),
        );
        const startY = Math.max(
          0,
          Math.min(boundsRect.height - elH, origin.cy - boundsRect.top - elH / 2),
        );

        el.style.transition = 'none';
        el.style.opacity = '';
        el.style.transform = `translate3d(${startX.toFixed(1)}px, ${startY.toFixed(1)}px, 0)`;
        // Force layout flush so the starting frame is committed before gliding
        void el.offsetWidth;

        el.style.transition = `transform 400ms ${EASE_OUT}`;
        el.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0)`;
      }
    } else {
      el.style.transition = 'none';
      el.style.opacity = '';
      el.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0)`;
    }
  }, [paletteState, dragEndNonce, boundsSize, tool, isDraggingMoved, dragState, boundsRef]);

  const layout = getSpreadLayout(
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
  );
  const visiblePages =
    spreadMode === 'single'
      ? layout.leftPage !== null
        ? [layout.leftPage]
        : []
      : [layout.leftPage, layout.rightPage].filter((p): p is number => p !== null);

  const historyKey = `${workbookId}:${activeLayer}`;
  const undoEnabled = canUndo(historyKey, visiblePages);
  const redoEnabled = canRedo(historyKey, visiblePages);

  const colorList = tool === 'marker' ? MARKER_COLOR_OPTIONS : PEN_COLOR_OPTIONS;
  const activeColor = tool === 'marker' ? markerColor : penColor;

  // ===== Drag Handling (Freeform-style: grab anywhere on bar including buttons) =====
  const isDragActive = dragState !== null;

  const beginDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragStateRef.current) return;
    e.stopPropagation();

    const bounds = boundsRef.current?.getBoundingClientRect();
    const el = paletteElRef.current;
    const visualRect = el?.getBoundingClientRect();
    if (!bounds || !el || !visualRect) return;

    const startedOnButton = Boolean((e.target as HTMLElement | null)?.closest('button'));
    if (!startedOnButton) {
      setSizePopover(null);
    }

    const wasMorphing = activeAnimsRef.current.length > 0;
    clearMorphStyles();

    const realW = wasMorphing ? el.offsetWidth || visualRect.width : visualRect.width;
    const realH = wasMorphing ? el.offsetHeight || visualRect.height : visualRect.height;
    const leftInBounds = wasMorphing
      ? visualRect.left + visualRect.width / 2 - bounds.left - realW / 2
      : visualRect.left - bounds.left;
    const topInBounds = wasMorphing
      ? visualRect.top + visualRect.height / 2 - bounds.top - realH / 2
      : visualRect.top - bounds.top;

    // Defer setPointerCapture when starting on a button so short taps still trigger native click
    if (!startedOnButton) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }

    const nextDrag: DragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      leftInBounds,
      topInBounds,
      elW: realW,
      elH: realH,
      moved: false,
      preview: null,
    };
    dragStateRef.current = nextDrag;
    setDragState(nextDrag);
  };

  useEffect(() => {
    if (!isDragActive) return;

    const handleWindowMove = (e: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || current.pointerId !== e.pointerId) return;

      const bounds = boundsRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const dist = Math.hypot(e.clientX - current.startX, e.clientY - current.startY);
      const justStartedMoving = !current.moved && dist > 10;
      const moved = current.moved || justStartedMoving;

      if (justStartedMoving) {
        setSizePopover(null);
        suppressClickRef.current = true;
        try {
          paletteElRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }

      if (!moved) return;

      const dragLeft = current.leftInBounds + (e.clientX - current.startX);
      const dragTop = current.topInBounds + (e.clientY - current.startY);
      const preview = resolveSnapTarget(dragLeft, dragTop, current.elW, current.elH, bounds);

      const next: DragState = {
        ...current,
        curX: e.clientX,
        curY: e.clientY,
        moved: true,
        preview,
      };
      dragStateRef.current = next;
      setDragState(next);
    };

    const finishDrag = (e: PointerEvent, cancelled: boolean) => {
      const currentDrag = dragStateRef.current;
      if (!currentDrag || currentDrag.pointerId !== e.pointerId) return;

      const el = paletteElRef.current;
      try {
        if (el?.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }

      const curPalette = paletteStateRef.current;
      const r = el?.getBoundingClientRect();
      if (!cancelled && r && r.width > 0 && (currentDrag.moved || curPalette.collapsed)) {
        flipOriginRef.current = {
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
          w: r.width,
          h: r.height,
          wasCollapsed: curPalette.collapsed,
          wasVertical: curPalette.dock === 'left' || curPalette.dock === 'right',
        };
      }

      dragStateRef.current = null;
      setDragState(null);
      if (currentDrag.moved || curPalette.collapsed) {
        setDragEndNonce((n) => n + 1);
      }

      if (currentDrag.moved) {
        if (suppressClickTimerRef.current !== null) {
          window.clearTimeout(suppressClickTimerRef.current);
        }
        suppressClickTimerRef.current = window.setTimeout(() => {
          suppressClickRef.current = false;
          suppressClickTimerRef.current = null;
        }, 120);
      }

      if (cancelled) return;

      if (!currentDrag.moved) {
        if (curPalette.collapsed) {
          setPaletteState((prev) => ({
            ...prev,
            collapsed: false,
            dock: getExpandDockForCorner(prev.corner, prev.dock),
          }));
        }
        return;
      }

      if (currentDrag.preview) {
        if (currentDrag.preview.kind === 'corner') {
          const corner = currentDrag.preview.corner;
          setPaletteState((prev) => ({
            ...prev,
            collapsed: true,
            corner,
          }));
        } else {
          const edge = currentDrag.preview.edge;
          setPaletteState((prev) => ({
            ...prev,
            collapsed: false,
            dock: edge,
            corner: getCornerForDock(edge, prev.corner),
          }));
        }
      }
    };

    const onUp = (e: PointerEvent) => finishDrag(e, false);
    const onCancel = (e: PointerEvent) => finishDrag(e, true);

    window.addEventListener('pointermove', handleWindowMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', handleWindowMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [isDragActive, boundsRef]);

  const handlePaletteClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
      }
    }
  };

  const handleCollapseButton = () => {
    setSizePopover(null);
    const r = paletteElRef.current?.getBoundingClientRect();
    if (r && r.width > 0) {
      flipOriginRef.current = {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        w: r.width,
        h: r.height,
        wasCollapsed: paletteState.collapsed,
        wasVertical: paletteState.dock === 'left' || paletteState.dock === 'right',
      };
    }
    setPaletteState((prev) => ({
      ...prev,
      collapsed: true,
      corner: getCornerForDock(prev.dock, prev.corner),
    }));
  };

  const isVertical = paletteState.dock === 'left' || paletteState.dock === 'right';
  const expandDock = getExpandDockForCorner(paletteState.corner, paletteState.dock);
  // Rotate collapsed icon + color bar 90° toward screen center when expanding vertically (left/right)
  const collapsedIconDeg = expandDock === 'left' ? -90 : expandDock === 'right' ? 90 : 0;

  const zoomResetLeftOffset =
    paletteState.collapsed && paletteState.corner === 'bottom-left'
      ? 'left-[96px]'
      : 'left-3.5';

  const renderToolIcon = (sizeClass: string) => {
    if (tool === 'marker') return <Highlighter className={sizeClass} />;
    if (tool === 'eraser') return <Eraser className={sizeClass} />;
    return <Pen className={sizeClass} />;
  };

  const handleToolButtonClick = (
    nextTool: 'pen' | 'marker' | 'eraser',
    btnEl: HTMLButtonElement | null,
  ) => {
    if (nextTool === 'eraser') {
      setTool('eraser');
      setSizePopover(null);
      return;
    }

    // 1st tap: switch tool normally without opening popover
    if (tool !== nextTool) {
      setTool(nextTool);
      setSizePopover(null);
      return;
    }

    // 2nd tap on already-selected pen/marker: toggle Freeform-style thickness popover
    if (sizePopover?.tool === nextTool) {
      setSizePopover(null);
      return;
    }

    const boundsRect = boundsRef.current?.getBoundingClientRect();
    const paletteRect = paletteElRef.current?.getBoundingClientRect();
    const btnRect = btnEl?.getBoundingClientRect();
    if (!boundsRect || !paletteRect || !btnRect) return;

    const dock = paletteState.dock;
    const gap = 12;
    let anchorX = 0;
    let anchorY = 0;

    if (dock === 'bottom') {
      anchorX = Math.max(
        88,
        Math.min(boundsRect.width - 88, btnRect.left + btnRect.width / 2 - boundsRect.left),
      );
      anchorY = paletteRect.top - boundsRect.top - gap;
    } else if (dock === 'top') {
      anchorX = Math.max(
        88,
        Math.min(boundsRect.width - 88, btnRect.left + btnRect.width / 2 - boundsRect.left),
      );
      anchorY = paletteRect.bottom - boundsRect.top + gap;
    } else if (dock === 'left') {
      anchorX = paletteRect.right - boundsRect.left + gap;
      anchorY = Math.max(
        40,
        Math.min(boundsRect.height - 40, btnRect.top + btnRect.height / 2 - boundsRect.top),
      );
    } else {
      anchorX = paletteRect.left - boundsRect.left - gap;
      anchorY = Math.max(
        40,
        Math.min(boundsRect.height - 40, btnRect.top + btnRect.height / 2 - boundsRect.top),
      );
    }

    setSizePopover({ tool: nextTool, anchorX, anchorY, dock });
  };

  // Compute snap preview ghost coordinates in pixels (same transform system, zero conflict)
  const previewGhost = (() => {
    if (!isDraggingMoved || !dragState?.preview) return null;
    const p = dragState.preview;
    const gw =
      p.kind === 'corner'
        ? 72
        : p.edge === 'left' || p.edge === 'right'
          ? 92
          : Math.min(440, boundsSize.w - 32);
    const gh =
      p.kind === 'corner'
        ? 72
        : p.edge === 'left' || p.edge === 'right'
          ? Math.min(400, boundsSize.h - 32)
          : 66;
    const pos = computeTargetPosition(p, gw, gh, boundsSize.w, boundsSize.h, getSafeBottom());
    return { w: gw, h: gh, x: pos.x, y: pos.y };
  })();

  return (
    <>
      {/* Hidden probe to measure exact CSS env(safe-area-inset-bottom) in px */}
      <div
        ref={safeBottomRef}
        aria-hidden="true"
        className="fixed bottom-0 left-0 w-0 h-[env(safe-area-inset-bottom)] pointer-events-none opacity-0"
      />

      {/* Magnetic snap preview ghost while dragging */}
      {previewGhost && (
        <div
          className="absolute top-0 left-0 pointer-events-none z-20 rounded-full border-2 border-dashed border-primary/50 bg-primary/8 backdrop-blur-[2px] transition-all duration-300 ease-out"
          style={{
            width: previewGhost.w,
            height: previewGhost.h,
            transform: `translate3d(${previewGhost.x.toFixed(1)}px, ${previewGhost.y.toFixed(1)}px, 0)`,
          }}
        />
      )}

      {/* Standalone Zoom Reset Pill (bottom-left, Apple Freeform style) */}
      {scale > 1.02 && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={resetZoom}
          title="タップして100%に戻す"
          className={`absolute ${zoomResetLeftOffset} bottom-[calc(14px+env(safe-area-inset-bottom))] z-30 px-3.5 py-2.5 rounded-full bg-base-100/92 backdrop-blur-md border border-base-300 shadow-md flex items-center gap-2 text-sm font-mono text-base-content/85 hover:text-primary transition-all`}
        >
          <span>{Math.round(scale * 100)}%</span>
          <RotateCcw className="w-4 h-4 text-base-content/55" />
        </button>
      )}

      {/* Main Floating Palette (Collapsed Circle OR Docked Pill) */}
      {paletteState.collapsed ? (
        <div
          ref={paletteElRef}
          onPointerDown={beginDrag}
          onClickCapture={handlePaletteClickCapture}
          onTouchStart={(e) => e.stopPropagation()}
          style={{ touchAction: 'none', transformOrigin: 'center center' }}
          title="タップで展開 / ドラッグで移動"
          className={`absolute top-0 left-0 z-30 w-[72px] h-[72px] rounded-full bg-base-100/95 backdrop-blur-md border border-base-300 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing select-none will-change-transform ${
            isDraggingMoved ? 'ring-2 ring-primary/30' : ''
          }`}
        >
          <div ref={contentElRef} className="relative flex items-center justify-center shrink-0">
            <div
              className="relative flex items-center justify-center transition-transform duration-300 ease-out"
              style={{ transform: `rotate(${collapsedIconDeg}deg)` }}
            >
              {renderToolIcon('w-7 h-7 text-base-content/85')}
              {tool !== 'eraser' && (
                <span
                  className="absolute -bottom-3 left-1/2 w-6 h-[7px] rounded-full ring-1 ring-black/15"
                  style={{ backgroundColor: activeColor, transform: 'translateX(-50%)' }}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={paletteElRef}
          onPointerDown={beginDrag}
          onClickCapture={handlePaletteClickCapture}
          onTouchStart={(e) => e.stopPropagation()}
          style={{ touchAction: 'none', transformOrigin: 'center center' }}
          className={`absolute top-0 left-0 z-30 bg-base-100/95 backdrop-blur-md border border-base-300 shadow-lg rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none will-change-transform ${
            isDraggingMoved ? 'opacity-95 ring-2 ring-primary/30' : ''
          } ${
            isVertical
              ? 'max-h-[calc(100%-24px)]'
              : 'max-w-[calc(100%-24px)]'
          }`}
        >
          <div
            ref={contentElRef}
            style={{ touchAction: 'none' }}
            className={
              isVertical
                ? 'flex flex-col items-center gap-2.5 px-3 py-3.5 max-h-full overflow-y-auto thin-scrollbar'
                : 'flex flex-row items-center gap-2.5 px-4 py-2.5 max-w-full overflow-x-auto thin-scrollbar'
            }
          >
          {/* Drag Handle */}
          <div
            title="ドラッグして上下左右へ移動 / 四隅で格納"
            style={{ touchAction: 'none', transformOrigin: 'center center' }}
            className={`flex items-center justify-center text-base-content/40 hover:text-base-content/75 cursor-grab active:cursor-grabbing shrink-0 ${
              isVertical ? 'w-12 h-6' : 'w-6 h-11'
            }`}
          >
            {isVertical ? (
              <GripHorizontal className="w-[22px] h-[22px]" />
            ) : (
              <GripVertical className="w-[22px] h-[22px]" />
            )}
          </div>

          {/* Interaction Mode: Flip vs Draw (icon-only for compact horizontal fit) */}
          <div
            className={`flex p-1 rounded-full bg-base-200 border border-base-300 shrink-0 ${
              isVertical ? 'flex-col gap-1' : 'flex-row items-center gap-1'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setInteractionMode('flip');
                setSizePopover(null);
              }}
              title="めくり（Apple Pencilは常に書き込み可）"
              className={`rounded-full flex items-center justify-center transition-colors ${
                isVertical ? 'w-12 h-11' : 'w-11 h-11'
              } ${
                interactionMode === 'flip'
                  ? 'bg-base-100 text-base-content shadow-xs'
                  : 'text-base-content/55 hover:text-base-content'
              }`}
            >
              <BookOpen className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setInteractionMode('draw');
                setSizePopover(null);
              }}
              title="書く（指/マウスでも直接書き込み）"
              className={`rounded-full flex items-center justify-center transition-colors ${
                isVertical ? 'w-12 h-11' : 'w-11 h-11'
              } ${
                interactionMode === 'draw'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'text-base-content/55 hover:text-base-content'
              }`}
            >
              <Pen className="w-5 h-5" />
            </button>
          </div>

          <div
            className={
              isVertical ? 'h-px w-10 bg-base-300 my-0.5 shrink-0' : 'w-px h-7 bg-base-300 mx-0.5 shrink-0'
            }
          />

          {/* Drawing Tools (2nd tap on pen/marker opens thickness speech-bubble popover) */}
          <div
            className={`flex items-center gap-2 shrink-0 ${
              isVertical ? 'flex-col' : 'flex-row'
            }`}
          >
            <button
              ref={penBtnRef}
              type="button"
              onClick={() => handleToolButtonClick('pen', penBtnRef.current)}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                tool === 'pen'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'hover:bg-base-200 text-base-content/75'
              }`}
              title="ペン（もう一度タップで太さ調整）"
            >
              <Pen className="w-[22px] h-[22px]" />
            </button>
            <button
              ref={markerBtnRef}
              type="button"
              onClick={() => handleToolButtonClick('marker', markerBtnRef.current)}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                tool === 'marker'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'hover:bg-base-200 text-base-content/75'
              }`}
              title="蛍光マーカー（もう一度タップで太さ調整）"
            >
              <Highlighter className="w-[22px] h-[22px]" />
            </button>
            <button
              type="button"
              onClick={() => handleToolButtonClick('eraser', null)}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                tool === 'eraser'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'hover:bg-base-200 text-base-content/75'
              }`}
              title="消しゴム（ストローク単位）"
            >
              <Eraser className="w-[22px] h-[22px]" />
            </button>
          </div>

          {/* Color Swatches */}
          {tool !== 'eraser' && (
            <>
              <div
                className={
                  isVertical
                    ? 'h-px w-10 bg-base-300 my-0.5 shrink-0'
                    : 'w-px h-7 bg-base-300 mx-0.5 shrink-0'
                }
              />

              <div
                className={
                  isVertical
                    ? 'grid grid-cols-2 gap-2.5 px-0.5 shrink-0'
                    : 'flex items-center gap-2.5 px-1 shrink-0'
                }
              >
                {colorList.map((c) => {
                  const selected = activeColor === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      onClick={() => {
                        setSizePopover(null);
                        if (tool === 'marker') setMarkerColor(c.value);
                        else setPenColor(c.value);
                      }}
                      className={`w-7 h-7 rounded-full transition-transform border border-black/15 ${
                        selected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100 scale-110'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c.value }}
                    />
                  );
                })}
              </div>
            </>
          )}

          <div
            className={
              isVertical ? 'h-px w-10 bg-base-300 my-0.5 shrink-0' : 'w-px h-7 bg-base-300 mx-0.5 shrink-0'
            }
          />

          {/* Undo / Redo */}
          <div
            className={
              isVertical ? 'grid grid-cols-2 gap-1.5 shrink-0' : 'flex items-center gap-1.5 shrink-0'
            }
          >
            <button
              type="button"
              onClick={onUndo}
              disabled={!undoEnabled}
              className={`${
                isVertical ? 'w-9 h-9' : 'w-10 h-10'
              } rounded-full flex items-center justify-center hover:bg-base-200 text-base-content/75 disabled:opacity-30 transition-colors`}
              title="元に戻す (Ctrl+Z)"
            >
              <Undo2 className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!redoEnabled}
              className={`${
                isVertical ? 'w-9 h-9' : 'w-10 h-10'
              } rounded-full flex items-center justify-center hover:bg-base-200 text-base-content/75 disabled:opacity-30 transition-colors`}
              title="やり直す (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-5 h-5" />
            </button>
          </div>

          {/* Collapse to Corner Button */}
          <button
            type="button"
            onClick={handleCollapseButton}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-base-200 text-base-content/55 hover:text-base-content transition-colors shrink-0"
            title="丸く折りたたむ（四隅へドラッグでも収納できます）"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
          </div>
        </div>
      )}

      {/* Freeform-style Speech Bubble Popover for Stroke Width (2nd tap on pen/marker) */}
      {sizePopover && !paletteState.collapsed && (
        <div
          ref={sizePopoverRef}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          style={{
            left: `${sizePopover.anchorX.toFixed(1)}px`,
            top: `${sizePopover.anchorY.toFixed(1)}px`,
            transform:
              sizePopover.dock === 'bottom'
                ? 'translate(-50%, -100%)'
                : sizePopover.dock === 'top'
                  ? 'translate(-50%, 0)'
                  : sizePopover.dock === 'left'
                    ? 'translate(0, -50%)'
                    : 'translate(-100%, -50%)',
          }}
          className="absolute z-40 select-none"
        >
          <div className="relative animate-palette-popover rounded-full bg-base-100/95 backdrop-blur-md border border-base-300 shadow-xl px-2.5 py-2 flex items-center gap-1.5">
            {/* Speech bubble triangle pointer pointing toward the active tool button */}
            <span
              aria-hidden="true"
              className={`absolute w-3 h-3 rotate-45 bg-base-100/95 pointer-events-none ${
                sizePopover.dock === 'bottom'
                  ? '-bottom-[7px] left-1/2 -translate-x-1/2 border-r border-b border-base-300'
                  : sizePopover.dock === 'top'
                    ? '-top-[7px] left-1/2 -translate-x-1/2 border-l border-t border-base-300'
                    : sizePopover.dock === 'left'
                      ? '-left-[7px] top-1/2 -translate-y-1/2 border-l border-b border-base-300'
                      : '-right-[7px] top-1/2 -translate-y-1/2 border-r border-t border-base-300'
              }`}
            />

            {SIZE_OPTIONS.map((opt, idx) => {
              const dotPx = idx === 0 ? 7 : idx === 1 ? 13 : 19;
              const currentSizeIdx =
                sizePopover.tool === 'marker' ? markerSizeIndex : penSizeIndex;
              const active = currentSizeIdx === idx;
              return (
                <button
                  key={opt.label}
                  type="button"
                  title={`太さ：${opt.label}`}
                  onClick={() => {
                    if (sizePopover.tool === 'marker') {
                      setMarkerSizeIndex(idx as 0 | 1 | 2);
                    } else {
                      setPenSizeIndex(idx as 0 | 1 | 2);
                    }
                  }}
                  className={`relative z-10 w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 ${
                    active
                      ? 'bg-primary/12 ring-2 ring-primary'
                      : 'hover:bg-base-200'
                  }`}
                >
                  <span
                    className={`rounded-full block transition-colors ${
                      active ? 'bg-primary animate-dot-pop' : 'bg-base-content/80'
                    }`}
                    style={{ width: dotPx, height: dotPx }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
