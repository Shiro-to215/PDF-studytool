import { useMemo } from 'react';
import type { PageState, Problem, UnitNode, Workbook } from '../../types/models';
import {
  addCustomMissReason,
  upsertPageState,
  upsertProblem,
} from '../../db/database';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';
import { RecordCard } from './RecordCard';

interface RecordTabProps {
  workbook: Workbook;
  pageStates: PageState[];
  problems: Problem[];
  unitNodes: UnitNode[];
}

export function RecordTab({
  workbook,
  pageStates,
  problems,
  unitNodes,
}: RecordTabProps) {
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    selectedSpreadSide,
    setSelectedSpreadSide,
  } = useViewerStore();

  const layout = getSpreadLayout(
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
  );

  // Determine the active page number
  const activePageNumber = useMemo(() => {
    if (spreadMode === 'single') return layout.leftPage ?? currentPage;
    if (selectedSpreadSide === 'left') {
      return layout.leftPage ?? layout.rightPage ?? currentPage;
    }
    return layout.rightPage ?? layout.leftPage ?? currentPage;
  }, [spreadMode, layout, selectedSpreadSide, currentPage]);

  // Build unit path helper for problem subtitles
  const unitPathMap = useMemo(() => {
    const byId = new Map(unitNodes.map((u) => [u.id, u]));
    const cache = new Map<string, string>();
    const resolve = (id: string | null): string => {
      if (!id) return '';
      if (cache.has(id)) return cache.get(id)!;
      const node = byId.get(id);
      if (!node) return '';
      const parentPath = resolve(node.parentId);
      const full = parentPath ? `${parentPath} / ${node.name}` : node.name;
      cache.set(id, full);
      return full;
    };
    for (const u of unitNodes) resolve(u.id);
    return cache;
  }, [unitNodes]);

  const pageProblems = useMemo(
    () =>
      problems
        .filter((p) => p.pageNumber === activePageNumber)
        .sort((a, b) => a.order - b.order),
    [problems, activePageNumber],
  );

  const activePageState = useMemo(
    () => pageStates.find((s) => s.pageNumber === activePageNumber),
    [pageStates, activePageNumber],
  );

  const showSideSwitcher =
    spreadMode === 'double' && layout.leftPage !== null && layout.rightPage !== null;

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar p-3.5 space-y-3.5">
      {/* Left / Right Spread Page Selector */}
      {showSideSwitcher && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-medium text-base-content/60">記録対象ページ</span>
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-base-200 border border-base-300">
            <button
              type="button"
              onClick={() => setSelectedSpreadSide('left')}
              className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors ${
                selectedSpreadSide === 'left'
                  ? 'bg-base-100 text-base-content shadow-xs'
                  : 'text-base-content/60 hover:text-base-content'
              }`}
            >
              左 P.{layout.leftPage}
            </button>
            <button
              type="button"
              onClick={() => setSelectedSpreadSide('right')}
              className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors ${
                selectedSpreadSide === 'right'
                  ? 'bg-base-100 text-base-content shadow-xs'
                  : 'text-base-content/60 hover:text-base-content'
              }`}
            >
              右 P.{layout.rightPage}
            </button>
          </div>
        </div>
      )}

      {/* Problems linked to this page -> comfortable scrollable list of cards */}
      {pageProblems.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[11px] text-base-content/55 px-1">
            P.{activePageNumber} に紐づく問題（{pageProblems.length} 件）
          </p>
          {pageProblems.map((prob) => (
            <RecordCard
              key={prob.id}
              recordKey={`prob:${prob.id}`}
              values={{
                title: prob.numberLabel,
                subtitle: prob.unitId ? unitPathMap.get(prob.unitId) : undefined,
                status: prob.status,
                missReasons: prob.missReasons,
                hints: prob.hints,
                compactAnswer: prob.compactAnswer,
                memo: prob.memo,
              }}
              customReasons={workbook.customReasons}
              workbookTitle={workbook.title}
              pageNumber={prob.pageNumber}
              geminiChatUrl={workbook.geminiChatUrl}
              onPatch={(patch) => {
                void upsertProblem(prob.id, patch);
              }}
              onAddCustomReason={(reason) => {
                void addCustomMissReason(workbook.id, reason);
              }}
            />
          ))}
        </div>
      ) : (
        /* Default 1 Page = 1 Record */
        <RecordCard
          recordKey={`page:${workbook.id}:${activePageNumber}`}
          values={{
            title: `P.${activePageNumber}`,
            subtitle: 'ページ単位の学習記録',
            status: activePageState?.status ?? 'none',
            missReasons: activePageState?.missReasons ?? [],
            hints: activePageState?.hints ?? [],
            compactAnswer: activePageState?.compactAnswer ?? '',
            memo: activePageState?.memo ?? '',
          }}
          customReasons={workbook.customReasons}
          workbookTitle={workbook.title}
          pageNumber={activePageNumber}
          geminiChatUrl={workbook.geminiChatUrl}
          onPatch={(patch) => {
            void upsertPageState(workbook.id, activePageNumber, patch);
          }}
          onAddCustomReason={(reason) => {
            void addCustomMissReason(workbook.id, reason);
          }}
        />
      )}
    </div>
  );
}
