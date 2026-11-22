import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  Lightbulb,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_MISS_REASONS,
  STUDY_STATUS_META,
  type StudyStatus,
} from '../../types/models';

export interface RecordCardValues {
  title: string;
  status: StudyStatus;
  missReasons: string[];
  hints: string[];
  compactAnswer: string;
  memo: string;
}

interface RecordCardProps {
  recordKey: string;
  values: RecordCardValues;
  customReasons: string[];
  onPatch: (patch: {
    status?: StudyStatus;
    missReasons?: string[];
    hints?: string[];
    compactAnswer?: string;
    memo?: string;
  }) => Promise<void> | void;
  onAddCustomReason: (reason: string) => Promise<void> | void;
}

const STATUS_ORDER: StudyStatus[] = ['none', 'review', 'weak', 'done'];

const ACTIVE_STATUS_BUTTON_CLASS: Record<StudyStatus, string> = {
  none: 'bg-base-100 text-base-content border-base-300',
  review: 'bg-amber-500/18 text-amber-800 dark:text-amber-200 border-amber-500/45',
  weak: 'bg-rose-500/18 text-rose-800 dark:text-rose-200 border-rose-500/45',
  done: 'bg-emerald-500/18 text-emerald-800 dark:text-emerald-200 border-emerald-500/45',
};

export function RecordCard({
  recordKey,
  values,
  customReasons,
  onPatch,
  onAddCustomReason,
}: RecordCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [revealedHints, setRevealedHints] = useState<Set<number>>(new Set());
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [answerDraft, setAnswerDraft] = useState(values.compactAnswer);

  const [addingHint, setAddingHint] = useState(false);
  const [hintDraft, setHintDraft] = useState('');
  const [editingHintIdx, setEditingHintIdx] = useState<number | null>(null);
  const [editingHintDraft, setEditingHintDraft] = useState('');

  const [addingReason, setAddingReason] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');

  const [memoDraft, setMemoDraft] = useState(values.memo);

  // Reset accordion, spoilers and sync local drafts when target changes
  useEffect(() => {
    setDetailsOpen(false);
    setRevealedHints(new Set());
    setAnswerRevealed(false);
    setEditingAnswer(false);
    setAddingHint(false);
    setHintDraft('');
    setEditingHintIdx(null);
    setEditingHintDraft('');
  }, [recordKey]);

  const showMissReasons = values.status === 'review' || values.status === 'weak';

  useEffect(() => {
    setAnswerDraft(values.compactAnswer);
  }, [values.compactAnswer, recordKey]);

  useEffect(() => {
    setMemoDraft(values.memo);
  }, [values.memo, recordKey]);

  const allReasons = Array.from(
    new Set([...DEFAULT_MISS_REASONS, ...customReasons, ...values.missReasons]),
  );

  const toggleReason = (reason: string) => {
    const exists = values.missReasons.includes(reason);
    const next = exists
      ? values.missReasons.filter((r) => r !== reason)
      : [...values.missReasons, reason];
    void onPatch({ missReasons: next });
  };

  const handleSaveCustomReason = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reasonDraft.trim();
    if (!trimmed) {
      setAddingReason(false);
      return;
    }
    await onAddCustomReason(trimmed);
    if (!values.missReasons.includes(trimmed)) {
      await onPatch({ missReasons: [...values.missReasons, trimmed] });
    }
    setReasonDraft('');
    setAddingReason(false);
  };

  const toggleHintReveal = (idx: number) => {
    setRevealedHints((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleAddHint = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = hintDraft.trim();
    if (!trimmed) {
      setAddingHint(false);
      return;
    }
    void onPatch({ hints: [...values.hints, trimmed] });
    setHintDraft('');
    setAddingHint(false);
  };

  const handleStartEditHint = (idx: number) => {
    setAddingHint(false);
    setEditingHintIdx(idx);
    setEditingHintDraft(values.hints[idx] ?? '');
  };

  const handleSaveEditHint = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingHintIdx === null) return;
    const trimmed = editingHintDraft.trim();
    if (!trimmed) {
      setEditingHintIdx(null);
      setEditingHintDraft('');
      return;
    }
    const next = values.hints.map((h, i) => (i === editingHintIdx ? trimmed : h));
    void onPatch({ hints: next });
    setEditingHintIdx(null);
    setEditingHintDraft('');
  };

  const handleDeleteHint = (idx: number) => {
    const next = values.hints.filter((_, i) => i !== idx);
    setRevealedHints((prev) => {
      const updated = new Set<number>();
      for (const i of prev) {
        if (i < idx) updated.add(i);
        else if (i > idx) updated.add(i - 1);
      }
      return updated;
    });
    if (editingHintIdx === idx) {
      setEditingHintIdx(null);
      setEditingHintDraft('');
    } else if (editingHintIdx !== null && editingHintIdx > idx) {
      setEditingHintIdx(editingHintIdx - 1);
    }
    void onPatch({ hints: next });
  };

  const handleSaveAnswer = () => {
    void onPatch({ compactAnswer: answerDraft.trim() });
    setEditingAnswer(false);
  };

  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 overflow-hidden">
      {/* Compact 1-Row Accordion Header (Title + Status Badge) */}
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        className="w-full px-4 py-3.5 flex items-center justify-between gap-2.5 text-left hover:bg-base-200/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            className={`w-4 h-4 text-base-content/45 shrink-0 transition-transform duration-200 ${
              detailsOpen ? 'rotate-90' : ''
            }`}
          />
          <h3 className="text-[15px] font-semibold text-base-content truncate">
            {values.title}
          </h3>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${
            STUDY_STATUS_META[values.status].badgeClass
          }`}
        >
          {STUDY_STATUS_META[values.status].label}
        </span>
      </button>

      {/* Expandable Details (Status + Miss Reasons + Hints + Compact Answer + Memo) */}
      {detailsOpen && (
        <div className="px-4 pb-4 pt-3.5 border-t border-base-300 space-y-4">
          {/* Flex-expanding Status Selector (active button grows wider & bolder) */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-base-200 border border-base-300">
            {STATUS_ORDER.map((st) => {
              const active = values.status === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => void onPatch({ status: st })}
                  className={`min-w-0 h-10 px-1.5 rounded-lg whitespace-nowrap overflow-hidden transition-all duration-300 ease-out flex items-center justify-center border ${
                    active
                      ? `flex-[1.75] text-sm font-semibold shadow-xs ${ACTIVE_STATUS_BUTTON_CLASS[st]}`
                      : 'flex-1 text-xs font-medium border-transparent text-base-content/55 hover:text-base-content'
                  }`}
                >
                  {STUDY_STATUS_META[st].label}
                </button>
              );
            })}
          </div>

          {/* Miss Reason Tags (Only shown when status is 'review' or 'weak') */}
          {showMissReasons && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-base-content/60">
                  ミス原因タグ
                </span>
                {!addingReason && (
                  <button
                    type="button"
                    onClick={() => setAddingReason(true)}
                    className="text-xs text-base-content/60 hover:text-primary flex items-center gap-0.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    追加
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allReasons.map((reason) => {
                  const selected = values.missReasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => toggleReason(reason)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-primary text-primary-content border-primary'
                          : 'bg-base-200/70 text-base-content/75 border-base-300 hover:bg-base-200'
                      }`}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
              {addingReason && (
                <form onSubmit={handleSaveCustomReason} className="flex gap-1.5 pt-1">
                  <input
                    type="text"
                    autoFocus
                    value={reasonDraft}
                    onChange={(e) => setReasonDraft(e.target.value)}
                    placeholder="新しい原因タグ..."
                    className="input input-bordered input-sm flex-1 text-sm"
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    追加
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingReason(false);
                      setReasonDraft('');
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    取消
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Hints (Tap to Reveal / Hide) */}
          <div className="space-y-2 pt-3 border-t border-base-300">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-base-content/60 flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4" />
                ヒント（タップで表示）
              </span>
              {!addingHint && (
                <button
                  type="button"
                  onClick={() => setAddingHint(true)}
                  className="text-xs text-primary hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  追加
                </button>
              )}
            </div>

            {values.hints.length === 0 && !addingHint && (
              <p className="text-xs text-base-content/45">ヒントはまだ登録されていません</p>
            )}

            <div className="space-y-2">
              {values.hints.map((hint, idx) => {
                const revealed = revealedHints.has(idx);
                const isEditing = editingHintIdx === idx;
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-base-300 bg-base-200/50 p-3 transition-colors hover:border-base-content/25"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-base-content/60 mb-1.5">
                      <button
                        type="button"
                        onClick={() => toggleHintReveal(idx)}
                        disabled={isEditing}
                        className="flex items-center gap-1.5 hover:text-base-content disabled:opacity-70"
                      >
                        {revealed ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                        <span>ヒント {idx + 1}</span>
                      </button>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditing) {
                              setEditingHintIdx(null);
                              setEditingHintDraft('');
                            } else {
                              handleStartEditHint(idx);
                            }
                          }}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isEditing
                              ? 'text-primary bg-primary/10'
                              : 'text-base-content/55 hover:text-base-content hover:bg-base-300/60'
                          }`}
                          title="ヒントを編集"
                          aria-label="ヒントを編集"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHint(idx)}
                          className="p-1.5 rounded-lg text-base-content/55 hover:text-error hover:bg-error/10 transition-colors"
                          title="ヒントを削除"
                          aria-label="ヒントを削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {isEditing ? (
                      <form onSubmit={handleSaveEditHint} className="space-y-2 pt-1">
                        <textarea
                          autoFocus
                          rows={2}
                          value={editingHintDraft}
                          onChange={(e) => setEditingHintDraft(e.target.value)}
                          placeholder="ヒントの内容を入力..."
                          className="textarea textarea-bordered textarea-sm w-full text-sm leading-relaxed"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingHintIdx(null);
                              setEditingHintDraft('');
                            }}
                            className="btn btn-ghost btn-sm"
                          >
                            キャンセル
                          </button>
                          <button type="submit" className="btn btn-primary btn-sm">
                            保存
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div
                        onClick={() => toggleHintReveal(idx)}
                        className="cursor-pointer"
                      >
                        <p
                          className={`text-sm leading-relaxed whitespace-pre-wrap spoiler-blur ${
                            revealed ? 'revealed' : ''
                          }`}
                        >
                          {hint}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {addingHint && (
              <form onSubmit={handleAddHint} className="space-y-2 pt-1">
                <textarea
                  autoFocus
                  rows={2}
                  value={hintDraft}
                  onChange={(e) => setHintDraft(e.target.value)}
                  placeholder="詰まったときに見たい方針や着眼点..."
                  className="textarea textarea-bordered textarea-sm w-full text-sm leading-relaxed"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingHint(false);
                      setHintDraft('');
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    キャンセル
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm">
                    保存
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Compact Answer */}
          <div className="space-y-2 pt-3 border-t border-base-300">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-base-content/60">
                コンパクト答え
              </span>
              <div className="flex items-center gap-3">
                {!editingAnswer && values.compactAnswer && (
                  <button
                    type="button"
                    onClick={() => setAnswerRevealed((v) => !v)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    {answerRevealed ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        隠す
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        表示
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAnswerDraft(values.compactAnswer);
                    setEditingAnswer((v) => !v);
                  }}
                  className="text-xs text-base-content/65 hover:text-base-content flex items-center gap-1"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  編集
                </button>
              </div>
            </div>

            {editingAnswer ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  rows={2}
                  value={answerDraft}
                  onChange={(e) => setAnswerDraft(e.target.value)}
                  placeholder="例：(1) a = 3.0 m/s²  (2) f = 9.0 N"
                  className="textarea textarea-bordered textarea-sm w-full font-mono text-sm"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingAnswer(false)}
                    className="btn btn-ghost btn-sm"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAnswer}
                    className="btn btn-primary btn-sm"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : values.compactAnswer ? (
              <div
                onClick={() => setAnswerRevealed((v) => !v)}
                className="p-3 rounded-xl border border-base-300 bg-base-200/50 cursor-pointer"
              >
                <p
                  className={`text-sm font-mono leading-relaxed whitespace-pre-wrap spoiler-blur ${
                    answerRevealed ? 'revealed' : ''
                  }`}
                >
                  {values.compactAnswer}
                </p>
              </div>
            ) : (
              <p className="text-xs text-base-content/45">
                答えは未登録です（右上の「編集」またはCSV/JSONから登録）
              </p>
            )}
          </div>

          {/* Free Memo */}
          <div className="space-y-2 pt-3 border-t border-base-300">
            <span className="text-xs font-medium text-base-content/60 block">
              メモ
            </span>
            <textarea
              rows={2}
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              onBlur={() => {
                if (memoDraft !== values.memo) {
                  void onPatch({ memo: memoDraft });
                }
              }}
              placeholder="気づきや解き直しのメモ..."
              className="textarea textarea-bordered textarea-sm w-full text-sm leading-relaxed bg-base-200/35"
            />
          </div>
        </div>
      )}
    </div>
  );
}
