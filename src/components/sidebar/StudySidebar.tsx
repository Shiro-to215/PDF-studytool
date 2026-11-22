import { forwardRef, useImperativeHandle, useRef } from 'react';
import { PanelRight, X } from 'lucide-react';
import type { PageState, Problem, UnitNode, Workbook } from '../../types/models';
import { useViewerStore, type SidebarTab } from '../../stores/useViewerStore';
import { RecordTab } from './RecordTab';
import { TocTab } from './TocTab';
import { ReviewTab } from './ReviewTab';

export interface StudySidebarHandle {
  /** Imperatively sync sidebar + backdrop position to shared progress t in [0 (closed), 1 (open)] */
  setSlideProgress: (t: number) => void;
  getWidth: () => number;
}

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

export const StudySidebar = forwardRef<StudySidebarHandle, StudySidebarProps>(function StudySidebar(
  { workbook, pageStates, unitNodes, problems, onOpenImport },
  ref,
) {
  const { sidebarOpen, sidebarTab, setSidebarTab, setSidebarOpen, toggleSidebar } =
    useViewerStore();
  const asideRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setSlideProgress(t: number) {
        const clamped = Math.max(0, Math.min(1, t));
        const el = asideRef.current;
        if (el) {
          const w = el.offsetWidth || 350;
          const x = (1 - clamped) * w;
          el.style.transform = `translate3d(${x.toFixed(2)}px, 0px, 0)`;
        }
        const bd = backdropRef.current;
        if (bd) {
          bd.style.opacity = clamped.toFixed(3);
        }
      },
      getWidth() {
        return asideRef.current?.offsetWidth || 350;
      },
    }),
    [],
  );

  const reviewCount =
    problems.filter((p) => p.status === 'review' || p.status === 'weak').length +
    pageStates.filter((s) => s.status === 'review' || s.status === 'weak').length;

  const activeTabIdx = Math.max(
    0,
    TABS.findIndex((t) => t.id === sidebarTab),
  );

  return (
    <>
      {/* Backdrop on narrow screens (opacity synced with sidebar progress) */}
      <div
        ref={backdropRef}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
        style={{ opacity: sidebarOpen ? 1 : 0 }}
        className={`lg:hidden fixed inset-0 z-30 bg-black/25 ${
          sidebarOpen ? '' : 'pointer-events-none'
        }`}
      />

      {/* Sliding Sidebar Shell (position driven imperatively by StudyPage's unified rAF loop) */}
      <aside
        ref={asideRef}
        className={`absolute right-0 top-0 bottom-0 w-[330px] sm:w-[350px] max-w-[calc(100vw-48px)] z-40 overflow-visible will-change-transform ${
          sidebarOpen ? '' : 'pointer-events-none'
        }`}
      >
        {/* Dual-Purpose Overhang Ear Tab (opens when closed, closes when open, moves seamlessly with sidebar) */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'パネルを閉じる' : 'パネルを開く'}
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? 'パネルを閉じる' : '記録・目次・復習パネルを開く'}
          className="pointer-events-auto absolute top-[calc(12px+env(safe-area-inset-top))] right-[calc(100%-1px)] z-10 w-12 h-[54px] rounded-l-2xl bg-base-100/95 backdrop-blur-md border border-r-0 border-base-300 shadow-[-6px_4px_16px_rgba(15,23,42,0.10)] flex items-center justify-center text-base-content/75 hover:text-base-content hover:bg-base-200/70 transition-colors select-none"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <PanelRight className="w-5 h-5" />}
        </button>

        {/* Inner Clipped Panel Surface */}
        <div
          aria-hidden={!sidebarOpen}
          className="relative h-full w-full border-l border-base-300 bg-base-100 pt-[env(safe-area-inset-top)] flex flex-col overflow-hidden shadow-xl lg:shadow-none"
        >
          {/* Tabs header (text + underline look, full width with flex-expand & sliding underline) */}
          <div className="border-b border-base-300 shrink-0 px-2">
            <div className="relative flex items-stretch min-w-0">
              {TABS.map((t) => {
                const active = sidebarTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSidebarTab(t.id)}
                    className={`basis-0 min-w-0 py-3 whitespace-nowrap overflow-hidden transition-all duration-300 ease-out flex items-center justify-center gap-1.5 ${
                      active
                        ? 'grow-[1.45] text-[15px] font-semibold text-base-content'
                        : 'grow text-sm font-medium text-base-content/55 hover:text-base-content'
                    }`}
                  >
                    <span>{t.label}</span>
                    {t.id === 'review' && reviewCount > 0 && (
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full bg-base-200 text-base-content/75 leading-none">
                        {reviewCount}
                      </span>
                    )}
                  </button>
                );
              })}
              {/* Sliding underline synced 1:1 with the 1.45 : 1 : 1 flex expansion */}
              <span
                aria-hidden="true"
                className="absolute bottom-0 h-[2.5px] rounded-full bg-primary pointer-events-none transition-all duration-300 ease-out"
                style={{
                  width: `${(1.45 / 3.45) * 100}%`,
                  left: `${(activeTabIdx * (1 / 3.45)) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Horizontal Sliding Tab Bodies Track */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <div
              className="flex h-full w-[300%] will-change-transform"
              style={{
                transform: `translate3d(-${(activeTabIdx * 100) / 3}%, 0, 0)`,
                transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <div className="w-1/3 h-full shrink-0 flex flex-col overflow-hidden">
                <RecordTab
                  workbook={workbook}
                  pageStates={pageStates}
                  problems={problems}
                />
              </div>
              <div className="w-1/3 h-full shrink-0 flex flex-col overflow-hidden">
                <TocTab
                  unitNodes={unitNodes}
                  problems={problems}
                  onOpenImport={onOpenImport}
                />
              </div>
              <div className="w-1/3 h-full shrink-0 flex flex-col overflow-hidden">
                <ReviewTab
                  pageStates={pageStates}
                  problems={problems}
                  customReasons={workbook.customReasons}
                />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
});
