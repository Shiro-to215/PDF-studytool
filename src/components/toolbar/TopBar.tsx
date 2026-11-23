import { useEffect, useRef, useState } from 'react';
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
  Plus,
  Sun,
} from 'lucide-react';
import type { Workbook } from '../../types/models';
import { addWorkbookLayer, updateWorkbookSettings } from '../../db/database';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';
import { useToolStore } from '../../stores/useToolStore';
import { useThemeStore } from '../../stores/useThemeStore';

interface TopBarProps {
  workbook: Workbook;
  onOpenImport: () => void;
}

export function TopBar({ workbook, onOpenImport }: TopBarProps) {
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
    activeLayer,
    hiddenLayers,
    allInkHidden,
    setActiveLayer,
    toggleLayerVisibility,
    toggleAllInkHidden,
  } = useToolStore();

  const [menuOpen, setMenuOpen] = useState(false);
  const [editingPage, setEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [newLayerName, setNewLayerName] = useState('');
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Smoothly slide-close when tapping/writing outside WITHOUT blocking Apple Pencil or taps
  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (drawerRef.current?.contains(target)) return;
      setMenuOpen(false);
      setEditingPage(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [menuOpen]);

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

  const handleAddLayer = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = newLayerName.trim() || `${workbook.layers.length + 1}周目`;
    await addWorkbookLayer(workbook.id, candidate);
    setActiveLayer(candidate);
    setNewLayerName('');
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
        title="メニュー（設定・周回レイヤー）"
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
        {/* Fixed Header: Back to Bookshelf + Workbook Title */}
        <div className="px-4 py-3.5 border-b border-base-300 flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={closeWorkbook}
            className="btn btn-ghost btn-sm h-9 px-2.5 gap-1.5 text-base-content/75 hover:text-base-content shrink-0"
            title="本棚へ戻る"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">本棚</span>
          </button>
          <div className="h-4 w-px bg-base-300 shrink-0" />
          <h1 className="text-sm font-semibold truncate text-base-content/90">
            {workbook.title}
          </h1>
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

          {/* Study Layers (1周目, 2周目...) */}
          <div className="pt-4 border-t border-base-300 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-base-content/60" />
                周回レイヤー
              </span>
              <button
                type="button"
                onClick={toggleAllInkHidden}
                className={`btn btn-sm h-8 px-2.5 gap-1.5 text-xs ${
                  allInkHidden ? 'btn-warning' : 'btn-ghost border border-base-300'
                }`}
              >
                {allInkHidden ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    全非表示中
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    全表示
                  </>
                )}
              </button>
            </div>

            <div className="space-y-1.5">
              {workbook.layers.map((layer) => {
                const isActive = activeLayer === layer;
                const isHidden = hiddenLayers.includes(layer);
                return (
                  <div
                    key={layer}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-base-200'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveLayer(layer)}
                      className="flex-1 text-left truncate"
                    >
                      {layer}
                      {isActive && (
                        <span className="ml-1.5 text-xs opacity-70">（書き込み中）</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLayerVisibility(layer)}
                      className="btn btn-ghost btn-sm btn-square"
                      title={isHidden ? '表示する' : '隠す'}
                    >
                      {isHidden ? (
                        <EyeOff className="w-4 h-4 text-base-content/35" />
                      ) : (
                        <Eye className="w-4 h-4 text-base-content/70" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <form onSubmit={handleAddLayer} className="flex gap-2 pt-1">
              <input
                type="text"
                value={newLayerName}
                onChange={(e) => setNewLayerName(e.target.value)}
                placeholder={`${workbook.layers.length + 1}周目`}
                className="input input-bordered input-sm flex-1 text-sm"
              />
              <button
                type="submit"
                className="btn btn-primary btn-sm btn-square"
                title="周回レイヤーを追加"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Fixed Footer: Import Index / Answers */}
        <div className="px-4 py-3 border-t border-base-300 shrink-0 bg-base-100">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setEditingPage(false);
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
