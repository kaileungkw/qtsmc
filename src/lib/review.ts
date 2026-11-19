import type { SheetRecord, StudentResult } from '../types';

export type ScoreFilter =
  | 'all'
  | 'review'
  | 'blank'
  | 'multi'
  | 'headers'
  | 'suggested'
  | 'noname';

export interface FilterCounts {
  all: number;
  review: number;
  blank: number;
  multi: number;
  headers: number;
  suggested: number;
  noname: number;
}

export interface FilterContext {
  reviewed: Set<string>;
  headers: Set<string>;
}

export function isSuggestedStudent(student: StudentResult): boolean {
  const suggested = student.suggested;
  return Boolean(suggested?.className || suggested?.seatNo || suggested?.name);
}

export function isNamelessStudent(student: StudentResult): boolean {
  return !student.isKey && !student.name.trim();
}

/** A student still needs review until the teacher presses 完成覆核. */
export function needsReviewStudent(
  student: StudentResult,
  reviewed: boolean,
): boolean {
  return (
    !student.isKey &&
    !reviewed &&
    (student.lowCount > 0 || student.multiCount > 0 || student.blankCount > 0)
  );
}

/**
 * Students whose class/seat is missing, or duplicated within the same class.
 * Seats repeat across classes (4A18 and 4B18), so duplicates must be grouped
 * by class; grouping by seat alone would flag nearly every whole-level row.
 */
export function headerIssueIds(students: StudentResult[]): Set<string> {
  const issues = new Set<string>();
  const groups = new Map<string, StudentResult[]>();
  for (const student of students) {
    if (student.isKey) continue;
    const className = student.className.trim().toUpperCase();
    const seatNo = student.seatNo.trim();
    if (!className || !seatNo) {
      issues.add(student.id);
      continue;
    }
    const key = `${className}|${seatNo}`;
    const group = groups.get(key);
    if (group) group.push(student);
    else groups.set(key, [student]);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      for (const student of group) issues.add(student.id);
    }
  }
  return issues;
}

export function reviewedSheetIds(sheets: SheetRecord[]): Set<string> {
  return new Set(sheets.filter((sheet) => sheet.reviewed).map((sheet) => sheet.id));
}

export function buildFilterCounts(
  students: StudentResult[],
  sheets: SheetRecord[],
): FilterCounts {
  const reviewed = reviewedSheetIds(sheets);
  return {
    all: students.length,
    review: students.filter((student) =>
      needsReviewStudent(student, reviewed.has(student.id)),
    ).length,
    blank: students.filter((student) => !student.isKey && student.blankCount > 0)
      .length,
    multi: students.filter((student) => !student.isKey && student.multiCount > 0)
      .length,
    headers: headerIssueIds(students).size,
    suggested: students.filter(
      (student) => !student.isKey && isSuggestedStudent(student),
    ).length,
    noname: students.filter(isNamelessStudent).length,
  };
}

export function matchesScoreFilter(
  student: StudentResult,
  filter: ScoreFilter,
  context: FilterContext,
): boolean {
  if (filter === 'all') return true;
  if (student.isKey) return false;
  if (filter === 'review') {
    return needsReviewStudent(student, context.reviewed.has(student.id));
  }
  if (filter === 'blank') return student.blankCount > 0;
  if (filter === 'multi') return student.multiCount > 0;
  if (filter === 'headers') return context.headers.has(student.id);
  if (filter === 'suggested') return isSuggestedStudent(student);
  return isNamelessStudent(student);
}
