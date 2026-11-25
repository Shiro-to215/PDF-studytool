import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  BookOpen,
  Download,
  FileSpreadsheet,
  FolderPlus,
  MoreHorizontal,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  addWorkbook,
  db,
  deleteWorkbook,
  upsertProblem,
} from '../db/database';
import {
  exportBackupJson,
  importBackupJson,
  importProblemsToWorkbook,
  parseImportInput,
} from '../db/importExport';
import {
  resolveActiveLayer,
  resolveRoundRecord,
  STUDY_STATUS_META,
  type PageState,
  type Problem,
  type StudyStatus,
  type Workbook,
} from '../types/models';
import {
  generateSamplePhysicsPdfBlob,
  SAMPLE_IMPORT_CSV,
} from '../utils/samplePdfGenerator';
import { useThemeStore } from '../stores/useThemeStore';
import { useViewerStore } from '../stores/useViewerStore';
import { AddWorkbookModal } from '../components/home/AddWorkbookModal';
import { ImportIndexModal } from '../components/home/ImportIndexModal';
import { WorkbookSettingsModal } from '../components/home/WorkbookSettingsModal';

interface GlobalReviewRow {
  id: string;
  workbook: Workbook;
  pageNumber: number;
  label: string;
  status: StudyStatus;
  missReasons: string[];
}

export function HomePage() {
  const { theme, toggleTheme } = useThemeStore();
  const { openWorkbook } = useViewerStore();

  const workbooks = useLiveQuery(
    () => db.workbooks.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as Workbook[],
  );
  const pageStates = useLiveQuery(
    () => db.pageStates.toArray(),
    [],
    [] as PageState[],
  );
  const problems = useLiveQuery(
    () => db.problems.toArray(),
    [],
    [] as Problem[],
  );

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [importTarget, setImportTarget] = useState<Workbook | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Workbook | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [creatingSample, setCreatingSample] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [isDraggingPage, setIsDraggingPage] = useState(false);
  const backupFileRef = useRef<HTMLInputElement | null>(null);

  // Per-workbook stats (scoped to each workbook's active round)
  const statsByWorkbook = useMemo(() => {
    const map = new Map<
      string,
      { totalTracked: number; done: number; attention: number; percent: number; activeRound: string }
    >();

    for (const wb of workbooks) {
      const activeRound = resolveActiveLayer(wb);
      const firstRound = wb.layers[0] ?? '1周目';
      const wbProblems = problems.filter((p) => p.workbookId === wb.id);
      const wbStates = pageStates.filter((s) => s.workbookId === wb.id);

      if (wbProblems.length > 0) {
        let done = 0;
        let attention = 0;
        for (const p of wbProblems) {
          const st = resolveRoundRecord(p, activeRound, firstRound).status;
          if (st === 'done') done++;
          else if (st === 'review' || st === 'weak') attention++;
        }
        const percent = Math.round((done / wbProblems.length) * 100);
        map.set(wb.id, {
          totalTracked: wbProblems.length,
          done,
          attention,
          percent,
          activeRound,
        });
      } else {
        let done = 0;
        let attention = 0;
        for (const s of wbStates) {
          const st = resolveRoundRecord(s, activeRound, firstRound).status;
          if (st === 'done') done++;
          else if (st === 'review' || st === 'weak') attention++;
        }
        const percent =
          wb.pageCount > 0 ? Math.min(100, Math.round((done / wb.pageCount) * 100)) : 0;
        map.set(wb.id, {
          totalTracked: wbStates.length,
          done,
          attention,
          percent,
          activeRound,
        });
      }
    }
    return map;
  }, [workbooks, problems, pageStates]);

  // Global review list across all workbooks (each workbook's active round)
  const globalReviewRows = useMemo<GlobalReviewRow[]>(() => {
    const wbMap = new Map(workbooks.map((w) => [w.id, w]));
    const rows: GlobalReviewRow[] = [];

    for (const p of problems) {
      const wb = wbMap.get(p.workbookId);
      if (!wb) continue;
      const rec = resolveRoundRecord(p, resolveActiveLayer(wb), wb.layers[0] ?? '1周目');
      if (rec.status !== 'review' && rec.status !== 'weak') continue;
      rows.push({
        id: `prob:${p.id}`,
        workbook: wb,
        pageNumber: p.pageNumber,
        label: p.numberLabel,
        status: rec.status,
        missReasons: rec.missReasons,
      });
    }

    for (const s of pageStates) {
      const wb = wbMap.get(s.workbookId);
      if (!wb) continue;
      const rec = resolveRoundRecord(s, resolveActiveLayer(wb), wb.layers[0] ?? '1周目');
      if (rec.status !== 'review' && rec.status !== 'weak') continue;
      rows.push({
        id: `page:${s.id}`,
        workbook: wb,
        pageNumber: s.pageNumber,
        label: `P.${s.pageNumber}`,
        status: rec.status,
        missReasons: rec.missReasons,
      });
    }

    return rows;
  }, [workbooks, problems, pageStates]);

  const totalDoneCount = useMemo(() => {
    let sum = 0;
    for (const st of statsByWorkbook.values()) {
      sum += st.done;
    }
    return sum;
  }, [statsByWorkbook]);

  const handleOpenBook = (
    wb: Workbook,
    page?: number,
    initialTab?: 'record' | 'toc' | 'review',
  ) => {
    openWorkbook({
      workbookId: wb.id,
      pageCount: wb.pageCount,
      lastPage: wb.lastPage,
      spreadMode: wb.defaultSpread,
      bindingDirection: wb.bindingDirection,
      coverSinglePage: wb.coverSinglePage,
      initialPage: page,
      initialTab,
    });
  };

  const handleCreateSample = async () => {
    if (creatingSample) return;
    setCreatingSample(true);
    try {
      const pdfBlob = generateSamplePhysicsPdfBlob();
      const wb = await addWorkbook({
        title: 'サンプル物理ワーク（力学）',
        pdfBlob,
        bindingDirection: 'ltr',
        defaultSpread: 'double',
        coverSinglePage: false,
      });
      const rows = parseImportInput(SAMPLE_IMPORT_CSV);
      await importProblemsToWorkbook(wb.id, rows);

      // Mark 2 sample problems as review/weak so the review workflow is immediately discoverable
      const createdProblems = await db.problems.where('workbookId').equals(wb.id).toArray();
      const p42 = createdProblems.find((p) => p.numberLabel === '問42');
      const p43 = createdProblems.find((p) => p.numberLabel === '問43');
      const p12 = createdProblems.find((p) => p.numberLabel === '例題12');
      if (p12) await upsertProblem(p12.id, { status: 'done' });
      if (p42) await upsertProblem(p42.id, { status: 'review', missReasons: ['方針不足'] });
      if (p43)
        await upsertProblem(p43.id, {
          status: 'weak',
          missReasons: ['方針不足', '計算ミス'],
        });

      handleOpenBook(wb, 1);
    } finally {
      setCreatingSample(false);
    }
  };

  const handleDeleteWorkbook = async (wb: Workbook) => {
    setOpenMenuId(null);
    if (!window.confirm(`「${wb.title}」と関連する書き込み・記録をすべて削除しますか？`)) {
      return;
    }
    await deleteWorkbook(wb.id);
  };

  const handleExportBackup = async () => {
    const json = await exportBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paperwork-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupNotice('学習データのバックアップを保存しました');
    setTimeout(() => setBackupNotice(null), 3000);
  };

  const handleImportBackup = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importBackupJson(text);
      setBackupNotice(
        `復元完了：${res.restoredWorkbooks}冊・記録${res.restoredStates + res.restoredProblems}件`,
      );
      setTimeout(() => setBackupNotice(null), 3500);
    } catch (err) {
      setBackupNotice(err instanceof Error ? err.message : '復元に失敗しました');
      setTimeout(() => setBackupNotice(null), 3500);
    }
  };

  useEffect(() => {
    if (!isDraggingPage) return;
    const clearDrag = () => setIsDraggingPage(false);
    window.addEventListener('dragend', clearDrag);
    window.addEventListener('drop', clearDrag);
    return () => {
      window.removeEventListener('dragend', clearDrag);
      window.removeEventListener('drop', clearDrag);
    };
  }, [isDraggingPage]);

  const handlePageDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPage(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      setDroppedFile(file);
      setAddModalOpen(true);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingPage(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsDraggingPage(false);
        }
      }}
      onDragEnd={() => setIsDraggingPage(false)}
      onDrop={handlePageDrop}
      className="min-h-screen bg-base-200 text-base-content flex flex-col"
    >
      {/* Top Minimal Header */}
      <header className="h-14 border-b border-base-300 bg-base-100 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-neutral text-neutral-content flex items-center justify-center">
              <BookOpen className="w-4 h-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight">PaperWork Studio</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="btn btn-ghost btn-sm inline-flex gap-1.5 font-normal text-xs border border-base-300"
              title="記録・単元・手書きの軽量バックアップを書き出す"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">書き出し</span>
            </button>
            <button
              type="button"
              onClick={() => backupFileRef.current?.click()}
              className="btn btn-ghost btn-sm inline-flex gap-1.5 font-normal text-xs border border-base-300"
              title="バックアップJSONから記録を復元"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">復元</span>
            </button>
            <input
              ref={backupFileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                void handleImportBackup(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={toggleTheme}
              className="btn btn-ghost btn-sm btn-square border border-base-300"
              title={theme === 'light' ? 'ダークモードに切替' : 'ライトモードに切替'}
              aria-label="テーマ切替"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setDroppedFile(null);
                setAddModalOpen(true);
              }}
              className="btn btn-primary btn-sm gap-1.5 font-medium"
            >
              <Plus className="w-4 h-4" />
              <span>PDFを追加</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-7 space-y-8">
        {backupNotice && (
          <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-2.5 text-xs text-base-content/80">
            {backupNotice}
          </div>
        )}

        {/* Quiet Summary Strip */}
        <section className="grid grid-cols-3 gap-3 sm:gap-4">
          <div className="rounded-2xl bg-base-100 border border-base-300 px-4 py-3.5">
            <p className="text-[11px] font-medium text-base-content/55">登録ワーク</p>
            <p className="text-xl sm:text-2xl font-semibold tracking-tight mt-1 font-mono">
              {workbooks.length}
              <span className="text-xs font-sans font-normal text-base-content/50 ml-1">冊</span>
            </p>
          </div>
          <div className="rounded-2xl bg-base-100 border border-base-300 px-4 py-3.5">
            <p className="text-[11px] font-medium text-base-content/55">要復習・苦手</p>
            <p className="text-xl sm:text-2xl font-semibold tracking-tight mt-1 font-mono text-amber-600 dark:text-amber-400">
              {globalReviewRows.length}
              <span className="text-xs font-sans font-normal text-base-content/50 ml-1">件</span>
            </p>
          </div>
          <div className="rounded-2xl bg-base-100 border border-base-300 px-4 py-3.5">
            <p className="text-[11px] font-medium text-base-content/55">完了記録</p>
            <p className="text-xl sm:text-2xl font-semibold tracking-tight mt-1 font-mono text-emerald-600 dark:text-emerald-400">
              {totalDoneCount}
              <span className="text-xs font-sans font-normal text-base-content/50 ml-1">件</span>
            </p>
          </div>
        </section>

        {/* Bookshelf Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">本棚</h2>
            {workbooks.length > 0 && (
              <button
                type="button"
                disabled={creatingSample}
                onClick={handleCreateSample}
                className="text-xs text-base-content/60 hover:text-primary transition-colors flex items-center gap-1"
              >
                <Sparkles className="w-3.5 h-3.5" />
                サンプル物理ワークを追加
              </button>
            )}
          </div>

          {workbooks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-base-300 bg-base-100 p-10 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-base-200 mx-auto flex items-center justify-center text-base-content/55">
                <FolderPlus className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-semibold">最初のPDFワークを追加しましょう</h3>
                <p className="text-xs text-base-content/60 leading-relaxed">
                  PDFファイルをこの画面にドロップするか「PDFを追加」から読み込むと、事前登録なしですぐにページをめくって書き込めます。
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDroppedFile(null);
                    setAddModalOpen(true);
                  }}
                  className="btn btn-primary btn-sm gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  PDFファイルを選ぶ
                </button>
                <button
                  type="button"
                  disabled={creatingSample}
                  onClick={handleCreateSample}
                  className="btn btn-ghost btn-sm border border-base-300 gap-1.5"
                >
                  <Sparkles className="w-4 h-4" />
                  {creatingSample ? '準備中...' : 'サンプル物理ワーク（6P）を試す'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {workbooks.map((wb) => {
                const st = statsByWorkbook.get(wb.id);
                const menuOpen = openMenuId === wb.id;
                return (
                  <div
                    key={wb.id}
                    className="group relative rounded-2xl bg-base-100 border border-base-300 hover:border-primary/60 transition-colors overflow-visible flex flex-col"
                  >
                    {/* Cover preview */}
                    <div
                      onClick={() => handleOpenBook(wb)}
                      className="cursor-pointer h-44 rounded-t-2xl bg-base-200/70 p-4 flex items-center justify-center relative overflow-hidden"
                    >
                      {wb.coverDataUrl ? (
                        <img
                          src={wb.coverDataUrl}
                          alt={wb.title}
                          className="h-36 w-auto object-contain rounded shadow-sm ring-1 ring-black/10 group-hover:-translate-y-0.5 transition-transform"
                        />
                      ) : (
                        <div className="h-36 w-24 rounded bg-base-100 border border-base-300 flex items-center justify-center text-base-content/30">
                          <BookOpen className="w-6 h-6" />
                        </div>
                      )}

                      {st && st.attention > 0 && (
                        <span className="absolute top-3 left-3 text-[11px] font-medium px-2 py-0.5 rounded-full bg-base-100/95 border border-base-300 text-amber-600 dark:text-amber-400">
                          要復習 {st.attention}
                        </span>
                      )}

                      {st && wb.layers.length > 1 && (
                        <span className="absolute top-3 right-3 text-[11px] font-medium px-2 py-0.5 rounded-full bg-base-100/95 border border-base-300 text-primary">
                          {st.activeRound}
                        </span>
                      )}
                    </div>

                    {/* Card Details */}
                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div
                          onClick={() => handleOpenBook(wb)}
                          className="cursor-pointer min-w-0 flex-1"
                        >
                          <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                            {wb.title}
                          </h3>
                          <p className="text-xs text-base-content/55 mt-0.5 font-mono">
                            P.{wb.lastPage} / {wb.pageCount} ・{' '}
                            <span className="font-sans">
                              {wb.bindingDirection === 'ltr' ? '左綴じ' : '右綴じ'}
                            </span>
                          </p>
                        </div>

                        {/* Context Menu */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setOpenMenuId(menuOpen ? null : wb.id)}
                            className="btn btn-ghost btn-xs btn-square text-base-content/55"
                            aria-label="ワークブックメニュー"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>

                          {menuOpen && (
                            <>
                              <div
                                onClick={() => setOpenMenuId(null)}
                                className="fixed inset-0 z-20"
                              />
                              <div className="absolute right-0 bottom-full mb-1 w-52 rounded-xl bg-base-100 border border-base-300 shadow-xl py-1 z-30">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setSettingsTarget(wb);
                                  }}
                                  className="w-full px-3 py-2 text-left text-xs hover:bg-base-200 flex items-center gap-2"
                                >
                                  <Settings className="w-3.5 h-3.5 text-base-content/60" />
                                  設定（綴じ方向・表示）
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setImportTarget(wb);
                                  }}
                                  className="w-full px-3 py-2 text-left text-xs hover:bg-base-200 flex items-center gap-2"
                                >
                                  <FileSpreadsheet className="w-3.5 h-3.5 text-base-content/60" />
                                  CSV / JSON 問題取込
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteWorkbook(wb)}
                                  className="w-full px-3 py-2 text-left text-xs text-error hover:bg-error/10 flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  削除
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] text-base-content/55">
                          <span>進捗</span>
                          <span className="font-mono">{st?.percent ?? 0}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-base-200 overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${st?.percent ?? 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Global Review List Section */}
        <section className="rounded-2xl bg-base-100 border border-base-300 p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold tracking-tight">
                間違えた問題・要復習まとめ
              </h2>
            </div>
          </div>

          {globalReviewRows.length === 0 ? (
            <p className="text-xs text-base-content/50 py-3">
              学習中に「要復習」や「苦手」をつけた問題・ページがここにまとまります。
            </p>
          ) : (
            <div className="divide-y divide-base-300">
              {globalReviewRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => handleOpenBook(row.workbook, row.pageNumber, 'review')}
                  className="w-full py-2.5 px-2 -mx-2 rounded-lg hover:bg-base-200/70 transition-colors flex items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-content/75 shrink-0">
                        P.{row.pageNumber}
                      </span>
                      <span className="text-xs font-semibold truncate">{row.label}</span>
                      <span className="text-xs text-base-content/50 truncate">
                        — {row.workbook.title}
                      </span>
                    </div>
                    {row.missReasons.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {row.missReasons.map((r) => (
                          <span
                            key={r}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-base-200 text-base-content/65"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <span
                    className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${
                      STUDY_STATUS_META[row.status].badgeClass
                    }`}
                  >
                    {STUDY_STATUS_META[row.status].label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Drag & Drop Overlay */}
      {isDraggingPage && (
        <div className="fixed inset-0 z-50 bg-primary/10 backdrop-blur-[2px] border-4 border-dashed border-primary flex items-center justify-center pointer-events-none">
          <div className="px-6 py-4 rounded-2xl bg-base-100 border border-base-300 shadow-lg text-sm font-medium">
            PDFをドロップしてワークを追加
          </div>
        </div>
      )}

      {/* Modals */}
      {addModalOpen && (
        <AddWorkbookModal
          key={droppedFile?.name ?? 'empty'}
          open={addModalOpen}
          initialFile={droppedFile}
          onClose={() => {
            setAddModalOpen(false);
            setDroppedFile(null);
          }}
          onCreated={(wb) => handleOpenBook(wb, 1)}
        />
      )}

      {importTarget && (
        <ImportIndexModal
          open={true}
          workbookId={importTarget.id}
          workbookTitle={importTarget.title}
          onClose={() => setImportTarget(null)}
        />
      )}

      {settingsTarget && (
        <WorkbookSettingsModal
          workbook={settingsTarget}
          onClose={() => setSettingsTarget(null)}
        />
      )}
    </div>
  );
}
