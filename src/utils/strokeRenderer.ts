import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../types/models';

function getSvgPathFromStroke(points: number[][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x.toFixed(2)} ${y.toFixed(2)} L ${(x + 0.1).toFixed(2)} ${(y + 0.1).toFixed(2)} Z`;
  }

  const d: string[] = [
    `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`,
    'Q',
  ];

  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    d.push(`${x0.toFixed(2)},${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)},${((y0 + y1) / 2).toFixed(2)}`);
  }

  d.push('Z');
  return d.join(' ');
}

export function drawSingleStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
): void {
  if (stroke.points.length === 0) return;

  // Reference baseline width 700px so strokes scale cleanly across view sizes
  const scaleFactor = width / 700;
  const scaledPoints = stroke.points.map(([nx, ny, p]) => [
    nx * width,
    ny * height,
    p,
  ]);

  if (stroke.tool === 'marker') {
    const outline = getStroke(scaledPoints, {
      size: Math.max(4, stroke.size * scaleFactor),
      thinning: 0,
      smoothing: 0.45,
      streamline: 0.55,
      simulatePressure: false,
      last: true,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
    });

    if (outline.length === 0) return;
    const path = new Path2D(getSvgPathFromStroke(outline));
    ctx.save();
    ctx.globalAlpha = 0.36;
    ctx.fillStyle = stroke.color;
    ctx.fill(path);
    ctx.restore();
    return;
  }

  const outline = getStroke(scaledPoints, {
    size: Math.max(1.2, stroke.size * scaleFactor),
    thinning: 0.42,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
    last: true,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  });

  if (outline.length === 0) return;
  const path = new Path2D(getSvgPathFromStroke(outline));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = stroke.color;
  ctx.fill(path);
  ctx.restore();
}

export function renderStrokesToCanvas(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  width: number,
  height: number,
  options?: { clear?: boolean; multiplyMarkers?: boolean },
): void {
  const clear = options?.clear ?? true;
  if (clear) {
    ctx.clearRect(0, 0, width, height);
  }
  if (strokes.length === 0) return;

  // Draw markers first so ink pens sit crisply above markers
  for (const s of strokes) {
    if (s.tool === 'marker') {
      if (options?.multiplyMarkers) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        drawSingleStroke(ctx, s, width, height);
        ctx.restore();
      } else {
        drawSingleStroke(ctx, s, width, height);
      }
    }
  }

  for (const s of strokes) {
    if (s.tool === 'pen') {
      drawSingleStroke(ctx, s, width, height);
    }
  }
}

function distToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const vx = px - ax;
    const vy = py - ay;
    return vx * vx + vy * vy;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const rx = px - projX;
  const ry = py - projY;
  return rx * rx + ry * ry;
}

export function isPointNearStroke(
  nx: number,
  ny: number,
  stroke: Stroke,
  thresholdNorm = 0.018,
): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;

  const extraRadius = stroke.tool === 'marker' ? 0.012 : 0;
  const maxDistSq = (thresholdNorm + extraRadius) ** 2;

  if (pts.length === 1) {
    const dx = nx - pts[0][0];
    const dy = ny - pts[0][1];
    return dx * dx + dy * dy <= maxDistSq;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const dSq = distToSegmentSq(
      nx,
      ny,
      pts[i][0],
      pts[i][1],
      pts[i + 1][0],
      pts[i + 1][1],
    );
    if (dSq <= maxDistSq) return true;
  }

  return false;
}
