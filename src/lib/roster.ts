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
  /** Maths lesson group, e.g. 1A1 / 4AB2 / 6CD1. */
  group?: string;
  /** English lesson group, e.g. 1AB1 / 4CD2 / 6AB1. */
  groupEng?: string;
}

export interface RosterData {
  entries: RosterEntry[];
  byExam: Map<number, RosterEntry>;
  byClassNum: Map<string, RosterEntry>;
  fetchedAt: number;
  fromCache: boolean;
}

const SHEET_ID = '12APNkMHeqqj2B5T79BbumvKsm3ZB61YD';
const SHEET_NAME = 'Student_namelist';
const ROSTER_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
  SHEET_NAME,
)}`;
// Lesson groups live in a keyed helper tab. 核對 is the tab the teacher
// actually pasted into; Group/分組 are accepted if the helper is renamed later.
const GROUP_SHEET_NAMES = ['核對', 'Group', '分組', 'Grouping'];
const GROUP_URLS = GROUP_SHEET_NAMES.map(
  (name) =>
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
      name,
    )}`,
);
const CACHE_KEY = 'qtsmc-roster-v4';
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

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_().-]+/g, '');
}

function findIndex(header: string[], names: string[]): number {
  const normalised = header.map(normaliseHeader);
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
  // The school sheet carries the 2627 lesson groups in appended columns.
  const groupIndex = findIndex(header, ['mathgroup', '數學分組', 'group', '分組']);
  const groupEngIndex = findIndex(header, ['enggroup', 'englishgroup', '英文分組']);
  if (examIndex < 0 || classIndex < 0 || numIndex < 0) return [];
  const entries: RosterEntry[] = [];
  const seen = new Set<number>();
  for (const row of rows.slice(startIndex + 1)) {
    const examId = Number(String(row[examIndex] ?? '').replace(/\D/g, ''));
    const cls = normaliseClass(row[classIndex]);
    const num = Number(String(row[numIndex] ?? '').replace(/\D/g, ''));
    const chiName = chiIndex >= 0 ? String(row[chiIndex] ?? '').trim() : '';
    const engName = engIndex >= 0 ? String(row[engIndex] ?? '').trim() : '';
    const rawGroup = groupIndex >= 0 ? String(row[groupIndex] ?? '').trim() : '';
    const group = rawGroup && rawGroup !== '#N/A' ? rawGroup : undefined;
    const rawGroupEng = groupEngIndex >= 0 ? String(row[groupEngIndex] ?? '').trim() : '';
    const groupEng = rawGroupEng && rawGroupEng !== '#N/A' ? rawGroupEng : undefined;
    const name = chiName || engName;
    if (!Number.isFinite(examId) || examId <= 0) continue;
    if (!/^[1-6][A-D]$/.test(cls)) continue;
    if (!Number.isFinite(num) || num <= 0) continue;
    if (!name) continue;
    if (seen.has(examId)) continue;
    seen.add(examId);
    entries.push({
      class: cls,
      num,
      examId,
      name,
      chiName: chiName || undefined,
      engName: engName || undefined,
      group,
      groupEng,
    });
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

interface GroupRow {
  examId?: number;
  class?: string;
  num?: number;
  group?: string;
  groupEng?: string;
}

function cleanGroup(value: unknown): string | undefined {
  const text = String(value ?? '').replace(/\u00a0/g, ' ').trim();
  return text && text !== '#N/A' && text !== '未分組' ? text : undefined;
}

/**
 * Parse a keyed grouping tab such as 核對:
 * ExamID / Class / Num / 姓名 / Group / EngGroup.
 */
export function parseGroupRows(rows: string[][]): GroupRow[] {
  if (rows.length < 2) return [];
  const headerIndex = rows.findIndex((row) => {
    const header = row.map(normaliseHeader);
    const hasKey =
      header.includes('examid') ||
      (header.includes('class') &&
        (header.includes('num') || header.includes('班號')));
    const hasGroup =
      header.includes('group') ||
      header.includes('mathgroup') ||
      header.includes('enggroup') ||
      header.includes('分組') ||
      header.includes('數學分組') ||
      header.includes('英文分組');
    return hasKey && hasGroup;
  });
  if (headerIndex < 0) return [];
  const header = rows[headerIndex];
  const examIndex = findIndex(header, [
    'examid',
    '考生號碼',
    'candidate',
    'candidateno',
    'studentno',
  ]);
  const classIndex = findIndex(header, ['class', '班別', 'classname']);
  const numIndex = findIndex(header, ['num', '班號', 'classno', 'seatno', 'no']);
  const groupIndex = findIndex(header, ['mathgroup', '數學分組', 'group', '分組']);
  const groupEngIndex = findIndex(header, ['enggroup', 'englishgroup', '英文分組']);
  if (groupIndex < 0 && groupEngIndex < 0) return [];
  if (examIndex < 0 && (classIndex < 0 || numIndex < 0)) return [];

  const result: GroupRow[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const examId = examIndex >= 0 ? Number(String(row[examIndex] ?? '').replace(/\D/g, '')) : NaN;
    const cls = classIndex >= 0 ? normaliseClass(row[classIndex]) : '';
    const num = numIndex >= 0 ? Number(String(row[numIndex] ?? '').replace(/\D/g, '')) : NaN;
    const group = groupIndex >= 0 ? cleanGroup(row[groupIndex]) : undefined;
    const groupEng = groupEngIndex >= 0 ? cleanGroup(row[groupEngIndex]) : undefined;
    if (!group && !groupEng) continue;
    if (!Number.isFinite(examId) && (!/^[1-6][A-D]$/.test(cls) || !Number.isFinite(num))) {
      continue;
    }
    result.push({
      examId: Number.isFinite(examId) && examId > 0 ? examId : undefined,
      class: /^[1-6][A-D]$/.test(cls) ? cls : undefined,
      num: Number.isFinite(num) && num > 0 ? num : undefined,
      group,
      groupEng,
    });
  }
  return result;
}

function applyGroupRows(entries: RosterEntry[], rows: GroupRow[]): boolean {
  if (!rows.length) return false;
  const byExam = new Map<number, RosterEntry>();
  const byClassNum = new Map<string, RosterEntry>();
  for (const entry of entries) {
    byExam.set(entry.examId, entry);
    byClassNum.set(`${entry.class}|${entry.num}`, entry);
  }
  let applied = false;
  for (const row of rows) {
    const entry =
      (row.examId ? byExam.get(row.examId) : undefined) ??
      (row.class && row.num ? byClassNum.get(`${row.class}|${row.num}`) : undefined);
    if (!entry) continue;
    if (row.group && entry.group !== row.group) {
      entry.group = row.group;
      applied = true;
    }
    if (row.groupEng && entry.groupEng !== row.groupEng) {
      entry.groupEng = row.groupEng;
      applied = true;
    }
  }
  return applied;
}

async function fetchGroupRows(): Promise<GroupRow[]> {
  for (const url of GROUP_URLS) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) continue;
      const text = await response.text();
      const rows = parseGroupRows(parseCsv(text.replace(/^\uFEFF/, '')));
      if (rows.length >= 10) return rows;
    } catch {
      // Try the next candidate tab name.
    }
  }
  return [];
}

function buildRoster(entries: RosterEntry[], fetchedAt: number, fromCache: boolean): RosterData {
  const byExam = new Map<number, RosterEntry>();
  const byClassNum = new Map<string, RosterEntry>();
  for (const entry of entries) {
    byExam.set(entry.examId, entry);
    byClassNum.set(`${entry.class}|${entry.num}`, entry);
  }
  return { entries, byExam, byClassNum, fetchedAt, fromCache };
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
    // Names are cached for a day; lesson groups are refreshed on every load
    // (see loadRoster) so a corrected Group/EngGroup appears on reload.
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

function writeCache(entries: RosterEntry[], fetchedAt = Date.now()): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ fetchedAt, entries } satisfies CachedRoster),
    );
  } catch {
    // Quota or private mode: the roster still works for this session.
  }
}

export async function loadRoster(force = false): Promise<RosterData> {
  // Remove the short-lived local roster import from v2.10.0; the school sheet
  // is now the single source of truth again.
  try {
    localStorage.removeItem('qtsmc-roster-custom-v1');
    // v2/v3 caches predate the Group and EngGroup columns.
    localStorage.removeItem('qtsmc-roster-v2');
    localStorage.removeItem('qtsmc-roster-v3');
  } catch {
    // Ignore storage restrictions.
  }

  let entries: RosterEntry[] | null = null;
  let fetchedAt = Date.now();
  let fromCache = false;
  if (!force) {
    const cached = readCache();
    if (cached) {
      entries = cached.entries;
      fetchedAt = cached.fetchedAt;
      fromCache = true;
    }
  }
  if (!entries) {
    try {
      const response = await fetch(ROSTER_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      entries = parseRosterCsv(text);
      if (entries.length < 10) throw new Error('名單格式不正確或為空');
      fetchedAt = Date.now();
    } catch (error) {
      const cached = staleCache();
      if (!cached) throw error;
      entries = cached.entries;
      fetchedAt = cached.fetchedAt;
      fromCache = true;
    }
  }

  // Lesson groups change more often than names. Fetch them on every load so a
  // newly pasted or corrected Group/EngGroup is visible on the next reload; a
  // failure leaves the last known values in place.
  const groupRows = await fetchGroupRows();
  if (groupRows.length) {
    const changed = applyGroupRows(entries, groupRows);
    if (changed || !fromCache) writeCache(entries, fetchedAt);
  }
  return buildRoster(entries, fetchedAt, fromCache);
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
