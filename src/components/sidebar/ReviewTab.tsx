import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import {
  STUDY_STATUS_META,
  type PageState,
  type Problem,
  type StudyStatus,
  type UnitNode,
} from '../../types/models';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';

interface ReviewTabProps {
  pageStates: PageState[];
  problems: Problem[];
  unitNodes: UnitNode[];
  reasonOptions: string[];
}

interface ReviewItem {
  id: string;
  recordKey: string;
  label: string;
  isPageRecord: boolean;
  pageNumber: number;
  order: number;
  unitId: string | null;
  status: StudyStatus;
  missReasons: string[];
}

interface ReviewTreeNode {
  id: string;
  name: string;
  children: ReviewTreeNode[];
  directItems: ReviewItem[];
  totalCount: number;
  containsCurrent: boolean;
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

const FOLDER_OPEN_MS = 320;
const FOLDER_CLOSE_MS = 240;
const FOLDER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const FOLDER_STAGGER_STEP_MS = 24;
const FOLDER_STAGGER_MAX_DELAY_MS = 120;

interface ReviewProblemRowProps {
  item: ReviewItem;
  isCurrent: boolean;
  compact?: boolean;
  onSelect: (item: ReviewItem) => void;
}

function ReviewProblemRow({
  item,
  isCurrent,
  compact = false,
  onSelect,
}: ReviewProblemRowProps) {
  return (
    <button
      type="button"
      data-tree-item
      onClick={() => onSelect(item)}
      className={`w-full text-left rounded-xl border transition-colors flex items-center justify-between gap-2 ${
        compact ? 'px-3 py-2.5' : 'px-3.5 py-3 rounded-2xl'
      } ${
        isCurrent
          ? 'border-primary/50 bg-primary/[0.05] hover:bg-primary/[0.09]'
          : 'border-base-300 bg-base-100 hover:border-primary/45 hover:bg-base-200/40'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {!item.isPageRecord && (
          <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-base-200 text-base-content/75 shrink-0">
            P.{item.pageNumber}
          </span>
        )}
        <span
          className={`font-semibold text-base-content truncate ${
            compact ? 'text-sm' : 'text-[15px]'
          }`}
        >
          {item.label}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
            STUDY_STATUS_META[item.status].badgeClass
          }`}
        >
          {STUDY_STATUS_META[item.status].label}
        </span>
        {isCurrent && <ChevronRight className="w-4 h-4 text-primary/70" />}
      </div>
    </button>
  );
}

interface ReviewFolderBranchProps {
  node: ReviewTreeNode;
  depth: number;
  expandedIds: Set<string>;
  visiblePageSet: Set<number>;
  onToggleFolder: (id: string) => void;
  onSelectItem: (item: ReviewItem) => void;
}

function ReviewFolderBranch({
  node,
  depth,
  expandedIds,
  visiblePageSet,
  onToggleFolder,
  onSelectItem,
}: ReviewFolderBranchProps) {
  const isOpen = expandedIds.has(node.id);
  const [renderChildren, setRenderChildren] = useState(isOpen);

  if (isOpen && !renderChildren) {
    setRenderChildren(true);
  }

  const accordionRef = useRef<HTMLDivElement | null>(null);
  const runningAnimsRef = useRef<Animation[]>([]);
  const closeTimerRef = useRef<number | null>(null);

  const cancelMotion = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    for (const anim of runningAnimsRef.current) {
      try {
        anim.cancel();
      } catch {
        // ignore
      }
    }
    runningAnimsRef.current = [];
  };

  useEffect(() => {
    return () => cancelMotion();
  }, []);

  useLayoutEffect(() => {
    if (!renderChildren) return;
    const accEl = accordionRef.current;
    if (!accEl) return;

    cancelMotion();

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (isOpen) {
      if (prefersReduced) {
        accEl.setAttribute('data-open', 'true');
        return;
      }

      accEl.setAttribute('data-open', 'false');
      void accEl.offsetHeight;
      accEl.setAttribute('data-open', 'true');

      const bodyEl = accEl.querySelector<HTMLElement>('[data-folder-body]');
      const directChildren = bodyEl
        ? Array.from(bodyEl.children).filter(
            (el): el is HTMLElement => el instanceof HTMLElement,
          )
        : [];

      const started: Animation[] = [];
      const limit = Math.min(directChildren.length, 20);
      for (let i = 0; i < limit; i++) {
        const el = directChildren[i];
        if (typeof el.animate !== 'function') continue;
        started.push(
          el.animate(
            [
              { transform: 'translateY(-8px)', opacity: 0 },
              { transform: 'translateY(0px)', opacity: 1 },
            ],
            {
              duration: FOLDER_OPEN_MS,
              delay: Math.min(i * FOLDER_STAGGER_STEP_MS, FOLDER_STAGGER_MAX_DELAY_MS),
              easing: FOLDER_EASING,
              fill: 'both',
            },
          ),
        );
      }
      runningAnimsRef.current = started;

      let cancelled = false;
      void Promise.all(started.map((a) => a.finished.catch(() => {}))).then(() => {
        if (cancelled) return;
        for (const a of started) {
          try {
            a.cancel();
          } catch {
            // ignore
          }
        }
        if (runningAnimsRef.current === started) {
          runningAnimsRef.current = [];
        }
      });

      return () => {
        cancelled = true;
      };
    }

    if (prefersReduced) {
      accEl.setAttribute('data-open', 'false');
      setRenderChildren(false);
      return;
    }

    accEl.setAttribute('data-open', 'false');
    const bodyEl = accEl.querySelector<HTMLElement>('[data-folder-body]');
    if (bodyEl && typeof bodyEl.animate === 'function') {
      const fadeAnim = bodyEl.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 160,
        easing: FOLDER_EASING,
        fill: 'forwards',
      });
      runningAnimsRef.current = [fadeAnim];
    }

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      runningAnimsRef.current = [];
      setRenderChildren(false);
    }, FOLDER_CLOSE_MS + 16);
  }, [isOpen, renderChildren]);

  const isRoot = depth === 0;
  // Cap visual indentation at deeper levels so 4-5 level hierarchies stay wide on 350px sidebars
  const indentClass =
    depth === 0
      ? 'px-3 pb-3 pt-2 border-t border-base-300/80'
      : depth <= 2
        ? 'ml-3 pl-2.5 border-l border-base-300/90 pt-1 pb-1'
        : 'ml-2 pl-2 border-l border-base-300/80 pt-1 pb-1';

  const headerButton = (
    <button
      type="button"
      onClick={() => onToggleFolder(node.id)}
      aria-expanded={isOpen}
      className={
        isRoot
          ? 'w-full px-4 py-3.5 flex items-center justify-between gap-2.5 text-left hover:bg-base-200/50 transition-colors'
          : `w-full px-2.5 py-2.5 rounded-xl flex items-center justify-between gap-2 text-left transition-colors ${
              node.containsCurrent
                ? 'bg-primary/[0.04] hover:bg-primary/[0.08]'
                : 'hover:bg-base-200/70'
            }`
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <ChevronRight
          className={`shrink-0 text-base-content/45 transition-transform duration-200 ${
            isRoot ? 'w-4 h-4' : 'w-3.5 h-3.5'
          } ${isOpen ? 'rotate-90' : ''}`}
        />
        <Folder
          className={`shrink-0 ${isRoot ? 'w-[18px] h-[18px]' : 'w-4 h-4'} ${
            node.containsCurrent ? 'text-primary' : 'text-base-content/45'
          }`}
        />
        <span
          className={`truncate text-base-content ${
            isRoot ? 'text-[15px] font-semibold' : 'text-sm font-medium'
          }`}
        >
          {node.name}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {node.containsCurrent && !isOpen && (
          <span
            className="w-2 h-2 rounded-full bg-primary"
            aria-label="現在表示中のページを含む"
          />
        )}
        <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-base-200 text-base-content/70">
          {node.totalCount}
        </span>
      </div>
    </button>
  );

  const childrenBlock = renderChildren && (
    <div ref={accordionRef} data-open="false" className="record-accordion">
      <div className="record-accordion-inner">
        <div data-folder-body className={`${indentClass} space-y-1.5`}>
          {node.children.map((child) => (
            <div key={child.id}>
              <ReviewFolderBranch
                node={child}
                depth={depth + 1}
                expandedIds={expandedIds}
                visiblePageSet={visiblePageSet}
                onToggleFolder={onToggleFolder}
                onSelectItem={onSelectItem}
              />
            </div>
          ))}
          {node.directItems.map((item) => (
            <div key={item.id}>
              <ReviewProblemRow
                item={item}
                isCurrent={visiblePageSet.has(item.pageNumber)}
                compact={true}
                onSelect={onSelectItem}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (isRoot) {
    return (
      <div
        className={`rounded-2xl border overflow-hidden transition-colors ${
          node.containsCurrent
            ? 'border-primary/45 bg-base-100'
            : 'border-base-300 bg-base-100'
        }`}
      >
        {headerButton}
        {childrenBlock}
      </div>
    );
  }

  return (
    <div>
      {headerButton}
      {childrenBlock}
    </div>
  );
}

export function ReviewTab({
  pageStates,
  problems,
  unitNodes,
  reasonOptions,
}: ReviewTabProps) {
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
  // All folders start collapsed for a clean overview; multiple folders may stay open at once
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

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

  const { unitById, childrenByParent } = useMemo(() => {
    const byId = new Map<string, UnitNode>();
    const cMap = new Map<string | null, UnitNode[]>();
    const sortedUnits = [...unitNodes].sort((a, b) => a.order - b.order);

    for (const u of sortedUnits) {
      byId.set(u.id, u);
      const list = cMap.get(u.parentId) ?? [];
      list.push(u);
      cMap.set(u.parentId, list);
    }

    return { unitById: byId, childrenByParent: cMap };
  }, [unitNodes]);

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
          unitId: p.unitId && unitById.has(p.unitId) ? p.unitId : null,
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
          unitId: null,
          status: s.status,
          missReasons: s.missReasons,
        });
      }
    }

    return items.sort((a, b) => a.pageNumber - b.pageNumber || a.order - b.order);
  }, [problems, pageStates, unitById]);

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

  const filteredItems = useMemo(
    () =>
      allItems.filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (reasonFilter !== 'all' && !item.missReasons.includes(reasonFilter)) return false;
        return true;
      }),
    [allItems, statusFilter, reasonFilter],
  );

  // Build pruned collapsible folder tree containing only branches with matching review items
  const { rootFolders, flatFallbackItems } = useMemo(() => {
    if (filteredItems.length === 0) {
      return { rootFolders: [] as ReviewTreeNode[], flatFallbackItems: [] as ReviewItem[] };
    }

    const itemsByUnit = new Map<string | null, ReviewItem[]>();
    for (const item of filteredItems) {
      const list = itemsByUnit.get(item.unitId);
      if (list) list.push(item);
      else itemsByUnit.set(item.unitId, [item]);
    }
    for (const list of itemsByUnit.values()) {
      list.sort((a, b) => a.pageNumber - b.pageNumber || a.order - b.order);
    }

    const visited = new Set<string>();
    const buildNode = (unit: UnitNode): ReviewTreeNode | null => {
      if (visited.has(unit.id)) return null;
      visited.add(unit.id);

      const childNodes: ReviewTreeNode[] = [];
      for (const childUnit of childrenByParent.get(unit.id) ?? []) {
        const built = buildNode(childUnit);
        if (built) childNodes.push(built);
      }

      const directItems = itemsByUnit.get(unit.id) ?? [];
      const totalCount =
        directItems.length + childNodes.reduce((sum, c) => sum + c.totalCount, 0);
      if (totalCount === 0) return null;

      const containsCurrent =
        directItems.some((it) => visiblePageSet.has(it.pageNumber)) ||
        childNodes.some((c) => c.containsCurrent);

      return {
        id: unit.id,
        name: unit.name,
        children: childNodes,
        directItems,
        totalCount,
        containsCurrent,
      };
    };

    const roots: ReviewTreeNode[] = [];
    for (const rootUnit of childrenByParent.get(null) ?? []) {
      const built = buildNode(rootUnit);
      if (built) roots.push(built);
    }

    const ungrouped = itemsByUnit.get(null) ?? [];
    if (roots.length === 0) {
      // Workbook has no categorized units (e.g. page-only study): show flat cards cleanly
      return { rootFolders: [], flatFallbackItems: ungrouped };
    }

    if (ungrouped.length > 0) {
      roots.push({
        id: '__UNGROUPED__',
        name: 'その他',
        children: [],
        directItems: ungrouped,
        totalCount: ungrouped.length,
        containsCurrent: ungrouped.some((it) => visiblePageSet.has(it.pageNumber)),
      });
    }

    return { rootFolders: roots, flatFallbackItems: [] as ReviewItem[] };
  }, [filteredItems, childrenByParent, visiblePageSet]);

  const toggleFolder = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      {/* Clean Original Filters (Status + 3-Column Miss Reason Grid) */}
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

      {/* Collapsible Nested Folder Tree (or Flat Cards on Page-Only Workbooks) */}
      <div className="flex-1 overflow-y-auto thin-scrollbar p-3.5 space-y-2.5">
        {rootFolders.length === 0 && flatFallbackItems.length === 0 ? (
          <div className="py-12 text-center space-y-1.5">
            <p className="text-sm font-medium text-base-content/60">
              該当する復習項目はありません
            </p>
            <p className="text-xs text-base-content/45">
              「記録」タブで要復習や苦手にするとここに集約されます
            </p>
          </div>
        ) : rootFolders.length > 0 ? (
          rootFolders.map((folder) => (
            <ReviewFolderBranch
              key={folder.id}
              node={folder}
              depth={0}
              expandedIds={expandedIds}
              visiblePageSet={visiblePageSet}
              onToggleFolder={toggleFolder}
              onSelectItem={handleSelectReviewItem}
            />
          ))
        ) : (
          <div className="space-y-2">
            {flatFallbackItems.map((item) => (
              <ReviewProblemRow
                key={item.id}
                item={item}
                isCurrent={visiblePageSet.has(item.pageNumber)}
                onSelect={handleSelectReviewItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
