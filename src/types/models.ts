export type StudyStatus = 'none' | 'review' | 'weak' | 'done';

export type BindingDirection = 'ltr' | 'rtl';

export type SpreadMode = 'single' | 'double';

export interface MissHistoryEntry {
  timestamp: number;
  status: StudyStatus;
  reasons: string[];
}

export interface RoundRecord {
  status: StudyStatus;
  missReasons: string[];
}

export interface AnswerValueItem {
  text: string;
  latex: boolean;
}

export interface AnswerEntry {
  /** Sub-question label such as "(1)", "(2)", "(ア)". Omitted when not split into sub-questions */
  label?: string;
  /** One or more answer values within this question or sub-question */
  items: AnswerValueItem[];
}

export interface Workbook {
  id: string;
  title: string;
  /** Legacy field kept optional only for migrating v1 records to pdfFiles table */
  pdfBlob?: Blob;
  coverDataUrl?: string;
  pageCount: number;
  bindingDirection: BindingDirection;
  defaultSpread: SpreadMode;
  coverSinglePage: boolean;
  layers: string[];
  /** Currently active study round name (persisted per workbook) */
  activeLayer?: string;
  /** Legacy custom-only reasons kept for backwards compatibility */
  customReasons: string[];
  /** Full editable miss-reason tag list for this workbook (overrides defaults when present) */
  missReasonOptions?: string[];
  lastPage: number;
  createdAt: number;
  updatedAt: number;
}

export interface PdfFileRecord {
  workbookId: string;
  data: ArrayBuffer;
}

export interface PageState {
  id: string; // `${workbookId}:${pageNumber}`
  workbookId: string;
  pageNumber: number;
  status: StudyStatus;
  missReasons: string[];
  /** Per-round status & miss reasons keyed by round (layer) name */
  roundRecords?: Record<string, RoundRecord>;
  missHistory: MissHistoryEntry[];
  hints: string[];
  compactAnswer: string;
  answerEntries?: AnswerEntry[];
  memo: string;
  updatedAt: number;
}

export interface UnitNode {
  id: string;
  workbookId: string;
  parentId: string | null;
  name: string;
  order: number;
}

export interface Problem {
  id: string;
  workbookId: string;
  unitId: string | null;
  numberLabel: string;
  pageNumber: number;
  order: number;
  status: StudyStatus;
  missReasons: string[];
  /** Per-round status & miss reasons keyed by round (layer) name */
  roundRecords?: Record<string, RoundRecord>;
  missHistory: MissHistoryEntry[];
  hints: string[];
  compactAnswer: string;
  answerEntries?: AnswerEntry[];
  memo: string;
  updatedAt: number;
}

/** Normalized coordinates [x (0..1), y (0..1), pressure (0..1)] */
export type StrokePoint = [number, number, number];

export interface Stroke {
  id: string;
  tool: 'pen' | 'marker';
  color: string;
  size: number;
  points: StrokePoint[];
  /** Shared ID linking split segments of a single cross-spread stroke */
  groupId?: string;
  /** Optional geometry hint for crisp uniform rendering of auto-snapped shapes */
  shapeKind?: 'line' | 'ellipse';
}

export interface PageStrokes {
  id: string; // `${workbookId}:${pageNumber}:${layerName}`
  workbookId: string;
  pageNumber: number;
  layerName: string;
  strokes: Stroke[];
  updatedAt: number;
}

export const DEFAULT_MISS_REASONS = [
  '知識不足',
  '方針不足',
  '計算ミス',
  '読解ミス',
  '時間不足',
] as const;

export function resolveWorkbookMissReasons(
  workbook: Pick<Workbook, 'missReasonOptions' | 'customReasons'>,
): string[] {
  if (workbook.missReasonOptions !== undefined) {
    return workbook.missReasonOptions;
  }
  return Array.from(new Set([...DEFAULT_MISS_REASONS, ...(workbook.customReasons ?? [])]));
}

export function resolveActiveLayer(
  workbook: Pick<Workbook, 'layers' | 'activeLayer'>,
): string {
  const layers = workbook.layers.length > 0 ? workbook.layers : ['1周目'];
  if (workbook.activeLayer && layers.includes(workbook.activeLayer)) {
    return workbook.activeLayer;
  }
  return layers[0];
}

export function resolveRoundRecord(
  item: Pick<Problem | PageState, 'status' | 'missReasons' | 'roundRecords'>,
  layerName: string,
  firstLayerName = '1周目',
): RoundRecord {
  if (item.roundRecords) {
    const rec = item.roundRecords[layerName];
    if (rec) return rec;
    return { status: 'none', missReasons: [] };
  }
  if (layerName === firstLayerName) {
    return { status: item.status, missReasons: item.missReasons };
  }
  return { status: 'none', missReasons: [] };
}

export const STUDY_STATUS_META: Record<
  StudyStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  none: {
    label: '未着手',
    badgeClass: 'bg-base-200 text-base-content/60 border-base-300',
    dotClass: 'bg-base-content/30',
  },
  review: {
    label: '要復習',
    badgeClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30',
    dotClass: 'bg-amber-500',
  },
  weak: {
    label: '苦手',
    badgeClass: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30',
    dotClass: 'bg-rose-500',
  },
  done: {
    label: '完了',
    badgeClass: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    dotClass: 'bg-emerald-500',
  },
};
