import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Eye,
  EyeOff,
  FileText,
  Layers,
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

  const [editingPage, setEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [layersMenuOpen, setLayersMenuOpen] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');
  const layerMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (!layersMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (layerMenuRef.current && !layerMenuRef.current.contains(e.target as Node)) {
        setLayersMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [layersMenuOpen]);

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
    <div className="relative shrink-0 z-50 bg-base-100 pt-[env(safe-area-inset-top)]">
      <header className="h-12 px-3 bg-base-100 border-b border-base-300 flex items-center justify-between gap-2">
        {/* Left: Back + Title + Page Jump */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={closeWorkbook}
            className="btn btn-ghost btn-sm px-2 gap-1 text-base-content/70 hover:text-base-content"
            title="本棚へ戻る"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline text-xs font-medium">本棚</span>
          </button>

          <div className="h-4 w-px bg-base-300 hidden sm:block" />

          <h1 className="text-xs sm:text-sm font-semibold truncate max-w-[140px] sm:max-w-[240px]">
            {workbook.title}
          </h1>

          {editingPage ? (
            <form onSubmit={commitPageJump} className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={pageCount}
                autoFocus
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => setEditingPage(false)}
                className="input input-bordered input-xs w-16 font-mono text-center"
              />
              <span className="text-xs text-base-content/50 font-mono">/ {pageCount}</span>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditingPage(true)}
              title="クリックしてページ番号を指定ジャンプ"
              className="px-2 py-1 rounded-md bg-base-200 hover:bg-base-300/70 transition-colors text-xs font-mono text-base-content/80 shrink-0"
            >
              {pageLabel} <span className="text-base-content/45">/ {pageCount}</span>
            </button>
          )}
        </div>

        {/* Right: View & Layer Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleToggleSpread}
            className="btn btn-ghost btn-xs h-8 px-2 gap-1.5 border border-base-300 font-normal"
            title={spreadMode === 'double' ? '単ページ表示へ切替' : '見開き表示へ切替'}
          >
            {spreadMode === 'double' ? (
              <>
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-xs">見開き</span>
              </>
            ) : (
              <>
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-xs">単ページ</span>
              </>
            )}
          </button>

          {/* Layer Popover */}
          <div ref={layerMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setLayersMenuOpen((v) => !v)}
              className={`btn btn-ghost btn-xs h-8 px-2 gap-1.5 border font-normal ${
                allInkHidden
                  ? 'border-warning/50 text-warning bg-warning/5'
                  : 'border-base-300'
              }`}
              title="周回レイヤー・書き込み表示設定"
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-xs">
                {allInkHidden ? '非表示中' : activeLayer}
              </span>
            </button>

            {layersMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-base-100 border border-base-300 shadow-xl p-3 space-y-3 z-50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">周回レイヤー</span>
                  <button
                    type="button"
                    onClick={toggleAllInkHidden}
                    className={`btn btn-xs gap-1 ${
                      allInkHidden ? 'btn-warning' : 'btn-ghost border border-base-300'
                    }`}
                  >
                    {allInkHidden ? (
                      <>
                        <EyeOff className="w-3 h-3" />
                        全非表示中
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        全表示
                      </>
                    )}
                  </button>
                </div>

                <div className="space-y-1 max-h-44 overflow-y-auto thin-scrollbar">
                  {workbook.layers.map((layer) => {
                    const isActive = activeLayer === layer;
                    const isHidden = hiddenLayers.includes(layer);
                    return (
                      <div
                        key={layer}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors ${
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
                            <span className="ml-1.5 text-[10px] opacity-70">（書き込み中）</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleLayerVisibility(layer)}
                          className="btn btn-ghost btn-xs btn-square"
                          title={isHidden ? '表示する' : '隠す'}
                        >
                          {isHidden ? (
                            <EyeOff className="w-3.5 h-3.5 text-base-content/35" />
                          ) : (
                            <Eye className="w-3.5 h-3.5 text-base-content/70" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleAddLayer} className="flex gap-1.5 pt-2 border-t border-base-300">
                  <input
                    type="text"
                    value={newLayerName}
                    onChange={(e) => setNewLayerName(e.target.value)}
                    placeholder={`${workbook.layers.length + 1}周目`}
                    className="input input-bordered input-xs flex-1"
                  />
                  <button type="submit" className="btn btn-primary btn-xs btn-square" title="周回レイヤーを追加">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </form>

                {spreadMode === 'double' && (
                  <label className="flex items-center gap-2 pt-2 border-t border-base-300 cursor-pointer text-[11px] text-base-content/75">
                    <input
                      type="checkbox"
                      checked={coverSinglePage}
                      onChange={handleToggleCoverSingle}
                      className="checkbox checkbox-xs checkbox-primary"
                    />
                    1ページ目を表紙単独にする
                  </label>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost btn-xs btn-square h-8 w-8 border border-base-300"
            title={theme === 'light' ? 'ダークモードへ' : 'ライトモードへ'}
            aria-label="テーマ切替"
          >
            {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={toggleSidebar}
            className={`btn btn-xs h-8 px-2 gap-1.5 border ${
              sidebarOpen
                ? 'btn-primary'
                : 'btn-ghost border-base-300'
            }`}
            title="右サイドバーを開閉"
          >
            <PanelRight className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-xs font-normal">パネル</span>
          </button>
        </div>
      </header>

      {/* Active Review Queue Banner */}
      {reviewQueue.length > 0 && (
        <div className="h-9 px-3 bg-base-100/95 border-b border-base-300 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-base-content/80">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="font-medium">連続復習モード</span>
            <span className="font-mono text-base-content/60">
              {reviewQueueIndex + 1} / {reviewQueue.length}（P.{reviewQueue[reviewQueueIndex]}）
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepReviewQueue(-1)}
              className="btn btn-ghost btn-xs gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              前へ
            </button>
            <button
              type="button"
              onClick={() => stepReviewQueue(1)}
              className="btn btn-ghost btn-xs gap-1"
            >
              次へ
              <ArrowRight className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={clearReviewQueue}
              className="btn btn-ghost btn-xs btn-square text-base-content/50"
              title="連続復習を終了"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
