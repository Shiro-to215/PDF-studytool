import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveWorkbookMissReasons,
  type PageState,
  type Problem,
  type Workbook,
} from '../../types/models';
import {
  updateWorkbookMissReasons,
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
    requestedRecordKey,
    requestedRecordSeq,
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

  // Allow only one RecordCard expanded at a time (auto-collapse others)
  const [openRecordKey, setOpenRecordKey] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastHandledReqSeqRef = useRef(requestedRecordSeq);
  const visiblePagesKey = visiblePages.join(',');
  useEffect(() => {
    setOpenRecordKey(null);
  }, [visiblePagesKey, workbook.id]);

  // Auto-open & scroll into view when jumped from ReviewTab
  useEffect(() => {
    if (requestedRecordSeq === lastHandledReqSeqRef.current) return;
    lastHandledReqSeqRef.current = requestedRecordSeq;
    if (!requestedRecordKey) return;
    setOpenRecordKey(requestedRecordKey);

    const frame = window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(
        `[data-record-key="${CSS.escape(requestedRecordKey)}"]`,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedRecordKey, requestedRecordSeq]);

  const handleToggleCard = (key: string) => {
    setOpenRecordKey((prev) => (prev === key ? null : key));
  };

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

  const reasonOptions = useMemo(() => resolveWorkbookMissReasons(workbook), [workbook]);

  const handleSaveReasonOptions = (
    nextReasons: string[],
    renameMap: Record<string, string>,
  ) => {
    void updateWorkbookMissReasons(workbook.id, nextReasons, renameMap);
  };

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto thin-scrollbar p-3.5 space-y-3"
    >
      {visiblePages.flatMap((pageNum) => {
        const pageProblems = problemsByPage.get(pageNum) ?? [];
        if (pageProblems.length > 0) {
          return pageProblems.map((prob) => {
            const cardKey = `prob:${prob.id}`;
            return (
              <div key={cardKey} data-record-key={cardKey}>
                <RecordCard
                  recordKey={cardKey}
                  isOpen={openRecordKey === cardKey}
                  onToggle={() => handleToggleCard(cardKey)}
                  values={{
                    title: prob.numberLabel,
                    status: prob.status,
                    missReasons: prob.missReasons,
                    hints: prob.hints,
                    compactAnswer: prob.compactAnswer,
                    answerEntries: prob.answerEntries,
                    memo: prob.memo,
                  }}
                  reasonOptions={reasonOptions}
                  onPatch={(patch) => {
                    void upsertProblem(prob.id, patch);
                  }}
                  onSaveReasonOptions={handleSaveReasonOptions}
                />
              </div>
            );
          });
        }

        const pageState = pageStateMap.get(pageNum);
        const pageKey = `page:${workbook.id}:${pageNum}`;
        return [
          <div key={pageKey} data-record-key={pageKey}>
            <RecordCard
              recordKey={pageKey}
              isOpen={openRecordKey === pageKey}
              onToggle={() => handleToggleCard(pageKey)}
              values={{
                title: `P.${pageNum}`,
                status: pageState?.status ?? 'none',
                missReasons: pageState?.missReasons ?? [],
                hints: pageState?.hints ?? [],
                compactAnswer: pageState?.compactAnswer ?? '',
                answerEntries: pageState?.answerEntries,
                memo: pageState?.memo ?? '',
              }}
              reasonOptions={reasonOptions}
              onPatch={(patch) => {
                void upsertPageState(workbook.id, pageNum, patch);
              }}
              onSaveReasonOptions={handleSaveReasonOptions}
            />
          </div>,
        ];
      })}
    </div>
  );
}
