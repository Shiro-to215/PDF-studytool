export type StudyStatus = 'none' | 'review' | 'weak' | 'done';

export type BindingDirection = 'ltr' | 'rtl';

export type SpreadMode = 'single' | 'double';

export interface MissHistoryEntry {
  timestamp: number;
  status: StudyStatus;
  reasons: string[];
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
  geminiChatUrl?: string;
  layers: string[];
  customReasons: string[];
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
  missHistory: MissHistoryEntry[];
  hints: string[];
  compactAnswer: string;
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
  missHistory: MissHistoryEntry[];
  hints: string[];
  compactAnswer: string;
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
