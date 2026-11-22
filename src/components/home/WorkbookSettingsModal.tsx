import { useState } from 'react';
import { X } from 'lucide-react';
import { updateWorkbookSettings } from '../../db/database';
import type { BindingDirection, SpreadMode, Workbook } from '../../types/models';

interface WorkbookSettingsModalProps {
  workbook: Workbook;
  onClose: () => void;
}

export function WorkbookSettingsModal({
  workbook,
  onClose,
}: WorkbookSettingsModalProps) {
  const [title, setTitle] = useState(workbook.title);
  const [bindingDirection, setBindingDirection] = useState<BindingDirection>(
    workbook.bindingDirection,
  );
  const [defaultSpread, setDefaultSpread] = useState<SpreadMode>(
    workbook.defaultSpread,
  );
  const [coverSinglePage, setCoverSinglePage] = useState(workbook.coverSinglePage);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateWorkbookSettings(workbook.id, {
        title: title.trim() || workbook.title,
        bindingDirection,
        defaultSpread,
        coverSinglePage,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-lg rounded-2xl bg-base-100 border border-base-300 shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-base-300 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">ワーク設定</h2>
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
          <label className="block space-y-1">
            <span className="text-xs font-medium text-base-content/70">タイトル</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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

          <div className="pt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary btn-sm"
            >
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
