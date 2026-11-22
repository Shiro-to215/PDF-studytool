import { useMemo, useState } from 'react';
import {
  DEFAULT_MISS_REASONS,
  STUDY_STATUS_META,
  type PageState,
  type Problem,
  type StudyStatus,
} from '../../types/models';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';

interface ReviewTabProps {
  pageStates: PageState[];
  problems: Problem[];
  customReasons: string[];
}

interface ReviewItem {
  id: string;
  label: string;
  isPageRecord: boolean;
  pageNumber: number;
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

export function ReviewTab({ pageStates, problems, customReasons }: ReviewTabProps) {
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    setCurrentPage,
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
        items.push({
          id: `prob:${p.id}`,
          label: p.numberLabel,
          isPageRecord: false,
          pageNumber: p.pageNumber,
          status: p.status,
          missReasons: p.missReasons,
        });
      }
    }

    for (const s of pageStates) {
      if (s.status === 'review' || s.status === 'weak') {
        items.push({
          id: `page:${s.id}`,
          label: `P.${s.pageNumber}`,
          isPageRecord: true,
          pageNumber: s.pageNumber,
          status: s.status,
          missReasons: s.missReasons,
        });
      }
    }

    return items.sort((a, b) => a.pageNumber - b.pageNumber);
  }, [problems, pageStates]);

  // Always show all known miss reasons regardless of whether any review item matches them
  const allReasons = useMemo(() => {
    const set = new Set<string>([...DEFAULT_MISS_REASONS, ...customReasons]);
    for (const item of allItems) {
      for (const r of item.missReasons) set.add(r);
    }
    return Array.from(set);
  }, [customReasons, allItems]);

  const filtered = useMemo(
    () =>
      allItems.filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (reasonFilter !== 'all' && !item.missReasons.includes(reasonFilter)) return false;
        return true;
      }),
    [allItems, statusFilter, reasonFilter],
  );

  // Stay on the Review tab when jumping to a problem page
  const handleJump = (item: ReviewItem) => {
    setCurrentPage(item.pageNumber);
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

      {/* Review List */}
      <div className="flex-1 overflow-y-auto thin-scrollbar p-3.5 space-y-2.5">
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
                onClick={() => handleJump(item)}
                className={`w-full text-left p-3.5 rounded-2xl border transition-colors space-y-2 ${
                  isCurrent
                    ? 'border-primary/50 bg-primary/[0.04] hover:bg-primary/[0.08]'
                    : 'border-base-300 bg-base-100 hover:border-primary/45 hover:bg-base-200/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
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
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full border shrink-0 ${
                      STUDY_STATUS_META[item.status].badgeClass
                    }`}
                  >
                    {STUDY_STATUS_META[item.status].label}
                  </span>
                </div>

                {item.missReasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.missReasons.map((r) => (
                      <span
                        key={r}
                        className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-base-200 text-base-content/70"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
