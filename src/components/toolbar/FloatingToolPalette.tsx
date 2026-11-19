import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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

function getNearestCornerForDock(dock: DockEdge): CornerPos {
  switch (dock) {
    case 'top':
      return 'top-right';
    case 'left':
      return 'bottom-left';
    case 'right':
      return 'bottom-right';
    case 'bottom':
    default:
      return 'bottom-right';
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
  clientX: number,
  clientY: number,
  boundsRect: DOMRect,
): SnapTarget {
  const relX = Math.max(0, Math.min(1, (clientX - boundsRect.left) / Math.max(1, boundsRect.width)));
  const relY = Math.max(0, Math.min(1, (clientY - boundsRect.top) / Math.max(1, boundsRect.height)));

  const nearLeft = relX < 0.17;
  const nearRight = relX > 0.83;
  const nearTop = relY < 0.18;
  const nearBottom = relY > 0.82;

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
    { edge: 'top', d: relY },
    { edge: 'bottom', d: 1 - relY },
    { edge: 'left', d: relX },
    { edge: 'right', d: 1 - relX },
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
    sizeIndex,
    activeLayer,
    canUndo,
    canRedo,
    setInteractionMode,
    setTool,
    setPenColor,
    setMarkerColor,
    setSizeIndex,
  } = useToolStore();

  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    selectedSpreadSide,
    scale,
    resetZoom,
  } = useViewerStore();

  const [paletteState, setPaletteState] = useState<PaletteState>(loadPaletteState);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragEndNonce, setDragEndNonce] = useState(0);
  const [boundsSize, setBoundsSize] = useState({ w: 800, h: 600 });

  const paletteElRef = useRef<HTMLDivElement | null>(null);
  const safeBottomRef = useRef<HTMLDivElement | null>(null);
  const flipOriginRef = useRef<{ cx: number; cy: number } | null>(null);

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

  // Unified pixel positioning + smooth 460ms glide animation on release/toggle
  useLayoutEffect(() => {
    const el = paletteElRef.current;
    const boundsEl = boundsRef.current;
    if (!el || !boundsEl) return;

    if (isDraggingMoved && dragState) {
      const x = dragState.leftInBounds + (dragState.curX - dragState.startX);
      const y = dragState.topInBounds + (dragState.curY - dragState.startY);
      el.style.transition = 'none';
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      return;
    }

    const boundsRect = boundsEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const target: SnapTarget = paletteState.collapsed
      ? { kind: 'corner', corner: paletteState.corner }
      : { kind: 'edge', edge: paletteState.dock };

    const { x: targetX, y: targetY } = computeTargetPosition(
      target,
      elRect.width,
      elRect.height,
      boundsRect.width,
      boundsRect.height,
      getSafeBottom(),
    );

    const origin = flipOriginRef.current;
    if (origin) {
      flipOriginRef.current = null;
      const startX = Math.max(
        0,
        Math.min(boundsRect.width - elRect.width, origin.cx - boundsRect.left - elRect.width / 2),
      );
      const startY = Math.max(
        0,
        Math.min(boundsRect.height - elRect.height, origin.cy - boundsRect.top - elRect.height / 2),
      );

      el.style.transition = 'none';
      el.style.transform = `translate3d(${startX.toFixed(1)}px, ${startY.toFixed(1)}px, 0)`;
      // Force layout flush so the starting frame is committed before gliding
      void el.offsetWidth;

      el.style.transition = 'transform 460ms cubic-bezier(0.25, 0.85, 0.3, 1)';
      el.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0)`;
    } else {
      el.style.transition = 'none';
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
  const targetPage =
    spreadMode === 'single'
      ? layout.leftPage ?? currentPage
      : selectedSpreadSide === 'left'
        ? layout.leftPage ?? layout.rightPage ?? currentPage
        : layout.rightPage ?? layout.leftPage ?? currentPage;

  const historyKey = `${workbookId}:${targetPage}:${activeLayer}`;
  const undoEnabled = canUndo(historyKey);
  const redoEnabled = canRedo(historyKey);

  const colorList = tool === 'marker' ? MARKER_COLOR_OPTIONS : PEN_COLOR_OPTIONS;
  const activeColor = tool === 'marker' ? markerColor : penColor;

  // ===== Drag Handling =====
  const beginDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();

    const bounds = boundsRef.current?.getBoundingClientRect();
    const elRect = paletteElRef.current?.getBoundingClientRect();
    if (!bounds || !elRect) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    setDragState({
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      leftInBounds: elRect.left - bounds.left,
      topInBounds: elRect.top - bounds.top,
      moved: false,
      preview: null,
    });
  };

  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const bounds = boundsRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const dist = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
    const moved = dragState.moved || dist > 8;
    const preview = moved ? resolveSnapTarget(e.clientX, e.clientY, bounds) : null;

    setDragState((prev) =>
      prev
        ? {
            ...prev,
            curX: e.clientX,
            curY: e.clientY,
            moved,
            preview,
          }
        : null,
    );
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    e.stopPropagation();

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    const r = paletteElRef.current?.getBoundingClientRect();
    if (!cancelled && r && r.width > 0) {
      flipOriginRef.current = {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    }

    const currentDrag = dragState;
    setDragState(null);
    setDragEndNonce((n) => n + 1);

    if (cancelled) return;

    if (!currentDrag.moved) {
      if (paletteState.collapsed) {
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
        }));
      }
    }
  };

  const handleCollapseButton = () => {
    const r = paletteElRef.current?.getBoundingClientRect();
    if (r && r.width > 0) {
      flipOriginRef.current = {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    }
    setPaletteState((prev) => ({
      ...prev,
      collapsed: true,
      corner: getNearestCornerForDock(prev.dock),
    }));
  };

  const isVertical = paletteState.dock === 'left' || paletteState.dock === 'right';

  const zoomResetLeftOffset =
    paletteState.collapsed && paletteState.corner === 'bottom-left'
      ? 'left-[84px]'
      : 'left-3.5';

  const renderToolIcon = (sizeClass: string) => {
    if (tool === 'marker') return <Highlighter className={sizeClass} />;
    if (tool === 'eraser') return <Eraser className={sizeClass} />;
    return <Pen className={sizeClass} />;
  };

  // Compute snap preview ghost coordinates in pixels (same transform system, zero conflict)
  const previewGhost = (() => {
    if (!isDraggingMoved || !dragState?.preview) return null;
    const p = dragState.preview;
    const gw =
      p.kind === 'corner'
        ? 60
        : p.edge === 'left' || p.edge === 'right'
          ? 74
          : Math.min(400, boundsSize.w - 32);
    const gh =
      p.kind === 'corner'
        ? 60
        : p.edge === 'left' || p.edge === 'right'
          ? Math.min(360, boundsSize.h - 32)
          : 54;
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
          className={`absolute ${zoomResetLeftOffset} bottom-[calc(14px+env(safe-area-inset-bottom))] z-30 px-3 py-2 rounded-full bg-base-100/92 backdrop-blur-md border border-base-300 shadow-md flex items-center gap-1.5 text-xs font-mono text-base-content/85 hover:text-primary transition-all`}
        >
          <span>{Math.round(scale * 100)}%</span>
          <RotateCcw className="w-3.5 h-3.5 text-base-content/55" />
        </button>
      )}

      {/* Main Floating Palette (Collapsed Circle OR Docked Pill) */}
      {paletteState.collapsed ? (
        <div
          ref={paletteElRef}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
          onTouchStart={(e) => e.stopPropagation()}
          style={{ touchAction: 'none' }}
          title="タップで展開 / ドラッグで移動"
          className={`absolute top-0 left-0 z-30 w-[60px] h-[60px] rounded-full bg-base-100/95 backdrop-blur-md border border-base-300 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing select-none will-change-transform ${
            isDraggingMoved ? 'ring-2 ring-primary/30' : ''
          }`}
        >
          <div className="relative flex items-center justify-center">
            {renderToolIcon('w-6 h-6 text-base-content/85')}
            {tool !== 'eraser' && (
              <span
                className="absolute -bottom-2.5 left-1/2 w-5 h-1.5 rounded-full ring-1 ring-black/15"
                style={{ backgroundColor: activeColor, transform: 'translateX(-50%)' }}
              />
            )}
          </div>
        </div>
      ) : (
        <div
          ref={paletteElRef}
          onPointerDown={(e) => {
            e.stopPropagation();
            const target = e.target as HTMLElement;
            if (!target.closest('button')) {
              beginDrag(e);
            }
          }}
          onPointerMove={moveDrag}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
          onTouchStart={(e) => e.stopPropagation()}
          style={{ touchAction: 'none' }}
          className={`absolute top-0 left-0 z-30 bg-base-100/95 backdrop-blur-md border border-base-300 shadow-lg select-none will-change-transform ${
            isDraggingMoved ? 'opacity-95 ring-2 ring-primary/30' : ''
          } ${
            isVertical
              ? 'flex flex-col items-center gap-2 px-2.5 py-3 rounded-full max-h-[calc(100%-24px)] overflow-y-auto thin-scrollbar'
              : 'flex flex-row items-center gap-2 px-3.5 py-2 rounded-full max-w-[calc(100%-24px)] overflow-x-auto thin-scrollbar'
          }`}
        >
          {/* Drag Handle */}
          <div
            onPointerDown={beginDrag}
            title="ドラッグして上下左右へ移動 / 四隅で格納"
            style={{ touchAction: 'none' }}
            className={`flex items-center justify-center text-base-content/40 hover:text-base-content/75 cursor-grab active:cursor-grabbing shrink-0 ${
              isVertical ? 'w-10 h-5' : 'w-5 h-9'
            }`}
          >
            {isVertical ? (
              <GripHorizontal className="w-[18px] h-[18px]" />
            ) : (
              <GripVertical className="w-[18px] h-[18px]" />
            )}
          </div>

          {/* Interaction Mode: Flip vs Draw */}
          <div
            className={`flex p-1 rounded-full bg-base-200 border border-base-300 shrink-0 ${
              isVertical ? 'flex-col gap-1' : 'flex-row items-center gap-0.5'
            }`}
          >
            <button
              type="button"
              onClick={() => setInteractionMode('flip')}
              title="指でページめくり（Apple Pencilは常に書き込み可）"
              className={`rounded-full text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                isVertical ? 'w-10 h-9' : 'px-3 py-1.5'
              } ${
                interactionMode === 'flip'
                  ? 'bg-base-100 text-base-content shadow-xs'
                  : 'text-base-content/55 hover:text-base-content'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              {!isVertical && <span className="hidden sm:inline">めくり</span>}
            </button>
            <button
              type="button"
              onClick={() => setInteractionMode('draw')}
              title="指/マウスでも直接書き込み"
              className={`rounded-full text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                isVertical ? 'w-10 h-9' : 'px-3 py-1.5'
              } ${
                interactionMode === 'draw'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'text-base-content/55 hover:text-base-content'
              }`}
            >
              <Pen className="w-4 h-4" />
              {!isVertical && <span className="hidden sm:inline">書く</span>}
            </button>
          </div>

          <div
            className={
              isVertical ? 'h-px w-8 bg-base-300 my-0.5 shrink-0' : 'w-px h-6 bg-base-300 mx-0.5 shrink-0'
            }
          />

          {/* Drawing Tools */}
          <div
            className={`flex items-center gap-1.5 shrink-0 ${
              isVertical ? 'flex-col' : 'flex-row'
            }`}
          >
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                tool === 'pen'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'hover:bg-base-200 text-base-content/75'
              }`}
              title="ペン"
            >
              <Pen className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setTool('marker')}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                tool === 'marker'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'hover:bg-base-200 text-base-content/75'
              }`}
              title="蛍光マーカー"
            >
              <Highlighter className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                tool === 'eraser'
                  ? 'bg-primary text-primary-content shadow-xs'
                  : 'hover:bg-base-200 text-base-content/75'
              }`}
              title="消しゴム（ストローク単位）"
            >
              <Eraser className="w-[18px] h-[18px]" />
            </button>
          </div>

          {/* Color Swatches & Width */}
          {tool !== 'eraser' && (
            <>
              <div
                className={
                  isVertical
                    ? 'h-px w-8 bg-base-300 my-0.5 shrink-0'
                    : 'w-px h-6 bg-base-300 mx-0.5 shrink-0'
                }
              />

              <div
                className={
                  isVertical
                    ? 'grid grid-cols-2 gap-2 px-0.5 shrink-0'
                    : 'flex items-center gap-2 px-1 shrink-0'
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
                        if (tool === 'marker') setMarkerColor(c.value);
                        else setPenColor(c.value);
                      }}
                      className={`w-6 h-6 rounded-full transition-transform border border-black/15 ${
                        selected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100 scale-110'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c.value }}
                    />
                  );
                })}
              </div>

              <div
                className={
                  isVertical
                    ? 'h-px w-8 bg-base-300 my-0.5 shrink-0'
                    : 'w-px h-6 bg-base-300 mx-0.5 shrink-0'
                }
              />

              {/* Stroke Width */}
              <div
                className={`flex items-center shrink-0 ${
                  isVertical ? 'gap-0.5' : 'gap-1 px-0.5'
                }`}
              >
                {SIZE_OPTIONS.map((opt, idx) => {
                  const dotPx = idx === 0 ? 6 : idx === 1 ? 10 : 14;
                  const active = sizeIndex === idx;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      title={`太さ：${opt.label}`}
                      onClick={() => setSizeIndex(idx as 0 | 1 | 2)}
                      className={`${
                        isVertical ? 'w-6 h-7' : 'w-8 h-8'
                      } rounded-full flex items-center justify-center transition-colors ${
                        active ? 'bg-base-200 ring-1 ring-base-300' : 'hover:bg-base-200/70'
                      }`}
                    >
                      <span
                        className="rounded-full bg-base-content/80 block"
                        style={{ width: dotPx, height: dotPx }}
                      />
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div
            className={
              isVertical ? 'h-px w-8 bg-base-300 my-0.5 shrink-0' : 'w-px h-6 bg-base-300 mx-0.5 shrink-0'
            }
          />

          {/* Undo / Redo */}
          <div
            className={
              isVertical ? 'grid grid-cols-2 gap-1 shrink-0' : 'flex items-center gap-1 shrink-0'
            }
          >
            <button
              type="button"
              onClick={onUndo}
              disabled={!undoEnabled}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-base-200 text-base-content/75 disabled:opacity-30 transition-colors"
              title="元に戻す (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!redoEnabled}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-base-200 text-base-content/75 disabled:opacity-30 transition-colors"
              title="やり直す (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* Collapse to Corner Button */}
          <button
            type="button"
            onClick={handleCollapseButton}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-base-200 text-base-content/55 hover:text-base-content transition-colors shrink-0"
            title="丸く折りたたむ（四隅へドラッグでも収納できます）"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}
