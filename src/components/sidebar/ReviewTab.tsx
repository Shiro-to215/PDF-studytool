import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  STUDY_STATUS_META,
  type PageState,
  type Problem,
  type StudyStatus,
} from '../../types/models';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';

interface ReviewTabProps {
  pageStates: PageState[];
  problems: Problem[];
  reasonOptions: string[];
}

interface ReviewItem {
  id: string;
  recordKey: string;
  label: string;
  isPageRecord: boolean;
  pageNumber: number;
  order: number;
  status: StudyStatus;
  missReasons: string[];
}

type StatusFilter = 'all' | 'review' | 'weak';

const STATUS_FILTER_META: Record<StatusFilter, { label: string; activeClass: string }> = {
  all: {
    label: 'すべて',
    activeClass: 'bg-base-100 text-base-content border-base-300',
  },
  review: {
    label: '要復習',
    activeClass: 'bg-amber-500/18 text-amber-800 dark:text-amber-200 border-amber-500/45',
  },
  weak: {
    label: '苦手',
    activeClass: 'bg-rose-500/18 text-rose-800 dark:text-rose-200 border-rose-500/45',
  },
};

export function ReviewTab({ pageStates, problems, reasonOptions }: ReviewTabProps) {
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    setCurrentPage,
    openRecordItem,
  } = useViewerStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');

  const visiblePageSet = useMemo(() => {
    const layout = getSpreadLayout(
      currentPage,
      pageCount,
      spreadMode,
      bindingDirection,
      coverSinglePage,
    );
    return new Set(layout.pages.length > 0 ? layout.pages : [currentPage]);
  }, [currentPage, pageCount, spreadMode, bindingDirection, coverSinglePage]);

  const allItems = useMemo<ReviewItem[]>(() => {
    const items: ReviewItem[] = [];

    for (const p of problems) {
      if (p.status === 'review' || p.status === 'weak') {
        const recordKey = `prob:${p.id}`;
        items.push({
          id: recordKey,
          recordKey,
          label: p.numberLabel,
          isPageRecord: false,
          pageNumber: p.pageNumber,
          order: p.order,
          status: p.status,
          missReasons: p.missReasons,
        });
      }
    }

    for (const s of pageStates) {
      if (s.status === 'review' || s.status === 'weak') {
        const recordKey = `page:${s.workbookId}:${s.pageNumber}`;
        items.push({
          id: `page:${s.id}`,
          recordKey,
          label: `P.${s.pageNumber}`,
          isPageRecord: true,
          pageNumber: s.pageNumber,
          order: Number.MAX_SAFE_INTEGER,
          status: s.status,
          missReasons: s.missReasons,
        });
      }
    }

    return items.sort((a, b) => a.pageNumber - b.pageNumber || a.order - b.order);
  }, [problems, pageStates]);

  // Always show all workbook miss reasons regardless of whether any review item matches them
  const allReasons = useMemo(() => {
    const set = new Set<string>(reasonOptions);
    for (const item of allItems) {
      for (const r of item.missReasons) set.add(r);
    }
    return Array.from(set);
  }, [reasonOptions, allItems]);

  useEffect(() => {
    if (reasonFilter !== 'all' && !allReasons.includes(reasonFilter)) {
      setReasonFilter('all');
    }
  }, [reasonFilter, allReasons]);

  const filtered = useMemo(
    () =>
      allItems.filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (reasonFilter !== 'all' && !item.missReasons.includes(reasonFilter)) return false;
        return true;
      }),
    [allItems, statusFilter, reasonFilter],
  );

  // 1st tap on another page: jump to page & stay on Review tab
  // Tap on a card already in the current spread: switch to Record tab & expand that problem
  const handleSelectReviewItem = (item: ReviewItem) => {
    if (visiblePageSet.has(item.pageNumber)) {
      openRecordItem(item.recordKey);
    } else {
      setCurrentPage(item.pageNumber);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filters */}
      <div className="p-3.5 border-b border-base-300 space-y-3 shrink-0">
        {/* Flex-expanding Status Filter (matches RecordCard status selector) */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-base-200 border border-base-300">
          {(['all', 'review', 'weak'] as const).map((key) => {
            const active = statusFilter === key;
            const meta = STATUS_FILTER_META[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`min-w-0 h-10 px-2 rounded-lg whitespace-nowrap overflow-hidden transition-all duration-300 ease-out flex items-center justify-center border ${
                  active
                    ? `flex-[1.65] text-sm font-semibold shadow-xs ${meta.activeClass}`
                    : 'flex-1 text-xs font-medium border-transparent text-base-content/55 hover:text-base-content'
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Always-visible 3-Column Miss Reason Filter Grid */}
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => setReasonFilter('all')}
            className={`h-9 px-2 rounded-xl text-xs font-medium truncate border transition-colors ${
              reasonFilter === 'all'
                ? 'bg-primary text-primary-content border-primary shadow-xs'
                : 'bg-base-200/70 text-base-content/75 border-base-300 hover:bg-base-200'
            }`}
          >
            全原因
          </button>
          {allReasons.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReasonFilter(r)}
              title={r}
              className={`h-9 px-2 rounded-xl text-xs font-medium truncate border transition-colors ${
                reasonFilter === r
                  ? 'bg-primary text-primary-content border-primary shadow-xs'
                  : 'bg-base-200/70 text-base-content/75 border-base-300 hover:bg-base-200'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Review List (Compact 1-row cards) */}
      <div className="flex-1 overflow-y-auto thin-scrollbar p-3.5 space-y-2">
        {filtered.length === 0 ? (
          <div className="py-12 text-center space-y-1.5">
            <p className="text-sm font-medium text-base-content/60">
              該当する復習項目はありません
            </p>
            <p className="text-xs text-base-content/45">
              「記録」タブで要復習や苦手にするとここに集約されます
            </p>
          </div>
        ) : (
          filtered.map((item) => {
            const isCurrent = visiblePageSet.has(item.pageNumber);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectReviewItem(item)}
                className={`w-full text-left px-3.5 py-3 rounded-2xl border transition-colors flex items-center justify-between gap-2.5 ${
                  isCurrent
                    ? 'border-primary/50 bg-primary/[0.04] hover:bg-primary/[0.08]'
                    : 'border-base-300 bg-base-100 hover:border-primary/45 hover:bg-base-200/40'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {!item.isPageRecord && (
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-lg bg-base-200 text-base-content/75 shrink-0">
                      P.{item.pageNumber}
                    </span>
                  )}
                  <span className="text-[15px] font-semibold text-base-content truncate">
                    {item.label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                      STUDY_STATUS_META[item.status].badgeClass
                    }`}
                  >
                    {STUDY_STATUS_META[item.status].label}
                  </span>
                  {isCurrent && (
                    <ChevronRight className="w-4 h-4 text-primary/65" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
