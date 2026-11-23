import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react';
import {
  ChevronRight,
  Lightbulb,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  STUDY_STATUS_META,
  type AnswerEntry,
  type StudyStatus,
} from '../../types/models';
import {
  hasSubQuestions,
  normalizeAnswerEntries,
  resolveAnswerEntries,
  summarizeAnswerEntries,
} from '../../utils/answerFormat';
import { MathText } from '../common/MathText';

export interface RecordCardValues {
  title: string;
  status: StudyStatus;
  missReasons: string[];
  hints: string[];
  compactAnswer: string;
  answerEntries?: AnswerEntry[];
  memo: string;
}

interface RecordCardProps {
  recordKey: string;
  isOpen?: boolean;
  onToggle?: () => void;
  values: RecordCardValues;
  reasonOptions: string[];
  onPatch: (patch: {
    status?: StudyStatus;
    missReasons?: string[];
    hints?: string[];
    compactAnswer?: string;
    answerEntries?: AnswerEntry[];
    memo?: string;
  }) => Promise<void> | void;
  onSaveReasonOptions: (
    nextReasons: string[],
    renameMap: Record<string, string>,
  ) => Promise<void> | void;
}

const STATUS_ORDER: StudyStatus[] = ['none', 'review', 'weak', 'done'];

const ACTIVE_STATUS_BUTTON_CLASS: Record<StudyStatus, string> = {
  none: 'bg-base-100 text-base-content border-base-300',
  review: 'bg-amber-500/18 text-amber-800 dark:text-amber-200 border-amber-500/45',
  weak: 'bg-rose-500/18 text-rose-800 dark:text-rose-200 border-rose-500/45',
  done: 'bg-emerald-500/18 text-emerald-800 dark:text-emerald-200 border-emerald-500/45',
};

const ACCORDION_OPEN_MS = 360;
const ACCORDION_CLOSE_MS = 240;
const ACCORDION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const ACCORDION_STAGGER_STEP_MS = 28;
const ACCORDION_STAGGER_MAX_DELAY_MS = 140;

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

function cloneAnswerEntries(entries: AnswerEntry[]): AnswerEntry[] {
  return entries.map((e) => ({
    ...(e.label ? { label: e.label } : {}),
    items: e.items.map((item) => ({ text: item.text, latex: item.latex })),
  }));
}

export function RecordCard({
  recordKey,
  isOpen,
  onToggle,
  values,
  reasonOptions,
  onPatch,
  onSaveReasonOptions,
}: RecordCardProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const detailsOpen = isOpen !== undefined ? isOpen : internalOpen;
  const [renderBody, setRenderBody] = useState(detailsOpen);

  if (detailsOpen && !renderBody) {
    setRenderBody(true);
  }

  const [revealedHints, setRevealedHints] = useState<Set<number>>(new Set());
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());
  const [editingAnswer, setEditingAnswer] = useState(false);
  const [answerDraftEntries, setAnswerDraftEntries] = useState<AnswerEntry[]>([]);

  const [editingHints, setEditingHints] = useState(false);
  const [hintDrafts, setHintDrafts] = useState<string[]>([]);

  const [editingReasons, setEditingReasons] = useState(false);
  const [reasonDrafts, setReasonDrafts] = useState<
    Array<{ original: string | null; value: string }>
  >([]);

  const [memoDraft, setMemoDraft] = useState(values.memo);

  const accordionRef = useRef<HTMLDivElement | null>(null);
  const runningAnimsRef = useRef<Animation[]>([]);
  const closeTimerRef = useRef<number | null>(null);

  const resolvedAnswers = useMemo(
    () => resolveAnswerEntries(values.compactAnswer, values.answerEntries),
    [values.compactAnswer, values.answerEntries],
  );
  const isSubQuestionMode = useMemo(() => hasSubQuestions(resolvedAnswers), [resolvedAnswers]);

  const cancelAccordionMotion = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    for (const anim of runningAnimsRef.current) {
      try {
        anim.cancel();
      } catch {
        // ignore
      }
    }
    runningAnimsRef.current = [];
  };

  // Reset accordion, spoilers and sync local drafts when target changes
  useEffect(() => {
    cancelAccordionMotion();
    setInternalOpen(false);
    setRenderBody(false);
    setRevealedHints(new Set());
    setRevealedAnswers(new Set());
    setEditingAnswer(false);
    setEditingHints(false);
    setHintDrafts([]);
    setEditingReasons(false);
    setReasonDrafts([]);
  }, [recordKey]);

  useEffect(() => {
    return () => cancelAccordionMotion();
  }, []);

  useEffect(() => {
    setMemoDraft(values.memo);
  }, [values.memo, recordKey]);

  // Smooth grid-height expand/collapse + 360ms vertical staggered fade-in
  useLayoutEffect(() => {
    if (!renderBody) return;
    const accEl = accordionRef.current;
    if (!accEl) return;

    cancelAccordionMotion();

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (detailsOpen) {
      if (prefersReduced) {
        accEl.setAttribute('data-open', 'true');
        return;
      }

      // Ensure transition always starts cleanly from 0fr on the same frame
      accEl.setAttribute('data-open', 'false');
      void accEl.offsetHeight;
      accEl.setAttribute('data-open', 'true');

      const sections = accEl.querySelectorAll<HTMLElement>('[data-record-section]');
      const started: Animation[] = [];
      for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        if (typeof sec.animate !== 'function') continue;
        started.push(
          sec.animate(
            [
              { transform: 'translateY(-10px)', opacity: 0 },
              { transform: 'translateY(0px)', opacity: 1 },
            ],
            {
              duration: ACCORDION_OPEN_MS,
              delay: Math.min(i * ACCORDION_STAGGER_STEP_MS, ACCORDION_STAGGER_MAX_DELAY_MS),
              easing: ACCORDION_EASING,
              fill: 'both',
            },
          ),
        );
      }
      runningAnimsRef.current = started;

      let cancelled = false;
      void Promise.all(started.map((a) => a.finished.catch(() => {}))).then(() => {
        if (cancelled) return;
        for (const a of started) {
          try {
            a.cancel();
          } catch {
            // ignore
          }
        }
        if (runningAnimsRef.current === started) {
          runningAnimsRef.current = [];
        }
      });

      return () => {
        cancelled = true;
      };
    }

    // Closing: collapse height & fade inner surface gently, then unmount
    if (prefersReduced) {
      accEl.setAttribute('data-open', 'false');
      setRenderBody(false);
      return;
    }

    accEl.setAttribute('data-open', 'false');
    const contentEl = accEl.querySelector<HTMLElement>('[data-record-body]');
    if (contentEl && typeof contentEl.animate === 'function') {
      const fadeAnim = contentEl.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        {
          duration: 180,
          easing: ACCORDION_EASING,
          fill: 'forwards',
        },
      );
      runningAnimsRef.current = [fadeAnim];
    }

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      runningAnimsRef.current = [];
      setRenderBody(false);
    }, ACCORDION_CLOSE_MS + 16);
  }, [detailsOpen, renderBody]);

  const handleToggleOpen = () => {
    if (onToggle) {
      onToggle();
      return;
    }
    if (detailsOpen) {
      setInternalOpen(false);
    } else {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setRenderBody(true);
      setInternalOpen(true);
    }
  };

  const showMissReasons = values.status === 'review' || values.status === 'weak';

  const allReasons = Array.from(new Set([...reasonOptions, ...values.missReasons]));

  const toggleReason = (reason: string) => {
    const exists = values.missReasons.includes(reason);
    const next = exists
      ? values.missReasons.filter((r) => r !== reason)
      : [...values.missReasons, reason];
    void onPatch({ missReasons: next });
  };

  // Batch Miss Reason Options Editor (applies to workbook & syncs existing tags)
  const handleToggleEditReasons = () => {
    if (editingReasons) {
      setEditingReasons(false);
      return;
    }
    setReasonDrafts(
      allReasons.length > 0
        ? allReasons.map((r) => ({ original: r, value: r }))
        : [{ original: null, value: '' }],
    );
    setEditingReasons(true);
  };

  const updateReasonDraft = (idx: number, value: string) => {
    setReasonDrafts((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, value } : item)),
    );
  };

  const addReasonDraftRow = () => {
    setReasonDrafts((prev) => [...prev, { original: null, value: '' }]);
  };

  const removeReasonDraftRow = (idx: number) => {
    setReasonDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveReasonOptions = () => {
    const nextReasons: string[] = [];
    const seen = new Set<string>();
    const renameMap: Record<string, string> = {};

    for (const draft of reasonDrafts) {
      const trimmed = draft.value.trim();
      if (!trimmed) continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        nextReasons.push(trimmed);
      }
      if (draft.original && draft.original !== trimmed) {
        renameMap[draft.original] = trimmed;
      }
    }

    void onSaveReasonOptions(nextReasons, renameMap);
    setEditingReasons(false);
  };

  const toggleHintReveal = (idx: number) => {
    setRevealedHints((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Batch Hint Editor actions
  const handleToggleEditHints = () => {
    if (editingHints) {
      setEditingHints(false);
      return;
    }
    setHintDrafts(values.hints.length > 0 ? [...values.hints] : ['']);
    setEditingHints(true);
  };

  const updateHintDraft = (idx: number, text: string) => {
    setHintDrafts((prev) => prev.map((h, i) => (i === idx ? text : h)));
  };

  const addHintDraftRow = () => {
    setHintDrafts((prev) => [...prev, '']);
  };

  const removeHintDraftRow = (idx: number) => {
    setHintDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveHints = () => {
    const cleaned = hintDrafts.map((h) => h.trim()).filter(Boolean);
    setRevealedHints((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < cleaned.length) next.add(i);
      }
      return next;
    });
    void onPatch({ hints: cleaned });
    setEditingHints(false);
  };

  // Answer reveal control (tap individual card to toggle blur)
  const toggleAnswerReveal = (idx: number) => {
    setRevealedAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Structured Answer Editor actions
  const handleToggleEditAnswer = () => {
    if (editingAnswer) {
      setEditingAnswer(false);
      return;
    }
    if (resolvedAnswers.length > 0) {
      setAnswerDraftEntries(cloneAnswerEntries(resolvedAnswers));
    } else {
      setAnswerDraftEntries([{ items: [{ text: '', latex: false }] }]);
    }
    setEditingAnswer(true);
  };

  const updateDraftEntryLabel = (entryIdx: number, label: string) => {
    setAnswerDraftEntries((prev) =>
      prev.map((entry, i) => (i === entryIdx ? { ...entry, label } : entry)),
    );
  };

  const updateDraftItemText = (entryIdx: number, itemIdx: number, text: string) => {
    setAnswerDraftEntries((prev) =>
      prev.map((entry, i) =>
        i === entryIdx
          ? {
              ...entry,
              items: entry.items.map((item, j) =>
                j === itemIdx ? { ...item, text } : item,
              ),
            }
          : entry,
      ),
    );
  };

  const toggleDraftItemLatex = (entryIdx: number, itemIdx: number) => {
    setAnswerDraftEntries((prev) =>
      prev.map((entry, i) =>
        i === entryIdx
          ? {
              ...entry,
              items: entry.items.map((item, j) =>
                j === itemIdx ? { ...item, latex: !item.latex } : item,
              ),
            }
          : entry,
      ),
    );
  };

  const addDraftItemToEntry = (entryIdx: number) => {
    setAnswerDraftEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== entryIdx) return entry;
        const lastLatex = entry.items[entry.items.length - 1]?.latex ?? false;
        return {
          ...entry,
          items: [...entry.items, { text: '', latex: lastLatex }],
        };
      }),
    );
  };

  const removeDraftItemFromEntry = (entryIdx: number, itemIdx: number) => {
    setAnswerDraftEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== entryIdx || entry.items.length <= 1) return entry;
        return {
          ...entry,
          items: entry.items.filter((_, j) => j !== itemIdx),
        };
      }),
    );
  };

  const addDraftSubQuestion = () => {
    setAnswerDraftEntries((prev) => {
      if (prev.length === 0) {
        return [{ items: [{ text: '', latex: false }] }];
      }
      const lastEntry = prev[prev.length - 1];
      const lastLatex = lastEntry?.items[lastEntry.items.length - 1]?.latex ?? false;
      const withFirstLabeled =
        prev.length === 1 && !prev[0].label?.trim()
          ? [{ ...prev[0], label: '(1)' }]
          : prev;
      return [
        ...withFirstLabeled,
        {
          label: `(${withFirstLabeled.length + 1})`,
          items: [{ text: '', latex: lastLatex }],
        },
      ];
    });
  };

  const removeDraftSubQuestion = (entryIdx: number) => {
    setAnswerDraftEntries((prev) => prev.filter((_, i) => i !== entryIdx));
  };

  const handleSaveAnswer = () => {
    const normalized = normalizeAnswerEntries(answerDraftEntries);
    void onPatch({
      compactAnswer: summarizeAnswerEntries(normalized),
      answerEntries: normalized.length > 0 ? normalized : undefined,
    });
    setEditingAnswer(false);
  };

  const showEditorSubLabels =
    answerDraftEntries.length > 1 || Boolean(answerDraftEntries[0]?.label?.trim());

  return (
    <div className="rounded-2xl border border-base-300 bg-base-100 overflow-hidden">
      {/* Compact 1-Row Accordion Header (Title + Status Badge) */}
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-expanded={detailsOpen}
        className="w-full px-4 py-3.5 flex items-center justify-between gap-2.5 text-left hover:bg-base-200/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            className={`w-4 h-4 text-base-content/45 shrink-0 transition-transform duration-300 ease-out ${
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

      {/* Expandable Details with smooth Grid height + 360ms staggered vertical entrance */}
      {renderBody && (
        <div ref={accordionRef} data-open="false" className="record-accordion">
          <div className="record-accordion-inner">
            <div
              data-record-body
              className="px-4 pb-4 pt-3.5 border-t border-base-300 space-y-3.5"
            >
              {/* Flex-expanding Status Selector (active button grows wider & bolder) */}
              <div
                data-record-section
                className="flex items-center gap-1.5 p-1 rounded-xl bg-base-200 border border-base-300"
              >
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
                <div data-record-section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-base-content/65">
                      ミス原因
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleEditReasons}
                      className={`h-8 px-2.5 rounded-lg text-xs font-medium text-primary flex items-center gap-1 transition-colors ${
                        editingReasons
                          ? 'bg-primary/20'
                          : 'bg-primary/10 hover:bg-primary/18'
                      }`}
                    >
                      {allReasons.length > 0 ? (
                        <>
                          <Pencil className="w-3.5 h-3.5" />
                          編集
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          追加
                        </>
                      )}
                    </button>
                  </div>

                  {editingReasons ? (
                    <div className="space-y-2">
                      {reasonDrafts.map((draft, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1.5 rounded-xl border border-base-300 bg-base-200/40 p-2"
                        >
                          <input
                            type="text"
                            autoFocus={idx === reasonDrafts.length - 1 && draft.original === null}
                            value={draft.value}
                            onChange={(e) => updateReasonDraft(idx, e.target.value)}
                            placeholder="原因名"
                            className="flex-1 h-9 px-3 rounded-lg border border-base-300 bg-base-100 text-sm focus:outline-none focus:border-primary"
                          />
                          <button
                            type="button"
                            onClick={() => removeReasonDraftRow(idx)}
                            className="w-8 h-9 rounded-lg flex items-center justify-center text-base-content/55 hover:text-error hover:bg-error/10 shrink-0 transition-colors"
                            title="原因を削除"
                            aria-label="原因を削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={addReasonDraftRow}
                          className="h-8 px-2.5 rounded-lg bg-base-200/80 hover:bg-base-200 text-xs font-medium text-base-content/75 hover:text-primary inline-flex items-center gap-1 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          原因を追加
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingReasons(false)}
                            className="btn btn-ghost btn-sm"
                          >
                            キャンセル
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveReasonOptions}
                            className="btn btn-primary btn-sm"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : allReasons.length > 0 ? (
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
                  ) : null}
                </div>
              )}

              {/* Hints */}
              <div data-record-section className="space-y-2 pt-3 border-t border-base-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-base-content/65 flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4" />
                    ヒント
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleEditHints}
                    className={`h-8 px-2.5 rounded-lg text-xs font-medium text-primary flex items-center gap-1 transition-colors ${
                      editingHints
                        ? 'bg-primary/20'
                        : 'bg-primary/10 hover:bg-primary/18'
                    }`}
                  >
                    {values.hints.length > 0 ? (
                      <>
                        <Pencil className="w-3.5 h-3.5" />
                        編集
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        追加
                      </>
                    )}
                  </button>
                </div>

                {editingHints ? (
                  <div className="space-y-2.5">
                    {hintDrafts.map((draft, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-base-300 bg-base-200/40 p-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <span className="shrink-0 w-6 text-xs font-semibold text-base-content/60 pt-2.5 text-center">
                            {idx + 1}.
                          </span>
                          <AutoGrowTextarea
                            autoFocus={idx === 0}
                            value={draft}
                            onChange={(e) => updateHintDraft(idx, e.target.value)}
                            className="flex-1 bg-base-100"
                          />
                          <button
                            type="button"
                            onClick={() => removeHintDraftRow(idx)}
                            className="w-8 h-[38px] rounded-xl flex items-center justify-center text-base-content/55 hover:text-error hover:bg-error/10 shrink-0 transition-colors"
                            title="ヒントを削除"
                            aria-label="ヒントを削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={addHintDraftRow}
                        className="h-8 px-2.5 rounded-lg bg-base-200/80 hover:bg-base-200 text-xs font-medium text-base-content/75 hover:text-primary inline-flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        ヒントを追加
                      </button>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingHints(false)}
                          className="btn btn-ghost btn-sm"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveHints}
                          className="btn btn-primary btn-sm"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                ) : values.hints.length > 0 ? (
                  <div className="space-y-2">
                    {values.hints.map((hint, idx) => {
                      const revealed = revealedHints.has(idx);
                      return (
                        <div
                          key={idx}
                          onClick={() => toggleHintReveal(idx)}
                          className="overflow-hidden min-h-[48px] rounded-xl border border-base-300 bg-base-200/50 px-3.5 py-2.5 flex flex-col justify-center cursor-pointer hover:border-base-content/25 transition-colors"
                        >
                          <div className="flex gap-2.5 items-start">
                            <span className="shrink-0 w-9 text-xs font-semibold text-base-content/65 leading-relaxed whitespace-nowrap pt-[2px]">
                              {idx + 1}.
                            </span>
                            <p
                              className={`flex-1 min-w-0 text-sm leading-relaxed whitespace-pre-wrap break-words spoiler-blur ${
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
                ) : null}
              </div>

              {/* Answer (Supports Sub-Questions, Multi-Answer Stacking, and KaTeX) */}
              <div data-record-section className="space-y-2 pt-3 border-t border-base-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-base-content/65">
                    答え
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleEditAnswer}
                    className={`h-8 px-2.5 rounded-lg text-xs font-medium text-primary flex items-center gap-1 transition-colors ${
                      editingAnswer
                        ? 'bg-primary/20'
                        : 'bg-primary/10 hover:bg-primary/18'
                    }`}
                  >
                    {resolvedAnswers.length > 0 ? (
                      <>
                        <Pencil className="w-3.5 h-3.5" />
                        編集
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        追加
                      </>
                    )}
                  </button>
                </div>

                {editingAnswer ? (
                  <div className="space-y-2.5">
                    {answerDraftEntries.map((entry, entryIdx) => (
                      <div
                        key={entryIdx}
                        className="rounded-xl border border-base-300 bg-base-200/40 p-2.5 space-y-2"
                      >
                        {showEditorSubLabels && (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={entry.label ?? ''}
                              onChange={(e) =>
                                updateDraftEntryLabel(entryIdx, e.target.value)
                              }
                              placeholder={`(${entryIdx + 1})`}
                              aria-label="小問番号"
                              className="w-24 h-8 px-2.5 rounded-lg border border-base-300 bg-base-100 text-xs font-semibold focus:outline-none focus:border-primary"
                            />
                          </div>
                        )}

                        <div className="space-y-2">
                          {entry.items.map((item, itemIdx) => (
                            <div key={itemIdx} className="space-y-1.5">
                              <div className="flex items-start gap-1.5">
                                <AutoGrowTextarea
                                  autoFocus={entryIdx === 0 && itemIdx === 0}
                                  value={item.text}
                                  onChange={(e) =>
                                    updateDraftItemText(
                                      entryIdx,
                                      itemIdx,
                                      e.target.value,
                                    )
                                  }
                                  className={`flex-1 bg-base-100 ${
                                    item.latex ? 'font-mono text-xs' : ''
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleDraftItemLatex(entryIdx, itemIdx)
                                  }
                                  aria-pressed={item.latex}
                                  title="LaTeX表示を切り替え"
                                  className={`h-[38px] px-2 rounded-xl border text-[11px] font-mono font-semibold shrink-0 transition-colors ${
                                    item.latex
                                      ? 'bg-primary text-primary-content border-primary'
                                      : 'bg-base-100 text-base-content/60 border-base-300 hover:text-base-content'
                                  }`}
                                >
                                  TeX
                                </button>
                                {entry.items.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeDraftItemFromEntry(entryIdx, itemIdx)
                                    }
                                    className="w-8 h-[38px] rounded-xl flex items-center justify-center text-base-content/50 hover:text-error hover:bg-error/10 shrink-0 transition-colors"
                                    title="回答行を削除"
                                    aria-label="回答行を削除"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
                              </div>

                              {item.latex && item.text.trim() && (
                                <div className="px-2.5 py-1.5 rounded-lg bg-base-100/90 border border-base-300/80 text-base-content">
                                  <MathText text={item.text} latex={true} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => addDraftItemToEntry(entryIdx)}
                            className="h-7 px-2 rounded-lg text-[11px] font-medium text-base-content/65 hover:text-primary hover:bg-base-200 inline-flex items-center gap-1 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            回答を追加
                          </button>
                          <button
                            type="button"
                            onClick={() => removeDraftSubQuestion(entryIdx)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-base-content/55 hover:text-error hover:bg-error/10 transition-colors"
                            title={showEditorSubLabels ? '小問を削除' : '答えを削除'}
                            aria-label={showEditorSubLabels ? '小問を削除' : '答えを削除'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={addDraftSubQuestion}
                        className="h-8 px-2.5 rounded-lg bg-base-200/80 hover:bg-base-200 text-xs font-medium text-base-content/75 hover:text-primary inline-flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {answerDraftEntries.length === 0 ? '答えを追加' : '小問を追加'}
                      </button>
                      <div className="flex items-center gap-1.5">
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
                  </div>
                ) : resolvedAnswers.length > 0 ? (
                  isSubQuestionMode ? (
                    (() => {
                      const hasWideLabel = resolvedAnswers.some((entry, idx) => {
                        const lbl = entry.label?.trim() || `(${idx + 1})`;
                        return lbl.length > 4;
                      });
                      const labelWidthClass = hasWideLabel ? 'w-14' : 'w-9';
                      const followIndentClass = hasWideLabel
                        ? 'pl-[calc(3.5rem+0.625rem)]'
                        : 'pl-[calc(2.25rem+0.625rem)]';
                      return (
                        <div className="space-y-2">
                          {resolvedAnswers.map((entry, entryIdx) => {
                            const revealed = revealedAnswers.has(entryIdx);
                            const label = entry.label?.trim() || `(${entryIdx + 1})`;
                            const [firstItem, ...restItems] = entry.items;
                            return (
                              <div
                                key={entryIdx}
                                onClick={() => toggleAnswerReveal(entryIdx)}
                                className="overflow-hidden min-h-[48px] rounded-xl border border-base-300 bg-base-200/50 px-3.5 py-2.5 flex flex-col justify-center cursor-pointer hover:border-base-content/25 transition-colors"
                              >
                                {firstItem && (
                                  <div
                                    className={`flex gap-2.5 ${
                                      firstItem.latex ? 'items-center' : 'items-start'
                                    }`}
                                  >
                                    <span
                                      className={`shrink-0 ${labelWidthClass} text-xs font-semibold text-base-content/65 leading-relaxed whitespace-nowrap ${
                                        firstItem.latex ? '' : 'pt-[2px]'
                                      }`}
                                    >
                                      {label}
                                    </span>
                                    <div
                                      className={`flex-1 min-w-0 spoiler-blur ${
                                        revealed ? 'revealed' : ''
                                      }`}
                                    >
                                      <MathText
                                        text={firstItem.text}
                                        latex={firstItem.latex}
                                        scrollable={revealed}
                                      />
                                    </div>
                                  </div>
                                )}

                                {restItems.length > 0 && (
                                  <div className={followIndentClass}>
                                    {restItems.map((item, idx) => (
                                      <div
                                        key={idx}
                                        className={`border-t border-base-300/75 pt-2 mt-2 spoiler-blur ${
                                          revealed ? 'revealed' : ''
                                        }`}
                                      >
                                        <MathText
                                          text={item.text}
                                          latex={item.latex}
                                          scrollable={revealed}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  ) : (
                    <div
                      onClick={() => toggleAnswerReveal(0)}
                      className="overflow-hidden min-h-[48px] px-3.5 py-2.5 flex flex-col justify-center rounded-xl border border-base-300 bg-base-200/50 cursor-pointer hover:border-base-content/25 transition-colors"
                    >
                      <div
                        className={`spoiler-blur ${
                          revealedAnswers.has(0) ? 'revealed' : ''
                        }`}
                      >
                        {resolvedAnswers[0].items.map((item, itemIdx) => (
                          <div
                            key={itemIdx}
                            className={
                              itemIdx > 0
                                ? 'border-t border-base-300/75 pt-2 mt-2'
                                : ''
                            }
                          >
                            <MathText
                              text={item.text}
                              latex={item.latex}
                              scrollable={revealedAnswers.has(0)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ) : null}
              </div>

              {/* Memo (1-row slim, auto-grows with content) */}
              <div data-record-section className="space-y-2 pt-3 border-t border-base-300">
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
          </div>
        </div>
      )}
    </div>
  );
}
