import type { SpreadMode, StrokePoint } from '../types/models';

export type SnappedShape =
  | {
      kind: 'line';
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation: number;
      isCircle: boolean;
      anchorDist: number;
      anchorAngle: number;
      baseRx: number;
      baseRy: number;
      baseRotation: number;
    };

interface Pt2D {
  x: number;
  y: number;
}

const ELLIPSE_ANGLE_SNAP_DEG = 5;
const CIRCLE_ASPECT_THRESHOLD = 0.82;

function snapAngleToCardinal(rad: number, thresholdDeg: number): number {
  const step = Math.PI / 2;
  const nearest = Math.round(rad / step) * step;
  const diffDeg = Math.abs((rad - nearest) * (180 / Math.PI));
  return diffDeg <= thresholdDeg ? nearest : rad;
}

/** Resample polyline to N arc-length-uniform points for unbiased PCA / circle fitting */
function resampleByArcLength(pts: Pt2D[], count: number): { samples: Pt2D[]; totalLength: number } {
  if (pts.length === 0) return { samples: [], totalLength: 0 };
  if (pts.length === 1) return { samples: [pts[0]], totalLength: 0 };

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const totalLength = cum[cum.length - 1];
  if (totalLength < 1e-3) {
    return { samples: [pts[0]], totalLength: 0 };
  }

  const samples: Pt2D[] = [];
  let segIdx = 0;
  for (let i = 0; i < count; i++) {
    const target = (totalLength * i) / (count - 1);
    while (segIdx < cum.length - 2 && cum[segIdx + 1] < target) {
      segIdx++;
    }
    const segLen = cum[segIdx + 1] - cum[segIdx];
    const t = segLen > 1e-6 ? (target - cum[segIdx]) / segLen : 0;
    const p0 = pts[segIdx];
    const p1 = pts[segIdx + 1];
    samples.push({
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
    });
  }

  return { samples, totalLength };
}

function pointToSegmentDist(p: Pt2D, a: Pt2D, b: Pt2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Decimate micro-jitter points (< minStep px) so arc length isn't inflated by stylus tremor */
function simplifyJitter(pts: Pt2D[], minStep = 4): Pt2D[] {
  if (pts.length <= 2) return pts;
  const out: Pt2D[] = [pts[0]];
  let last = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minStep) {
      out.push(p);
      last = p;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Recognizes a straight line or circle/ellipse from a hand-drawn stroke in book-normalized
 * coordinates, using Euclidean aspect-corrected pixel dimensions (bookW x bookH).
 */
export function recognizeHoldShape(
  bookPoints: StrokePoint[],
  bookW: number,
  bookH: number,
): SnappedShape | null {
  if (bookPoints.length < 4 || bookW <= 0 || bookH <= 0) return null;

  const rawPts: Pt2D[] = bookPoints.map(([bx, by]) => ({
    x: bx * bookW,
    y: by * bookH,
  }));
  const pts = simplifyJitter(rawPts, 4);

  const { samples, totalLength } = resampleByArcLength(pts, 64);
  if (totalLength < 22 || samples.length < 4) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  const diag = Math.hypot(bboxW, bboxH);
  if (diag < 16) return null;

  const start = pts[0];
  const end = pts[pts.length - 1];
  const endDist = Math.hypot(end.x - start.x, end.y - start.y);

  // --- 1. Check Circle / Ellipse (Apple Freeform-style PCA + extent fit) ---
  let meanX = 0;
  let meanY = 0;
  for (const s of samples) {
    meanX += s.x;
    meanY += s.y;
  }
  meanX /= samples.length;
  meanY /= samples.length;

  // Signed angular sweep around centroid
  let totalSweep = 0;
  let prevAngle = Math.atan2(samples[0].y - meanY, samples[0].x - meanX);
  for (let i = 1; i < samples.length; i++) {
    const a = Math.atan2(samples[i].y - meanY, samples[i].x - meanX);
    let delta = a - prevAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    totalSweep += delta;
    prevAngle = a;
  }

  const isClosedLoop =
    Math.abs(totalSweep) >= 4.2 && // >= ~240 deg wrap
    Math.abs(totalSweep) <= 8.5 && // not a multi-turn spiral
    endDist <= Math.max(diag * 0.48, totalLength * 0.3);

  if (isClosedLoop) {
    // 2D PCA covariance matrix to recover ellipse principal axis orientation
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (const s of samples) {
      const dx = s.x - meanX;
      const dy = s.y - meanY;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    }
    cxx /= samples.length;
    cyy /= samples.length;
    cxy /= samples.length;

    let rotation = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    // Project points onto principal axes to match exact drawn bounds
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const s of samples) {
      const dx = s.x - meanX;
      const dy = s.y - meanY;
      const u = dx * cosR + dy * sinR;
      const v = -dx * sinR + dy * cosR;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const midU = (minU + maxU) / 2;
    const midV = (minV + maxV) / 2;
    const cx = meanX + midU * cosR - midV * sinR;
    const cy = meanY + midU * sinR + midV * cosR;
    let rx = (maxU - minU) / 2;
    let ry = (maxV - minV) / 2;

    if (rx >= 8 && ry >= 8) {
      // Evaluate normalized radial ellipse fit RMS error (0 = perfect ellipse)
      let errSqSum = 0;
      for (const s of samples) {
        const dx = s.x - cx;
        const dy = s.y - cy;
        const u = (dx * cosR + dy * sinR) / rx;
        const v = (-dx * sinR + dy * cosR) / ry;
        const radialErr = Math.hypot(u, v) - 1;
        errSqSum += radialErr * radialErr;
      }
      const rmsErr = Math.sqrt(errSqSum / samples.length);

      if (rmsErr <= 0.25) {
        const aspect = Math.min(rx, ry) / Math.max(rx, ry);
        const isCircle = aspect >= CIRCLE_ASPECT_THRESHOLD;

        if (isCircle) {
          const r = (rx + ry) / 2;
          rx = r;
          ry = r;
          rotation = 0;
        } else {
          rotation = snapAngleToCardinal(rotation, ELLIPSE_ANGLE_SNAP_DEG);
        }

        const anchorDist = Math.max(8, Math.hypot(end.x - cx, end.y - cy));
        const anchorAngle = Math.atan2(end.y - cy, end.x - cx);
        return {
          kind: 'ellipse',
          cx,
          cy,
          rx,
          ry,
          rotation,
          isCircle,
          anchorDist,
          anchorAngle,
          baseRx: rx,
          baseRy: ry,
          baseRotation: rotation,
        };
      }
    }
  }

  // --- 2. Check Straight Line ---
  if (endDist >= 18 && endDist / totalLength >= 0.72) {
    let maxDev = 0;
    for (const s of samples) {
      const d = pointToSegmentDist(s, start, end);
      if (d > maxDev) maxDev = d;
    }

    if (maxDev <= Math.max(18, endDist * 0.3)) {
      return {
        kind: 'line',
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      };
    }
  }

  return null;
}

/** Live-adjust a snapped shape while the user continues dragging without lifting the pen */
export function updateSnappedShape(
  shape: SnappedShape,
  penPxX: number,
  penPxY: number,
): SnappedShape {
  if (shape.kind === 'line') {
    return {
      ...shape,
      endX: penPxX,
      endY: penPxY,
    };
  }

  const curDist = Math.max(8, Math.hypot(penPxX - shape.cx, penPxY - shape.cy));
  const scaleRatio = curDist / Math.max(8, shape.anchorDist);
  const nextRx = Math.max(6, shape.baseRx * scaleRatio);
  const nextRy = Math.max(6, shape.baseRy * scaleRatio);

  if (shape.isCircle) {
    const r = (nextRx + nextRy) / 2;
    return {
      ...shape,
      rx: r,
      ry: r,
      rotation: 0,
    };
  }

  const curAngle = Math.atan2(penPxY - shape.cy, penPxX - shape.cx);
  const rawRot = shape.baseRotation + (curAngle - shape.anchorAngle);
  const snappedRot = snapAngleToCardinal(rawRot, ELLIPSE_ANGLE_SNAP_DEG);
  return {
    ...shape,
    rx: nextRx,
    ry: nextRy,
    rotation: snappedRot,
  };
}

/** Convert a snapped shape back to evenly-sampled normalized book points */
export function sampleShapeToBookPoints(
  shape: SnappedShape,
  bookW: number,
  bookH: number,
): StrokePoint[] {
  if (bookW <= 0 || bookH <= 0) return [];

  if (shape.kind === 'line') {
    const dist = Math.hypot(shape.endX - shape.startX, shape.endY - shape.startY);
    const steps = Math.max(12, Math.min(120, Math.ceil(dist / 8)));
    const pts: StrokePoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = shape.startX + (shape.endX - shape.startX) * t;
      const y = shape.startY + (shape.endY - shape.startY) * t;
      pts.push([x / bookW, y / bookH, 0.5]);
    }
    return pts;
  }

  const steps = 96;
  const cosR = Math.cos(shape.rotation);
  const sinR = Math.sin(shape.rotation);
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (Math.PI * 2 * i) / steps;
    const lx = shape.rx * Math.cos(theta);
    const ly = shape.ry * Math.sin(theta);
    const x = shape.cx + lx * cosR - ly * sinR;
    const y = shape.cy + lx * sinR + ly * cosR;
    pts.push([x / bookW, y / bookH, 0.5]);
  }
  return pts;
}

export interface SplitPageSegment {
  pageNumber: number;
  points: StrokePoint[];
}

/**
 * Splits a single polyline in unified book coordinates ([0..1] across single or double spread)
 * cleanly at the center spine (x = 0.5) into per-page segments so each page saves its own ink
 * and single-page viewing works identically without artifacts.
 */
export function splitBookPointsToPages(
  bookPoints: StrokePoint[],
  spreadMode: SpreadMode,
  leftPage: number | null,
  rightPage: number | null,
): SplitPageSegment[] {
  if (bookPoints.length === 0) return [];

  if (spreadMode === 'single') {
    if (leftPage === null) return [];
    return [{ pageNumber: leftPage, points: bookPoints }];
  }

  const segments: Array<{ side: 'left' | 'right'; points: StrokePoint[] }> = [];

  const toSidePoint = (side: 'left' | 'right', pt: StrokePoint): StrokePoint => [
    side === 'left' ? pt[0] * 2 : (pt[0] - 0.5) * 2,
    pt[1],
    pt[2],
  ];

  const first = bookPoints[0];
  let curSide: 'left' | 'right' = first[0] <= 0.5 ? 'left' : 'right';
  let curPts: StrokePoint[] = [toSidePoint(curSide, first)];

  for (let i = 1; i < bookPoints.length; i++) {
    const p0 = bookPoints[i - 1];
    const p1 = bookPoints[i];
    const nextSide: 'left' | 'right' = p1[0] <= 0.5 ? 'left' : 'right';

    if (nextSide === curSide) {
      curPts.push(toSidePoint(curSide, p1));
    } else {
      // Compute exact crossing on the spine x = 0.5
      const dx = p1[0] - p0[0];
      const t = Math.abs(dx) > 1e-7 ? (0.5 - p0[0]) / dx : 0.5;
      const clampedT = Math.max(0, Math.min(1, t));
      const iy = p0[1] + (p1[1] - p0[1]) * clampedT;
      const ip = p0[2] + (p1[2] - p0[2]) * clampedT;

      // Finish current half at the spine boundary
      curPts.push([curSide === 'left' ? 1 : 0, iy, ip]);
      segments.push({ side: curSide, points: curPts });

      // Start new half cleanly from the spine boundary
      curSide = nextSide;
      curPts = [
        [curSide === 'left' ? 1 : 0, iy, ip],
        toSidePoint(curSide, p1),
      ];
    }
  }

  if (curPts.length > 0) {
    segments.push({ side: curSide, points: curPts });
  }

  const result: SplitPageSegment[] = [];
  for (const seg of segments) {
    const pageNumber = seg.side === 'left' ? leftPage : rightPage;
    if (pageNumber !== null && seg.points.length > 0) {
      result.push({ pageNumber, points: seg.points });
    }
  }

  return result;
}
