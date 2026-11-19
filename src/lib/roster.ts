/**
 * Whole-school student roster, read from the school's Google Sheet at runtime.
 *
 * The roster is deliberately NOT bundled into the repository or the static
 * build: teachers only upload their PDF, and the browser fetches the current
 * name list directly from the school sheet. A local cache makes it usable
 * offline after the first successful load.
 */
export interface RosterEntry {
  class: string;
  num: number;
  examId: number;
  name: string;
  chiName?: string;
  engName?: string;
}

export interface RosterData {
  entries: RosterEntry[];
  byExam: Map<number, RosterEntry>;
  byClassNum: Map<string, RosterEntry>;
  fetchedAt: number;
  fromCache: boolean;
  /** True when this roster was imported from a local Excel/CSV file. */
  custom?: boolean;
  label?: string;
}

const SHEET_ID = '1rSkCt53pqazOQlDJ1QMqfUxQwttBKWab';
const SHEET_NAME = 'Student_namelist';
const ROSTER_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
  SHEET_NAME,
)}`;
const CACHE_KEY = 'qtsmc-roster-v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface CachedRoster {
  fetchedAt: number;
  entries: RosterEntry[];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normaliseClass(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^S(?=\d)/, '');
}

function findIndex(header: string[], names: string[]): number {
  const normalised = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s_().-]+/g, ''),
  );
  for (const name of names) {
    const index = normalised.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

export function parseRosterRows(rows: string[][]): RosterEntry[] {
  if (rows.length < 2) return [];
  // Some exports have a title row above the real header. Find the first row
  // that looks like ExamID / Class / Num, otherwise use the first row.
  const headerIndex = rows.findIndex((row) => {
    const text = row.join('|').toLowerCase();
    return (
      text.includes('examid') &&
      text.includes('class') &&
      (text.includes('num') || text.includes('班號'))
    );
  });
  const startIndex = headerIndex >= 0 ? headerIndex : 0;
  const header = rows[startIndex];
  const examIndex = findIndex(header, [
    'examid',
    '考生號碼',
    'candidate',
    'candidateno',
    'studentno',
  ]);
  const classIndex = findIndex(header, ['class', '班別', 'classname']);
  const numIndex = findIndex(header, ['num', '班號', 'classno', 'seatno', 'no']);
  const chiIndex = findIndex(header, ['chiname', '中文姓名', 'name', '姓名']);
  const engIndex = findIndex(header, ['engname', 'englishname', 'english']);
  if (examIndex < 0 || classIndex < 0 || numIndex < 0) return [];
  const entries: RosterEntry[] = [];
  const seen = new Set<number>();
  for (const row of rows.slice(startIndex + 1)) {
    const examId = Number(String(row[examIndex] ?? '').replace(/\D/g, ''));
    const cls = normaliseClass(row[classIndex]);
    const num = Number(String(row[numIndex] ?? '').replace(/\D/g, ''));
    const chiName = chiIndex >= 0 ? String(row[chiIndex] ?? '').trim() : '';
    const engName = engIndex >= 0 ? String(row[engIndex] ?? '').trim() : '';
    const name = chiName || engName;
    if (!Number.isFinite(examId) || examId <= 0) continue;
    if (!/^[1-6][A-D]$/.test(cls)) continue;
    if (!Number.isFinite(num) || num <= 0) continue;
    if (!name) continue;
    if (seen.has(examId)) continue;
    seen.add(examId);
    entries.push({ class: cls, num, examId, name, chiName: chiName || undefined, engName: engName || undefined });
  }
  entries.sort(
    (a, b) =>
      a.class.localeCompare(b.class, 'en', { numeric: true }) ||
      a.num - b.num,
  );
  return entries;
}

export function parseRosterCsv(text: string): RosterEntry[] {
  return parseRosterRows(parseCsv(text.replace(/^\uFEFF/, '')));
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  const cell = value as {
    text?: unknown;
    result?: unknown;
    richText?: { text?: string }[];
    hyperlink?: unknown;
  };
  if (typeof cell.text === 'string') return cell.text;
  if (cell.result != null) return String(cell.result);
  if (Array.isArray(cell.richText)) {
    return cell.richText.map((part) => part.text ?? '').join('');
  }
  if (typeof cell.hyperlink === 'string') return cell.hyperlink;
  return '';
}

/** Parse the school roster from an uploaded .xlsx or .csv file. */
export async function parseRosterFile(file: File): Promise<RosterEntry[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || file.type.includes('csv')) {
    return parseRosterCsv(await file.text());
  }
  const ExcelJSmod = await import('exceljs');
  const ExcelJS = (ExcelJSmod as unknown as { default?: any }).default ?? ExcelJSmod;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  for (const worksheet of workbook.worksheets) {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row: { values: unknown[] }) => {
      const values = row.values as unknown[];
      const line: string[] = [];
      for (let i = 1; i < values.length; i++) line.push(cellText(values[i]));
      if (line.some((value) => value.trim())) rows.push(line);
    });
    const entries = parseRosterRows(rows);
    if (entries.length >= 10) return entries;
  }
  return [];
}

function buildRoster(
  entries: RosterEntry[],
  fetchedAt: number,
  fromCache: boolean,
  custom = false,
  label?: string,
): RosterData {
  const byExam = new Map<number, RosterEntry>();
  const byClassNum = new Map<string, RosterEntry>();
  for (const entry of entries) {
    byExam.set(entry.examId, entry);
    byClassNum.set(`${entry.class}|${entry.num}`, entry);
  }
  return { entries, byExam, byClassNum, fetchedAt, fromCache, custom, label };
}

const CUSTOM_KEY = 'qtsmc-roster-custom-v1';

interface CustomRoster {
  savedAt: number;
  entries: RosterEntry[];
  label?: string;
}

function readCustomRoster(): RosterData | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return null;
    const custom = JSON.parse(raw) as CustomRoster;
    if (!custom || !Array.isArray(custom.entries) || custom.entries.length < 10) {
      return null;
    }
    return buildRoster(custom.entries, custom.savedAt, false, true, custom.label);
  } catch {
    return null;
  }
}

/** Store a locally imported roster; it overrides the online sheet on this device. */
export function saveCustomRoster(entries: RosterEntry[], label?: string): RosterData {
  const savedAt = Date.now();
  try {
    localStorage.setItem(
      CUSTOM_KEY,
      JSON.stringify({ savedAt, entries, label } satisfies CustomRoster),
    );
  } catch {
    // Private mode/quota: keep it in memory for this session.
  }
  return buildRoster(entries, savedAt, false, true, label);
}

export function clearCustomRoster(): void {
  try {
    localStorage.removeItem(CUSTOM_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

function readCache(): RosterData | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedRoster;
    if (!cached || !Array.isArray(cached.entries) || cached.entries.length === 0) {
      return null;
    }
    if (Date.now() - cached.fetchedAt > CACHE_TTL) return null;
    return buildRoster(cached.entries, cached.fetchedAt, true);
  } catch {
    return null;
  }
}

function staleCache(): RosterData | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedRoster;
    if (!cached || !Array.isArray(cached.entries) || cached.entries.length === 0) {
      return null;
    }
    return buildRoster(cached.entries, cached.fetchedAt, true);
  } catch {
    return null;
  }
}

function writeCache(entries: RosterEntry[]): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), entries } satisfies CachedRoster),
    );
  } catch {
    // Quota or private mode: the roster still works for this session.
  }
}

export async function loadRoster(force = false): Promise<RosterData> {
  const custom = readCustomRoster();
  if (custom) return custom;
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }
  try {
    const response = await fetch(ROSTER_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const entries = parseRosterCsv(text);
    if (entries.length < 10) throw new Error('名單格式不正確或為空');
    writeCache(entries);
    return buildRoster(entries, Date.now(), false);
  } catch (error) {
    const cached = staleCache();
    if (cached) return cached;
    throw error;
  }
}

export function lookupRoster(
  roster: RosterData | null,
  className: string,
  seatNo: string,
): RosterEntry | undefined {
  if (!roster) return undefined;
  const cls = normaliseClass(className);
  const digits = String(seatNo ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.length >= 4) {
    const entry = roster.byExam.get(Number(digits.slice(-4)));
    if (entry) return entry;
  }
  if (cls) {
    const num = Number(digits.slice(-2));
    if (num > 0) return roster.byClassNum.get(`${cls}|${num}`);
  }
  return undefined;
}

export function findFreeRosterEntry(
  roster: RosterData | null,
  className: string,
  startExamId: number,
  direction: 1 | -1,
  usedExamIds: Set<number>,
): RosterEntry | undefined {
  if (!roster) return undefined;
  const cls = normaliseClass(className);
  const candidates = roster.entries.filter((entry) => entry.class === cls);
  if (!candidates.length) return undefined;
  const sorted = [...candidates].sort((a, b) => a.num - b.num);
  if (direction === 1) {
    return sorted.find((entry) => entry.examId >= startExamId && !usedExamIds.has(entry.examId));
  }
  return [...sorted]
    .reverse()
    .find((entry) => entry.examId <= startExamId && !usedExamIds.has(entry.examId));
}
