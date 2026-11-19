import { useRef, useState, type DragEvent } from 'react';
import { FileUp, X } from 'lucide-react';
import { addWorkbook } from '../../db/database';
import type { BindingDirection, SpreadMode, Workbook } from '../../types/models';

interface AddWorkbookModalProps {
  open: boolean;
  initialFile?: File | null;
  onClose: () => void;
  onCreated: (workbook: Workbook) => void;
}

export function AddWorkbookModal({
  open,
  initialFile = null,
  onClose,
  onCreated,
}: AddWorkbookModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(initialFile);
  const [title, setTitle] = useState(
    initialFile ? initialFile.name.replace(/\.pdf$/i, '') : '',
  );
  const [bindingDirection, setBindingDirection] = useState<BindingDirection>('ltr');
  const [defaultSpread, setDefaultSpread] = useState<SpreadMode>('double');
  const [coverSinglePage, setCoverSinglePage] = useState(false);
  const [geminiChatUrl, setGeminiChatUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleFileSelect = (picked: File | null) => {
    if (!picked) return;
    if (picked.type !== 'application/pdf' && !picked.name.toLowerCase().endsWith('.pdf')) {
      setError('PDFファイルを選択してください。');
      return;
    }
    setError(null);
    setFile(picked);
    if (!title.trim()) {
      setTitle(picked.name.replace(/\.pdf$/i, ''));
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0] ?? null;
    handleFileSelect(dropped);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('PDFファイルを選択してください。');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const wb = await addWorkbook({
        title: title.trim() || file.name.replace(/\.pdf$/i, ''),
        pdfBlob: file,
        bindingDirection,
        defaultSpread,
        coverSinglePage,
        geminiChatUrl,
      });
      onCreated(wb);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDFの読み込みに失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-lg rounded-2xl bg-base-100 border border-base-300 shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-base-300 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">PDFワークを追加</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-square"
            aria-label="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-xl border border-dashed border-base-300 hover:border-primary bg-base-200/50 transition-colors p-5 text-center space-y-1.5"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
            />
            <FileUp className="w-6 h-6 mx-auto text-base-content/50" />
            {file ? (
              <div>
                <p className="text-sm font-medium text-base-content truncate">{file.name}</p>
                <p className="text-xs text-base-content/50">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB — クリックで変更
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium">PDFをドロップ、またはクリックして選択</p>
                <p className="text-xs text-base-content/50">
                  ブラウザ内にローカル保存されます（オフライン利用可）
                </p>
              </div>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-base-content/70">タイトル</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：セミナー物理基礎＋物理"
              className="input input-bordered input-sm w-full"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-xs font-medium text-base-content/70">綴じ方向</span>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-base-200 border border-base-300">
                <button
                  type="button"
                  onClick={() => setBindingDirection('ltr')}
                  className={`py-1 rounded text-xs font-medium transition-colors ${
                    bindingDirection === 'ltr'
                      ? 'bg-base-100 text-base-content shadow-xs'
                      : 'text-base-content/60'
                  }`}
                >
                  左綴じ（横書）
                </button>
                <button
                  type="button"
                  onClick={() => setBindingDirection('rtl')}
                  className={`py-1 rounded text-xs font-medium transition-colors ${
                    bindingDirection === 'rtl'
                      ? 'bg-base-100 text-base-content shadow-xs'
                      : 'text-base-content/60'
                  }`}
                >
                  右綴じ（縦書）
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium text-base-content/70">初期表示</span>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-base-200 border border-base-300">
                <button
                  type="button"
                  onClick={() => setDefaultSpread('double')}
                  className={`py-1 rounded text-xs font-medium transition-colors ${
                    defaultSpread === 'double'
                      ? 'bg-base-100 text-base-content shadow-xs'
                      : 'text-base-content/60'
                  }`}
                >
                  見開き
                </button>
                <button
                  type="button"
                  onClick={() => setDefaultSpread('single')}
                  className={`py-1 rounded text-xs font-medium transition-colors ${
                    defaultSpread === 'single'
                      ? 'bg-base-100 text-base-content shadow-xs'
                      : 'text-base-content/60'
                  }`}
                >
                  単ページ
                </button>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={coverSinglePage}
              onChange={(e) => setCoverSinglePage(e.target.checked)}
              className="checkbox checkbox-sm checkbox-primary"
            />
            <span className="text-xs text-base-content/80">
              1ページ目を表紙として単独表示する（2〜3ページ目から見開き）
            </span>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-base-content/70">
              専用GeminiチャットURL（任意）
            </span>
            <input
              type="url"
              value={geminiChatUrl}
              onChange={(e) => setGeminiChatUrl(e.target.value)}
              placeholder="https://gemini.google.com/..."
              className="input input-bordered input-sm w-full"
            />
          </label>

          {error && (
            <p className="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary btn-sm"
            >
              {submitting ? (
                <>
                  <span className="loading loading-spinner loading-xs" />
                  読み込み中...
                </>
              ) : (
                'ワークを追加'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
