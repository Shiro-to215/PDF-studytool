import { useMemo } from 'react';
import type { PageState, Problem, Workbook } from '../../types/models';
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
}

export function RecordTab({
  workbook,
  pageStates,
  problems,
}: RecordTabProps) {
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
  } = useViewerStore();

  const layout = getSpreadLayout(
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
  );

  // Always show all currently visible pages together in reading (ascending page number) order
  const visiblePages = useMemo(() => {
    const pages = layout.pages.length > 0 ? layout.pages : [currentPage];
    return Array.from(new Set(pages)).sort((a, b) => a - b);
  }, [layout.pages, currentPage]);

  const pageStateMap = useMemo(
    () => new Map(pageStates.map((s) => [s.pageNumber, s])),
    [pageStates],
  );

  const problemsByPage = useMemo(() => {
    const map = new Map<number, Problem[]>();
    for (const p of problems) {
      const list = map.get(p.pageNumber);
      if (list) list.push(p);
      else map.set(p.pageNumber, [p]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order - b.order);
    }
    return map;
  }, [problems]);

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar p-3.5 space-y-3">
      {visiblePages.flatMap((pageNum) => {
        const pageProblems = problemsByPage.get(pageNum) ?? [];
        if (pageProblems.length > 0) {
          return pageProblems.map((prob) => (
            <RecordCard
              key={`prob:${prob.id}`}
              recordKey={`prob:${prob.id}`}
              values={{
                title: prob.numberLabel,
                status: prob.status,
                missReasons: prob.missReasons,
                hints: prob.hints,
                compactAnswer: prob.compactAnswer,
                memo: prob.memo,
              }}
              customReasons={workbook.customReasons}
              onPatch={(patch) => {
                void upsertProblem(prob.id, patch);
              }}
              onAddCustomReason={(reason) => {
                void addCustomMissReason(workbook.id, reason);
              }}
            />
          ));
        }

        const pageState = pageStateMap.get(pageNum);
        return [
          <RecordCard
            key={`page:${workbook.id}:${pageNum}`}
            recordKey={`page:${workbook.id}:${pageNum}`}
            values={{
              title: `P.${pageNum}`,
              status: pageState?.status ?? 'none',
              missReasons: pageState?.missReasons ?? [],
              hints: pageState?.hints ?? [],
              compactAnswer: pageState?.compactAnswer ?? '',
              memo: pageState?.memo ?? '',
            }}
            customReasons={workbook.customReasons}
            onPatch={(patch) => {
              void upsertPageState(workbook.id, pageNum, patch);
            }}
            onAddCustomReason={(reason) => {
              void addCustomMissReason(workbook.id, reason);
            }}
          />,
        ];
      })}
    </div>
  );
}
