import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet, Folder } from 'lucide-react';
import {
  STUDY_STATUS_META,
  type Problem,
  type UnitNode,
} from '../../types/models';
import { useViewerStore } from '../../stores/useViewerStore';

interface TocTabProps {
  unitNodes: UnitNode[];
  problems: Problem[];
  onOpenImport: () => void;
}

interface TreeBranchProps {
  node: UnitNode;
  depth: number;
  childrenByParent: Map<string | null, UnitNode[]>;
  problemsByUnit: Map<string | null, Problem[]>;
  currentPage: number;
  onSelectProblem: (prob: Problem) => void;
}

function countBranchStats(
  nodeId: string,
  childrenByParent: Map<string | null, UnitNode[]>,
  problemsByUnit: Map<string | null, Problem[]>,
): { total: number; done: number; attention: number } {
  const own = problemsByUnit.get(nodeId) ?? [];
  let total = own.length;
  let done = own.filter((p) => p.status === 'done').length;
  let attention = own.filter((p) => p.status === 'review' || p.status === 'weak').length;

  for (const child of childrenByParent.get(nodeId) ?? []) {
    const sub = countBranchStats(child.id, childrenByParent, problemsByUnit);
    total += sub.total;
    done += sub.done;
    attention += sub.attention;
  }
  return { total, done, attention };
}

function TreeBranch({
  node,
  depth,
  childrenByParent,
  problemsByUnit,
  currentPage,
  onSelectProblem,
}: TreeBranchProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const childUnits = childrenByParent.get(node.id) ?? [];
  const ownProblems = problemsByUnit.get(node.id) ?? [];
  const stats = countBranchStats(node.id, childrenByParent, problemsByUnit);

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-base-200 transition-colors text-left"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-base-content/50" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-base-content/50" />
          )}
          <Folder className="w-3.5 h-3.5 shrink-0 text-base-content/45" />
          <span className="text-xs font-medium truncate">{node.name}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-base-content/50 font-mono">
          {stats.attention > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
              {stats.attention}
            </span>
          )}
          <span>
            {stats.done}/{stats.total}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-0.5">
          {childUnits.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              problemsByUnit={problemsByUnit}
              currentPage={currentPage}
              onSelectProblem={onSelectProblem}
            />
          ))}

          {ownProblems.map((prob) => {
            const isCurrent = prob.pageNumber === currentPage;
            return (
              <button
                key={prob.id}
                type="button"
                onClick={() => onSelectProblem(prob)}
                className={`w-full flex items-center justify-between gap-2 pr-2 py-1.5 rounded-lg text-xs transition-colors ${
                  isCurrent
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-base-200 text-base-content/80'
                }`}
                style={{ paddingLeft: `${24 + depth * 12}px` }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      STUDY_STATUS_META[prob.status].dotClass
                    }`}
                  />
                  <span className="truncate">{prob.numberLabel}</span>
                </div>
                <span className="text-[11px] font-mono text-base-content/45 shrink-0">
                  P.{prob.pageNumber}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TocTab({ unitNodes, problems, onOpenImport }: TocTabProps) {
  const { currentPage, setCurrentPage, setSidebarTab } = useViewerStore();

  const { roots, childrenByParent, problemsByUnit } = useMemo(() => {
    const cMap = new Map<string | null, UnitNode[]>();
    const sortedUnits = [...unitNodes].sort((a, b) => a.order - b.order);
    for (const u of sortedUnits) {
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

    return {
      roots: cMap.get(null) ?? [],
      childrenByParent: cMap,
      problemsByUnit: pMap,
    };
  }, [unitNodes, problems]);

  const uncategorized = problemsByUnit.get(null) ?? [];

  const handleSelectProblem = (prob: Problem) => {
    setCurrentPage(prob.pageNumber);
    setSidebarTab('record');
  };

  if (unitNodes.length === 0 && problems.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
        <div className="w-10 h-10 rounded-full bg-base-200 flex items-center justify-center text-base-content/50">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">単元・問題インデックスは未登録です</p>
          <p className="text-xs text-base-content/55 leading-relaxed">
            登録なしでもページ単位でそのまま学習できます。問題番号や答えを紐づけたいときにCSV / JSONで一括取込できます。
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenImport}
          className="btn btn-primary btn-xs gap-1.5"
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          CSV / JSONを取り込む
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-base-300 flex items-center justify-between shrink-0">
        <span className="text-[11px] font-medium text-base-content/60">
          全 {problems.length} 問
        </span>
        <button
          type="button"
          onClick={onOpenImport}
          className="text-[11px] text-primary hover:underline flex items-center gap-1"
        >
          <FileSpreadsheet className="w-3 h-3" />
          追加インポート
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar p-2 space-y-0.5">
        {roots.map((root) => (
          <TreeBranch
            key={root.id}
            node={root}
            depth={0}
            childrenByParent={childrenByParent}
            problemsByUnit={problemsByUnit}
            currentPage={currentPage}
            onSelectProblem={handleSelectProblem}
          />
        ))}

        {uncategorized.length > 0 && (
          <div className="pt-2 space-y-0.5">
            <p className="px-2 py-1 text-[11px] font-medium text-base-content/50">
              未分類の問題
            </p>
            {uncategorized.map((prob) => (
              <button
                key={prob.id}
                type="button"
                onClick={() => handleSelectProblem(prob)}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  prob.pageNumber === currentPage
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-base-200 text-base-content/80'
                }`}
              >
                <span className="truncate">{prob.numberLabel}</span>
                <span className="text-[11px] font-mono text-base-content/45">
                  P.{prob.pageNumber}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
