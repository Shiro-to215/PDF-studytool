import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
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
  subtitle?: string;
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
  workbookTitle: string;
  pageNumber: number;
  geminiChatUrl?: string;
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

export function RecordCard({
  recordKey,
  values,
  customReasons,
  workbookTitle,
  pageNumber,
  geminiChatUrl,
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

  const [addingReason, setAddingReason] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');

  const [memoDraft, setMemoDraft] = useState(values.memo);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Reset accordion, spoilers and sync local drafts when target changes
  useEffect(() => {
    setDetailsOpen(false);
    setRevealedHints(new Set());
    setAnswerRevealed(false);
    setEditingAnswer(false);
    setAddingHint(false);
    setHintDraft('');
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

  const handleDeleteHint = (idx: number) => {
    const next = values.hints.filter((_, i) => i !== idx);
    void onPatch({ hints: next });
  };

  const handleSaveAnswer = () => {
    void onPatch({ compactAnswer: answerDraft.trim() });
    setEditingAnswer(false);
  };

  const handleCopyPrompt = async () => {
    const reasonsStr =
      values.missReasons.length > 0
        ? `（ミス原因：${values.missReasons.join('・')}）`
        : '';
    const promptText = `${workbookTitle} P.${pageNumber}${
      values.subtitle ? ` ${values.title}` : ''
    } の解説をお願いします${reasonsStr}`;

    try {
      await navigator.clipboard.writeText(promptText);
    } catch {
      // Fallback ignored if clipboard unavailable
    }
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-3.5 space-y-3">
      {/* Card Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-base-content truncate">
            {values.title}
          </h3>
          {values.subtitle && (
            <p className="text-[11px] text-base-content/55 truncate mt-0.5">
              {values.subtitle}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
            STUDY_STATUS_META[values.status].badgeClass
          }`}
        >
          {STUDY_STATUS_META[values.status].label}
        </span>
      </div>

      {/* Status Selector (Always visible) */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-base-content/55 block">
          ステータス
        </span>
        <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-base-200 border border-base-300">
          {STATUS_ORDER.map((st) => {
            const active = values.status === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => void onPatch({ status: st })}
                className={`py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-base-100 text-base-content shadow-xs ring-1 ring-base-300'
                    : 'text-base-content/60 hover:text-base-content'
                }`}
              >
                {STUDY_STATUS_META[st].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Miss Reason Tags (Only shown when status is 'review' or 'weak') */}
      {showMissReasons && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-base-content/55">
              ミス原因タグ
            </span>
            {!addingReason && (
              <button
                type="button"
                onClick={() => setAddingReason(true)}
                className="text-[11px] text-base-content/55 hover:text-primary flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" />
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
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    selected
                      ? 'bg-primary text-primary-content border-primary'
                      : 'bg-base-200/70 text-base-content/70 border-base-300 hover:bg-base-200'
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
                className="input input-bordered input-xs flex-1"
              />
              <button type="submit" className="btn btn-primary btn-xs">
                追加
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingReason(false);
                  setReasonDraft('');
                }}
                className="btn btn-ghost btn-xs"
              >
                取消
              </button>
            </form>
          )}
        </div>
      )}

      {/* Accordion Toggle for Hints, Compact Answer & Memo */}
      <div className="pt-2 border-t border-base-300">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 py-1 text-xs text-base-content/70 hover:text-base-content transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium">
            {detailsOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-base-content/50" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-base-content/50" />
            )}
            <span>ヒント・答え・メモ</span>
          </span>

          <span className="flex items-center gap-1.5 text-[10px] text-base-content/50">
            {values.hints.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-base-200">
                ヒント {values.hints.length}
              </span>
            )}
            {values.compactAnswer && (
              <span className="px-1.5 py-0.5 rounded bg-base-200">答あり</span>
            )}
            {values.memo.trim() && (
              <span className="px-1.5 py-0.5 rounded bg-base-200">メモ</span>
            )}
          </span>
        </button>

        {detailsOpen && (
          <div className="pt-3 space-y-4">
            {/* Hints (Tap to Reveal / Hide) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-base-content/55 flex items-center gap-1">
                  <Lightbulb className="w-3.5 h-3.5" />
                  ヒント（タップで表示）
                </span>
                {!addingHint && (
                  <button
                    type="button"
                    onClick={() => setAddingHint(true)}
                    className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    ヒントを追加
                  </button>
                )}
              </div>

              {values.hints.length === 0 && !addingHint && (
                <p className="text-xs text-base-content/45">ヒントはまだ登録されていません</p>
              )}

              <div className="space-y-1.5">
                {values.hints.map((hint, idx) => {
                  const revealed = revealedHints.has(idx);
                  return (
                    <div
                      key={idx}
                      className="group rounded-lg border border-base-300 bg-base-200/50 p-2.5 transition-colors hover:border-base-content/25"
                    >
                      <div className="flex items-center justify-between text-[10px] text-base-content/50 mb-1">
                        <button
                          type="button"
                          onClick={() => toggleHintReveal(idx)}
                          className="flex items-center gap-1 hover:text-base-content"
                        >
                          {revealed ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                          <span>ヒント {idx + 1}</span>
                          <span className="opacity-75">
                            （{revealed ? 'タップで隠す' : 'タップで表示'}）
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHint(idx)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-base-content/40 hover:text-error transition-opacity"
                          title="ヒントを削除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div
                        onClick={() => toggleHintReveal(idx)}
                        className="cursor-pointer"
                      >
                        <p
                          className={`text-xs leading-relaxed whitespace-pre-wrap spoiler-blur ${
                            revealed ? 'revealed' : ''
                          }`}
                        >
                          {hint}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {addingHint && (
                <form onSubmit={handleAddHint} className="space-y-1.5 pt-1">
                  <textarea
                    autoFocus
                    rows={2}
                    value={hintDraft}
                    onChange={(e) => setHintDraft(e.target.value)}
                    placeholder="詰まったときに見たい方針や着眼点..."
                    className="textarea textarea-bordered textarea-xs w-full text-xs leading-relaxed"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAddingHint(false);
                        setHintDraft('');
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      キャンセル
                    </button>
                    <button type="submit" className="btn btn-primary btn-xs">
                      保存
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Compact Answer & Gemini Shortcut */}
            <div className="space-y-2 pt-2 border-t border-base-300">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-base-content/55">
                  コンパクト答え
                </span>
                <div className="flex items-center gap-2">
                  {!editingAnswer && values.compactAnswer && (
                    <button
                      type="button"
                      onClick={() => setAnswerRevealed((v) => !v)}
                      className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                      {answerRevealed ? (
                        <>
                          <EyeOff className="w-3 h-3" />
                          隠す
                        </>
                      ) : (
                        <>
                          <Eye className="w-3 h-3" />
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
                    className="text-[11px] text-base-content/60 hover:text-base-content flex items-center gap-0.5"
                  >
                    <Pencil className="w-3 h-3" />
                    編集
                  </button>
                </div>
              </div>

              {editingAnswer ? (
                <div className="space-y-1.5">
                  <textarea
                    autoFocus
                    rows={2}
                    value={answerDraft}
                    onChange={(e) => setAnswerDraft(e.target.value)}
                    placeholder="例：(1) a = 3.0 m/s²  (2) f = 9.0 N"
                    className="textarea textarea-bordered textarea-xs w-full font-mono text-xs"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingAnswer(false)}
                      className="btn btn-ghost btn-xs"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAnswer}
                      className="btn btn-primary btn-xs"
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : values.compactAnswer ? (
                <div
                  onClick={() => setAnswerRevealed((v) => !v)}
                  className="p-2.5 rounded-lg border border-base-300 bg-base-200/50 cursor-pointer"
                >
                  <p
                    className={`text-xs font-mono leading-relaxed whitespace-pre-wrap spoiler-blur ${
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

              {/* Gemini Chat Helper */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => void handleCopyPrompt()}
                  className="btn btn-ghost btn-xs flex-1 border border-base-300 justify-center gap-1.5 font-normal"
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-success" />
                      <span className="text-success">コピーしました</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-base-content/65" />
                      <span>Gemini用質問文をコピー</span>
                    </>
                  )}
                </button>
                {geminiChatUrl && (
                  <a
                    href={geminiChatUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-xs border border-base-300 px-2"
                    title="専用Geminiチャットを開く"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Free Memo */}
            <div className="space-y-1.5 pt-2 border-t border-base-300">
              <span className="text-[11px] font-medium text-base-content/55 block">
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
                className="textarea textarea-bordered textarea-xs w-full text-xs leading-relaxed bg-base-200/35"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
