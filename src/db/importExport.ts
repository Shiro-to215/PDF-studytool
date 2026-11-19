import { createId, db } from './database';
import type {
  PageState,
  PageStrokes,
  Problem,
  UnitNode,
  Workbook,
} from '../types/models';

export interface ParsedImportRow {
  path: string;
  problemNumber: string;
  page: number;
  answer: string;
  hints: string[];
}

export interface ImportSummary {
  totalRows: number;
  unitsCreated: number;
  problemsCreated: number;
  problemsUpdated: number;
}

/**
 * RFC-4180 inspired CSV parser supporting quoted fields, embedded commas, and newlines.
 */
export function parseCsv(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function parseImportInput(rawText: string): ParsedImportRow[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Try JSON first when starting with [ or {
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown[] }).items)
        ? (parsed as { items: unknown[] }).items
        : [];

    if (!Array.isArray(arr)) {
      throw new Error('JSONは配列形式で指定してください。');
    }

    const rows: ParsedImportRow[] = [];
    for (const item of arr) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const problemNumber = String(
        obj.problemNumber ?? obj.numberLabel ?? obj.number ?? obj.problem ?? '',
      ).trim();
      const page = Number(obj.page ?? obj.pageNumber ?? 0);
      if (!problemNumber || !Number.isFinite(page) || page < 1) continue;

      const path = String(obj.path ?? obj.unit ?? '').trim();
      const answer = String(obj.answer ?? obj.compactAnswer ?? '').trim();
      const hints = Array.isArray(obj.hints)
        ? obj.hints.map((h) => String(h).trim()).filter(Boolean)
        : typeof obj.hint === 'string' && obj.hint.trim()
          ? [obj.hint.trim()]
          : [];

      rows.push({ path, problemNumber, page: Math.floor(page), answer, hints });
    }
    return rows;
  }

  // Otherwise parse as CSV
  const table = parseCsv(trimmed);
  if (table.length === 0) return [];

  const firstLower = table[0].map((c) => c.toLowerCase());
  const hasHeader =
    firstLower.some((c) => ['path', 'unit', '単元', 'problemnumber', 'problem', '問題番号', 'page', 'ページ'].includes(c));

  let pathIdx = 0;
  let numIdx = 1;
  let pageIdx = 2;
  let ansIdx = 3;
  let hintIdx = 4;
  let startRow = 0;

  if (hasHeader) {
    startRow = 1;
    pathIdx = firstLower.findIndex((c) => ['path', 'unit', '単元', '階層'].includes(c));
    numIdx = firstLower.findIndex((c) =>
      ['problemnumber', 'numberlabel', 'number', 'problem', '問題番号', '番号'].includes(c),
    );
    pageIdx = firstLower.findIndex((c) => ['page', 'pagenumber', 'ページ'].includes(c));
    ansIdx = firstLower.findIndex((c) => ['answer', 'compactanswer', '答え', '解答'].includes(c));
    hintIdx = firstLower.findIndex((c) => ['hint', 'hints', 'ヒント'].includes(c));
  }

  const rows: ParsedImportRow[] = [];
  for (let i = startRow; i < table.length; i++) {
    const cols = table[i];
    const problemNumber = (numIdx >= 0 ? cols[numIdx] : '')?.trim() ?? '';
    const pageRaw = (pageIdx >= 0 ? cols[pageIdx] : '')?.trim() ?? '';
    const page = Number(pageRaw);
    if (!problemNumber || !Number.isFinite(page) || page < 1) continue;

    const path = (pathIdx >= 0 ? cols[pathIdx] : '')?.trim() ?? '';
    const answer = (ansIdx >= 0 ? cols[ansIdx] : '')?.trim() ?? '';
    const hintStr = (hintIdx >= 0 ? cols[hintIdx] : '')?.trim() ?? '';
    const hints = hintStr
      ? hintStr.split('|').map((s) => s.trim()).filter(Boolean)
      : [];

    rows.push({
      path,
      problemNumber,
      page: Math.floor(page),
      answer,
      hints,
    });
  }

  return rows;
}

export async function importProblemsToWorkbook(
  workbookId: string,
  rows: ParsedImportRow[],
): Promise<ImportSummary> {
  const existingUnits = await db.unitNodes.where('workbookId').equals(workbookId).toArray();
  const existingProblems = await db.problems.where('workbookId').equals(workbookId).toArray();

  // Key: `${parentId ?? 'ROOT'}::${name}` -> UnitNode
  const unitMap = new Map<string, UnitNode>();
  const siblingOrderMap = new Map<string, number>();

  for (const u of existingUnits) {
    const key = `${u.parentId ?? 'ROOT'}::${u.name}`;
    unitMap.set(key, u);
    const parentKey = u.parentId ?? 'ROOT';
    siblingOrderMap.set(parentKey, Math.max(siblingOrderMap.get(parentKey) ?? -1, u.order));
  }

  // Match existing problem by `${unitId ?? 'NONE'}::${numberLabel}` or `PAGE:${pageNumber}::${numberLabel}`
  const problemByUnitAndNum = new Map<string, Problem>();
  const problemByPageAndNum = new Map<string, Problem>();
  let maxProblemOrder = existingProblems.reduce((m, p) => Math.max(m, p.order), -1);

  for (const p of existingProblems) {
    problemByUnitAndNum.set(`${p.unitId ?? 'NONE'}::${p.numberLabel}`, p);
    problemByPageAndNum.set(`${p.pageNumber}::${p.numberLabel}`, p);
  }

  const newUnits: UnitNode[] = [];
  const upsertProblemsList: Problem[] = [];
  let problemsCreated = 0;
  let problemsUpdated = 0;
  const now = Date.now();

  for (const row of rows) {
    const segments = row.path
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    let parentId: string | null = null;
    for (const seg of segments) {
      const key = `${parentId ?? 'ROOT'}::${seg}`;
      let node: UnitNode | undefined = unitMap.get(key);
      if (!node) {
        const parentKey: string = parentId ?? 'ROOT';
        const nextOrder: number = (siblingOrderMap.get(parentKey) ?? -1) + 1;
        siblingOrderMap.set(parentKey, nextOrder);
        node = {
          id: createId(),
          workbookId,
          parentId,
          name: seg,
          order: nextOrder,
        };
        unitMap.set(key, node);
        newUnits.push(node);
      }
      parentId = node.id;
    }

    const unitId = parentId;
    const match =
      problemByUnitAndNum.get(`${unitId ?? 'NONE'}::${row.problemNumber}`) ??
      problemByPageAndNum.get(`${row.page}::${row.problemNumber}`);

    if (match) {
      const updated: Problem = {
        ...match,
        unitId,
        pageNumber: row.page,
        compactAnswer: row.answer || match.compactAnswer,
        hints: row.hints.length > 0 ? row.hints : match.hints,
        updatedAt: now,
      };
      upsertProblemsList.push(updated);
      problemByUnitAndNum.set(`${unitId ?? 'NONE'}::${row.problemNumber}`, updated);
      problemByPageAndNum.set(`${row.page}::${row.problemNumber}`, updated);
      problemsUpdated++;
    } else {
      maxProblemOrder += 1;
      const created: Problem = {
        id: createId(),
        workbookId,
        unitId,
        numberLabel: row.problemNumber,
        pageNumber: row.page,
        order: maxProblemOrder,
        status: 'none',
        missReasons: [],
        missHistory: [],
        hints: row.hints,
        compactAnswer: row.answer,
        memo: '',
        updatedAt: now,
      };
      upsertProblemsList.push(created);
      problemByUnitAndNum.set(`${unitId ?? 'NONE'}::${row.problemNumber}`, created);
      problemByPageAndNum.set(`${row.page}::${row.problemNumber}`, created);
      problemsCreated++;
    }
  }

  await db.transaction('rw', [db.unitNodes, db.problems, db.workbooks], async () => {
    if (newUnits.length > 0) {
      await db.unitNodes.bulkPut(newUnits);
    }
    if (upsertProblemsList.length > 0) {
      await db.problems.bulkPut(upsertProblemsList);
    }
    await db.workbooks.update(workbookId, { updatedAt: now });
  });

  return {
    totalRows: rows.length,
    unitsCreated: newUnits.length,
    problemsCreated,
    problemsUpdated,
  };
}

export interface BackupPayload {
  version: 1;
  exportedAt: number;
  workbooks: Array<Omit<Workbook, 'pdfBlob' | 'coverDataUrl'>>;
  pageStates: PageState[];
  unitNodes: UnitNode[];
  problems: Problem[];
  pageStrokes: PageStrokes[];
}

export async function exportBackupJson(): Promise<string> {
  const [workbooks, pageStates, unitNodes, problems, pageStrokes] = await Promise.all([
    db.workbooks.toArray(),
    db.pageStates.toArray(),
    db.unitNodes.toArray(),
    db.problems.toArray(),
    db.pageStrokes.toArray(),
  ]);

  const payload: BackupPayload = {
    version: 1,
    exportedAt: Date.now(),
    workbooks: workbooks.map(({ pdfBlob: _blob, coverDataUrl: _cover, ...rest }) => rest),
    pageStates,
    unitNodes,
    problems,
    pageStrokes,
  };

  return JSON.stringify(payload, null, 2);
}

export async function importBackupJson(jsonText: string): Promise<{
  restoredWorkbooks: number;
  restoredStates: number;
  restoredProblems: number;
  restoredStrokes: number;
}> {
  const parsed = JSON.parse(jsonText) as Partial<BackupPayload>;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.workbooks)) {
    throw new Error('バックアップJSONの形式が正しくありません。');
  }

  const existingWorkbooks = await db.workbooks.toArray();
  const idMap = new Map<string, string>();
  let restoredWorkbooks = 0;

  for (const bWb of parsed.workbooks) {
    const byId = existingWorkbooks.find((w) => w.id === bWb.id);
    const byTitle = existingWorkbooks.find((w) => w.title === bWb.title);
    const target = byId ?? byTitle;
    if (target) {
      idMap.set(bWb.id, target.id);
      await db.workbooks.update(target.id, {
        bindingDirection: bWb.bindingDirection,
        defaultSpread: bWb.defaultSpread,
        coverSinglePage: bWb.coverSinglePage,
        geminiChatUrl: bWb.geminiChatUrl,
        layers: Array.from(new Set([...target.layers, ...(bWb.layers ?? [])])),
        customReasons: Array.from(new Set([...target.customReasons, ...(bWb.customReasons ?? [])])),
        lastPage: bWb.lastPage,
      });
      restoredWorkbooks++;
    }
  }

  const statesToPut: PageState[] = (parsed.pageStates ?? [])
    .filter((s) => idMap.has(s.workbookId))
    .map((s) => {
      const wbId = idMap.get(s.workbookId)!;
      return { ...s, workbookId: wbId, id: `${wbId}:${s.pageNumber}` };
    });

  const unitsToPut: UnitNode[] = (parsed.unitNodes ?? [])
    .filter((u) => idMap.has(u.workbookId))
    .map((u) => ({ ...u, workbookId: idMap.get(u.workbookId)! }));

  const problemsToPut: Problem[] = (parsed.problems ?? [])
    .filter((p) => idMap.has(p.workbookId))
    .map((p) => ({ ...p, workbookId: idMap.get(p.workbookId)! }));

  const strokesToPut: PageStrokes[] = (parsed.pageStrokes ?? [])
    .filter((st) => idMap.has(st.workbookId))
    .map((st) => {
      const wbId = idMap.get(st.workbookId)!;
      return { ...st, workbookId: wbId, id: `${wbId}:${st.pageNumber}:${st.layerName}` };
    });

  await db.transaction(
    'rw',
    [db.pageStates, db.unitNodes, db.problems, db.pageStrokes],
    async () => {
      if (statesToPut.length) await db.pageStates.bulkPut(statesToPut);
      if (unitsToPut.length) await db.unitNodes.bulkPut(unitsToPut);
      if (problemsToPut.length) await db.problems.bulkPut(problemsToPut);
      if (strokesToPut.length) await db.pageStrokes.bulkPut(strokesToPut);
    },
  );

  return {
    restoredWorkbooks,
    restoredStates: statesToPut.length,
    restoredProblems: problemsToPut.length,
    restoredStrokes: strokesToPut.length,
  };
}
