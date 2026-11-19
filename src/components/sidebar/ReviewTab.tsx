import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import {
  STUDY_STATUS_META,
  type PageState,
  type Problem,
  type StudyStatus,
  type UnitNode,
} from '../../types/models';
import { useViewerStore } from '../../stores/useViewerStore';

interface ReviewTabProps {
  pageStates: PageState[];
  problems: Problem[];
  unitNodes: UnitNode[];
}

interface ReviewItem {
  id: string;
  label: string;
  subtitle?: string;
  pageNumber: number;
  status: StudyStatus;
  missReasons: string[];
}

export function ReviewTab({ pageStates, problems, unitNodes }: ReviewTabProps) {
  const { setCurrentPage, setSidebarTab, startReviewQueue } = useViewerStore();
  const [statusFilter, setStatusFilter] = useState<'all' | 'review' | 'weak'>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('all');

  const unitPathMap = useMemo(() => {
    const byId = new Map(unitNodes.map((u) => [u.id, u]));
    const cache = new Map<string, string>();
    const resolve = (id: string | null): string => {
      if (!id) return '';
      if (cache.has(id)) return cache.get(id)!;
      const node = byId.get(id);
      if (!node) return '';
      const parent = resolve(node.parentId);
      const path = parent ? `${parent} / ${node.name}` : node.name;
      cache.set(id, path);
      return path;
    };
    for (const u of unitNodes) resolve(u.id);
    return cache;
  }, [unitNodes]);

  const allItems = useMemo<ReviewItem[]>(() => {
    const items: ReviewItem[] = [];

    for (const p of problems) {
      if (p.status === 'review' || p.status === 'weak') {
        items.push({
          id: `prob:${p.id}`,
          label: p.numberLabel,
          subtitle: p.unitId ? unitPathMap.get(p.unitId) : undefined,
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
          subtitle: s.memo ? s.memo.slice(0, 36) : 'ページ記録',
          pageNumber: s.pageNumber,
          status: s.status,
          missReasons: s.missReasons,
        });
      }
    }

    return items.sort((a, b) => a.pageNumber - b.pageNumber);
  }, [problems, pageStates, unitPathMap]);

  const availableReasons = useMemo(() => {
    const set = new Set<string>();
    for (const item of allItems) {
      for (const r of item.missReasons) set.add(r);
    }
    return Array.from(set);
  }, [allItems]);

  const filtered = useMemo(
    () =>
      allItems.filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (reasonFilter !== 'all' && !item.missReasons.includes(reasonFilter)) return false;
        return true;
      }),
    [allItems, statusFilter, reasonFilter],
  );

  const handleJump = (item: ReviewItem) => {
    setCurrentPage(item.pageNumber);
    setSidebarTab('record');
  };

  const handleStartQueue = () => {
    const pages = filtered.map((i) => i.pageNumber);
    startReviewQueue(pages);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filters */}
      <div className="p-3 border-b border-base-300 space-y-2.5 shrink-0">
        <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-base-200 border border-base-300">
          {(['all', 'review', 'weak'] as const).map((key) => {
            const label =
              key === 'all' ? 'すべて' : key === 'review' ? '要復習' : '苦手';
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`py-1 rounded-md text-[11px] font-medium transition-colors ${
                  statusFilter === key
                    ? 'bg-base-100 text-base-content shadow-xs'
                    : 'text-base-content/60 hover:text-base-content'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {availableReasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setReasonFilter('all')}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                reasonFilter === 'all'
                  ? 'bg-primary text-primary-content border-primary'
                  : 'bg-base-200/70 text-base-content/65 border-base-300'
              }`}
            >
              全原因
            </button>
            {availableReasons.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReasonFilter(r)}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                  reasonFilter === r
                    ? 'bg-primary text-primary-content border-primary'
                    : 'bg-base-200/70 text-base-content/65 border-base-300'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}

        {filtered.length > 0 && (
          <button
            type="button"
            onClick={handleStartQueue}
            className="btn btn-primary btn-xs w-full gap-1.5 font-medium"
          >
            <Play className="w-3 h-3" />
            この {filtered.length} 件を連続復習する
          </button>
        )}
      </div>

      {/* Review List */}
      <div className="flex-1 overflow-y-auto thin-scrollbar p-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="py-10 text-center space-y-1">
            <p className="text-xs font-medium text-base-content/60">
              該当する復習項目はありません
            </p>
            <p className="text-[11px] text-base-content/45">
              「記録」タブで要復習や苦手にするとここに集約されます
            </p>
          </div>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleJump(item)}
              className="w-full text-left p-3 rounded-xl border border-base-300 bg-base-100 hover:border-primary transition-colors space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-content/75 shrink-0">
                    P.{item.pageNumber}
                  </span>
                  <span className="text-xs font-semibold truncate">{item.label}</span>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                    STUDY_STATUS_META[item.status].badgeClass
                  }`}
                >
                  {STUDY_STATUS_META[item.status].label}
                </span>
              </div>

              {item.subtitle && (
                <p className="text-[11px] text-base-content/55 truncate">{item.subtitle}</p>
              )}

              {item.missReasons.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {item.missReasons.map((r) => (
                    <span
                      key={r}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-base-200 text-base-content/65"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
