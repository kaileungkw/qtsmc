import type {
  Analysis,
  AnswerOverrides,
  AnswerValue,
  QuestionOptionStat,
  QuestionStat,
  SheetOverrides,
  SheetRecord,
  StudentResult,
  Summary,
} from '../types';
import { OPTIONS, ROWS_PER_BLOCK } from './marker';

export const MAX_QUESTIONS = 60;

/** HK convention: S4–S6 pass at 40%, S1–S3 at 50%. */
export function suggestPassMark(sheets: SheetRecord[]): number | undefined {
  const counts = new Map<number, number>();
  const consider = (sheet: SheetRecord) => {
    const match = sheet.className.trim().match(/^(?:S)?([1-6])/i);
    const level = match ? Number(match[1]) : sheet.detection?.header?.level;
    if (!level || level < 1 || level > 6) return;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  };
  for (const sheet of sheets) if (!sheet.isKey) consider(sheet);
  if (counts.size === 0) for (const sheet of sheets) consider(sheet);
  if (counts.size === 0) return undefined;
  const level = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  )[0][0];
  return level >= 4 ? 40 : 50;
}

export function getSheetAnswers(
  sheet: SheetRecord | undefined,
  overrides?: SheetOverrides,
): Record<number, AnswerValue> {
  const answers: Record<number, AnswerValue> = {};
  if (!sheet?.detection?.ok) return answers;
  for (const row of sheet.detection.rows) {
    answers[row.q] = row.answer;
  }
  if (overrides) {
    for (const [q, value] of Object.entries(overrides.answers)) {
      answers[Number(q)] = value;
    }
  }
  return answers;
}

export function getKeyAnswers(
  keySheet: SheetRecord | undefined,
  keyOverrides: AnswerOverrides,
): Record<number, AnswerValue> {
  const answers = getSheetAnswers(keySheet);
  for (const [q, value] of Object.entries(keyOverrides)) {
    answers[Number(q)] = value;
  }
  return answers;
}

/** Last question that has a real mark; trailing blanks on the form are unused. */
export function suggestQuestionCount(
  keyAnswers: Record<number, AnswerValue>,
): number {
  let last = 0;
  for (let q = 1; q <= MAX_QUESTIONS; q++) {
    const answer = keyAnswers[q];
    // A stray 'multi' beyond the real last question is usually a print/scan
    // artefact; only a resolved A-D answer extends the paper.
    if (answer === 'A' || answer === 'B' || answer === 'C' || answer === 'D') {
      last = q;
    }
  }
  return Math.max(0, last);
}


/**
 * The key sheet is authoritative, but faint show-through on the back of a scan
 * can look like an answered Q50. Low-confidence rows are ignored for the
 * purpose of deciding where the real paper ends; explicit teacher edits count.
 */
export function suggestQuestionCountFromKey(
  keySheet: SheetRecord | undefined,
  keyAnswers: Record<number, AnswerValue>,
  keyOverrides: AnswerOverrides,
): number {
  if (!keySheet?.detection?.ok) return 0;
  const rows = new Map(keySheet.detection.rows.map((row) => [row.q, row]));
  let last = 0;
  for (let q = 1; q <= MAX_QUESTIONS; q++) {
    const answer = keyAnswers[q];
    if (answer !== 'A' && answer !== 'B' && answer !== 'C' && answer !== 'D') continue;
    if (keyOverrides[q] !== undefined) {
      last = q;
      continue;
    }
    const row = rows.get(q);
    if (!row || row.status === 'ok') last = q;
  }
  return last;
}

/**
 * Decide the paper length from the key plus the class. A question only extends
 * the paper if it is answered confidently on the key, or by a meaningful share
 * of the class. This protects against scanner show-through and stray marks.
 */
export function suggestQuestionCountFromClass(
  sheets: SheetRecord[],
  overrides: Record<string, SheetOverrides>,
  keySheet: SheetRecord | undefined,
  keyAnswers: Record<number, AnswerValue>,
  keyOverrides: AnswerOverrides,
): number {
  const detected = sheets.filter((sheet) => sheet.detection?.ok);
  const keyLast = suggestQuestionCountFromKey(keySheet, keyAnswers, keyOverrides);
  if (detected.length <= 1) return keyLast;
  const classSheets = detected.filter((sheet) => sheet.id !== keySheet?.id);
  const threshold = Math.max(2, Math.ceil(classSheets.length * 0.2));
  const counts = new Array<number>(MAX_QUESTIONS + 1).fill(0);
  for (const sheet of classSheets) {
    const answers = getSheetAnswers(sheet, overrides[sheet.id]);
    const rows = new Map(sheet.detection!.rows.map((row) => [row.q, row]));
    for (let q = 1; q <= MAX_QUESTIONS; q++) {
      const answer = answers[q];
      if (answer !== 'A' && answer !== 'B' && answer !== 'C' && answer !== 'D') continue;
      const override = overrides[sheet.id]?.answers?.[q];
      const row = rows.get(q);
      if (override !== undefined || !row || row.status === 'ok') counts[q]++;
    }
  }
  let classLast = 0;
  for (let q = 1; q <= MAX_QUESTIONS; q++) {
    if (counts[q] >= threshold) classLast = q;
  }
  if (classLast === 0) return keyLast;
  if (keyLast <= classLast) return classLast;
  // A key-only tail beyond the class consensus is almost always an artefact
  // (show-through, speckle). Require at least two other sheets to back it up.
  let backed = 0;
  for (const sheet of detected) {
    if (sheet.id === keySheet?.id) continue;
    const answers = getSheetAnswers(sheet, overrides[sheet.id]);
    const rows = new Map(sheet.detection!.rows.map((row) => [row.q, row]));
    for (let q = classLast + 1; q <= keyLast; q++) {
      const answer = answers[q];
      if (answer !== 'A' && answer !== 'B' && answer !== 'C' && answer !== 'D') continue;
      const override = overrides[sheet.id]?.answers?.[q];
      const row = rows.get(q);
      if (override !== undefined || !row || row.status === 'ok') {
        backed++;
        break;
      }
    }
  }
  return backed >= 2 ? keyLast : classLast;
}

export function detectedQuestionMax(sheet: SheetRecord | undefined): number {
  if (!sheet?.detection?.ok) return 0;
  return sheet.detection.frames.length * ROWS_PER_BLOCK;
}

export function countRowStatuses(
  sheet: SheetRecord,
  overrides: SheetOverrides | undefined,
  questionCount: number,
): { low: number; multi: number; blank: number } {
  let low = 0;
  let multi = 0;
  let blank = 0;
  const overridden = overrides?.answers ?? {};
  for (let q = 1; q <= questionCount; q++) {
    const answer = overridden[q];
    if (answer) {
      if (answer === 'blank') blank++;
      if (answer === 'multi') multi++;
      continue;
    }
    const row = sheet.detection?.rows.find((r) => r.q === q);
    if (!row) {
      blank++;
      continue;
    }
    if (row.status === 'low') low++;
    if (row.status === 'multi') multi++;
    if (row.answer === 'blank') blank++;
  }
  return { low, multi, blank };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptySummary(): Summary {
  return {
    includedCount: 0,
    average: 0,
    median: 0,
    highest: 0,
    lowest: 0,
    passRate: 0,
    stdDev: 0,
    distribution: Array.from({ length: 10 }, (_, i) => ({
      label: `${i * 10}–${i * 10 + 9}`,
      count: 0,
    })),
  };
}

function makeSummary(students: StudentResult[], passMark: number): Summary {
  if (students.length === 0) return emptySummary();
  const percents = students.map((s) => s.percent).sort((a, b) => a - b);
  const mean = percents.reduce((sum, v) => sum + v, 0) / percents.length;
  const mid = Math.floor(percents.length / 2);
  const median =
    percents.length % 2 === 0
      ? (percents[mid - 1] + percents[mid]) / 2
      : percents[mid];
  const variance =
    percents.reduce((sum, v) => sum + (v - mean) ** 2, 0) / percents.length;
  const distribution = Array.from({ length: 10 }, (_, i) => ({
    label: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }));
  for (const s of students) {
    const idx = Math.min(9, Math.max(0, Math.floor(s.percent / 10)));
    distribution[idx].count++;
  }
  return {
    includedCount: students.length,
    average: round1(mean),
    median: round1(median),
    highest: round1(percents[percents.length - 1]),
    lowest: round1(percents[0]),
    passRate: round1(
      (students.filter((s) => s.percent >= passMark).length / students.length) * 100,
    ),
    stdDev: round1(Math.sqrt(variance)),
    distribution,
  };
}

export function analyseResults(
  sheets: SheetRecord[],
  questionCount: number,
  passMark: number,
  includeKey: boolean,
  overrides: Record<string, SheetOverrides>,
  keyOverrides: AnswerOverrides,
): Analysis {
  const keySheet = sheets.find((s) => s.isKey) ?? sheets[0];
  const keyAnswers = getKeyAnswers(keySheet, keyOverrides);
  const students: StudentResult[] = [];
  for (const sheet of sheets) {
    if (!sheet.detection?.ok) continue;
    const answers = getSheetAnswers(sheet, overrides[sheet.id]);
    const correct: Record<number, boolean> = {};
    const multiChoices: Record<number, string> = {};
    let score = 0;
    let blankCount = 0;
    let multiCount = 0;
    let lowCount = 0;
    for (let q = 1; q <= questionCount; q++) {
      const value = answers[q] ?? 'blank';
      const key = keyAnswers[q];
      const row = sheet.detection.rows.find((r) => r.q === q);
      if (value === 'multi' && row) {
        const label = multiChoiceLabel(row.scores);
        if (label) multiChoices[q] = label;
      }
      const isCorrect = Boolean(key && key !== 'blank' && key !== 'multi' && value === key);
      correct[q] = isCorrect;
      if (sheet.isKey) {
        // The first/selected sheet defines the key and therefore full marks.
        if (key && key !== 'blank' && key !== 'multi') score++;
      } else if (isCorrect) {
        score++;
      }
      if (value === 'blank') blankCount++;
      if (value === 'multi') multiCount++;
      const override = overrides[sheet.id]?.answers?.[q];
      if (!override && row?.status === 'low') lowCount++;
    }
    const total = Math.max(1, questionCount);
    const percent = round1((score / total) * 100);
    students.push({
      id: sheet.id,
      name: sheet.name,
      className: sheet.className,
      seatNo: sheet.seatNo,
      candidateNo: sheet.candidateNo,
      isKey: sheet.isKey,
      answers,
      correct,
      score: sheet.isKey ? questionCount : score,
      total: questionCount,
      percent: sheet.isKey ? 100 : percent,
      blankCount,
      multiCount,
      lowCount,
      multiChoices,
      needsReview: !sheet.isKey && (lowCount > 0 || multiCount > 0),
      suggested: sheet.suggested,
    });
  }

  const included = students.filter((s) => includeKey || !s.isKey);
  const questions: QuestionStat[] = [];
  for (let q = 1; q <= questionCount; q++) {
    const key = keyAnswers[q] ?? 'blank';
    const keyValid = key === 'A' || key === 'B' || key === 'C' || key === 'D';
    const counts: Record<'A' | 'B' | 'C' | 'D' | 'blank' | 'multi', number> = {
      A: 0,
      B: 0,
      C: 0,
      D: 0,
      blank: 0,
      multi: 0,
    };
    let correctCount = 0;
    let answeredCount = 0;
    for (const student of included) {
      const value = student.answers[q] ?? 'blank';
      counts[value]++;
      if (value === 'A' || value === 'B' || value === 'C' || value === 'D') {
        answeredCount++;
      }
      if (keyValid && value === key) correctCount++;
    }
    const denom = Math.max(1, included.length);
    const options = {} as Record<'A' | 'B' | 'C' | 'D' | 'blank' | 'multi', QuestionOptionStat>;
    for (const keyName of [...OPTIONS, 'blank', 'multi'] as const) {
      options[keyName] = {
        count: counts[keyName],
        percent: round1((counts[keyName] / denom) * 100),
      };
    }
    questions.push({
      q,
      key,
      keyValid,
      correctCount,
      correctPercent: round1((correctCount / denom) * 100),
      answeredCount,
      options,
      flagged: !keyValid,
    });
  }

  return {
    students,
    included,
    questions,
    summary: makeSummary(included, passMark),
  };
}

export function shortAnswer(value: AnswerValue | undefined): string {
  if (!value) return 'blank';
  return value;
}

/** The options that count as marked when a row is detected as multi. */
export function selectedMultiOptions(
  scores: Record<'A' | 'B' | 'C' | 'D', number>,
): (typeof OPTIONS)[number][] {
  const top = Math.max(scores.A, scores.B, scores.C, scores.D);
  const floor = Math.max(0.21, top * 0.5);
  return OPTIONS.filter((option) => scores[option] >= floor);
}

/** The marked options of a detected multi answer, in A-D order. */
export function multiChoiceLabel(
  scores: Record<'A' | 'B' | 'C' | 'D', number>,
): string | undefined {
  const selected = selectedMultiOptions(scores);
  return selected.length >= 2 ? selected.join(', ') : undefined;
}

/** Human-readable per-question answer: blank, A-D, or "B, C" for multi. */
export function displayAnswer(
  value: AnswerValue | undefined,
  multiChoice?: string,
): string {
  if (value === 'multi' && multiChoice) return multiChoice;
  return shortAnswer(value);
}

/** Compact answer label for the webpage (exports keep blank/multi tokens). */
export function uiAnswerLabel(
  value: AnswerValue | undefined,
  multiChoice?: string,
): string {
  if (!value || value === 'blank') return '—';
  if (value === 'multi') return multiChoice || '多選';
  return value;
}
