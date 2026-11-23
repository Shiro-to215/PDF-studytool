import { create } from 'zustand';
import type { BindingDirection, SpreadMode } from '../types/models';

export type SidebarTab = 'record' | 'toc' | 'review';

export interface SpreadLayout {
  leftPage: number | null;
  rightPage: number | null;
  pages: number[];
}

export function getSpreadLayout(
  currentPage: number,
  pageCount: number,
  spreadMode: SpreadMode,
  bindingDirection: BindingDirection,
  coverSinglePage: boolean,
): SpreadLayout {
  const safePage = Math.max(1, Math.min(pageCount || 1, currentPage));

  if (spreadMode === 'single') {
    return {
      leftPage: safePage,
      rightPage: null,
      pages: [safePage],
    };
  }

  let first: number | null = null;
  let second: number | null = null;

  if (coverSinglePage) {
    if (safePage === 1) {
      first = null;
      second = 1;
      // Put cover on the closing side: right for LTR, left for RTL
      return bindingDirection === 'ltr'
        ? { leftPage: null, rightPage: 1, pages: [1] }
        : { leftPage: 1, rightPage: null, pages: [1] };
    }
    const pairStart = safePage % 2 === 0 ? safePage : safePage - 1;
    first = pairStart;
    second = pairStart + 1 <= pageCount ? pairStart + 1 : null;
  } else {
    const pairStart = safePage % 2 === 1 ? safePage : safePage - 1;
    first = pairStart;
    second = pairStart + 1 <= pageCount ? pairStart + 1 : null;
  }

  const pages = [first, second].filter((n): n is number => n !== null);
  return bindingDirection === 'ltr'
    ? { leftPage: first, rightPage: second, pages }
    : { leftPage: second, rightPage: first, pages };
}

export function getNextSpreadPage(
  currentPage: number,
  pageCount: number,
  spreadMode: SpreadMode,
  coverSinglePage: boolean,
): number | null {
  if (spreadMode === 'single') {
    return currentPage < pageCount ? currentPage + 1 : null;
  }
  if (coverSinglePage) {
    if (currentPage === 1) {
      return pageCount >= 2 ? 2 : null;
    }
    const pairStart = currentPage % 2 === 0 ? currentPage : currentPage - 1;
    return pairStart + 2 <= pageCount ? pairStart + 2 : null;
  }
  const pairStart = currentPage % 2 === 1 ? currentPage : currentPage - 1;
  return pairStart + 2 <= pageCount ? pairStart + 2 : null;
}

export function getPrevSpreadPage(
  currentPage: number,
  spreadMode: SpreadMode,
  coverSinglePage: boolean,
): number | null {
  if (spreadMode === 'single') {
    return currentPage > 1 ? currentPage - 1 : null;
  }
  if (coverSinglePage) {
    if (currentPage <= 1) return null;
    const pairStart = currentPage % 2 === 0 ? currentPage : currentPage - 1;
    return pairStart <= 2 ? 1 : pairStart - 2;
  }
  const pairStart = currentPage % 2 === 1 ? currentPage : currentPage - 1;
  return pairStart - 2 >= 1 ? pairStart - 2 : null;
}

interface ViewerStore {
  activeWorkbookId: string | null;
  currentPage: number;
  pageCount: number;
  spreadMode: SpreadMode;
  bindingDirection: BindingDirection;
  coverSinglePage: boolean;
  scale: number;
  panX: number;
  panY: number;
  zoomResetSeq: number;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  tocUnitId: string | null;
  pageNavSeq: number;
  requestedRecordKey: string | null;
  requestedRecordSeq: number;

  openWorkbook: (params: {
    workbookId: string;
    pageCount: number;
    lastPage: number;
    spreadMode: SpreadMode;
    bindingDirection: BindingDirection;
    coverSinglePage: boolean;
    initialPage?: number;
    initialTab?: SidebarTab;
  }) => void;
  closeWorkbook: () => void;
  setCurrentPage: (page: number, options?: { syncToc?: boolean }) => void;
  setSpreadMode: (mode: SpreadMode) => void;
  setBindingDirection: (dir: BindingDirection) => void;
  setCoverSinglePage: (coverSingle: boolean) => void;
  setZoomPan: (scale: number, panX: number, panY: number) => void;
  resetZoom: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setTocUnitId: (unitId: string | null) => void;
  openRecordItem: (recordKey: string) => void;
}

export const useViewerStore = create<ViewerStore>((set, get) => ({
  activeWorkbookId: null,
  currentPage: 1,
  pageCount: 1,
  spreadMode: 'double',
  bindingDirection: 'ltr',
  coverSinglePage: false,
  scale: 1,
  panX: 0,
  panY: 0,
  zoomResetSeq: 0,
  sidebarOpen: true,
  sidebarTab: 'record',
  tocUnitId: null,
  pageNavSeq: 0,
  requestedRecordKey: null,
  requestedRecordSeq: 0,

  openWorkbook: ({
    workbookId,
    pageCount,
    lastPage,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    initialPage,
    initialTab,
  }) => {
    const targetPage = Math.max(1, Math.min(pageCount || 1, initialPage ?? lastPage ?? 1));

    set({
      activeWorkbookId: workbookId,
      currentPage: targetPage,
      pageCount,
      spreadMode,
      bindingDirection,
      coverSinglePage,
      scale: 1,
      panX: 0,
      panY: 0,
      tocUnitId: null,
      pageNavSeq: 0,
      requestedRecordKey: null,
      ...(initialTab ? { sidebarTab: initialTab, sidebarOpen: true } : {}),
    });
  },

  closeWorkbook: () =>
    set({
      activeWorkbookId: null,
      tocUnitId: null,
      pageNavSeq: 0,
      requestedRecordKey: null,
      scale: 1,
      panX: 0,
      panY: 0,
    }),

  setCurrentPage: (page, options) => {
    const { pageCount, currentPage, pageNavSeq } = get();
    const safePage = Math.max(1, Math.min(pageCount || 1, page));
    const shouldSyncToc = options?.syncToc !== false && safePage !== currentPage;
    set({
      currentPage: safePage,
      pageNavSeq: shouldSyncToc ? pageNavSeq + 1 : pageNavSeq,
      scale: 1,
      panX: 0,
      panY: 0,
    });
  },

  setSpreadMode: (spreadMode) =>
    set({
      spreadMode,
      scale: 1,
      panX: 0,
      panY: 0,
    }),

  setBindingDirection: (bindingDirection) => set({ bindingDirection }),
  setCoverSinglePage: (coverSinglePage) => set({ coverSinglePage }),

  setZoomPan: (scale, panX, panY) =>
    set({
      scale: Math.max(0.85, Math.min(8.8, scale)),
      panX,
      panY,
    }),

  resetZoom: () => set((s) => ({ zoomResetSeq: s.zoomResetSeq + 1 })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarTab: (sidebarTab) => set({ sidebarTab, sidebarOpen: true }),
  setTocUnitId: (tocUnitId) => set({ tocUnitId }),
  openRecordItem: (recordKey) =>
    set((s) => ({
      sidebarTab: 'record',
      sidebarOpen: true,
      requestedRecordKey: recordKey,
      requestedRecordSeq: s.requestedRecordSeq + 1,
    })),
}));
