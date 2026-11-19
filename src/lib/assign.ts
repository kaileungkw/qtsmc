import type { SheetRecord, SuggestedFields } from '../types';
import {
  findFreeRosterEntry,
  lookupRoster,
  type RosterData,
  type RosterEntry,
} from './roster';

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function inferredNameSource(sheet: SheetRecord): 'default' | 'manual' | 'roster' | 'suggested' {
  if (sheet.nameSource) return sheet.nameSource;
  return !sheet.name || sheet.name === baseName(sheet.fileName) ? 'default' : 'manual';
}

function canReplaceName(sheet: SheetRecord): boolean {
  return inferredNameSource(sheet) !== 'manual';
}

function padExamId(entry: RosterEntry): string {
  return String(entry.examId).padStart(4, '0');
}

function withSuggested(
  sheet: SheetRecord,
  patch: SuggestedFields,
): SuggestedFields {
  return { ...(sheet.suggested ?? {}), ...patch };
}

/**
 * Fill names from the whole-school roster and suggest missing class/seat values
 * from the order of the uploaded stack. Suggested values are flagged so the
 * teacher can see they are not read from the scan.
 */
export function applyRosterAndSuggestions<T extends SheetRecord>(
  sheets: T[],
  roster: RosterData | null,
): T[] {
  if (!roster) return sheets;
  const next = sheets.map((sheet) => ({
    ...sheet,
    suggested: sheet.suggested ? { ...sheet.suggested } : {},
  })) as T[];

  // 1) Known class + seat: fill the current roster name.
  for (const sheet of next) {
    if (!sheet.detection?.ok) continue;
    const header = sheet.detection.header;
    const cls = sheet.className || header?.className || '';
    const seat = sheet.seatNo || header?.seatNo || '';
    if (!cls && !seat) continue;
    const entry = lookupRoster(roster, cls, seat);
    if (!entry) continue;
    if (!sheet.className) {
      sheet.className = entry.class;
      sheet.suggested = withSuggested(sheet, { className: false });
    }
    if (!sheet.seatNo) {
      sheet.seatNo = padExamId(entry);
      sheet.suggested = withSuggested(sheet, { seatNo: false });
    }
    // If the seat itself was only suggested, let the suggestion pass below
    // decide; do not silently turn a guess into a confirmed roster match.
    if (sheet.suggested?.seatNo) continue;
    if (canReplaceName(sheet)) {
      sheet.name = entry.name;
      sheet.nameSource = 'roster';
      sheet.suggested = withSuggested(sheet, { name: false });
    }
  }

  // 2) Missing class/seat: use the neighbouring sheets in upload order.
  const used = new Set<number>();
  for (const sheet of next) {
    if (sheet.suggested?.seatNo) continue;
    const digits = String(sheet.seatNo ?? '').replace(/\D/g, '');
    if (digits.length >= 4) used.add(Number(digits.slice(-4)));
  }

  for (let i = 0; i < next.length; i++) {
    const sheet = next[i];
    if (sheet.isKey || !sheet.detection?.ok) continue;
    const classMissing = !sheet.className || sheet.suggested?.className === true;
    const seatMissing = !sheet.seatNo || sheet.suggested?.seatNo === true;
    if (!classMissing && !seatMissing) continue;

    const prev = [...next.slice(0, i)]
      .reverse()
      .find(
        (s) =>
          !s.isKey &&
          s.detection?.ok &&
          s.className &&
          s.seatNo &&
          !s.suggested?.className &&
          !s.suggested?.seatNo,
      );
    const after = next
      .slice(i + 1)
      .find(
        (s) =>
          !s.isKey &&
          s.detection?.ok &&
          s.className &&
          s.seatNo &&
          !s.suggested?.className &&
          !s.suggested?.seatNo,
      );

    let cls = !sheet.suggested?.className ? sheet.className : '';
    if (!cls) {
      if (prev && after && prev.className !== after.className) continue;
      cls = prev?.className || after?.className || '';
    }
    if (!cls) continue;

    const prevEntry =
      prev && prev.className === cls
        ? {
            seat: Number(String(prev.seatNo).replace(/\D/g, '').slice(-4)),
            nextSeat: Number(String(after?.seatNo ?? '').replace(/\D/g, '').slice(-4)),
          }
        : undefined;
    const afterEntry =
      after && after.className === cls
        ? Number(String(after.seatNo).replace(/\D/g, '').slice(-4))
        : undefined;

    let start: number | undefined;
    let direction: 1 | -1 = 1;
    let upperBound: number | undefined;
    if (prevEntry && Number.isFinite(prevEntry.seat)) {
      start = prevEntry.seat + 1;
      direction = 1;
      if (afterEntry && afterEntry > prevEntry.seat) upperBound = afterEntry - 1;
    } else if (afterEntry && Number.isFinite(afterEntry)) {
      start = afterEntry - 1;
      direction = -1;
    }
    if (!start || start <= 0) continue;

    const entry = findFreeRosterEntry(roster, cls, start, direction, used);
    if (!entry) continue;
    if (upperBound !== undefined && entry.examId > upperBound) continue;

    if (classMissing) {
      sheet.className = entry.class;
      sheet.suggested = withSuggested(sheet, { className: true });
    }
    sheet.seatNo = padExamId(entry);
    sheet.suggested = withSuggested(sheet, { seatNo: true });
    used.add(entry.examId);
    if (canReplaceName(sheet)) {
      sheet.name = entry.name;
      sheet.nameSource = 'suggested';
      sheet.suggested = withSuggested(sheet, { name: true });
    }
  }

  return next;
}
