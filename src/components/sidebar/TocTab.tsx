import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Folder,
} from 'lucide-react';
import {
  STUDY_STATUS_META,
  type Problem,
  type StudyStatus,
  type UnitNode,
} from '../../types/models';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';

const TOC_ANIM_DURATION_MS = 360;
const TOC_ANIM_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const TOC_STAGGER_STEP_MS = 28;
const TOC_STAGGER_MAX_DELAY_MS = 140;
const TOC_MAX_STAGGER_ITEMS = 30;

interface TocTabProps {
  unitNodes: UnitNode[];
  problems: Problem[];
  onOpenImport: () => void;
}

const TILE_STATUS_CLASS: Record<StudyStatus, string> = {
  none: 'bg-base-100 border-base-300 text-base-content/85 hover:bg-base-200/70',
  review:
    'bg-amber-500/10 border-amber-500/35 text-amber-900 dark:text-amber-200 hover:bg-amber-500/18',
  weak:
    'bg-rose-500/10 border-rose-500/35 text-rose-900 dark:text-rose-200 hover:bg-rose-500/18',
  done:
    'bg-emerald-500/10 border-emerald-500/35 text-emerald-900 dark:text-emerald-200 hover:bg-emerald-500/18',
};

function visualLabelWidth(label: string): number {
  let w = 0;
  for (const ch of label) {
    // ASCII characters are narrower than CJK characters
    w += ch.charCodeAt(0) <= 0x7f ? 0.55 : 1;
  }
  return w;
}

function getTileGridClass(list: Problem[]): string {
  const hasLongLabel = list.some((p) => visualLabelWidth(p.numberLabel.trim()) > 4.2);
  return hasLongLabel ? 'grid-cols-2' : 'grid-cols-3';
}

interface BranchStats {
  total: number;
  done: number;
  attention: number;
  containsCurrent: boolean;
}

export function TocTab({ unitNodes, problems, onOpenImport }: TocTabProps) {
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    tocUnitId,
    setCurrentPage,
    setTocUnitId,
  } = useViewerStore();

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

  const {
    unitById,
    childrenByParent,
    problemsByUnit,
    statsByUnit,
    depthByUnit,
    preorderByUnit,
  } = useMemo(() => {
    const byId = new Map<string, UnitNode>();
    const cMap = new Map<string | null, UnitNode[]>();
    const sortedUnits = [...unitNodes].sort((a, b) => a.order - b.order);
    for (const u of sortedUnits) {
      byId.set(u.id, u);
      const list = cMap.get(u.parentId) ?? [];
      list.push(u);
      cMap.set(u.parentId, list);
    }

    const pMap = new Map<string | null, Problem[]>();
    const sortedProblems = [...problems].sort((a, b) => a.order - b.order);
    for (const p of sortedProblems) {
      const list = pMap.get(p.unitId) ?? [];
      list.push(p);
      pMap.set(p.unitId, list);
    }

    const sMap = new Map<string, BranchStats>();
    const computeStats = (nodeId: string): BranchStats => {
      const cached = sMap.get(nodeId);
      if (cached) return cached;

      const own = pMap.get(nodeId) ?? [];
      let total = own.length;
      let done = own.filter((p) => p.status === 'done').length;
      let attention = own.filter((p) => p.status === 'review' || p.status === 'weak').length;
      let containsCurrent = own.some((p) => visiblePageSet.has(p.pageNumber));

      for (const child of cMap.get(nodeId) ?? []) {
        const sub = computeStats(child.id);
        total += sub.total;
        done += sub.done;
        attention += sub.attention;
        if (sub.containsCurrent) containsCurrent = true;
      }

      const res = { total, done, attention, containsCurrent };
      sMap.set(nodeId, res);
      return res;
    };

    for (const u of sortedUnits) computeStats(u.id);

    const dMap = new Map<string, number>();
    const preMap = new Map<string, number>();
    let orderCursor = 0;
    const walkTree = (parentId: string | null, depth: number) => {
      for (const node of cMap.get(parentId) ?? []) {
        if (dMap.has(node.id)) continue;
        dMap.set(node.id, depth);
        preMap.set(node.id, orderCursor++);
        walkTree(node.id, depth + 1);
      }
    };
    walkTree(null, 1);
    for (const u of sortedUnits) {
      if (!dMap.has(u.id)) {
        dMap.set(u.id, 1);
        preMap.set(u.id, orderCursor++);
      }
    }

    return {
      unitById: byId,
      childrenByParent: cMap,
      problemsByUnit: pMap,
      statsByUnit: sMap,
      depthByUnit: dMap,
      preorderByUnit: preMap,
    };
  }, [unitNodes, problems, visiblePageSet]);

  // Fall back safely to root if the selected unit no longer exists (e.g. after re-import)
  const activeUnitId =
    tocUnitId !== null && unitById.has(tocUnitId) ? tocUnitId : null;
  const activeUnit = activeUnitId ? unitById.get(activeUnitId) ?? null : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevUnitIdRef = useRef<string | null | undefined>(undefined);
  const runningAnimsRef = useRef<Animation[]>([]);
  const treeOrderRef = useRef({ depthByUnit, preorderByUnit });
  treeOrderRef.current = { depthByUnit, preorderByUnit };

  // Short directional slide + staggered fade-in whenever the TOC hierarchy changes
  useLayoutEffect(() => {
    const prevId = prevUnitIdRef.current;
    prevUnitIdRef.current = activeUnitId;

    // Skip on initial mount or when hierarchy hasn't actually changed
    if (prevId === undefined || prevId === activeUnitId) return;

    // Cancel any in-flight animations from a previous rapid navigation
    for (const anim of runningAnimsRef.current) {
      try {
        anim.cancel();
      } catch {
        // ignore
      }
    }
    runningAnimsRef.current = [];

    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }

    const root = containerRef.current;
    if (!root) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const { depthByUnit: dMap, preorderByUnit: preMap } = treeOrderRef.current;
    const prevDepth = prevId === null ? 0 : dMap.get(prevId) ?? 1;
    const nextDepth = activeUnitId === null ? 0 : dMap.get(activeUnitId) ?? 1;
    const forward =
      nextDepth !== prevDepth
        ? nextDepth > prevDepth
        : prevId !== null && activeUnitId !== null
          ? (preMap.get(activeUnitId) ?? 0) >= (preMap.get(prevId) ?? 0)
          : true;

    const inX = forward ? 26 : -26;
    const started: Animation[] = [];

    const headerEl = root.querySelector<HTMLElement>('[data-toc-header]');
    if (headerEl && typeof headerEl.animate === 'function') {
      started.push(
        headerEl.animate(
          [
            { transform: `translateX(${Math.round(inX * 0.5)}px)`, opacity: 0 },
            { transform: 'translateX(0px)', opacity: 1 },
          ],
          {
            duration: Math.round(TOC_ANIM_DURATION_MS * 0.8),
            easing: TOC_ANIM_EASING,
            fill: 'both',
          },
        ),
      );
    }

    const itemEls = root.querySelectorAll<HTMLElement>('[data-toc-item]');
    const count = Math.min(itemEls.length, TOC_MAX_STAGGER_ITEMS);
    for (let i = 0; i < count; i++) {
      const el = itemEls[i];
      if (typeof el.animate !== 'function') continue;
      started.push(
        el.animate(
          [
            { transform: `translateX(${inX}px)`, opacity: 0 },
            { transform: 'translateX(0px)', opacity: 1 },
          ],
          {
            duration: TOC_ANIM_DURATION_MS,
            delay: Math.min(i * TOC_STAGGER_STEP_MS, TOC_STAGGER_MAX_DELAY_MS),
            easing: TOC_ANIM_EASING,
            fill: 'both',
          },
        ),
      );
    }

    runningAnimsRef.current = started;

    // Release finished WAAPI layers cleanly (important for WebKit/iPadOS compositing)
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
  }, [activeUnitId]);

  // Breadcrumb path from top-level chapter down to activeUnit
  const breadcrumb = useMemo(() => {
    const chain: UnitNode[] = [];
    let cursor = activeUnit;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      chain.unshift(cursor);
      cursor = cursor.parentId ? unitById.get(cursor.parentId) ?? null : null;
    }
    return chain;
  }, [activeUnit, unitById]);

  const displayedUnits = childrenByParent.get(activeUnitId) ?? [];
  const displayedProblems = problemsByUnit.get(activeUnitId) ?? [];

  // Stay on the TOC tab & current hierarchy when jumping to a problem page
  const handleSelectProblem = (prob: Problem) => {
    setCurrentPage(prob.pageNumber, { syncToc: false });
  };

  if (unitNodes.length === 0 && problems.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3.5">
        <div className="w-12 h-12 rounded-full bg-base-200 flex items-center justify-center text-base-content/50">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">単元・問題インデックスは未登録です</p>
          <p className="text-xs text-base-content/55 leading-relaxed">
            登録なしでもページ単位でそのまま学習できます。問題番号や答えを紐づけたいときにCSV / JSONで一括取込できます。
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenImport}
          className="btn btn-primary btn-sm gap-1.5"
        >
          <FileSpreadsheet className="w-4 h-4" />
          CSV / JSONを取り込む
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Top Bar: Root summary OR Spacious Drill-down back + breadcrumb */}
      {activeUnit === null ? (
        <div
          data-toc-header
          className="px-4 py-3.5 border-b border-base-300 flex items-center justify-between shrink-0"
        >
          <span className="text-sm font-semibold text-base-content/70">
            全 {problems.length} 問
          </span>
          <button
            type="button"
            onClick={onOpenImport}
            className="text-sm text-primary hover:underline flex items-center gap-1.5 font-medium"
          >
            <FileSpreadsheet className="w-4 h-4" />
            追加インポート
          </button>
        </div>
      ) : (
        <div
          data-toc-header
          className="px-4 py-3.5 border-b border-base-300 space-y-2.5 shrink-0 bg-base-100"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setTocUnitId(activeUnit.parentId)}
              className="h-10 px-3.5 rounded-full bg-base-200 hover:bg-base-300/80 border border-base-300 flex items-center gap-1.5 text-sm font-medium text-base-content/85 transition-colors active:scale-95"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>戻る</span>
            </button>
            <span className="text-sm font-mono font-semibold text-base-content/75 bg-base-200/80 px-3 py-1.5 rounded-xl shrink-0">
              {statsByUnit.get(activeUnit.id)?.done ?? 0} /{' '}
              {statsByUnit.get(activeUnit.id)?.total ?? 0}
            </span>
          </div>

          <div className="flex items-center flex-wrap gap-1 text-xs font-medium text-base-content/60">
            <button
              type="button"
              onClick={() => setTocUnitId(null)}
              className="hover:text-primary transition-colors py-0.5"
            >
              すべて
            </button>
            {breadcrumb.slice(0, -1).map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1">
                <ChevronRight className="w-3.5 h-3.5 opacity-55" />
                <button
                  type="button"
                  onClick={() => setTocUnitId(u.id)}
                  className="hover:text-primary transition-colors truncate max-w-[140px] py-0.5"
                >
                  {u.name}
                </button>
              </span>
            ))}
          </div>

          <h3 className="text-lg font-bold text-base-content leading-snug">
            {activeUnit.name}
          </h3>
        </div>
      )}

      {/* Drill-down Content: Spacious Unit Cards + Auto 2-3 Column Problem Tiles */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden thin-scrollbar p-3.5 space-y-4">
        {displayedUnits.length > 0 && (
          <div className="space-y-2.5">
            {displayedUnits.map((unit) => {
              const stats = statsByUnit.get(unit.id) ?? {
                total: 0,
                done: 0,
                attention: 0,
                containsCurrent: false,
              };
              const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
              return (
                <button
                  key={unit.id}
                  type="button"
                  data-toc-item
                  onClick={() => setTocUnitId(unit.id)}
                  className={`relative w-full overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                    stats.containsCurrent
                      ? 'border-primary/45 bg-primary/[0.04] hover:bg-primary/[0.08]'
                      : 'border-base-300 bg-base-100 hover:bg-base-200/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Folder
                        className={`w-[18px] h-[18px] shrink-0 ${
                          stats.containsCurrent ? 'text-primary' : 'text-base-content/45'
                        }`}
                      />
                      <span className="text-[15px] font-semibold text-base-content truncate">
                        {unit.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {stats.attention > 0 && (
                        <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          {stats.attention}
                        </span>
                      )}
                      <span className="text-xs font-mono text-base-content/55">
                        {stats.done}/{stats.total}
                      </span>
                      <ChevronRight className="w-4 h-4 text-base-content/40" />
                    </div>
                  </div>

                  {/* Subtle bottom progress bar */}
                  {stats.total > 0 && (
                    <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-base-200">
                      <div
                        className="h-full bg-emerald-500/70 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {displayedProblems.length > 0 && (
          <div className="space-y-2">
            {activeUnit === null && displayedUnits.length > 0 && (
              <p data-toc-item className="px-1 text-xs font-medium text-base-content/50">
                未分類の問題
              </p>
            )}
            <div className={`grid gap-2 ${getTileGridClass(displayedProblems)}`}>
              {displayedProblems.map((prob) => {
                const isCurrent = visiblePageSet.has(prob.pageNumber);
                return (
                  <button
                    key={prob.id}
                    type="button"
                    data-toc-item
                    onClick={() => handleSelectProblem(prob)}
                    title={`${prob.numberLabel}（P.${prob.pageNumber}）`}
                    className={`h-11 px-3 rounded-xl border flex items-center gap-2 min-w-0 transition-all active:scale-[0.98] ${
                      TILE_STATUS_CLASS[prob.status]
                    } ${isCurrent ? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100' : ''}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        STUDY_STATUS_META[prob.status].dotClass
                      }`}
                    />
                    <span className="text-sm font-medium truncate">{prob.numberLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
