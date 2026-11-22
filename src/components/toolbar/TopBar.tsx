import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Menu,
  Moon,
  PanelRight,
  Plus,
  Sun,
  X,
} from 'lucide-react';
import type { Workbook } from '../../types/models';
import { addWorkbookLayer, updateWorkbookSettings } from '../../db/database';
import { getSpreadLayout, useViewerStore } from '../../stores/useViewerStore';
import { useToolStore } from '../../stores/useToolStore';
import { useThemeStore } from '../../stores/useThemeStore';

interface TopBarProps {
  workbook: Workbook;
}

export function TopBar({ workbook }: TopBarProps) {
  const { theme, toggleTheme } = useThemeStore();
  const {
    currentPage,
    pageCount,
    spreadMode,
    bindingDirection,
    coverSinglePage,
    sidebarOpen,
    reviewQueue,
    reviewQueueIndex,
    closeWorkbook,
    setCurrentPage,
    setSpreadMode,
    setCoverSinglePage,
    toggleSidebar,
    stepReviewQueue,
    clearReviewQueue,
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
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Auto-close menu when tapping outside or starting to draw on the PDF
  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuContainerRef.current?.contains(target)) return;
      setMenuOpen(false);
      setEditingPage(false);
    };
    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('touchstart', handleOutside, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('touchstart', handleOutside, true);
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
    <>
      {/* Floating Top-Left Hamburger Trigger + Spacious Popover Menu */}
      <div
        ref={menuContainerRef}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className="absolute top-[calc(12px+env(safe-area-inset-top))] left-3.5 z-40 select-none"
      >
        <button
          type="button"
          onClick={() => {
            setMenuOpen((v) => !v);
            setEditingPage(false);
          }}
          aria-label="メニューを開く"
          aria-expanded={menuOpen}
          title="メニュー（設定・周回レイヤー）"
          className={`relative w-[54px] h-[54px] rounded-full flex items-center justify-center border shadow-lg backdrop-blur-md transition-colors ${
            menuOpen
              ? 'bg-primary text-primary-content border-primary'
              : 'bg-base-100/95 text-base-content/80 border-base-300 hover:bg-base-100 hover:text-base-content'
          }`}
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          {allInkHidden && !menuOpen && (
            <span
              className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-warning ring-2 ring-base-100"
              title="書き込み非表示中"
            />
          )}
        </button>

        {menuOpen && (
          <div className="mt-2.5 w-80 max-w-[calc(100vw-28px)] max-h-[calc(100dvh-96px)] overflow-y-auto thin-scrollbar rounded-2xl bg-base-100/95 backdrop-blur-md border border-base-300 shadow-xl p-4 space-y-4 animate-palette-popover">
            {/* Back + Workbook Title */}
            <div className="flex items-center gap-2.5 pb-3 border-b border-base-300">
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

            {/* Spacious 2-Column View & Theme Toggles */}
            <div className="space-y-2.5">
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
            </div>

            {/* Study Layers (1周目, 2周目...) */}
            <div className="pt-3 border-t border-base-300 space-y-2.5">
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

              <div className="space-y-1.5 max-h-48 overflow-y-auto thin-scrollbar">
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
        )}
      </div>

      {/* Independent Floating Top-Right Panel Button (hidden while sidebar is open) */}
      {!sidebarOpen && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={() => {
            setMenuOpen(false);
            toggleSidebar();
          }}
          aria-label="右パネルを開く"
          title="記録・目次・復習パネルを開く"
          className="absolute top-[calc(12px+env(safe-area-inset-top))] right-3.5 z-40 w-[54px] h-[54px] rounded-full flex items-center justify-center bg-base-100/95 text-base-content/80 border border-base-300 shadow-lg backdrop-blur-md hover:bg-base-100 hover:text-base-content transition-colors select-none"
        >
          <PanelRight className="w-6 h-6" />
        </button>
      )}

      {/* Floating Active Review Queue Pill (only visible while reviewing) */}
      {reviewQueue.length > 0 && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute top-[calc(16px+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-30 h-10 px-3.5 rounded-full bg-base-100/95 backdrop-blur-md border border-base-300 shadow-md flex items-center gap-2 text-xs select-none"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
          <span className="font-medium hidden sm:inline">連続復習</span>
          <span className="font-mono text-base-content/75">
            {reviewQueueIndex + 1}/{reviewQueue.length}（P.{reviewQueue[reviewQueueIndex]}）
          </span>
          <div className="flex items-center gap-0.5 ml-1">
            <button
              type="button"
              onClick={() => stepReviewQueue(-1)}
              className="btn btn-ghost btn-xs btn-circle"
              title="前へ"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepReviewQueue(1)}
              className="btn btn-ghost btn-xs btn-circle"
              title="次へ"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={clearReviewQueue}
              className="btn btn-ghost btn-xs btn-circle text-base-content/50"
              title="連続復習を終了"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
