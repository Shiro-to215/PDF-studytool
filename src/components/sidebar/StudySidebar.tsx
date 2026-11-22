import { X } from 'lucide-react';
import type { PageState, Problem, UnitNode, Workbook } from '../../types/models';
import { useViewerStore, type SidebarTab } from '../../stores/useViewerStore';
import { RecordTab } from './RecordTab';
import { TocTab } from './TocTab';
import { ReviewTab } from './ReviewTab';

interface StudySidebarProps {
  workbook: Workbook;
  pageStates: PageState[];
  unitNodes: UnitNode[];
  problems: Problem[];
  onOpenImport: () => void;
}

const TABS: Array<{ id: SidebarTab; label: string }> = [
  { id: 'record', label: '記録' },
  { id: 'toc', label: '目次' },
  { id: 'review', label: '復習' },
];

export function StudySidebar({
  workbook,
  pageStates,
  unitNodes,
  problems,
  onOpenImport,
}: StudySidebarProps) {
  const { sidebarOpen, sidebarTab, setSidebarTab, setSidebarOpen } = useViewerStore();

  if (!sidebarOpen) return null;

  const reviewCount =
    problems.filter((p) => p.status === 'review' || p.status === 'weak').length +
    pageStates.filter((s) => s.status === 'review' || s.status === 'weak').length;

  return (
    <>
      {/* Backdrop on narrow screens */}
      <div
        onClick={() => setSidebarOpen(false)}
        className="lg:hidden absolute inset-0 z-30 bg-black/25"
      />

      <aside className="absolute lg:static right-0 top-0 bottom-0 w-[330px] sm:w-[350px] max-w-[90vw] z-40 border-l border-base-300 bg-base-100 pt-[env(safe-area-inset-top)] flex flex-col shrink-0 shadow-xl lg:shadow-none">
        {/* Tabs header */}
        <div className="flex items-center border-b border-base-300 shrink-0 px-2">
          <div className="flex-1 grid grid-cols-3">
            {TABS.map((t) => {
              const active = sidebarTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSidebarTab(t.id)}
                  className={`py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
                    active
                      ? 'border-primary text-base-content'
                      : 'border-transparent text-base-content/55 hover:text-base-content'
                  }`}
                >
                  <span>{t.label}</span>
                  {t.id === 'review' && reviewCount > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-base-200 text-base-content/75">
                      {reviewCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="btn btn-ghost btn-sm btn-square ml-1 text-base-content/65 hover:text-base-content"
            aria-label="サイドバーを閉じる"
            title="パネルを閉じる"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Active Tab Body */}
        {sidebarTab === 'record' && (
          <RecordTab
            workbook={workbook}
            pageStates={pageStates}
            problems={problems}
            unitNodes={unitNodes}
          />
        )}
        {sidebarTab === 'toc' && (
          <TocTab
            unitNodes={unitNodes}
            problems={problems}
            onOpenImport={onOpenImport}
          />
        )}
        {sidebarTab === 'review' && (
          <ReviewTab
            pageStates={pageStates}
            problems={problems}
            unitNodes={unitNodes}
          />
        )}
      </aside>
    </>
  );
}
