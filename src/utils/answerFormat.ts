import type { AnswerEntry, AnswerValueItem } from '../types/models';

/**
 * Strip accidental outer LaTeX delimiters ($...$, $$...$$, \(...\), \[...\])
 * so LLM-generated strings render cleanly in KaTeX.
 */
export function stripLatexDelimiters(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) {
    s = s.slice(2, -2).trim();
  } else if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  } else if (s.startsWith('\\(') && s.endsWith('\\)') && s.length >= 4) {
    s = s.slice(2, -2).trim();
  } else if (s.startsWith('\\[') && s.endsWith('\\]') && s.length >= 4) {
    s = s.slice(2, -2).trim();
  }
  return s;
}

/**
 * Normalize AnswerEntry[] by removing empty items/entries and trimming labels.
 */
export function normalizeAnswerEntries(entries: AnswerEntry[]): AnswerEntry[] {
  const result: AnswerEntry[] = [];
  for (const entry of entries) {
    const cleanedItems: AnswerValueItem[] = [];
    for (const item of entry.items) {
      const text = item.text.trim();
      if (!text) continue;
      cleanedItems.push({
        text: item.latex ? stripLatexDelimiters(text) : text,
        latex: Boolean(item.latex),
      });
    }
    if (cleanedItems.length === 0) continue;
    const label = entry.label?.trim();
    result.push(label ? { label, items: cleanedItems } : { items: cleanedItems });
  }
  return result;
}

/**
 * Resolve stored structured entries with automatic fallback to legacy `compactAnswer`.
 */
export function resolveAnswerEntries(
  compactAnswer: string,
  answerEntries?: AnswerEntry[],
): AnswerEntry[] {
  if (answerEntries && answerEntries.length > 0) {
    const normalized = normalizeAnswerEntries(answerEntries);
    if (normalized.length > 0) return normalized;
  }
  const fallback = compactAnswer.trim();
  if (!fallback) return [];
  return [{ items: [{ text: fallback, latex: false }] }];
}

/**
 * True when the problem answer should render with sub-question cards.
 */
export function hasSubQuestions(entries: AnswerEntry[]): boolean {
  if (entries.length > 1) return true;
  if (entries.length === 1 && Boolean(entries[0].label?.trim())) return true;
  return false;
}

/**
 * Build a concise 1-line plain fallback summary for `compactAnswer`.
 */
export function summarizeAnswerEntries(entries: AnswerEntry[]): string {
  const normalized = normalizeAnswerEntries(entries);
  if (normalized.length === 0) return '';
  return normalized
    .map((entry) => {
      const joined = entry.items.map((i) => i.text).join(' / ');
      return entry.label ? `${entry.label} ${joined}` : joined;
    })
    .join('  ');
}

function parseSingleValueItem(raw: unknown, defaultLatex: boolean): AnswerValueItem | null {
  if (typeof raw === 'string' || typeof raw === 'number') {
    const text = String(raw).trim();
    if (!text) return null;
    return {
      text: defaultLatex ? stripLatexDelimiters(text) : text,
      latex: defaultLatex,
    };
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const latex = typeof obj.latex === 'boolean' ? obj.latex : defaultLatex;
    const rawText = obj.text ?? obj.value ?? obj.answer ?? '';
    if (typeof rawText === 'string' || typeof rawText === 'number') {
      const text = String(rawText).trim();
      if (!text) return null;
      return {
        text: latex ? stripLatexDelimiters(text) : text,
        latex,
      };
    }
  }
  return null;
}

function parseValueList(raw: unknown, defaultLatex: boolean): AnswerValueItem[] {
  if (Array.isArray(raw)) {
    const items: AnswerValueItem[] = [];
    for (const el of raw) {
      const item = parseSingleValueItem(el, defaultLatex);
      if (item) items.push(item);
    }
    return items;
  }
  const single = parseSingleValueItem(raw, defaultLatex);
  return single ? [single] : [];
}

function isSubQuestionObject(raw: unknown): raw is Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  return (
    'label' in obj ||
    'subLabel' in obj ||
    'values' in obj ||
    'items' in obj ||
    Array.isArray(obj.value)
  );
}

/**
 * Parse flexible JSON `answer` field supporting:
 * 1) string (single answer, inherits defaultLatex)
 * 2) string[] or value-item[] (multiple answers without sub-questions)
 * 3) single object { value/values/text/items, label?, latex? }
 * 4) array of sub-question objects [{ label, value/values/items, latex? }]
 */
export function parseJsonAnswerField(
  rawAnswer: unknown,
  defaultLatex: boolean,
): { answerEntries: AnswerEntry[]; compactAnswer: string } {
  if (rawAnswer === undefined || rawAnswer === null || rawAnswer === '') {
    return { answerEntries: [], compactAnswer: '' };
  }

  // Case 1: plain string or number
  if (typeof rawAnswer === 'string' || typeof rawAnswer === 'number') {
    const text = String(rawAnswer).trim();
    if (!text) return { answerEntries: [], compactAnswer: '' };
    const cleaned = defaultLatex ? stripLatexDelimiters(text) : text;
    const entries: AnswerEntry[] = [{ items: [{ text: cleaned, latex: defaultLatex }] }];
    return { answerEntries: entries, compactAnswer: summarizeAnswerEntries(entries) };
  }

  // Case 2: single object
  if (typeof rawAnswer === 'object' && !Array.isArray(rawAnswer)) {
    const obj = rawAnswer as Record<string, unknown>;
    const entryLatex = typeof obj.latex === 'boolean' ? obj.latex : defaultLatex;
    const label = String(obj.label ?? obj.subLabel ?? '').trim();
    const rawVal = obj.values ?? obj.items ?? obj.value ?? obj.text ?? obj.answer;
    const items = parseValueList(rawVal, entryLatex);
    if (items.length === 0) return { answerEntries: [], compactAnswer: '' };
    const entries: AnswerEntry[] = [label ? { label, items } : { items }];
    return { answerEntries: entries, compactAnswer: summarizeAnswerEntries(entries) };
  }

  // Case 3: array (either sub-question objects or multiple values without sub-questions)
  if (Array.isArray(rawAnswer)) {
    const hasSubObj = rawAnswer.some((el) => isSubQuestionObject(el));
    if (hasSubObj) {
      const entries: AnswerEntry[] = [];
      for (const el of rawAnswer) {
        if (typeof el === 'object' && el !== null && !Array.isArray(el)) {
          const obj = el as Record<string, unknown>;
          const entryLatex = typeof obj.latex === 'boolean' ? obj.latex : defaultLatex;
          const label = String(obj.label ?? obj.subLabel ?? '').trim();
          const rawVal = obj.values ?? obj.items ?? obj.value ?? obj.text ?? obj.answer;
          const items = parseValueList(rawVal, entryLatex);
          if (items.length > 0) {
            entries.push(label ? { label, items } : { items });
          }
        } else {
          const item = parseSingleValueItem(el, defaultLatex);
          if (item) entries.push({ items: [item] });
        }
      }
      const normalized = normalizeAnswerEntries(entries);
      return {
        answerEntries: normalized,
        compactAnswer: summarizeAnswerEntries(normalized),
      };
    }

    // Array of plain values / { text, latex } without sub-questions
    const items = parseValueList(rawAnswer, defaultLatex);
    if (items.length === 0) return { answerEntries: [], compactAnswer: '' };
    const entries: AnswerEntry[] = [{ items }];
    return { answerEntries: entries, compactAnswer: summarizeAnswerEntries(entries) };
  }

  return { answerEntries: [], compactAnswer: '' };
}
