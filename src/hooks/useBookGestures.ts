import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { InteractionMode } from '../stores/useToolStore';

export interface DrawMoveSample {
  clientX: number;
  clientY: number;
  pressure: number;
}

export interface ZoomPanState {
  scale: number;
  panX: number;
  panY: number;
}

export interface BookGestureCallbacks {
  stageRef: RefObject<HTMLElement | null>;
  interactionMode: InteractionMode;
  getZoomPan: () => ZoomPanState;
  onDrawStart: (clientX: number, clientY: number, pressure: number) => boolean;
  onDrawMovePoints: (samples: DrawMoveSample[]) => void;
  onDrawEnd: () => void;
  onFlipStart: (clientX: number) => void;
  onFlipMove: (clientX: number) => void;
  onFlipEnd: (clientX: number, velocityX: number) => void;
  onFlipCancel: (immediate?: boolean) => void;
  onZoomPanLive: (scale: number, panX: number, panY: number, focusX?: number, focusY?: number) => void;
  onZoomPanEnd: () => void;
  onWheelZoomAt: (factor: number, clientX: number, clientY: number) => void;
  onWheelPan: (dx: number, dy: number) => void;
}

type TouchWithType = Touch & { touchType?: 'direct' | 'stylus' };

// Ignore accidental 1-finger palm touches right after lifting Apple Pencil
const PALM_GUARD_MS = 320;

function getFingerTouches(touchList: TouchList): Touch[] {
  const fingers: Touch[] = [];
  for (let i = 0; i < touchList.length; i++) {
    const t = touchList.item(i) as TouchWithType | null;
    if (!t) continue;
    if (t.touchType === 'stylus') continue;
    fingers.push(t);
  }
  return fingers;
}

export function useBookGestures(callbacks: BookGestureCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Pen & Mouse pointer tracking (strictly separate from touch!)
  const isPenDrawingRef = useRef(false);
  const activePenIdRef = useRef<number | null>(null);
  const lastPenTimeRef = useRef(0);

  const mouseModeRef = useRef<'none' | 'draw' | 'flip' | 'pan'>('none');
  const mousePointerIdRef = useRef<number | null>(null);
  const mousePanOriginRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const mouseLastFlipSampleRef = useRef({ x: 0, time: 0 });
  const mouseVelocityXRef = useRef(0);

  // Touch state (Single Source of Truth = e.touches via native TouchEvent)
  const touchModeRef = useRef<'none' | 'draw' | 'flip' | 'pan' | 'pinch'>('none');
  const touchPanIdRef = useRef<number | null>(null);
  const touchPanOriginRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const touchDrawIdRef = useRef<number | null>(null);
  const touchFlipIdRef = useRef<number | null>(null);
  const touchFlipLastXRef = useRef(0);
  const touchFlipLastSampleRef = useRef({ x: 0, time: 0 });
  const touchVelocityXRef = useRef(0);

  const pinchOriginRef = useRef<{
    id1: number;
    id2: number;
    dist: number;
    midOffsetX: number;
    midOffsetY: number;
    scale: number;
    panX: number;
    panY: number;
  }>({
    id1: -1,
    id2: -1,
    dist: 1,
    midOffsetX: 0,
    midOffsetY: 0,
    scale: 1,
    panX: 0,
    panY: 0,
  });

  // Native TouchEvent + Safari gesture handling on stageRef
  useEffect(() => {
    const el = callbacks.stageRef.current;
    if (!el) return;

    const getStageCenter = () => {
      const rect = el.getBoundingClientRect();
      const pr = parseFloat(window.getComputedStyle(el).paddingRight) || 0;
      return {
        cx: rect.left + (rect.width - pr) / 2,
        cy: rect.top + rect.height / 2,
      };
    };

    const getPinchMetrics = (t1: Touch, t2: Touch) => {
      const { cx, cy } = getStageCenter();
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      return {
        dist: Math.max(12, Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)),
        midOffsetX: midX - cx,
        midOffsetY: midY - cy,
      };
    };

    const anchorPinch = (t1: Touch, t2: Touch) => {
      const cb = callbacksRef.current;
      const currentZoom = cb.getZoomPan();
      const metrics = getPinchMetrics(t1, t2);
      pinchOriginRef.current = {
        id1: t1.identifier,
        id2: t2.identifier,
        dist: metrics.dist,
        midOffsetX: metrics.midOffsetX,
        midOffsetY: metrics.midOffsetY,
        scale: currentZoom.scale,
        panX: currentZoom.panX,
        panY: currentZoom.panY,
      };
      touchModeRef.current = 'pinch';
    };

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select')) {
        return;
      }
      if (e.cancelable) {
        e.preventDefault();
      }

      if (isPenDrawingRef.current) {
        return;
      }

      const cb = callbacksRef.current;
      const fingers = getFingerTouches(e.touches);

      if (fingers.length >= 2) {
        if (touchModeRef.current === 'flip') {
          cb.onFlipCancel(true);
          touchFlipIdRef.current = null;
        } else if (touchModeRef.current === 'draw') {
          cb.onDrawEnd();
          touchDrawIdRef.current = null;
        }
        touchPanIdRef.current = null;
        anchorPinch(fingers[0], fingers[1]);
        return;
      }

      if (fingers.length === 1 && touchModeRef.current === 'none') {
        // Guard against accidental palm touch right after Apple Pencil lift
        if (performance.now() - lastPenTimeRef.current < PALM_GUARD_MS) {
          return;
        }

        const f = fingers[0];
        const currentZoom = cb.getZoomPan();

        if (currentZoom.scale > 1.02) {
          touchModeRef.current = 'pan';
          touchPanIdRef.current = f.identifier;
          touchPanOriginRef.current = {
            startX: f.clientX,
            startY: f.clientY,
            panX: currentZoom.panX,
            panY: currentZoom.panY,
          };
        } else if (cb.interactionMode === 'draw') {
          const started = cb.onDrawStart(f.clientX, f.clientY, 0.5);
          if (started) {
            touchModeRef.current = 'draw';
            touchDrawIdRef.current = f.identifier;
          }
        } else {
          touchModeRef.current = 'flip';
          touchFlipIdRef.current = f.identifier;
          touchFlipLastXRef.current = f.clientX;
          touchFlipLastSampleRef.current = { x: f.clientX, time: performance.now() };
          touchVelocityXRef.current = 0;
          cb.onFlipStart(f.clientX);
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select') && touchModeRef.current === 'none') {
        return;
      }
      if (e.cancelable) {
        e.preventDefault();
      }

      if (isPenDrawingRef.current) {
        return;
      }

      const cb = callbacksRef.current;
      const fingers = getFingerTouches(e.touches);

      if (touchModeRef.current === 'pinch') {
        if (fingers.length >= 2) {
          const t1 = fingers[0];
          const t2 = fingers[1];
          const orig = pinchOriginRef.current;

          if (t1.identifier !== orig.id1 || t2.identifier !== orig.id2) {
            anchorPinch(t1, t2);
            return;
          }

          const metrics = getPinchMetrics(t1, t2);
          const rawScale = orig.scale * (metrics.dist / orig.dist);
          const nextScale =
            rawScale > 8
              ? Math.min(8.6, 8 + (rawScale - 8) * 0.22)
              : Math.max(0.85, rawScale);
          const ratio = nextScale / orig.scale;

          const nextPanX = metrics.midOffsetX - ratio * (orig.midOffsetX - orig.panX);
          const nextPanY = metrics.midOffsetY - ratio * (orig.midOffsetY - orig.panY);

          cb.onZoomPanLive(nextScale, nextPanX, nextPanY, metrics.midOffsetX, metrics.midOffsetY);
        }
        return;
      }

      if (touchModeRef.current === 'pan' && fingers.length === 1) {
        const f = fingers[0];
        if (f.identifier !== touchPanIdRef.current) {
          const currentZoom = cb.getZoomPan();
          touchPanIdRef.current = f.identifier;
          touchPanOriginRef.current = {
            startX: f.clientX,
            startY: f.clientY,
            panX: currentZoom.panX,
            panY: currentZoom.panY,
          };
          return;
        }
        const currentZoom = cb.getZoomPan();
        const dx = f.clientX - touchPanOriginRef.current.startX;
        const dy = f.clientY - touchPanOriginRef.current.startY;
        cb.onZoomPanLive(
          currentZoom.scale,
          touchPanOriginRef.current.panX + dx,
          touchPanOriginRef.current.panY + dy,
        );
        return;
      }

      if (touchModeRef.current === 'draw' && fingers.length >= 1) {
        const f = fingers.find((t) => t.identifier === touchDrawIdRef.current) ?? fingers[0];
        cb.onDrawMovePoints([{ clientX: f.clientX, clientY: f.clientY, pressure: 0.5 }]);
        return;
      }

      if (touchModeRef.current === 'flip' && fingers.length === 1) {
        const f = fingers[0];
        if (f.identifier !== touchFlipIdRef.current) return;
        const now = performance.now();
        const dt = Math.max(1, now - touchFlipLastSampleRef.current.time);
        const instantVx = (f.clientX - touchFlipLastSampleRef.current.x) / dt;
        touchVelocityXRef.current = touchVelocityXRef.current * 0.5 + instantVx * 0.5;
        touchFlipLastSampleRef.current = { x: f.clientX, time: now };
        touchFlipLastXRef.current = f.clientX;
        cb.onFlipMove(f.clientX);
      }
    };

    const handleTouchEndOrCancel = (e: TouchEvent, cancelled: boolean) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select') && touchModeRef.current === 'none') {
        return;
      }
      if (e.cancelable) {
        e.preventDefault();
      }

      const cb = callbacksRef.current;
      const fingers = getFingerTouches(e.touches);

      if (fingers.length >= 2) {
        if (touchModeRef.current === 'pinch') {
          anchorPinch(fingers[0], fingers[1]);
        }
        return;
      }

      if (fingers.length === 1) {
        if (touchModeRef.current === 'pinch') {
          const f = fingers[0];
          const currentZoom = cb.getZoomPan();
          if (currentZoom.scale > 1.02) {
            touchModeRef.current = 'pan';
            touchPanIdRef.current = f.identifier;
            touchPanOriginRef.current = {
              startX: f.clientX,
              startY: f.clientY,
              panX: currentZoom.panX,
              panY: currentZoom.panY,
            };
          } else {
            touchModeRef.current = 'none';
            cb.onZoomPanEnd();
          }
          return;
        }

        // If a second resting finger existed while drawing/flipping and lifted, keep active mode
        return;
      }

      // fingers.length === 0: all fingers lifted
      const mode = touchModeRef.current;
      touchModeRef.current = 'none';
      touchPanIdRef.current = null;
      touchDrawIdRef.current = null;
      touchFlipIdRef.current = null;

      if (mode === 'flip') {
        if (cancelled) {
          cb.onFlipCancel(false);
        } else {
          cb.onFlipEnd(touchFlipLastXRef.current, touchVelocityXRef.current);
        }
      } else if (mode === 'pinch' || mode === 'pan') {
        cb.onZoomPanEnd();
      } else if (mode === 'draw') {
        cb.onDrawEnd();
      }
    };

    const onTouchEnd = (e: TouchEvent) => handleTouchEndOrCancel(e, false);
    const onTouchCancel = (e: TouchEvent) => handleTouchEndOrCancel(e, true);
    const preventGesture = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel, { passive: false });
    el.addEventListener('gesturestart', preventGesture, { passive: false });
    el.addEventListener('gesturechange', preventGesture, { passive: false });
    el.addEventListener('gestureend', preventGesture, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('gesturestart', preventGesture);
      el.removeEventListener('gesturechange', preventGesture);
      el.removeEventListener('gestureend', preventGesture);
    };
  }, [callbacks.stageRef]);

  // PointerEvents handle ONLY 'pen' and 'mouse' ('touch' is handled above via e.touches)
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const cb = callbacksRef.current;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }

    if (e.pointerType === 'pen') {
      lastPenTimeRef.current = performance.now();

      // Abort any active touch gesture cleanly so pen takes immediate priority
      if (touchModeRef.current === 'flip') {
        touchModeRef.current = 'none';
        touchFlipIdRef.current = null;
        cb.onFlipCancel(true);
      } else if (touchModeRef.current === 'pinch' || touchModeRef.current === 'pan') {
        touchModeRef.current = 'none';
        touchPanIdRef.current = null;
        cb.onZoomPanEnd();
      } else if (touchModeRef.current === 'draw') {
        touchModeRef.current = 'none';
        touchDrawIdRef.current = null;
        cb.onDrawEnd();
      }

      // Recover cleanly if a previous pen pointerup was dropped
      if (isPenDrawingRef.current) {
        cb.onDrawEnd();
        isPenDrawingRef.current = false;
        activePenIdRef.current = null;
      }

      const started = cb.onDrawStart(e.clientX, e.clientY, e.pressure || 0.5);
      if (started) {
        isPenDrawingRef.current = true;
        activePenIdRef.current = e.pointerId;
      }
      return;
    }

    // Mouse input
    const currentZoom = cb.getZoomPan();
    if (cb.interactionMode === 'draw') {
      const started = cb.onDrawStart(e.clientX, e.clientY, 0.5);
      if (started) {
        mouseModeRef.current = 'draw';
        mousePointerIdRef.current = e.pointerId;
      }
    } else if (currentZoom.scale > 1.02) {
      mouseModeRef.current = 'pan';
      mousePointerIdRef.current = e.pointerId;
      mousePanOriginRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: currentZoom.panX,
        panY: currentZoom.panY,
      };
    } else {
      mouseModeRef.current = 'flip';
      mousePointerIdRef.current = e.pointerId;
      mouseLastFlipSampleRef.current = { x: e.clientX, time: performance.now() };
      mouseVelocityXRef.current = 0;
      cb.onFlipStart(e.clientX);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return;

    const cb = callbacksRef.current;

    if (e.pointerType === 'pen') {
      if (!isPenDrawingRef.current || activePenIdRef.current !== e.pointerId) return;
      lastPenTimeRef.current = performance.now();
      // Always use the primary pointermove coordinates rather than getCoalescedEvents():
      // getCoalescedEvents() is SecureContext-only (HTTPS) and on iPadOS Safari 18+
      // can emit out-of-order / micro-jitter Apple Pencil samples that break hold-to-snap
      // on long strokes while working fine on non-HTTPS LAN URLs.
      cb.onDrawMovePoints([
        { clientX: e.clientX, clientY: e.clientY, pressure: e.pressure || 0.5 },
      ]);
      return;
    }

    // Mouse move
    if (mousePointerIdRef.current !== e.pointerId) return;
    if (mouseModeRef.current === 'draw') {
      cb.onDrawMovePoints([{ clientX: e.clientX, clientY: e.clientY, pressure: 0.5 }]);
    } else if (mouseModeRef.current === 'pan') {
      const currentZoom = cb.getZoomPan();
      const dx = e.clientX - mousePanOriginRef.current.startX;
      const dy = e.clientY - mousePanOriginRef.current.startY;
      cb.onZoomPanLive(
        currentZoom.scale,
        mousePanOriginRef.current.panX + dx,
        mousePanOriginRef.current.panY + dy,
      );
    } else if (mouseModeRef.current === 'flip') {
      const now = performance.now();
      const dt = Math.max(1, now - mouseLastFlipSampleRef.current.time);
      const instantVx = (e.clientX - mouseLastFlipSampleRef.current.x) / dt;
      mouseVelocityXRef.current = mouseVelocityXRef.current * 0.5 + instantVx * 0.5;
      mouseLastFlipSampleRef.current = { x: e.clientX, time: now };
      cb.onFlipMove(e.clientX);
    }
  };

  const cleanupPointer = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch') return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    const cb = callbacksRef.current;

    if (e.pointerType === 'pen') {
      if (isPenDrawingRef.current && activePenIdRef.current === e.pointerId) {
        lastPenTimeRef.current = performance.now();
        isPenDrawingRef.current = false;
        activePenIdRef.current = null;
        cb.onDrawEnd();
      }
      return;
    }

    if (mousePointerIdRef.current !== e.pointerId) return;
    const mode = mouseModeRef.current;
    mouseModeRef.current = 'none';
    mousePointerIdRef.current = null;

    if (mode === 'draw') {
      cb.onDrawEnd();
    } else if (mode === 'pan') {
      cb.onZoomPanEnd();
    } else if (mode === 'flip') {
      if (cancelled) {
        cb.onFlipCancel(false);
      } else {
        cb.onFlipEnd(e.clientX, mouseVelocityXRef.current);
      }
    }
  };

  const onWheel = (e: ReactWheelEvent<HTMLElement>) => {
    const cb = callbacksRef.current;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.006);
      cb.onWheelZoomAt(factor, e.clientX, e.clientY);
    } else if (cb.getZoomPan().scale > 1.02) {
      e.preventDefault();
      cb.onWheelPan(-e.deltaX, -e.deltaY);
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => cleanupPointer(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => cleanupPointer(e, true),
    onWheel,
  };
}
