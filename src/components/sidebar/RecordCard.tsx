import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react';
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

/** 1-row slim textarea that grows smoothly with content */
function AutoGrowTextarea({
  value,
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(38, el.scrollHeight)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={`w-full resize-none overflow-hidden rounded-xl border border-base-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-primary transition-colors ${className}`}
      {...rest}
    />
  );
}

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

      {/* Expandable Details (Status + Miss Reasons + Hints + Answer + Memo) */}
      {detailsOpen && (
        <div className="px-4 pb-4 pt-3.5 border-t border-base-300 space-y-3.5">
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-base-content/65">
                  ミス原因
                </span>
                {!addingReason && (
                  <button
                    type="button"
                    onClick={() => setAddingReason(true)}
                    className="h-8 px-2.5 rounded-lg bg-base-200/80 hover:bg-base-200 text-xs font-medium text-base-content/75 hover:text-primary flex items-center gap-1 transition-colors"
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
                      className={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
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
                    placeholder="原因名"
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

          {/* Hints */}
          <div className="space-y-2 pt-3 border-t border-base-300">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-base-content/65 flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4" />
                ヒント
              </span>
              {!addingHint && (
                <button
                  type="button"
                  onClick={() => setAddingHint(true)}
                  className="h-8 px-2.5 rounded-lg bg-primary/10 hover:bg-primary/18 text-xs font-medium text-primary flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  追加
                </button>
              )}
            </div>

            {values.hints.length > 0 && (
              <div className="space-y-2">
                {values.hints.map((hint, idx) => {
                  const revealed = revealedHints.has(idx);
                  const isEditing = editingHintIdx === idx;
                  return (
                    <div
                      key={idx}
                      onClick={!isEditing ? () => toggleHintReveal(idx) : undefined}
                      className={`rounded-xl border border-base-300 bg-base-200/50 p-3 transition-colors ${
                        isEditing ? '' : 'cursor-pointer hover:border-base-content/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-base-content/60">
                          {revealed ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                          <span>ヒント {idx + 1}</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isEditing) {
                                setEditingHintIdx(null);
                                setEditingHintDraft('');
                              } else {
                                handleStartEditHint(idx);
                              }
                            }}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                              isEditing
                                ? 'text-primary bg-primary/15'
                                : 'text-base-content/60 hover:text-base-content hover:bg-base-300/70'
                            }`}
                            title="ヒントを編集"
                            aria-label="ヒントを編集"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteHint(idx);
                            }}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-base-content/60 hover:text-error hover:bg-error/10 transition-colors"
                            title="ヒントを削除"
                            aria-label="ヒントを削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isEditing ? (
                        <form onSubmit={handleSaveEditHint} className="space-y-2 pt-1">
                          <AutoGrowTextarea
                            autoFocus
                            value={editingHintDraft}
                            onChange={(e) => setEditingHintDraft(e.target.value)}
                            className="bg-base-100"
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
                        <p
                          className={`text-sm leading-relaxed whitespace-pre-wrap spoiler-blur ${
                            revealed ? 'revealed' : ''
                          }`}
                        >
                          {hint}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {addingHint && (
              <form onSubmit={handleAddHint} className="space-y-2 pt-1">
                <AutoGrowTextarea
                  autoFocus
                  value={hintDraft}
                  onChange={(e) => setHintDraft(e.target.value)}
                  className="bg-base-100"
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

          {/* Answer */}
          <div className="space-y-2 pt-3 border-t border-base-300">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-base-content/65">
                答え
              </span>
              <div className="flex items-center gap-1.5">
                {!editingAnswer && values.compactAnswer && (
                  <button
                    type="button"
                    onClick={() => setAnswerRevealed((v) => !v)}
                    className="h-8 px-2.5 rounded-lg bg-primary/10 hover:bg-primary/18 text-xs font-medium text-primary flex items-center gap-1 transition-colors"
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
                  className={`h-8 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
                    editingAnswer
                      ? 'bg-primary/15 text-primary'
                      : 'bg-base-200/80 hover:bg-base-200 text-base-content/75 hover:text-base-content'
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  編集
                </button>
              </div>
            </div>

            {editingAnswer ? (
              <div className="space-y-2">
                <AutoGrowTextarea
                  autoFocus
                  value={answerDraft}
                  onChange={(e) => setAnswerDraft(e.target.value)}
                  className="bg-base-100 font-mono"
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
                className="p-3 rounded-xl border border-base-300 bg-base-200/50 cursor-pointer hover:border-base-content/25 transition-colors"
              >
                <p
                  className={`text-sm font-mono leading-relaxed whitespace-pre-wrap spoiler-blur ${
                    answerRevealed ? 'revealed' : ''
                  }`}
                >
                  {values.compactAnswer}
                </p>
              </div>
            ) : null}
          </div>

          {/* Memo (1-row slim, auto-grows with content) */}
          <div className="space-y-2 pt-3 border-t border-base-300">
            <span className="text-xs font-semibold text-base-content/65 block">
              メモ
            </span>
            <AutoGrowTextarea
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              onBlur={() => {
                if (memoDraft !== values.memo) {
                  void onPatch({ memo: memoDraft });
                }
              }}
              className="bg-base-200/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
