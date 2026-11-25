import { create } from 'zustand';
import type { Stroke } from '../types/models';

export type InteractionMode = 'flip' | 'draw';
export type DrawingTool = 'pen' | 'marker' | 'eraser';

export const PEN_COLOR_OPTIONS = [
  { label: '黒', value: '#18181b' },
  { label: '青', value: '#2563eb' },
  { label: '赤', value: '#dc2626' },
  { label: '緑', value: '#059669' },
] as const;

export const MARKER_COLOR_OPTIONS = [
  { label: '黄マーカー', value: '#fde047' },
  { label: '桃マーカー', value: '#f9a8d4' },
  { label: '水色マーカー', value: '#7dd3fc' },
] as const;

export const SIZE_OPTIONS = [
  { label: '細', eraserLabel: '小', pen: 2.2, marker: 12, eraser: 14 },
  { label: '中', eraserLabel: '中', pen: 3.6, marker: 20, eraser: 28 },
  { label: '太', eraserLabel: '大', pen: 5.5, marker: 30, eraser: 52 },
] as const;

export type PageStrokesSnapshot = Record<number, Stroke[]>;

interface HistoryBucket {
  past: PageStrokesSnapshot[];
  future: PageStrokesSnapshot[];
}

function snapshotTouchesVisible(
  snapshot: PageStrokesSnapshot | undefined,
  visiblePages: number[],
): boolean {
  if (!snapshot || visiblePages.length === 0) return false;
  for (const key of Object.keys(snapshot)) {
    if (visiblePages.includes(Number(key))) return true;
  }
  return false;
}

function findLastIndexTouchingVisible(
  list: PageStrokesSnapshot[],
  visiblePages: number[],
): number {
  if (list.length === 0 || visiblePages.length === 0) return -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (snapshotTouchesVisible(list[i], visiblePages)) return i;
  }
  return -1;
}

function snapshotSharesAnyPage(
  a: PageStrokesSnapshot,
  b: PageStrokesSnapshot,
): boolean {
  for (const key of Object.keys(b)) {
    if (key in a) return true;
  }
  return false;
}

interface ToolStore {
  interactionMode: InteractionMode;
  tool: DrawingTool;
  penColor: string;
  markerColor: string;
  penSizeIndex: 0 | 1 | 2;
  markerSizeIndex: 0 | 1 | 2;
  eraserSizeIndex: 0 | 1 | 2;
  activeLayer: string;
  hiddenLayers: string[];
  allInkHidden: boolean;
  historyByKey: Record<string, HistoryBucket>;

  setInteractionMode: (mode: InteractionMode) => void;
  toggleInteractionMode: () => void;
  setTool: (tool: DrawingTool) => void;
  setPenColor: (color: string) => void;
  setMarkerColor: (color: string) => void;
  setPenSizeIndex: (idx: 0 | 1 | 2) => void;
  setMarkerSizeIndex: (idx: 0 | 1 | 2) => void;
  setEraserSizeIndex: (idx: 0 | 1 | 2) => void;
  setActiveLayer: (layer: string) => void;
  toggleLayerVisibility: (layer: string) => void;
  setAllInkHidden: (hidden: boolean) => void;
  toggleAllInkHidden: () => void;

  pushHistory: (key: string, previousByPage: PageStrokesSnapshot) => void;
  popUndo: (
    key: string,
    visiblePages: number[],
    getCurrent: (pageNum: number) => Stroke[],
  ) => PageStrokesSnapshot | null;
  popRedo: (
    key: string,
    visiblePages: number[],
    getCurrent: (pageNum: number) => Stroke[],
  ) => PageStrokesSnapshot | null;
  canUndo: (key: string, visiblePages: number[]) => boolean;
  canRedo: (key: string, visiblePages: number[]) => boolean;
}

export const useToolStore = create<ToolStore>((set, get) => ({
  interactionMode: 'flip',
  tool: 'pen',
  penColor: '#2563eb',
  markerColor: '#fde047',
  penSizeIndex: 1,
  markerSizeIndex: 1,
  eraserSizeIndex: 1,
  activeLayer: '1周目',
  hiddenLayers: [],
  allInkHidden: false,
  historyByKey: {},

  setInteractionMode: (interactionMode) => set({ interactionMode }),
  toggleInteractionMode: () =>
    set((s) => ({ interactionMode: s.interactionMode === 'flip' ? 'draw' : 'flip' })),
  setTool: (tool) => set({ tool }),
  setPenColor: (penColor) => set({ penColor, tool: 'pen' }),
  setMarkerColor: (markerColor) => set({ markerColor, tool: 'marker' }),
  setPenSizeIndex: (penSizeIndex) => set({ penSizeIndex }),
  setMarkerSizeIndex: (markerSizeIndex) => set({ markerSizeIndex }),
  setEraserSizeIndex: (eraserSizeIndex) => set({ eraserSizeIndex }),
  setActiveLayer: (activeLayer) =>
    set((s) => ({
      activeLayer,
      hiddenLayers: s.hiddenLayers.filter((l) => l !== activeLayer),
      allInkHidden: false,
    })),

  toggleLayerVisibility: (layer) =>
    set((s) => ({
      hiddenLayers: s.hiddenLayers.includes(layer)
        ? s.hiddenLayers.filter((l) => l !== layer)
        : [...s.hiddenLayers, layer],
    })),

  setAllInkHidden: (allInkHidden) => set({ allInkHidden }),
  toggleAllInkHidden: () => set((s) => ({ allInkHidden: !s.allInkHidden })),

  pushHistory: (key, previousByPage) =>
    set((s) => {
      const bucket = s.historyByKey[key] ?? { past: [], future: [] };
      const nextPast = [...bucket.past, previousByPage].slice(-80);
      const nextFuture = bucket.future.filter(
        (snap) => !snapshotSharesAnyPage(previousByPage, snap),
      );
      return {
        historyByKey: {
          ...s.historyByKey,
          [key]: { past: nextPast, future: nextFuture },
        },
      };
    }),

  popUndo: (key, visiblePages, getCurrent) => {
    const bucket = get().historyByKey[key];
    if (!bucket || bucket.past.length === 0) return null;
    const idx = findLastIndexTouchingVisible(bucket.past, visiblePages);
    if (idx < 0) return null;
    const restored = bucket.past[idx];

    const currentSnap: PageStrokesSnapshot = {};
    for (const pStr of Object.keys(restored)) {
      const pageNum = Number(pStr);
      currentSnap[pageNum] = getCurrent(pageNum);
    }

    const nextPast = [...bucket.past.slice(0, idx), ...bucket.past.slice(idx + 1)];
    const nextFuture = [...bucket.future, currentSnap].slice(-80);
    set((s) => ({
      historyByKey: {
        ...s.historyByKey,
        [key]: { past: nextPast, future: nextFuture },
      },
    }));
    return restored;
  },

  popRedo: (key, visiblePages, getCurrent) => {
    const bucket = get().historyByKey[key];
    if (!bucket || bucket.future.length === 0) return null;
    const idx = findLastIndexTouchingVisible(bucket.future, visiblePages);
    if (idx < 0) return null;
    const restored = bucket.future[idx];

    const currentSnap: PageStrokesSnapshot = {};
    for (const pStr of Object.keys(restored)) {
      const pageNum = Number(pStr);
      currentSnap[pageNum] = getCurrent(pageNum);
    }

    const nextFuture = [...bucket.future.slice(0, idx), ...bucket.future.slice(idx + 1)];
    const nextPast = [...bucket.past, currentSnap].slice(-80);
    set((s) => ({
      historyByKey: {
        ...s.historyByKey,
        [key]: { past: nextPast, future: nextFuture },
      },
    }));
    return restored;
  },

  canUndo: (key, visiblePages) => {
    const bucket = get().historyByKey[key];
    if (!bucket || bucket.past.length === 0) return false;
    return findLastIndexTouchingVisible(bucket.past, visiblePages) >= 0;
  },

  canRedo: (key, visiblePages) => {
    const bucket = get().historyByKey[key];
    if (!bucket || bucket.future.length === 0) return false;
    return findLastIndexTouchingVisible(bucket.future, visiblePages) >= 0;
  },
}));
