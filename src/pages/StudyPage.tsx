import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileUp } from 'lucide-react';
import {
  db,
  getWorkbookPdfBytes,
  relinkWorkbookPdf,
  updateWorkbookSettings,
} from '../db/database';
import type {
  PageState,
  PageStrokes,
  Problem,
  UnitNode,
} from '../types/models';
import { PdfDocumentManager } from '../utils/pdfEngine';
import { getSpreadLayout, useViewerStore } from '../stores/useViewerStore';
import { TopBar } from '../components/toolbar/TopBar';
import { FloatingToolPalette } from '../components/toolbar/FloatingToolPalette';
import {
  FlipBookViewer,
  type FlipBookViewerHandle,
} from '../components/book/FlipBookViewer';
import { StudySidebar } from '../components/sidebar/StudySidebar';
import { ImportIndexModal } from '../components/home/ImportIndexModal';

interface StudyPageProps {
  workbookId: string;
}

export function StudyPage({ workbookId }: StudyPageProps) {
  const viewerRef = useRef<FlipBookViewerHandle | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    pageNavSeq,
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

  const allPageStrokes = useLiveQuery(
    () => db.pageStrokes.where('workbookId').equals(workbookId).toArray(),
    [workbookId],
    [] as PageStrokes[],
  );

  const [pdfManager, setPdfManager] = useState<PdfDocumentManager | null>(null);
  const [aspectRatio, setAspectRatio] = useState(0.707);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [relinking, setRelinking] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const lastSavedPageRef = useRef<number | null>(null);
  const lastSyncedNavSeqRef = useRef(0);

  // Initialize PdfDocumentManager from pdfFiles (ArrayBuffer) strictly per workbookId / reloadSeq
  useEffect(() => {
    let cancelled = false;
    const manager = new PdfDocumentManager();
    setPdfError(null);
    setPdfManager(null);

    void Promise.all([db.workbooks.get(workbookId), getWorkbookPdfBytes(workbookId)])
      .then(([wb, bytes]) => {
        if (cancelled) return null;
        if (wb) {
          lastSavedPageRef.current = wb.lastPage;
        }
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

  // Persist lastPage gently without triggering PDF reload
  useEffect(() => {
    if (lastSavedPageRef.current === currentPage) return;
    const timer = setTimeout(() => {
      lastSavedPageRef.current = currentPage;
      void updateWorkbookSettings(workbookId, { lastPage: currentPage });
    }, 350);
    return () => clearTimeout(timer);
  }, [workbookId, currentPage]);

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
        {/* Book Stage + Floating Hamburger Menu + Floating Pen Palette */}
        <div
          ref={stageContainerRef}
          className="relative flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          <TopBar workbook={workbook} />

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
            />
          )}

          <FloatingToolPalette
            workbookId={workbook.id}
            boundsRef={stageContainerRef}
            onUndo={() => viewerRef.current?.undo()}
            onRedo={() => viewerRef.current?.redo()}
          />
        </div>

        {/* Right Sidebar */}
        <StudySidebar
          workbook={workbook}
          pageStates={pageStates}
          unitNodes={unitNodes}
          problems={problems}
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
    </div>
  );
}
