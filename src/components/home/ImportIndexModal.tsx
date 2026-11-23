import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import {
  importProblemsToWorkbook,
  parseImportInput,
  type ImportSummary,
} from '../../db/importExport';

interface ImportIndexModalProps {
  open: boolean;
  workbookId: string;
  workbookTitle: string;
  onClose: () => void;
  onImported?: (summary: ImportSummary) => void;
}

const EXAMPLE_JSON = `[
  {
    "path": "力学/運動方程式/基本問題",
    "problemNumber": "問42",
    "page": 34,
    "latex": true,
    "answer": [
      { "label": "(1)", "value": ["a = 3.0\\\\,\\\\mathrm{m/s^2}", "T = 12\\\\,\\\\mathrm{N}"] },
      { "label": "(2)", "value": "右向き", "latex": false }
    ]
  },
  {
    "path": "力学/摩擦力/発展問題",
    "problemNumber": "発展3",
    "page": 38,
    "latex": true,
    "answer": "F = \\\\mu (M + m) g"
  }
]`;

export function ImportIndexModal({
  open,
  workbookId,
  workbookTitle,
  onClose,
  onImported,
}: ImportIndexModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rawText, setRawText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const preview = useMemo(() => {
    if (!rawText.trim()) return { rows: [], parseError: null as string | null };
    try {
      const rows = parseImportInput(rawText);
      return { rows, parseError: null as string | null };
    } catch (err) {
      return {
        rows: [],
        parseError: err instanceof Error ? err.message : '形式の解析に失敗しました。',
      };
    }
  }, [rawText]);

  if (!open) return null;

  const handleFileLoad = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    setSummary(null);
    setError(null);
  };

  const handleImport = async () => {
    if (preview.rows.length === 0) {
      setError('取り込み可能な行が見つかりませんでした。');
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const result = await importProblemsToWorkbook(workbookId, preview.rows);
      setSummary(result);
      onImported?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'インポート中にエラーが発生しました。');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-base-100 border border-base-300 shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-base-300 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold tracking-tight">単元・問題・答え一括インポート</h2>
            <p className="text-xs text-base-content/60 mt-0.5">{workbookTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-square"
            aria-label="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto thin-scrollbar">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-base-content/70">
              CSV（<code className="px-1 py-0.5 rounded bg-base-200">path,problemNumber,page,answer,hints</code>）または JSON配列を貼り付けます。階層 <code className="px-1 py-0.5 rounded bg-base-200">/</code> 区切りは何段でも対応します。
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRawText(EXAMPLE_JSON);
                  setSummary(null);
                }}
                className="btn btn-ghost btn-xs border border-base-300"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                JSON例を挿入
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn btn-ghost btn-xs border border-base-300"
              >
                <Upload className="w-3.5 h-3.5" />
                ファイル読込
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="hidden"
                onChange={(e) => void handleFileLoad(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <textarea
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setSummary(null);
              setError(null);
            }}
            rows={8}
            placeholder={EXAMPLE_JSON}
            className="textarea textarea-bordered w-full font-mono text-xs leading-relaxed"
          />

          {preview.parseError && (
            <p className="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
              {preview.parseError}
            </p>
          )}

          {preview.rows.length > 0 && (
            <div className="rounded-xl border border-base-300 bg-base-200/50 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">プレビュー：{preview.rows.length} 問を検出</span>
                <span className="text-base-content/50">既存問題の進捗・状態は維持されます</span>
              </div>
              <div className="max-h-36 overflow-y-auto thin-scrollbar divide-y divide-base-300 text-xs">
                {preview.rows.slice(0, 8).map((r, idx) => {
                  const subCount = r.answerEntries?.length ?? 0;
                  const usesLatex =
                    r.answerEntries?.some((e) => e.items.some((i) => i.latex)) ?? false;
                  return (
                    <div key={idx} className="py-1.5 flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate">
                        <span className="text-base-content/50 mr-2">{r.path || '（階層なし）'}</span>
                        <span className="font-semibold">{r.problemNumber}</span>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 text-base-content/70">
                        {usesLatex && (
                          <span className="px-1.5 py-0.5 rounded bg-primary/12 text-primary text-[10px] font-mono font-semibold">
                            TeX
                          </span>
                        )}
                        {subCount > 1 && (
                          <span className="px-1.5 py-0.5 rounded bg-base-300/80 text-base-content/75 text-[10px] font-medium">
                            小問{subCount}
                          </span>
                        )}
                        <span className="font-mono">P.{r.page}</span>
                        {r.answer && (
                          <span className="max-w-[140px] truncate text-base-content/50">
                            答: {r.answer}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {preview.rows.length > 8 && (
                  <p className="py-1.5 text-center text-base-content/50">
                    ほか {preview.rows.length - 8} 件...
                  </p>
                )}
              </div>
            </div>
          )}

          {summary && (
            <div className="rounded-xl border border-success/30 bg-success/10 px-3.5 py-2.5 text-xs text-success">
              インポート完了：階層 {summary.unitsCreated} 件作成・新規問題 {summary.problemsCreated} 件・更新 {summary.problemsUpdated} 件
            </div>
          )}

          {error && (
            <p className="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-base-300 flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            閉じる
          </button>
          <button
            type="button"
            disabled={importing || preview.rows.length === 0}
            onClick={handleImport}
            className="btn btn-primary btn-sm"
          >
            {importing ? '取り込み中...' : `${preview.rows.length} 件を取り込む`}
          </button>
        </div>
      </div>
    </div>
  );
}
