import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Layers,
  Menu,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
} from 'lucide-react';
import {
  resolveActiveLayer,
  resolveRoundRecord,
  type PageState,
  type Problem,
  type Workbook,
} from '../../types/models';
import {
  addWorkbookRound,
  setWorkbookActiveLayer,
  updateWorkbookRounds,
  updateWorkbookSettings,
} from '../../db/database';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';
import { useToolStore } from '../../stores/useToolStore';
import { useThemeStore } from '../../stores/useThemeStore';

interface TopBarProps {
  workbook: Workbook;
  problems: Problem[];
  pageStates: PageState[];
  onOpenImport: () => void;
}

export function TopBar({ workbook, problems, pageStates, onOpenImport }: TopBarProps) {
  const { theme, toggleTheme } = useThemeStore();
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    showPageTurnButtons,
    closeWorkbook,
    setCurrentPage,
    setSpreadMode,
    setCoverSinglePage,
    togglePageTurnButtons,
  } = useViewerStore();

  const {
    hiddenLayers,
    allInkHidden,
    setActiveLayer,
    toggleLayerVisibility,
    toggleAllInkHidden,
  } = useToolStore();

  const activeRound = resolveActiveLayer(workbook);
  const firstRound = workbook.layers[0] ?? '1周目';

  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(workbook.title);
  const [titleEdges, setTitleEdges] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  const [editingPage, setEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState(String(currentPage));

  // Round creation & batch editing state
  const [newRoundName, setNewRoundName] = useState('');
  const [newRoundMode, setNewRoundMode] = useState<'fresh' | 'carry_done'>('fresh');
  const [addingRound, setAddingRound] = useState(false);
  const [editingRounds, setEditingRounds] = useState(false);
  const [roundDrafts, setRoundDrafts] = useState<
    Array<{ original: string; value: string }>
  >([]);

  const drawerRef = useRef<HTMLElement | null>(null);
  const titleScrollRef = useRef<HTMLDivElement | null>(null);
  const titleDidScrollRef = useRef(false);

  // Per-round completion stats (done / total)
  const roundStatsMap = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    const hasProblems = problems.length > 0;
    const total = hasProblems ? problems.length : workbook.pageCount;

    for (const layer of workbook.layers) {
      let done = 0;
      if (hasProblems) {
        for (const p of problems) {
          if (resolveRoundRecord(p, layer, firstRound).status === 'done') done++;
        }
      } else {
        for (const s of pageStates) {
          if (resolveRoundRecord(s, layer, firstRound).status === 'done') done++;
        }
      }
      map.set(layer, { done, total });
    }
    return map;
  }, [workbook.layers, workbook.pageCount, problems, pageStates, firstRound]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (!editingTitle) {
      setTitleInput(workbook.title);
    }
  }, [workbook.title, editingTitle]);

  const updateTitleEdges = useCallback(() => {
    const el = titleScrollRef.current;
    if (!el) {
      setTitleEdges((prev) => (prev.left || prev.right ? { left: false, right: false } : prev));
      return;
    }
    const hasOverflow = el.scrollWidth > el.clientWidth + 2;
    const left = hasOverflow && el.scrollLeft > 2;
    const right = hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setTitleEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useLayoutEffect(() => {
    if (editingTitle) return;
    const el = titleScrollRef.current;
    if (!el) return;
    updateTitleEdges();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateTitleEdges());
    ro.observe(el);
    return () => ro.disconnect();
  }, [workbook.title, editingTitle, menuOpen, updateTitleEdges]);

  const commitTitleRename = () => {
    const trimmed = titleInput.trim();
    if (trimmed && trimmed !== workbook.title) {
      void updateWorkbookSettings(workbook.id, { title: trimmed });
    } else {
      setTitleInput(workbook.title);
    }
    setEditingTitle(false);
  };

  // Smoothly slide-close when tapping/writing outside WITHOUT blocking Apple Pencil or taps
  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (drawerRef.current?.contains(target)) return;
      setMenuOpen(false);
      setEditingPage(false);
      setEditingTitle(false);
      setEditingRounds(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingTitle) {
          setTitleInput(workbook.title);
          setEditingTitle(false);
          return;
        }
        if (editingRounds) {
          setEditingRounds(false);
          return;
        }
        setMenuOpen(false);
        setEditingPage(false);
      }
    };
    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('touchstart', handleOutside, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('touchstart', handleOutside, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, editingTitle, editingRounds, workbook.title]);

  const layout = getSpreadLayout(
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
  );

  const pageLabel =
    layout.pages.length === 2
      ? `P.${Math.min(...layout.pages)}–${Math.max(...layout.pages)}`
      : `P.${layout.pages[0] ?? currentPage}`;

  const commitPageJump = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(pageInput, 10);
    if (Number.isFinite(num) && num >= 1 && num <= pageCount) {
      setCurrentPage(num);
    } else {
      setPageInput(String(currentPage));
    }
    setEditingPage(false);
  };

  const handleToggleSpread = () => {
    const next = spreadMode === 'double' ? 'single' : 'double';
    setSpreadMode(next);
    void updateWorkbookSettings(workbook.id, { defaultSpread: next });
  };

  const handleToggleCoverSingle = () => {
    const next = !coverSinglePage;
    setCoverSinglePage(next);
    void updateWorkbookSettings(workbook.id, { coverSinglePage: next });
  };

  const handleSelectRound = (layer: string) => {
    setActiveLayer(layer);
    void setWorkbookActiveLayer(workbook.id, layer);
  };

  const handleAddRound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addingRound) return;
    setAddingRound(true);
    try {
      const candidate = newRoundName.trim() || `${workbook.layers.length + 1}周目`;
      const createdName = await addWorkbookRound(
        workbook.id,
        candidate,
        newRoundMode,
        activeRound,
      );
      setActiveLayer(createdName);
      setNewRoundName('');
    } finally {
      setAddingRound(false);
    }
  };

  const handleToggleEditRounds = () => {
    if (editingRounds) {
      setEditingRounds(false);
      return;
    }
    setRoundDrafts(workbook.layers.map((l) => ({ original: l, value: l })));
    setEditingRounds(true);
  };

  const updateRoundDraft = (idx: number, value: string) => {
    setRoundDrafts((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, value } : item)),
    );
  };

  const removeRoundDraft = (idx: number) => {
    setRoundDrafts((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleSaveRounds = async () => {
    const nextLayers: string[] = [];
    const seen = new Set<string>();
    const renameMap: Record<string, string> = {};

    for (const draft of roundDrafts) {
      const trimmed = draft.value.trim();
      if (!trimmed) continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        nextLayers.push(trimmed);
      }
      if (draft.original !== trimmed) {
        renameMap[draft.original] = trimmed;
      }
    }

    if (nextLayers.length === 0) {
      setEditingRounds(false);
      return;
    }

    const res = await updateWorkbookRounds(workbook.id, nextLayers, renameMap);
    setActiveLayer(res.activeLayer);
    setEditingRounds(false);
  };

  return (
    <aside
      ref={drawerRef}
      onPointerDown={(e) => {
        if (menuOpen) e.stopPropagation();
      }}
      onTouchStart={(e) => {
        if (menuOpen) e.stopPropagation();
      }}
      style={{
        transform: menuOpen ? 'translate3d(0px, 0px, 0)' : 'translate3d(-100%, 0px, 0)',
        transition: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className={`absolute left-0 top-0 bottom-0 w-[300px] sm:w-[310px] max-w-[calc(100vw-48px)] z-[45] overflow-visible will-change-transform select-none ${
        menuOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {/* Left-Edge Overhang Ear Tab (rides with drawer and tucks smoothly behind it when open) */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onClick={() => {
          setMenuOpen(true);
          setEditingPage(false);
        }}
        aria-label="メニューを開く"
        aria-expanded={menuOpen}
        aria-hidden={menuOpen}
        tabIndex={menuOpen ? -1 : 0}
        title="メニュー（設定・周回管理）"
        style={{
          transform: menuOpen ? 'translate3d(-100%, 0px, 0)' : 'translate3d(0px, 0px, 0)',
          opacity: menuOpen ? 0 : 1,
          transition: menuOpen
            ? 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out'
            : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1) 80ms, opacity 220ms ease-out 80ms',
        }}
        className={`absolute top-[calc(12px+env(safe-area-inset-top))] left-[calc(100%-1px)] z-0 w-12 h-[54px] rounded-r-2xl bg-base-100/95 backdrop-blur-md border border-l-0 border-base-300 shadow-[6px_4px_16px_rgba(15,23,42,0.10)] flex items-center justify-center text-base-content/75 hover:text-base-content hover:bg-base-200/70 select-none ${
          menuOpen ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
      >
        <Menu className="w-5 h-5" />
        {allInkHidden && !menuOpen && (
          <span
            className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-warning ring-2 ring-base-100"
            title="書き込み非表示中"
          />
        )}
      </button>

      {/* Inner Clipped Drawer Surface (sits above ear tab so tab tucks cleanly behind it) */}
      <div
        aria-hidden={!menuOpen}
        className={`relative z-10 h-full w-full border-r border-base-300 bg-base-100 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] flex flex-col overflow-hidden transition-shadow duration-300 ${
          menuOpen ? 'shadow-[12px_0_32px_rgba(15,23,42,0.14)]' : 'shadow-none'
        }`}
      >
        {/* Fixed Header: Pill Back Button (matching TOC Back) + Tappable Scrollable Workbook Title */}
        <div className="px-4 py-3.5 border-b border-base-300 flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={closeWorkbook}
            className="h-10 px-3.5 rounded-full bg-base-200 hover:bg-base-300/80 border border-base-300 flex items-center gap-1.5 text-sm font-medium text-base-content/85 transition-colors active:scale-95 shrink-0"
            title="本棚へ戻る"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>本棚</span>
          </button>

          {editingTitle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitTitleRename();
              }}
              className="flex-1 min-w-0"
            >
              <input
                type="text"
                autoFocus
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={commitTitleRename}
                aria-label="ワーク名を変更"
                className="w-full h-10 px-2.5 rounded-xl border border-primary bg-base-100 text-xl font-bold text-base-content focus:outline-none"
              />
            </form>
          ) : (
            (() => {
              let titleMask: string | undefined;
              if (titleEdges.left && titleEdges.right) {
                titleMask =
                  'linear-gradient(to right, transparent 0, black 18px, black calc(100% - 18px), transparent 100%)';
              } else if (titleEdges.right) {
                titleMask =
                  'linear-gradient(to right, black 0, black calc(100% - 22px), transparent 100%)';
              } else if (titleEdges.left) {
                titleMask =
                  'linear-gradient(to right, transparent 0, black 22px, black 100%)';
              }
              return (
                <div className="flex-1 min-w-0 flex items-center">
                  <div
                    role="button"
                    tabIndex={0}
                    title="タップして名前を変更"
                    onPointerDown={() => {
                      titleDidScrollRef.current = false;
                    }}
                    onClick={() => {
                      if (titleDidScrollRef.current) {
                        titleDidScrollRef.current = false;
                        return;
                      }
                      setTitleInput(workbook.title);
                      setEditingTitle(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setTitleInput(workbook.title);
                        setEditingTitle(true);
                      }
                    }}
                    className="max-w-full inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 hover:bg-base-200/70 transition-colors cursor-pointer"
                  >
                    <div
                      ref={titleScrollRef}
                      onScroll={() => {
                        titleDidScrollRef.current = true;
                        updateTitleEdges();
                      }}
                      style={
                        titleMask
                          ? { maskImage: titleMask, WebkitMaskImage: titleMask }
                          : undefined
                      }
                      className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden math-scroll whitespace-nowrap"
                    >
                      <span
                        className={`inline-block text-xl font-bold text-base-content leading-tight ${
                          titleEdges.left || titleEdges.right ? 'pr-2' : ''
                        }`}
                      >
                        {workbook.title}
                      </span>
                    </div>
                    <Pencil
                      className="w-4 h-4 shrink-0 text-[#9ca3af] dark:text-base-content/40"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              );
            })()
          )}
        </div>

        {/* Scrollable Drawer Body */}
        <div className="flex-1 overflow-y-auto thin-scrollbar p-4 space-y-5">
          {/* Page Indicator / Jump */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-base-content/65 font-medium">ページ</span>
            {editingPage ? (
              <form onSubmit={commitPageJump} className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  autoFocus
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => setEditingPage(false)}
                  className="input input-bordered input-sm w-20 font-mono text-sm text-center"
                />
                <span className="text-sm text-base-content/50 font-mono">/ {pageCount}</span>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingPage(true)}
                title="タップしてページ番号を指定ジャンプ"
                className="px-3 py-1.5 rounded-xl bg-base-200 hover:bg-base-300/70 transition-colors text-sm font-mono text-base-content/85"
              >
                {pageLabel} <span className="text-base-content/45">/ {pageCount}</span>
              </button>
            )}
          </div>

          {/* View & Theme Settings */}
          <div className="space-y-3 pt-4 border-t border-base-300">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleToggleSpread}
                className="h-11 px-3 rounded-xl border border-base-300 bg-base-200/55 hover:bg-base-200 transition-colors flex items-center justify-center gap-2 text-sm font-medium text-base-content/85"
                title={spreadMode === 'double' ? '単ページ表示へ切替' : '見開き表示へ切替'}
              >
                {spreadMode === 'double' ? (
                  <>
                    <BookOpen className="w-[18px] h-[18px] text-primary" />
                    <span>見開き</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-[18px] h-[18px] text-primary" />
                    <span>単ページ</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                className="h-11 px-3 rounded-xl border border-base-300 bg-base-200/55 hover:bg-base-200 transition-colors flex items-center justify-center gap-2 text-sm font-medium text-base-content/85"
                title={theme === 'light' ? 'ダークモードへ' : 'ライトモードへ'}
              >
                {theme === 'light' ? (
                  <>
                    <Moon className="w-[18px] h-[18px] text-base-content/75" />
                    <span>ダーク</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-[18px] h-[18px] text-amber-400" />
                    <span>ライト</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-2.5 pt-0.5">
              {spreadMode === 'double' && (
                <label className="flex items-center gap-2.5 px-1 cursor-pointer text-xs text-base-content/75">
                  <input
                    type="checkbox"
                    checked={coverSinglePage}
                    onChange={handleToggleCoverSingle}
                    className="checkbox checkbox-sm checkbox-primary"
                  />
                  1ページ目を表紙単独にする
                </label>
              )}
              <label className="flex items-center gap-2.5 px-1 cursor-pointer text-xs text-base-content/75">
                <input
                  type="checkbox"
                  checked={showPageTurnButtons}
                  onChange={togglePageTurnButtons}
                  className="checkbox checkbox-sm checkbox-primary"
                />
                ページめくりボタンを表示
              </label>
            </div>
          </div>

          {/* Study Rounds (per-round Status, Miss Reasons & Pen Strokes) */}
          <div className="pt-4 border-t border-base-300 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-base-content/60" />
                周回
              </span>
              <div className="flex items-center gap-1.5">
                {!editingRounds && (
                  <button
                    type="button"
                    onClick={toggleAllInkHidden}
                    title={allInkHidden ? 'すべての書き込みを表示' : 'すべての書き込みを非表示'}
                    className={`h-8 px-2 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors border ${
                      allInkHidden
                        ? 'bg-warning/15 text-warning border-warning/40'
                        : 'bg-base-200/70 hover:bg-base-200 text-base-content/70 border-base-300'
                    }`}
                  >
                    {allInkHidden ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        ペン隠中
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        ペン表示
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleEditRounds}
                  className={`h-8 px-2.5 rounded-lg text-xs font-medium text-primary flex items-center gap-1 transition-colors ${
                    editingRounds
                      ? 'bg-primary/20'
                      : 'bg-primary/10 hover:bg-primary/18'
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  編集
                </button>
              </div>
            </div>

            {editingRounds ? (
              <div className="space-y-2">
                {roundDrafts.map((draft, idx) => (
                  <div
                    key={draft.original}
                    className="flex items-center gap-1.5 rounded-xl border border-base-300 bg-base-200/40 p-2"
                  >
                    <input
                      type="text"
                      value={draft.value}
                      onChange={(e) => updateRoundDraft(idx, e.target.value)}
                      placeholder={`${idx + 1}周目`}
                      className="flex-1 h-9 px-3 rounded-lg border border-base-300 bg-base-100 text-sm focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={roundDrafts.length <= 1}
                      onClick={() => removeRoundDraft(idx)}
                      className="w-8 h-9 rounded-lg flex items-center justify-center text-base-content/55 hover:text-error hover:bg-error/10 disabled:opacity-30 disabled:pointer-events-none shrink-0 transition-colors"
                      title={
                        roundDrafts.length <= 1
                          ? '最後の1周は削除できません'
                          : 'この周回を削除'
                      }
                      aria-label="周回を削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setEditingRounds(false)}
                    className="btn btn-ghost btn-sm"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveRounds()}
                    className="btn btn-primary btn-sm"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  {workbook.layers.map((layer) => {
                    const isActive = activeRound === layer;
                    const isHidden = hiddenLayers.includes(layer);
                    const stats = roundStatsMap.get(layer);
                    return (
                      <div
                        key={layer}
                        className={`flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors border ${
                          isActive
                            ? 'bg-primary/10 border-primary/35 text-primary font-semibold'
                            : 'border-transparent hover:bg-base-200 text-base-content/85'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectRound(layer)}
                          className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left"
                        >
                          <span className="truncate">{layer}</span>
                          {stats && stats.total > 0 && (
                            <span
                              className={`text-xs font-mono shrink-0 ${
                                isActive ? 'text-primary/80' : 'text-base-content/50'
                              }`}
                            >
                              {stats.done}/{stats.total}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleLayerVisibility(layer)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-base-300/60 shrink-0 transition-colors"
                          title={isHidden ? 'ペン書き込みを表示' : 'ペン書き込みを隠す'}
                          aria-label={isHidden ? 'ペン書き込みを表示' : 'ペン書き込みを隠す'}
                        >
                          {isHidden ? (
                            <EyeOff className="w-4 h-4 text-base-content/35" />
                          ) : (
                            <Eye className="w-4 h-4 text-base-content/65" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Add New Round with Fresh / Carry-Done Mode Toggle */}
                <form onSubmit={handleAddRound} className="space-y-2 pt-1.5">
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-base-200 border border-base-300">
                    <button
                      type="button"
                      onClick={() => setNewRoundMode('fresh')}
                      className={`h-8 rounded-lg text-xs font-medium transition-all ${
                        newRoundMode === 'fresh'
                          ? 'bg-base-100 text-base-content shadow-xs font-semibold'
                          : 'text-base-content/55 hover:text-base-content'
                      }`}
                    >
                      まっさら
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewRoundMode('carry_done')}
                      className={`h-8 rounded-lg text-xs font-medium transition-all ${
                        newRoundMode === 'carry_done'
                          ? 'bg-base-100 text-base-content shadow-xs font-semibold'
                          : 'text-base-content/55 hover:text-base-content'
                      }`}
                    >
                      完了を引継ぐ
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newRoundName}
                      onChange={(e) => setNewRoundName(e.target.value)}
                      placeholder={`${workbook.layers.length + 1}周目`}
                      className="input input-bordered input-sm flex-1 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={addingRound}
                      className="btn btn-primary btn-sm px-3 gap-1"
                      title="新しい周回を追加"
                    >
                      <Plus className="w-4 h-4" />
                      追加
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>

        {/* Fixed Footer: Import Index / Answers */}
        <div className="px-4 py-3 border-t border-base-300 shrink-0 bg-base-100">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setEditingPage(false);
              setEditingTitle(false);
              setEditingRounds(false);
              onOpenImport();
            }}
            className="w-full h-11 px-3.5 rounded-xl bg-primary/10 hover:bg-primary/18 text-primary text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <FileSpreadsheet className="w-[18px] h-[18px]" />
            <span>問題・答えをインポート</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
