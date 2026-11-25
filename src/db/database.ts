import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_MISS_REASONS,
  resolveActiveLayer,
  resolveRoundRecord,
  type BindingDirection,
  type MissHistoryEntry,
  type PageState,
  type PageStrokes,
  type PdfFileRecord,
  type Problem,
  type RoundRecord,
  type SpreadMode,
  type Stroke,
  type StudyStatus,
  type UnitNode,
  type Workbook,
} from '../types/models';
import { getPdfDocumentOptions, pdfjsLib } from '../utils/pdfWorker';

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
    this.version(3)
      .stores({
        workbooks: 'id, updatedAt',
        pdfFiles: 'workbookId',
        pageStates: 'id, workbookId, [workbookId+pageNumber], status',
        unitNodes: 'id, workbookId, parentId, [workbookId+parentId]',
        problems: 'id, workbookId, unitId, [workbookId+pageNumber], status',
        pageStrokes:
          'id, workbookId, [workbookId+layerName], [workbookId+pageNumber], [workbookId+pageNumber+layerName]',
      })
      .upgrade(async (tx) => {
        // Strip redundant empty ('none') roundRecords entries created by earlier Round 2 bulk writes
        const stripEmptyRounds = (item: {
          status: StudyStatus;
          missReasons: string[];
          roundRecords?: Record<string, RoundRecord>;
        }) => {
          if (!item.roundRecords) return;
          const compacted: Record<string, RoundRecord> = {};
          let keptCount = 0;
          let origCount = 0;
          for (const [k, rec] of Object.entries(item.roundRecords)) {
            origCount++;
            if (rec && (rec.status !== 'none' || (rec.missReasons && rec.missReasons.length > 0))) {
              compacted[k] = { status: rec.status, missReasons: rec.missReasons ?? [] };
              keptCount++;
            }
          }
          if (keptCount === origCount) return;
          if (keptCount === 0) {
            delete item.roundRecords;
            item.status = 'none';
            item.missReasons = [];
          } else {
            item.roundRecords = compacted;
          }
        };

        await tx.table('problems').toCollection().modify(stripEmptyRounds);
        await tx.table('pageStates').toCollection().modify(stripEmptyRounds);
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
  let data: Uint8Array;
  if (source instanceof Uint8Array) {
    data = new Uint8Array(source);
  } else if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source.slice(0));
  } else {
    const buf = await source.arrayBuffer();
    data = new Uint8Array(buf.slice(0));
  }
  const loadingTask = pdfjsLib.getDocument(getPdfDocumentOptions(data));
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
    activeLayer: '1周目',
    customReasons: [],
    missReasonOptions: [...DEFAULT_MISS_REASONS],
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

function wrapBufferAsUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

export async function getWorkbookPdfBytes(workbookId: string): Promise<Uint8Array> {
  const fileRecord = await db.pdfFiles.get(workbookId);
  if (fileRecord?.data) {
    return wrapBufferAsUint8Array(fileRecord.data);
  }

  // Legacy v1 fallback: migrate pdfBlob to pdfFiles if still readable
  const wb = await db.workbooks.get(workbookId);
  if (wb?.pdfBlob) {
    const rawBuffer = await wb.pdfBlob.arrayBuffer();
    await db.transaction('rw', [db.workbooks, db.pdfFiles], async () => {
      await db.pdfFiles.put({ workbookId, data: rawBuffer });
      await db.workbooks.update(workbookId, { pdfBlob: undefined });
    });
    return new Uint8Array(rawBuffer);
  }

  throw new Error('PDFデータが見つかりませんでした。ファイルを選び直してください。');
}

export async function relinkWorkbookPdf(workbookId: string, pdfBlob: Blob): Promise<Workbook | undefined> {
  const rawBuffer = await pdfBlob.arrayBuffer();
  const { pageCount, coverDataUrl } = await extractPdfMetaAndCover(rawBuffer);
  const now = Date.now();
  await db.transaction('rw', [db.workbooks, db.pdfFiles], async () => {
    const wb = await db.workbooks.get(workbookId);
    const clampedLastPage = Math.max(1, Math.min(pageCount || 1, wb?.lastPage ?? 1));
    await db.pdfFiles.put({ workbookId, data: rawBuffer });
    await db.workbooks.update(workbookId, {
      pdfBlob: undefined,
      pageCount,
      lastPage: clampedLastPage,
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
      | 'activeLayer'
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

function buildBaseRoundRecords(
  existing: Pick<Problem | PageState, 'status' | 'missReasons' | 'roundRecords'> | undefined,
  firstLayer: string,
): Record<string, RoundRecord> {
  if (existing?.roundRecords) {
    const copy: Record<string, RoundRecord> = {};
    for (const [k, v] of Object.entries(existing.roundRecords)) {
      if (v.status !== 'none' || v.missReasons.length > 0) {
        copy[k] = { status: v.status, missReasons: [...v.missReasons] };
      }
    }
    return copy;
  }
  if (existing && (existing.status !== 'none' || existing.missReasons.length > 0)) {
    return {
      [firstLayer]: {
        status: existing.status,
        missReasons: [...existing.missReasons],
      },
    };
  }
  return {};
}

function compactRoundRecords(
  rr: Record<string, RoundRecord>,
): Record<string, RoundRecord> | undefined {
  const out: Record<string, RoundRecord> = {};
  let count = 0;
  for (const [k, v] of Object.entries(rr)) {
    if (v.status !== 'none' || v.missReasons.length > 0) {
      out[k] = { status: v.status, missReasons: [...v.missReasons] };
      count++;
    }
  }
  return count > 0 ? out : undefined;
}

function roundRecordsEqual(
  a: Record<string, RoundRecord> | undefined,
  b: Record<string, RoundRecord> | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const ra = a[k];
    const rb = b[k];
    if (!rb || ra.status !== rb.status || !sameStringArray(ra.missReasons, rb.missReasons)) {
      return false;
    }
  }
  return true;
}

export async function upsertPageState(
  workbookId: string,
  pageNumber: number,
  patch: Partial<
    Pick<PageState, 'status' | 'missReasons' | 'hints' | 'compactAnswer' | 'answerEntries' | 'memo'>
  >,
  layerName?: string,
): Promise<PageState> {
  return db.transaction('rw', [db.pageStates, db.workbooks], async () => {
    const id = getPageStateId(workbookId, pageNumber);
    const [existing, wb] = await Promise.all([
      db.pageStates.get(id),
      db.workbooks.get(workbookId),
    ]);
    const now = Date.now();
    const firstLayer = wb?.layers[0] ?? '1周目';
    const targetLayer = layerName ?? (wb ? resolveActiveLayer(wb) : firstLayer);

    const curRec = existing
      ? resolveRoundRecord(existing, targetLayer, firstLayer)
      : { status: 'none' as StudyStatus, missReasons: [] as string[] };
    const nextStatus = patch.status ?? curRec.status;
    const nextReasons = patch.missReasons ?? curRec.missReasons;

    const history: MissHistoryEntry[] = existing?.missHistory ? [...existing.missHistory] : [];
    if (shouldAppendHistory(curRec.status, curRec.missReasons, nextStatus, nextReasons)) {
      history.push({
        timestamp: now,
        status: nextStatus,
        reasons: [...nextReasons],
      });
    }

    const nextRoundRecords = buildBaseRoundRecords(existing, firstLayer);
    if (patch.status !== undefined || patch.missReasons !== undefined || existing?.roundRecords) {
      if (nextStatus === 'none' && nextReasons.length === 0) {
        delete nextRoundRecords[targetLayer];
      } else {
        nextRoundRecords[targetLayer] = {
          status: nextStatus,
          missReasons: [...nextReasons],
        };
      }
    }
    const compacted = compactRoundRecords(nextRoundRecords);

    const nextState: PageState = {
      id,
      workbookId,
      pageNumber,
      status: nextStatus,
      missReasons: nextReasons,
      ...(compacted ? { roundRecords: compacted } : {}),
      missHistory: history,
      hints: patch.hints ?? existing?.hints ?? [],
      compactAnswer: patch.compactAnswer ?? existing?.compactAnswer ?? '',
      answerEntries:
        'answerEntries' in patch ? patch.answerEntries : existing?.answerEntries,
      memo: patch.memo ?? existing?.memo ?? '',
      updatedAt: now,
    };

    await db.pageStates.put(nextState);
    await db.workbooks.update(workbookId, { updatedAt: now });
    return nextState;
  });
}

export async function upsertProblem(
  problemId: string,
  patch: Partial<
    Pick<
      Problem,
      | 'status'
      | 'missReasons'
      | 'hints'
      | 'compactAnswer'
      | 'answerEntries'
      | 'memo'
      | 'pageNumber'
      | 'numberLabel'
    >
  >,
  layerName?: string,
): Promise<Problem | undefined> {
  return db.transaction('rw', [db.problems, db.workbooks], async () => {
    const existing = await db.problems.get(problemId);
    if (!existing) return undefined;

    const wb = await db.workbooks.get(existing.workbookId);
    const now = Date.now();
    const firstLayer = wb?.layers[0] ?? '1周目';
    const targetLayer = layerName ?? (wb ? resolveActiveLayer(wb) : firstLayer);

    const curRec = resolveRoundRecord(existing, targetLayer, firstLayer);
    const nextStatus = patch.status ?? curRec.status;
    const nextReasons = patch.missReasons ?? curRec.missReasons;

    const history: MissHistoryEntry[] = [...existing.missHistory];
    if (shouldAppendHistory(curRec.status, curRec.missReasons, nextStatus, nextReasons)) {
      history.push({
        timestamp: now,
        status: nextStatus,
        reasons: [...nextReasons],
      });
    }

    const nextRoundRecords = buildBaseRoundRecords(existing, firstLayer);
    if (patch.status !== undefined || patch.missReasons !== undefined || existing.roundRecords) {
      if (nextStatus === 'none' && nextReasons.length === 0) {
        delete nextRoundRecords[targetLayer];
      } else {
        nextRoundRecords[targetLayer] = {
          status: nextStatus,
          missReasons: [...nextReasons],
        };
      }
    }
    const compacted = compactRoundRecords(nextRoundRecords);

    const { roundRecords: _prevRoundRecords, ...existingWithoutRounds } = existing;
    const nextProblem: Problem = {
      ...existingWithoutRounds,
      ...patch,
      status: nextStatus,
      missReasons: nextReasons,
      ...(compacted ? { roundRecords: compacted } : {}),
      missHistory: history,
      updatedAt: now,
    };

    await db.problems.put(nextProblem);
    await db.workbooks.update(existing.workbookId, { updatedAt: now });
    return nextProblem;
  });
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

export async function setWorkbookActiveLayer(
  workbookId: string,
  layerName: string,
): Promise<void> {
  const wb = await db.workbooks.get(workbookId);
  if (!wb || !wb.layers.includes(layerName)) return;
  if (wb.activeLayer === layerName) return;
  await db.workbooks.update(workbookId, {
    activeLayer: layerName,
    updatedAt: Date.now(),
  });
}

export async function addWorkbookRound(
  workbookId: string,
  layerName: string,
  mode: 'fresh' | 'carry_done' = 'fresh',
  sourceLayerName?: string,
): Promise<string> {
  const trimmed = layerName.trim();
  const wb = await db.workbooks.get(workbookId);
  if (!wb) return trimmed || '1周目';

  const targetName = trimmed || `${wb.layers.length + 1}周目`;
  if (wb.layers.includes(targetName)) {
    await db.workbooks.update(workbookId, {
      activeLayer: targetName,
      updatedAt: Date.now(),
    });
    return targetName;
  }

  const firstLayer = wb.layers[0] ?? '1周目';
  const fromLayer = sourceLayerName ?? resolveActiveLayer(wb);
  const now = Date.now();
  let nextLayers: string[];
  if (mode === 'carry_done') {
    const srcIdx = wb.layers.indexOf(fromLayer);
    if (srcIdx >= 0) {
      nextLayers = [
        ...wb.layers.slice(0, srcIdx + 1),
        targetName,
        ...wb.layers.slice(srcIdx + 1),
      ];
    } else {
      nextLayers = [...wb.layers, targetName];
    }
  } else {
    nextLayers = [...wb.layers, targetName];
  }

  if (mode === 'fresh') {
    // Untouched problems/pageStates resolve to 'none' automatically via resolveRoundRecord,
    // so creating a fresh round needs zero writes to problems/pageStates.
    await db.workbooks.update(workbookId, {
      layers: nextLayers,
      activeLayer: targetName,
      updatedAt: now,
    });
    return targetName;
  }

  await db.transaction(
    'rw',
    [db.workbooks, db.problems, db.pageStates],
    async () => {
      await db.workbooks.update(workbookId, {
        layers: nextLayers,
        activeLayer: targetName,
        updatedAt: now,
      });

      const problems = await db.problems.where('workbookId').equals(workbookId).toArray();
      const updatedProblems: Problem[] = [];
      for (const p of problems) {
        const srcRec = resolveRoundRecord(p, fromLayer, firstLayer);
        if (srcRec.status !== 'done') continue;
        const rr = buildBaseRoundRecords(p, firstLayer);
        rr[targetName] = { status: 'done', missReasons: [] };
        const compacted = compactRoundRecords(rr);
        const { roundRecords: _prevRR, ...rest } = p;
        updatedProblems.push({
          ...rest,
          status: 'done',
          missReasons: [],
          ...(compacted ? { roundRecords: compacted } : {}),
          updatedAt: now,
        });
      }
      if (updatedProblems.length > 0) {
        await db.problems.bulkPut(updatedProblems);
      }

      const states = await db.pageStates.where('workbookId').equals(workbookId).toArray();
      const updatedStates: PageState[] = [];
      for (const s of states) {
        const srcRec = resolveRoundRecord(s, fromLayer, firstLayer);
        if (srcRec.status !== 'done') continue;
        const rr = buildBaseRoundRecords(s, firstLayer);
        rr[targetName] = { status: 'done', missReasons: [] };
        const compacted = compactRoundRecords(rr);
        const { roundRecords: _prevRR, ...rest } = s;
        updatedStates.push({
          ...rest,
          status: 'done',
          missReasons: [],
          ...(compacted ? { roundRecords: compacted } : {}),
          updatedAt: now,
        });
      }
      if (updatedStates.length > 0) {
        await db.pageStates.bulkPut(updatedStates);
      }
    },
  );

  return targetName;
}

export async function updateWorkbookRounds(
  workbookId: string,
  nextLayers: string[],
  renameMap: Record<string, string> = {},
): Promise<{ layers: string[]; activeLayer: string }> {
  const wb = await db.workbooks.get(workbookId);
  if (!wb) return { layers: ['1周目'], activeLayer: '1周目' };

  const cleaned = Array.from(new Set(nextLayers.map((l) => l.trim()).filter(Boolean)));
  const finalLayers = cleaned.length > 0 ? cleaned : ['1周目'];
  const validSet = new Set(finalLayers);
  const firstOldLayer = wb.layers[0] ?? '1周目';
  const curActive = resolveActiveLayer(wb);
  const mappedActive = renameMap[curActive] ?? curActive;
  const nextActive = validSet.has(mappedActive) ? mappedActive : finalLayers[0];
  const now = Date.now();

  const remapRecords = (
    item: Pick<Problem | PageState, 'status' | 'missReasons' | 'roundRecords'>,
  ): Record<string, RoundRecord> | undefined => {
    const base = buildBaseRoundRecords(item, firstOldLayer);
    const out: Record<string, RoundRecord> = {};
    for (const [oldName, rec] of Object.entries(base)) {
      const mapped = renameMap[oldName] ?? oldName;
      if (!validSet.has(mapped)) continue;
      if (!out[mapped] || (out[mapped].status === 'none' && rec.status !== 'none')) {
        out[mapped] = { status: rec.status, missReasons: [...rec.missReasons] };
      }
    }
    return compactRoundRecords(out);
  };

  await db.transaction(
    'rw',
    [db.workbooks, db.problems, db.pageStates, db.pageStrokes],
    async () => {
      await db.workbooks.update(workbookId, {
        layers: finalLayers,
        activeLayer: nextActive,
        updatedAt: now,
      });

      const problems = await db.problems.where('workbookId').equals(workbookId).toArray();
      const updatedProblems: Problem[] = [];
      for (const p of problems) {
        const rr = remapRecords(p);
        const activeRec = rr?.[nextActive] ?? { status: 'none' as StudyStatus, missReasons: [] };
        if (
          roundRecordsEqual(p.roundRecords, rr) &&
          p.status === activeRec.status &&
          sameStringArray(p.missReasons, activeRec.missReasons)
        ) {
          continue;
        }
        const { roundRecords: _prevRR, ...rest } = p;
        updatedProblems.push({
          ...rest,
          status: activeRec.status,
          missReasons: activeRec.missReasons,
          ...(rr ? { roundRecords: rr } : {}),
          updatedAt: now,
        });
      }
      if (updatedProblems.length > 0) {
        await db.problems.bulkPut(updatedProblems);
      }

      const states = await db.pageStates.where('workbookId').equals(workbookId).toArray();
      const updatedStates: PageState[] = [];
      for (const s of states) {
        const rr = remapRecords(s);
        const activeRec = rr?.[nextActive] ?? { status: 'none' as StudyStatus, missReasons: [] };
        if (
          roundRecordsEqual(s.roundRecords, rr) &&
          s.status === activeRec.status &&
          sameStringArray(s.missReasons, activeRec.missReasons)
        ) {
          continue;
        }
        const { roundRecords: _prevRR, ...rest } = s;
        updatedStates.push({
          ...rest,
          status: activeRec.status,
          missReasons: activeRec.missReasons,
          ...(rr ? { roundRecords: rr } : {}),
          updatedAt: now,
        });
      }
      if (updatedStates.length > 0) {
        await db.pageStates.bulkPut(updatedStates);
      }

      // Sync stroke layers (rename, merge, or delete orphaned stroke layers)
      const strokes = await db.pageStrokes.where('workbookId').equals(workbookId).toArray();
      const deleteIds: string[] = [];
      const mergedBuckets = new Map<
        string,
        {
          pageNumber: number;
          layerName: string;
          strokes: Stroke[];
          seenStrokeIds: Set<string>;
          needsWrite: boolean;
          sourceCount: number;
        }
      >();
      for (const st of strokes) {
        const mapped = renameMap[st.layerName] ?? st.layerName;
        if (!validSet.has(mapped)) {
          deleteIds.push(st.id);
          continue;
        }
        if (mapped !== st.layerName) {
          deleteIds.push(st.id);
        }
        const bucketKey = `${st.pageNumber}:${mapped}`;
        let bucket = mergedBuckets.get(bucketKey);
        if (!bucket) {
          bucket = {
            pageNumber: st.pageNumber,
            layerName: mapped,
            strokes: [],
            seenStrokeIds: new Set<string>(),
            needsWrite: mapped !== st.layerName,
            sourceCount: 0,
          };
          mergedBuckets.set(bucketKey, bucket);
        } else {
          bucket.needsWrite = true;
        }
        bucket.sourceCount += 1;
        if (mapped !== st.layerName) {
          bucket.needsWrite = true;
        }
        for (const stroke of st.strokes) {
          if (!bucket.seenStrokeIds.has(stroke.id)) {
            bucket.seenStrokeIds.add(stroke.id);
            bucket.strokes.push(stroke);
          }
        }
      }
      const putStrokes: PageStrokes[] = [];
      for (const bucket of mergedBuckets.values()) {
        if (!bucket.needsWrite && bucket.sourceCount <= 1) continue;
        putStrokes.push({
          id: getPageStrokesId(workbookId, bucket.pageNumber, bucket.layerName),
          workbookId,
          pageNumber: bucket.pageNumber,
          layerName: bucket.layerName,
          strokes: bucket.strokes,
          updatedAt: now,
        });
      }
      if (deleteIds.length > 0) {
        await db.pageStrokes.bulkDelete(deleteIds);
      }
      if (putStrokes.length > 0) {
        await db.pageStrokes.bulkPut(putStrokes);
      }
    },
  );

  return { layers: finalLayers, activeLayer: nextActive };
}

export async function updateWorkbookMissReasons(
  workbookId: string,
  nextReasons: string[],
  renameMap: Record<string, string> = {},
): Promise<string[]> {
  const cleaned = Array.from(
    new Set(nextReasons.map((r) => r.trim()).filter(Boolean)),
  );
  const validSet = new Set(cleaned);
  const now = Date.now();

  const transformReasons = (current: string[]): string[] => {
    const mapped: string[] = [];
    const seen = new Set<string>();
    for (const r of current) {
      const next = renameMap[r] ?? r;
      if (validSet.has(next) && !seen.has(next)) {
        seen.add(next);
        mapped.push(next);
      }
    }
    return mapped;
  };

  const transformRoundRecords = (
    rr: Record<string, RoundRecord> | undefined,
  ): { next: Record<string, RoundRecord> | undefined; changed: boolean } => {
    if (!rr) return { next: undefined, changed: false };
    let changed = false;
    const out: Record<string, RoundRecord> = {};
    for (const [k, rec] of Object.entries(rr)) {
      const nextR = transformReasons(rec.missReasons);
      if (!sameStringArray(rec.missReasons, nextR)) changed = true;
      out[k] = { status: rec.status, missReasons: nextR };
    }
    return { next: out, changed };
  };

  await db.transaction(
    'rw',
    [db.workbooks, db.problems, db.pageStates],
    async () => {
      await db.workbooks.update(workbookId, {
        missReasonOptions: cleaned,
        customReasons: [],
        updatedAt: now,
      });

      const problems = await db.problems.where('workbookId').equals(workbookId).toArray();
      const updatedProblems: Problem[] = [];
      for (const p of problems) {
        const nextTop = transformReasons(p.missReasons);
        const topChanged = !sameStringArray(p.missReasons, nextTop);
        const { next: nextRR, changed: rrChanged } = transformRoundRecords(p.roundRecords);
        if (topChanged || rrChanged) {
          updatedProblems.push({
            ...p,
            missReasons: nextTop,
            ...(nextRR ? { roundRecords: nextRR } : {}),
            updatedAt: now,
          });
        }
      }
      if (updatedProblems.length > 0) {
        await db.problems.bulkPut(updatedProblems);
      }

      const states = await db.pageStates.where('workbookId').equals(workbookId).toArray();
      const updatedStates: PageState[] = [];
      for (const s of states) {
        const nextTop = transformReasons(s.missReasons);
        const topChanged = !sameStringArray(s.missReasons, nextTop);
        const { next: nextRR, changed: rrChanged } = transformRoundRecords(s.roundRecords);
        if (topChanged || rrChanged) {
          updatedStates.push({
            ...s,
            missReasons: nextTop,
            ...(nextRR ? { roundRecords: nextRR } : {}),
            updatedAt: now,
          });
        }
      }
      if (updatedStates.length > 0) {
        await db.pageStates.bulkPut(updatedStates);
      }
    },
  );

  return cleaned;
}
