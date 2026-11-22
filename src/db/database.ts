import Dexie, { type Table } from 'dexie';
import type {
  BindingDirection,
  MissHistoryEntry,
  PageState,
  PageStrokes,
  PdfFileRecord,
  Problem,
  SpreadMode,
  Stroke,
  StudyStatus,
  UnitNode,
  Workbook,
} from '../types/models';
import { ensurePdfWorker, pdfjsLib } from '../utils/pdfWorker';

export class PaperWorkDB extends Dexie {
  workbooks!: Table<Workbook, string>;
  pdfFiles!: Table<PdfFileRecord, string>;
  pageStates!: Table<PageState, string>;
  unitNodes!: Table<UnitNode, string>;
  problems!: Table<Problem, string>;
  pageStrokes!: Table<PageStrokes, string>;

  constructor() {
    super('paperwork-studio-db');
    this.version(1).stores({
      workbooks: 'id, updatedAt',
      pageStates: 'id, workbookId, [workbookId+pageNumber], status',
      unitNodes: 'id, workbookId, parentId, [workbookId+parentId]',
      problems: 'id, workbookId, unitId, [workbookId+pageNumber], status',
      pageStrokes: 'id, workbookId, [workbookId+pageNumber], [workbookId+pageNumber+layerName]',
    });
    this.version(2).stores({
      workbooks: 'id, updatedAt',
      pdfFiles: 'workbookId',
      pageStates: 'id, workbookId, [workbookId+pageNumber], status',
      unitNodes: 'id, workbookId, parentId, [workbookId+parentId]',
      problems: 'id, workbookId, unitId, [workbookId+pageNumber], status',
      pageStrokes: 'id, workbookId, [workbookId+pageNumber], [workbookId+pageNumber+layerName]',
    });
  }
}

export const db = new PaperWorkDB();

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getPageStateId(workbookId: string, pageNumber: number): string {
  return `${workbookId}:${pageNumber}`;
}

export function getPageStrokesId(
  workbookId: string,
  pageNumber: number,
  layerName: string,
): string {
  return `${workbookId}:${pageNumber}:${layerName}`;
}

export async function extractPdfMetaAndCover(
  source: Blob | ArrayBuffer | Uint8Array,
): Promise<{
  pageCount: number;
  coverDataUrl?: string;
}> {
  ensurePdfWorker();
  let data: Uint8Array;
  if (source instanceof Uint8Array) {
    data = new Uint8Array(source);
  } else if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source.slice(0));
  } else {
    const buf = await source.arrayBuffer();
    data = new Uint8Array(buf.slice(0));
  }
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDoc = await loadingTask.promise;

  try {
    const pageCount = pdfDoc.numPages;
    let coverDataUrl: string | undefined;

    if (pageCount >= 1) {
      const page = await pdfDoc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = 320;
      const scale = targetWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(scaledViewport.width));
      canvas.height = Math.max(1, Math.round(scaledViewport.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
        coverDataUrl = canvas.toDataURL('image/jpeg', 0.82);
      }
      page.cleanup();
    }

    return { pageCount, coverDataUrl };
  } finally {
    await pdfDoc.destroy();
  }
}

export interface CreateWorkbookInput {
  title: string;
  pdfBlob: Blob;
  bindingDirection?: BindingDirection;
  defaultSpread?: SpreadMode;
  coverSinglePage?: boolean;
}

export async function addWorkbook(input: CreateWorkbookInput): Promise<Workbook> {
  // Read the full PDF bytes into memory immediately so iPadOS File handles cannot expire
  // and store raw ArrayBuffer instead of Blob to avoid WebKit IndexedDB NotFoundError.
  const rawBuffer = await input.pdfBlob.arrayBuffer();
  const { pageCount, coverDataUrl } = await extractPdfMetaAndCover(rawBuffer);
  const now = Date.now();
  const workbook: Workbook = {
    id: createId(),
    title: input.title.trim() || '無題のワーク',
    coverDataUrl,
    pageCount,
    bindingDirection: input.bindingDirection ?? 'ltr',
    defaultSpread: input.defaultSpread ?? 'double',
    coverSinglePage: input.coverSinglePage ?? false,
    layers: ['1周目'],
    customReasons: [],
    lastPage: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', [db.workbooks, db.pdfFiles], async () => {
    await db.workbooks.put(workbook);
    await db.pdfFiles.put({ workbookId: workbook.id, data: rawBuffer });
  });
  return workbook;
}

function normalizeBufferToUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.slice(0));
}

export async function getWorkbookPdfBytes(workbookId: string): Promise<Uint8Array> {
  const fileRecord = await db.pdfFiles.get(workbookId);
  if (fileRecord?.data) {
    return normalizeBufferToUint8Array(fileRecord.data);
  }

  // Legacy v1 fallback: migrate pdfBlob to pdfFiles if still readable
  const wb = await db.workbooks.get(workbookId);
  if (wb?.pdfBlob) {
    const rawBuffer = await wb.pdfBlob.arrayBuffer();
    await db.transaction('rw', [db.workbooks, db.pdfFiles], async () => {
      await db.pdfFiles.put({ workbookId, data: rawBuffer });
      await db.workbooks.update(workbookId, { pdfBlob: undefined });
    });
    return new Uint8Array(rawBuffer.slice(0));
  }

  throw new Error('PDFデータが見つかりませんでした。ファイルを選び直してください。');
}

export async function relinkWorkbookPdf(workbookId: string, pdfBlob: Blob): Promise<Workbook | undefined> {
  const rawBuffer = await pdfBlob.arrayBuffer();
  const { pageCount, coverDataUrl } = await extractPdfMetaAndCover(rawBuffer);
  const now = Date.now();
  await db.transaction('rw', [db.workbooks, db.pdfFiles], async () => {
    await db.pdfFiles.put({ workbookId, data: rawBuffer });
    await db.workbooks.update(workbookId, {
      pdfBlob: undefined,
      pageCount,
      coverDataUrl,
      updatedAt: now,
    });
  });
  return db.workbooks.get(workbookId);
}

export async function updateWorkbookSettings(
  workbookId: string,
  patch: Partial<
    Pick<
      Workbook,
      | 'title'
      | 'bindingDirection'
      | 'defaultSpread'
      | 'coverSinglePage'
      | 'lastPage'
      | 'layers'
      | 'customReasons'
    >
  >,
): Promise<void> {
  await db.workbooks.update(workbookId, {
    ...patch,
    updatedAt: Date.now(),
  });
}

export async function deleteWorkbook(workbookId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.workbooks, db.pdfFiles, db.pageStates, db.unitNodes, db.problems, db.pageStrokes],
    async () => {
      await db.pdfFiles.delete(workbookId);
      await db.pageStates.where('workbookId').equals(workbookId).delete();
      await db.unitNodes.where('workbookId').equals(workbookId).delete();
      await db.problems.where('workbookId').equals(workbookId).delete();
      await db.pageStrokes.where('workbookId').equals(workbookId).delete();
      await db.workbooks.delete(workbookId);
    },
  );
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function shouldAppendHistory(
  prevStatus: StudyStatus | undefined,
  prevReasons: string[] | undefined,
  nextStatus: StudyStatus,
  nextReasons: string[],
): boolean {
  if (prevStatus === undefined || prevReasons === undefined) {
    return nextStatus !== 'none' || nextReasons.length > 0;
  }
  return prevStatus !== nextStatus || !sameStringArray(prevReasons, nextReasons);
}

export async function upsertPageState(
  workbookId: string,
  pageNumber: number,
  patch: Partial<
    Pick<PageState, 'status' | 'missReasons' | 'hints' | 'compactAnswer' | 'memo'>
  >,
): Promise<PageState> {
  const id = getPageStateId(workbookId, pageNumber);
  const existing = await db.pageStates.get(id);
  const now = Date.now();

  const nextStatus = patch.status ?? existing?.status ?? 'none';
  const nextReasons = patch.missReasons ?? existing?.missReasons ?? [];

  const history: MissHistoryEntry[] = existing?.missHistory ? [...existing.missHistory] : [];
  if (shouldAppendHistory(existing?.status, existing?.missReasons, nextStatus, nextReasons)) {
    history.push({
      timestamp: now,
      status: nextStatus,
      reasons: [...nextReasons],
    });
  }

  const nextState: PageState = {
    id,
    workbookId,
    pageNumber,
    status: nextStatus,
    missReasons: nextReasons,
    missHistory: history,
    hints: patch.hints ?? existing?.hints ?? [],
    compactAnswer: patch.compactAnswer ?? existing?.compactAnswer ?? '',
    memo: patch.memo ?? existing?.memo ?? '',
    updatedAt: now,
  };

  await db.pageStates.put(nextState);
  await db.workbooks.update(workbookId, { updatedAt: now });
  return nextState;
}

export async function upsertProblem(
  problemId: string,
  patch: Partial<
    Pick<
      Problem,
      'status' | 'missReasons' | 'hints' | 'compactAnswer' | 'memo' | 'pageNumber' | 'numberLabel'
    >
  >,
): Promise<Problem | undefined> {
  const existing = await db.problems.get(problemId);
  if (!existing) return undefined;

  const now = Date.now();
  const nextStatus = patch.status ?? existing.status;
  const nextReasons = patch.missReasons ?? existing.missReasons;

  const history: MissHistoryEntry[] = [...existing.missHistory];
  if (shouldAppendHistory(existing.status, existing.missReasons, nextStatus, nextReasons)) {
    history.push({
      timestamp: now,
      status: nextStatus,
      reasons: [...nextReasons],
    });
  }

  const nextProblem: Problem = {
    ...existing,
    ...patch,
    status: nextStatus,
    missReasons: nextReasons,
    missHistory: history,
    updatedAt: now,
  };

  await db.problems.put(nextProblem);
  await db.workbooks.update(existing.workbookId, { updatedAt: now });
  return nextProblem;
}

export async function savePageStrokes(
  workbookId: string,
  pageNumber: number,
  layerName: string,
  strokes: Stroke[],
): Promise<void> {
  const id = getPageStrokesId(workbookId, pageNumber, layerName);
  const now = Date.now();
  if (strokes.length === 0) {
    await db.pageStrokes.delete(id);
    return;
  }
  await db.pageStrokes.put({
    id,
    workbookId,
    pageNumber,
    layerName,
    strokes,
    updatedAt: now,
  });
}

export async function addWorkbookLayer(workbookId: string, layerName: string): Promise<string[]> {
  const trimmed = layerName.trim();
  const wb = await db.workbooks.get(workbookId);
  if (!wb || !trimmed) return wb?.layers ?? ['1周目'];
  if (wb.layers.includes(trimmed)) return wb.layers;
  const nextLayers = [...wb.layers, trimmed];
  await db.workbooks.update(workbookId, { layers: nextLayers, updatedAt: Date.now() });
  return nextLayers;
}

export async function addCustomMissReason(workbookId: string, reason: string): Promise<string[]> {
  const trimmed = reason.trim();
  const wb = await db.workbooks.get(workbookId);
  if (!wb || !trimmed) return wb?.customReasons ?? [];
  if (wb.customReasons.includes(trimmed)) return wb.customReasons;
  const nextReasons = [...wb.customReasons, trimmed];
  await db.workbooks.update(workbookId, { customReasons: nextReasons, updatedAt: Date.now() });
  return nextReasons;
}
