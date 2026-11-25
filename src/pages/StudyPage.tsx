import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileUp } from 'lucide-react';
import {
  db,
  getPageStrokesId,
  getWorkbookPdfBytes,
  relinkWorkbookPdf,
  updateWorkbookSettings,
} from '../db/database';
import {
  resolveActiveLayer,
  resolveRoundRecord,
  type PageState,
  type PageStrokes,
  type Problem,
  type UnitNode,
} from '../types/models';
import { PdfDocumentManager } from '../utils/pdfEngine';
import {
  getNextSpreadPage,
  getPrevSpreadPage,
  getSpreadLayout,
  useViewerStore,
} from '../stores/useViewerStore';
import { useToolStore } from '../stores/useToolStore';
import { TopBar } from '../components/toolbar/TopBar';
import {
  FloatingToolPalette,
  type FloatingToolPaletteHandle,
} from '../components/toolbar/FloatingToolPalette';
import {
  FlipBookViewer,
  type FlipBookViewerHandle,
} from '../components/book/FlipBookViewer';
import {
  StudySidebar,
  type StudySidebarHandle,
} from '../components/sidebar/StudySidebar';
import { ImportIndexModal } from '../components/home/ImportIndexModal';
import { WorkbookSettingsModal } from '../components/home/WorkbookSettingsModal';

const SIDEBAR_ANIM_DURATION_MS = 400;
const DESKTOP_LG_BREAKPOINT = 1024;

interface StudyPageProps {
  workbookId: string;
}

export function StudyPage({ workbookId }: StudyPageProps) {
  const viewerRef = useRef<FlipBookViewerHandle | null>(null);
  const paletteRef = useRef<FloatingToolPaletteHandle | null>(null);
  const sidebarRef = useRef<StudySidebarHandle | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    sidebarOpen,
    pageNavSeq,
    setSpreadMode,
    setPageCount,
    setBindingDirection,
    setCoverSinglePage,
    setTocUnitId,
    closeWorkbook,
  } = useViewerStore();

  const workbook = useLiveQuery(
    () => db.workbooks.get(workbookId),
    [workbookId],
  );

  const pageStates = useLiveQuery(
    () => db.pageStates.where('workbookId').equals(workbookId).toArray(),
    [workbookId],
    [] as PageState[],
  );

  const unitNodes = useLiveQuery(
    () => db.unitNodes.where('workbookId').equals(workbookId).toArray(),
    [workbookId],
    [] as UnitNode[],
  );

  const problems = useLiveQuery(
    () => db.problems.where('workbookId').equals(workbookId).toArray(),
    [workbookId],
    [] as Problem[],
  );

  const activeRound = workbook ? resolveActiveLayer(workbook) : '1周目';
  const workbookReadyLayer = workbook ? activeRound : null;
  const firstRound = workbook?.layers[0] ?? '1周目';

  // Fetch pen strokes ONLY for the current spread + adjacent spreads of the active round
  // via O(1) primary-key bulkGet, expanding as the user turns pages instead of scanning all rounds/pages.
  const strokeTargetPages = useMemo(() => {
    if (pageCount <= 0) return [] as number[];
    const pages = new Set<number>();
    const pushSpread = (anchorPage: number | null) => {
      if (anchorPage === null) return;
      const sp = getSpreadLayout(
        anchorPage,
        pageCount,
        spreadMode,
        bindingDirection,
        coverSinglePage,
      );
      if (sp.leftPage !== null) pages.add(sp.leftPage);
      if (sp.rightPage !== null) pages.add(sp.rightPage);
    };

    const next1 = getNextSpreadPage(currentPage, pageCount, spreadMode, coverSinglePage);
    const prev1 = getPrevSpreadPage(currentPage, spreadMode, coverSinglePage);
    const next2 =
      next1 !== null
        ? getNextSpreadPage(next1, pageCount, spreadMode, coverSinglePage)
        : null;
    const prev2 =
      prev1 !== null
        ? getPrevSpreadPage(prev1, spreadMode, coverSinglePage)
        : null;

    pushSpread(currentPage);
    pushSpread(next1);
    pushSpread(prev1);
    pushSpread(next2);
    pushSpread(prev2);
    return Array.from(pages).sort((a, b) => a - b);
  }, [currentPage, pageCount, spreadMode, bindingDirection, coverSinglePage]);

  const strokeTargetPagesKey = strokeTargetPages.join(',');

  const allPageStrokes = useLiveQuery(
    async () => {
      if (!workbookReadyLayer || strokeTargetPages.length === 0) {
        return [] as PageStrokes[];
      }
      const keys = strokeTargetPages.map((p) =>
        getPageStrokesId(workbookId, p, workbookReadyLayer),
      );
      const records = await db.pageStrokes.bulkGet(keys);
      return records.filter((r): r is PageStrokes => r !== undefined);
    },
    [workbookId, workbookReadyLayer, strokeTargetPagesKey],
    [] as PageStrokes[],
  );

  const [pdfManager, setPdfManager] = useState<PdfDocumentManager | null>(null);
  const [aspectRatio, setAspectRatio] = useState(0.707);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [relinking, setRelinking] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settledRightInset, setSettledRightInset] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= DESKTOP_LG_BREAKPOINT && sidebarOpen
      ? 350
      : 0,
  );
  const lastSavedPageRef = useRef<number | null>(null);
  const lastSyncedNavSeqRef = useRef(0);
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  const sidebarProgressRef = useRef(sidebarOpen ? 1 : 0);
  const sidebarAnimRafRef = useRef<number | null>(null);
  const sidebarInitializedRef = useRef(false);

  const isWorkbookReady = Boolean(workbook);
  const setActiveLayer = useToolStore((s) => s.setActiveLayer);

  // Keep drawing tool's activeLayer strictly synced to the workbook's active round
  useEffect(() => {
    if (!workbook) return;
    setActiveLayer(activeRound);
  }, [workbook?.id, activeRound, setActiveLayer]);

  // Keep viewer display settings & pageCount synced when updated via WorkbookSettingsModal or PDF relink
  useEffect(() => {
    if (!workbook) return;
    setPageCount(workbook.pageCount);
    setBindingDirection(workbook.bindingDirection);
    setCoverSinglePage(workbook.coverSinglePage);
    setSpreadMode(workbook.defaultSpread);
  }, [
    workbook?.id,
    workbook?.pageCount,
    workbook?.bindingDirection,
    workbook?.coverSinglePage,
    workbook?.defaultSpread,
    setPageCount,
    setBindingDirection,
    setCoverSinglePage,
    setSpreadMode,
  ]);

  // Project problems & pageStates onto the active round so Record / TOC / Review all reflect it
  const activeProblems = useMemo(
    () =>
      problems.map((p) => {
        const rec = resolveRoundRecord(p, activeRound, firstRound);
        return rec.status === p.status && rec.missReasons === p.missReasons
          ? p
          : { ...p, status: rec.status, missReasons: rec.missReasons };
      }),
    [problems, activeRound, firstRound],
  );

  const activePageStates = useMemo(
    () =>
      pageStates.map((s) => {
        const rec = resolveRoundRecord(s, activeRound, firstRound);
        return rec.status === s.status && rec.missReasons === s.missReasons
          ? s
          : { ...s, status: rec.status, missReasons: rec.missReasons };
      }),
    [pageStates, activeRound, firstRound],
  );

  const getLayoutShift = useCallback(() => {
    const containerW =
      stageContainerRef.current?.getBoundingClientRect().width ??
      (typeof window !== 'undefined' ? window.innerWidth : 0);
    if (containerW < DESKTOP_LG_BREAKPOINT) return 0;
    return sidebarRef.current?.getWidth() ?? 350;
  }, []);

  const applySidebarSyncFrame = useCallback((t: number, layoutShift: number) => {
    const clamped = Math.max(0, Math.min(1, t));
    sidebarProgressRef.current = clamped;
    sidebarRef.current?.setSlideProgress(clamped);
    viewerRef.current?.setSidebarAnimFrame(clamped, layoutShift);
    paletteRef.current?.setLiveRightInset(clamped * layoutShift);
  }, []);

  // Unified single-rAF 400ms linear animation syncing sidebar, PDF zoom+shift, right arrow, and pen palette
  useLayoutEffect(() => {
    if (!isWorkbookReady) {
      sidebarInitializedRef.current = false;
      return;
    }

    const layoutShift = getLayoutShift();
    const targetT = sidebarOpen ? 1 : 0;

    if (!sidebarInitializedRef.current) {
      sidebarInitializedRef.current = true;
      const nextInset = sidebarOpen ? layoutShift : 0;
      setSettledRightInset(nextInset);
      applySidebarSyncFrame(targetT, layoutShift);
      return;
    }

    if (sidebarAnimRafRef.current !== null) {
      cancelAnimationFrame(sidebarAnimRafRef.current);
      sidebarAnimRafRef.current = null;
    }

    const startT = sidebarProgressRef.current;
    const dist = Math.abs(targetT - startT);

    // When closing, immediately restore full-width high-DPI PDF layout before first paint while
    // keeping visual size/position identical via startT transform so zoom-in stays razor sharp.
    if (targetT === 0) {
      setSettledRightInset(0);
    }

    if (dist < 0.001) {
      applySidebarSyncFrame(targetT, layoutShift);
      setSettledRightInset(targetT === 1 ? layoutShift : 0);
      if (targetT === 0) {
        viewerRef.current?.reclampZoom();
      }
      return;
    }

    // Apply exact frame 0 synchronously before browser paint
    applySidebarSyncFrame(startT, layoutShift);

    const duration = Math.max(1, SIDEBAR_ANIM_DURATION_MS * dist);
    const startTime = performance.now();

    const tick = (now: number) => {
      const u = Math.min(1, (now - startTime) / duration);
      // Gentle ease-out matching cubic-bezier(0.22, 1, 0.36, 1) across all 4 synced elements
      const eased = 1 - Math.pow(1 - u, 3.2);
      const curT = startT + (targetT - startT) * eased;
      applySidebarSyncFrame(curT, layoutShift);

      if (u < 1) {
        sidebarAnimRafRef.current = requestAnimationFrame(tick);
      } else {
        sidebarAnimRafRef.current = null;
        setSettledRightInset(targetT === 1 ? layoutShift : 0);
        if (targetT === 0) {
          viewerRef.current?.reclampZoom();
        }
      }
    };

    sidebarAnimRafRef.current = requestAnimationFrame(tick);
  }, [sidebarOpen, isWorkbookReady, getLayoutShift, applySidebarSyncFrame]);

  // Keep synced on viewport resize / iPad rotation when not actively animating
  useEffect(() => {
    if (!isWorkbookReady) return;
    const el = stageContainerRef.current;
    if (!el) return;

    const handleResize = () => {
      if (sidebarAnimRafRef.current !== null) return;
      const layoutShift = getLayoutShift();
      const t = sidebarOpenRef.current ? 1 : 0;
      setSettledRightInset(t === 1 ? layoutShift : 0);
      applySidebarSyncFrame(t, layoutShift);
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isWorkbookReady, getLayoutShift, applySidebarSyncFrame]);

  useEffect(() => {
    return () => {
      if (sidebarAnimRafRef.current !== null) {
        cancelAnimationFrame(sidebarAnimRafRef.current);
        sidebarAnimRafRef.current = null;
      }
    };
  }, []);

  // Initialize PdfDocumentManager from pdfFiles (ArrayBuffer) strictly per workbookId / reloadSeq
  useEffect(() => {
    let cancelled = false;
    const manager = new PdfDocumentManager();
    setPdfError(null);
    setPdfManager(null);

    void getWorkbookPdfBytes(workbookId)
      .then((bytes) => {
        if (cancelled) return null;
        return manager.load(bytes);
      })
      .then((meta) => {
        if (!meta) return;
        if (cancelled) {
          void manager.destroy();
          return;
        }
        setAspectRatio(meta.aspectRatio);
        setPdfManager(manager);
      })
      .catch((err) => {
        if (!cancelled) {
          setPdfError(err instanceof Error ? err.message : 'PDFの読み込みに失敗しました。');
        }
      });

    return () => {
      cancelled = true;
      setPdfManager(null);
      void manager.destroy();
    };
  }, [workbookId, reloadSeq]);

  // Reset saved-page tracker when switching workbooks
  useEffect(() => {
    lastSavedPageRef.current = null;
  }, [workbookId]);

  // Persist lastPage gently without triggering PDF reload or spurious writes on initial open
  useEffect(() => {
    if (!workbook) return;
    if (lastSavedPageRef.current === null) {
      lastSavedPageRef.current = workbook.lastPage;
    }
    if (lastSavedPageRef.current === currentPage) return;
    const timer = setTimeout(() => {
      lastSavedPageRef.current = currentPage;
      void updateWorkbookSettings(workbookId, { lastPage: currentPage });
    }, 350);
    return () => clearTimeout(timer);
  }, [workbook, workbookId, currentPage]);

  // Reset TOC sync tracker when switching workbooks
  useEffect(() => {
    lastSyncedNavSeqRef.current = 0;
  }, [workbookId]);

  // Sync TOC hierarchy automatically on page turns (prefers the earlier page / earlier problem)
  useEffect(() => {
    if (pageNavSeq === 0 || pageNavSeq === lastSyncedNavSeqRef.current) return;
    lastSyncedNavSeqRef.current = pageNavSeq;

    if (unitNodes.length === 0 || problems.length === 0) return;

    const layout = getSpreadLayout(
      currentPage,
      pageCount,
      spreadMode,
      bindingDirection,
      coverSinglePage,
    );
    const visiblePages = Array.from(
      new Set(layout.pages.length > 0 ? layout.pages : [currentPage]),
    ).sort((a, b) => a - b);

    const validUnitIds = new Set(unitNodes.map((u) => u.id));
    for (const pageNum of visiblePages) {
      const firstLinked = problems
        .filter((p) => p.pageNumber === pageNum && p.unitId !== null && validUnitIds.has(p.unitId))
        .sort((a, b) => a.order - b.order)[0];
      if (firstLinked?.unitId) {
        setTocUnitId(firstLinked.unitId);
        return;
      }
    }
  }, [
    pageNavSeq,
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    unitNodes,
    problems,
    setTocUnitId,
  ]);

  const handleRelinkPdf = async (file: File | null) => {
    if (!file) return;
    setRelinking(true);
    try {
      await relinkWorkbookPdf(workbookId, file);
      setPdfError(null);
      setReloadSeq((n) => n + 1);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'PDFの再読み込みに失敗しました。');
    } finally {
      setRelinking(false);
    }
  };

  if (workbook === undefined) {
    return (
      <div className="fixed inset-0 h-[100dvh] w-[100dvw] flex items-center justify-center bg-base-200 overflow-hidden">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  if (workbook === null) {
    return (
      <div className="fixed inset-0 h-[100dvh] w-[100dvw] flex flex-col items-center justify-center gap-3 bg-base-200 p-4 text-center overflow-hidden">
        <p className="text-sm text-base-content/70">ワークブックが見つかりませんでした。</p>
        <button type="button" onClick={closeWorkbook} className="btn btn-primary btn-sm">
          本棚へ戻る
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] w-[100dvw] flex flex-col overflow-hidden bg-base-200 text-base-content">
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Book Stage + Floating Hamburger Menu + Floating Pen Palette (always full width; sidebar offset driven by single rAF) */}
        <div
          ref={stageContainerRef}
          className="relative flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          <TopBar
            workbook={workbook}
            problems={problems}
            pageStates={pageStates}
            onOpenImport={() => setImportOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />

          {pdfError ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center">
              <div className="rounded-2xl bg-base-100 border border-base-300 p-6 max-w-sm space-y-3">
                <p className="text-sm font-semibold text-error">PDFを表示できませんでした</p>
                <p className="text-xs text-base-content/65 leading-relaxed">{pdfError}</p>
                <p className="text-[11px] text-base-content/50 leading-relaxed">
                  手書きや問題記録は保持されています。PDFファイルを選び直すとそのまま復旧できます。
                </p>
                <input
                  ref={relinkInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    void handleRelinkPdf(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={relinking}
                  onClick={() => relinkInputRef.current?.click()}
                  className="btn btn-primary btn-sm gap-1.5"
                >
                  <FileUp className="w-4 h-4" />
                  {relinking ? '修復中...' : 'PDFファイルを選び直して修復'}
                </button>
              </div>
            </div>
          ) : (
            <FlipBookViewer
              ref={viewerRef}
              workbookId={workbook.id}
              pdfManager={pdfManager}
              aspectRatio={aspectRatio}
              layers={workbook.layers}
              allPageStrokes={allPageStrokes}
              rightInset={settledRightInset}
            />
          )}

          <FloatingToolPalette
            ref={paletteRef}
            workbookId={workbook.id}
            boundsRef={stageContainerRef}
            onUndo={() => viewerRef.current?.undo()}
            onRedo={() => viewerRef.current?.redo()}
          />
        </div>

        {/* Right Sidebar (with dual-purpose overhang ear tab, synced 1:1 with StudyPage rAF) */}
        <StudySidebar
          ref={sidebarRef}
          workbook={workbook}
          activeRound={activeRound}
          pageStates={activePageStates}
          unitNodes={unitNodes}
          problems={activeProblems}
          onOpenImport={() => setImportOpen(true)}
        />
      </div>

      {importOpen && (
        <ImportIndexModal
          open={importOpen}
          workbookId={workbook.id}
          workbookTitle={workbook.title}
          onClose={() => setImportOpen(false)}
        />
      )}

      {settingsOpen && (
        <WorkbookSettingsModal
          workbook={workbook}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
