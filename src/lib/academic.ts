export interface AcademicPeriod {
  schoolYear: string;
  term: 'T1' | 'T2' | 'T3';
  prefix: string;
}

/** Format a local calendar day for the report date input. */
export function toDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateParts(value: string | number | Date | undefined): {
  year: number;
  month: number;
} {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      ) {
        return { year, month };
      }
    }
  } else if (value !== undefined) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** School year starts in September; terms are Sep–Dec, Jan–Apr and May–Aug. */
/** 中三選科表：12 月＝第一次，3–4 月＝第二次，6–7 月＝第三次。 */
export function surveyRoundLabel(
  value: string | number | Date | undefined,
): '第一次' | '第二次' | '第三次' {
  const { month } = dateParts(value);
  if (month === 12) return '第一次';
  if (month >= 3 && month <= 4) return '第二次';
  if (month >= 6 && month <= 7) return '第三次';
  // Fall back to the school term for dates just outside the survey windows
  // (e.g. a task created in November for the December survey).
  const term = academicPeriod(value).term;
  return term === 'T1' ? '第一次' : term === 'T2' ? '第二次' : '第三次';
}

export function academicPeriod(value: string | number | Date | undefined): AcademicPeriod {
  const { year, month } = dateParts(value);
  const startYear = month >= 9 ? year : year - 1;
  const schoolYear = `${String(startYear % 100).padStart(2, '0')}${String(
    (startYear + 1) % 100,
  ).padStart(2, '0')}`;
  const term = month >= 9 ? 'T1' : month <= 4 ? 'T2' : 'T3';
  return { schoolYear, term, prefix: `${schoolYear}_${term}` };
}
