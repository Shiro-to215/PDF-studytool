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
  { label: '細', pen: 2.2, marker: 12 },
  { label: '中', pen: 3.6, marker: 20 },
  { label: '太', pen: 5.5, marker: 30 },
] as const;

interface HistoryBucket {
  past: Stroke[][];
  future: Stroke[][];
}

interface ToolStore {
  interactionMode: InteractionMode;
  tool: DrawingTool;
  penColor: string;
  markerColor: string;
  sizeIndex: 0 | 1 | 2;
  activeLayer: string;
  hiddenLayers: string[];
  allInkHidden: boolean;
  historyByKey: Record<string, HistoryBucket>;

  setInteractionMode: (mode: InteractionMode) => void;
  toggleInteractionMode: () => void;
  setTool: (tool: DrawingTool) => void;
  setPenColor: (color: string) => void;
  setMarkerColor: (color: string) => void;
  setSizeIndex: (idx: 0 | 1 | 2) => void;
  setActiveLayer: (layer: string) => void;
  toggleLayerVisibility: (layer: string) => void;
  setAllInkHidden: (hidden: boolean) => void;
  toggleAllInkHidden: () => void;

  pushHistory: (key: string, previousStrokes: Stroke[]) => void;
  popUndo: (key: string, currentStrokes: Stroke[]) => Stroke[] | null;
  popRedo: (key: string, currentStrokes: Stroke[]) => Stroke[] | null;
  canUndo: (key: string) => boolean;
  canRedo: (key: string) => boolean;
}

export const useToolStore = create<ToolStore>((set, get) => ({
  interactionMode: 'flip',
  tool: 'pen',
  penColor: '#2563eb',
  markerColor: '#fde047',
  sizeIndex: 1,
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
  setSizeIndex: (sizeIndex) => set({ sizeIndex }),
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

  pushHistory: (key, previousStrokes) =>
    set((s) => {
      const bucket = s.historyByKey[key] ?? { past: [], future: [] };
      const nextPast = [...bucket.past, previousStrokes].slice(-40);
      return {
        historyByKey: {
          ...s.historyByKey,
          [key]: { past: nextPast, future: [] },
        },
      };
    }),

  popUndo: (key, currentStrokes) => {
    const bucket = get().historyByKey[key];
    if (!bucket || bucket.past.length === 0) return null;
    const restored = bucket.past[bucket.past.length - 1];
    const nextPast = bucket.past.slice(0, -1);
    const nextFuture = [...bucket.future, currentStrokes].slice(-40);
    set((s) => ({
      historyByKey: {
        ...s.historyByKey,
        [key]: { past: nextPast, future: nextFuture },
      },
    }));
    return restored;
  },

  popRedo: (key, currentStrokes) => {
    const bucket = get().historyByKey[key];
    if (!bucket || bucket.future.length === 0) return null;
    const restored = bucket.future[bucket.future.length - 1];
    const nextFuture = bucket.future.slice(0, -1);
    const nextPast = [...bucket.past, currentStrokes].slice(-40);
    set((s) => ({
      historyByKey: {
        ...s.historyByKey,
        [key]: { past: nextPast, future: nextFuture },
      },
    }));
    return restored;
  },

  canUndo: (key) => (get().historyByKey[key]?.past.length ?? 0) > 0,
  canRedo: (key) => (get().historyByKey[key]?.future.length ?? 0) > 0,
}));
