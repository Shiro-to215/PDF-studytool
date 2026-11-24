import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronsLeftRight,
  FileSpreadsheet,
  FileText,
  Layers,
  Menu,
  Moon,
  Pencil,
  Plus,
  Settings,
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
  onOpenSettings: () => void;
}

export function TopBar({
  workbook,
  problems,
  pageStates,
  onOpenImport,
  onOpenSettings,
}: TopBarProps) {
  const { theme, toggleTheme } = useThemeStore();
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    showPageTurnButtons,
    closeWorkbook,
    setSpreadMode,
    togglePageTurnButtons,
  } = useViewerStore();

  const setActiveLayer = useToolStore((s) => s.setActiveLayer);

  const activeRound = resolveActiveLayer(workbook);
  const firstRound = workbook.layers[0] ?? '1周目';

  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(workbook.title);
  const [titleEdges, setTitleEdges] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  // Round creation & batch editing state
  const [showAddRoundForm, setShowAddRoundForm] = useState(false);
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
  const prevRoundStatsRef = useRef<Map<string, { done: number; total: number; pct: number }>>(
    new Map(),
  );

  // Per-round completion stats (done / total / percent) — computed only while left drawer is open
  // (reuses last snapshot while closing so progress bars never flicker during the 400ms slide-out)
  const roundStatsMap = useMemo(() => {
    if (!menuOpen) return prevRoundStatsRef.current;
    const map = new Map<string, { done: number; total: number; pct: number }>();
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
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      map.set(layer, { done, total, pct });
    }
    prevRoundStatsRef.current = map;
    return map;
  }, [menuOpen, workbook.layers, workbook.pageCount, problems, pageStates, firstRound]);

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
      setEditingTitle(false);
      setEditingRounds(false);
      setShowAddRoundForm(false);
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
        if (showAddRoundForm) {
          setShowAddRoundForm(false);
          return;
        }
        setMenuOpen(false);
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
  }, [menuOpen, editingTitle, editingRounds, showAddRoundForm, workbook.title]);

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

  const handleToggleSpread = () => {
    const next = spreadMode === 'double' ? 'single' : 'double';
    setSpreadMode(next);
    void updateWorkbookSettings(workbook.id, { defaultSpread: next });
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
      setShowAddRoundForm(false);
    } finally {
      setAddingRound(false);
    }
  };

  const handleToggleEditRounds = () => {
    if (editingRounds) {
      setEditingRounds(false);
      return;
    }
    setShowAddRoundForm(false);
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
        onClick={() => setMenuOpen(true)}
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
      </button>

      {/* Inner Clipped Drawer Surface (sits above ear tab so tab tucks cleanly behind it) */}
      <div
        aria-hidden={!menuOpen}
        className={`relative z-10 h-full w-full border-r border-base-300 bg-base-100 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] flex flex-col overflow-hidden transition-shadow duration-300 ${
          menuOpen ? 'shadow-[12px_0_32px_rgba(15,23,42,0.14)]' : 'shadow-none'
        }`}
      >
        {/* Fixed Header: Pill Back Button + Tappable Scrollable Workbook Title */}
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

        {/* Compact 4-Icon Quick Settings Bar + Quiet Read-Only Page Info */}
        <div className="px-4 py-3 border-b border-base-300 space-y-2.5 shrink-0">
          <div className="grid grid-cols-4 gap-2">
            {/* Spread / Single mode switch (neutral, matching Dark/Light mode switch) */}
            <button
              type="button"
              onClick={handleToggleSpread}
              aria-label={spreadMode === 'double' ? '単ページ表示に切り替え' : '見開き表示に切り替え'}
              title={spreadMode === 'double' ? '見開き表示中（タップで単ページ）' : '単ページ表示中（タップで見開き）'}
              className="h-11 rounded-xl border border-base-300 bg-base-200/60 hover:bg-base-200 text-base-content/75 hover:text-base-content flex items-center justify-center transition-colors active:scale-95"
            >
              {spreadMode === 'double' ? (
                <BookOpen className="w-5 h-5" />
              ) : (
                <FileText className="w-5 h-5" />
              )}
            </button>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'}
              title={theme === 'light' ? 'ダークモードへ' : 'ライトモードへ'}
              className="h-11 rounded-xl border border-base-300 bg-base-200/60 hover:bg-base-200 flex items-center justify-center transition-colors active:scale-95"
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5 text-base-content/75" />
              ) : (
                <Sun className="w-5 h-5 text-amber-400" />
              )}
            </button>

            {/* Page-turn buttons visibility toggle */}
            <button
              type="button"
              onClick={togglePageTurnButtons}
              aria-pressed={showPageTurnButtons}
              aria-label={
                showPageTurnButtons
                  ? 'ページめくりボタンを非表示にする'
                  : 'ページめくりボタンを表示する'
              }
              title={
                showPageTurnButtons
                  ? 'ページめくりボタン：表示中（タップで非表示）'
                  : 'ページめくりボタン：非表示（タップで表示）'
              }
              className={`h-11 rounded-xl border flex items-center justify-center transition-colors active:scale-95 ${
                showPageTurnButtons
                  ? 'bg-primary/10 border-primary/35 text-primary hover:bg-primary/15'
                  : 'bg-base-200/60 border-base-300 text-base-content/45 hover:bg-base-200 hover:text-base-content/75'
              }`}
            >
              <ChevronsLeftRight className="w-5 h-5" />
            </button>

            {/* Workbook settings modal (cover single page, binding direction, etc.) */}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setEditingTitle(false);
                setEditingRounds(false);
                setShowAddRoundForm(false);
                onOpenSettings();
              }}
              aria-label="ワーク設定を開く"
              title="ワーク設定（表紙単独・綴じ方向など）"
              className="h-11 rounded-xl border border-base-300 bg-base-200/60 hover:bg-base-200 text-base-content/75 hover:text-base-content flex items-center justify-center transition-colors active:scale-95"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>

          {/* Quiet Read-Only Current Page Indicator */}
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="text-base-content/50 font-medium">現在ページ</span>
            <span className="font-mono font-medium text-base-content/75">
              {pageLabel} <span className="text-base-content/40">/ {pageCount}</span>
            </span>
          </div>
        </div>

        {/* Hero Main Content: Study Rounds (per-round Status, Miss Reasons & Pen Strokes) */}
        <div className="flex-1 overflow-y-auto thin-scrollbar p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-base-content/60" />
              周回
            </span>
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
            <div className="space-y-2.5">
              {workbook.layers.map((layer) => {
                const isActive = activeRound === layer;
                const stats = roundStatsMap.get(layer) ?? { done: 0, total: 0, pct: 0 };
                return (
                  <button
                    key={layer}
                    type="button"
                    onClick={() => handleSelectRound(layer)}
                    className={`relative w-full overflow-hidden rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                      isActive
                        ? 'border-primary/45 bg-primary/[0.04] hover:bg-primary/[0.08]'
                        : 'border-base-300 bg-base-100 hover:bg-base-200/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <span
                        className={`text-[15px] font-semibold truncate ${
                          isActive ? 'text-primary' : 'text-base-content'
                        }`}
                      >
                        {layer}
                      </span>
                      {stats.total > 0 && (
                        <span
                          className={`text-xs font-mono shrink-0 ${
                            isActive ? 'text-primary/80 font-semibold' : 'text-base-content/55'
                          }`}
                        >
                          {stats.done}/{stats.total}
                        </span>
                      )}
                    </div>

                    {/* Subtle bottom progress bar (matching TOC unit cards) */}
                    {stats.total > 0 && (
                      <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-base-200">
                        <div
                          className="h-full bg-emerald-500/70 transition-all duration-300"
                          style={{ width: `${stats.pct}%` }}
                        />
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Collapsible Add New Round */}
              {showAddRoundForm ? (
                <form
                  onSubmit={handleAddRound}
                  className="rounded-2xl border border-base-300 bg-base-200/40 p-3 space-y-2.5"
                >
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

                  <input
                    type="text"
                    autoFocus
                    value={newRoundName}
                    onChange={(e) => setNewRoundName(e.target.value)}
                    placeholder={`${workbook.layers.length + 1}周目`}
                    className="input input-bordered input-sm w-full text-sm bg-base-100"
                  />

                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddRoundForm(false);
                        setNewRoundName('');
                      }}
                      className="btn btn-ghost btn-sm"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      disabled={addingRound}
                      className="btn btn-primary btn-sm px-3 gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      追加
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddRoundForm(true)}
                  className="w-full h-11 rounded-2xl border border-dashed border-base-300 hover:border-primary/45 hover:bg-base-200/50 text-sm font-medium text-base-content/65 hover:text-primary flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>周回を追加</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Fixed Footer: Import Index / Answers */}
        <div className="px-4 py-3 border-t border-base-300 shrink-0 bg-base-100">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setEditingTitle(false);
              setEditingRounds(false);
              setShowAddRoundForm(false);
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
