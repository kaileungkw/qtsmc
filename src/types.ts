export type AnswerValue = 'A' | 'B' | 'C' | 'D' | 'blank' | 'multi';
export type RowStatus = 'ok' | 'low' | 'blank' | 'multi';

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CellMark {
  option: 'A' | 'B' | 'C' | 'D';
  cx: number;
  cy: number;
  ink: number;
}

export interface DetectedRow {
  q: number;
  block: number;
  answer: AnswerValue;
  status: RowStatus;
  confidence: number;
  scores: Record<'A' | 'B' | 'C' | 'D', number>;
  cells: CellMark[];
}

export interface HeaderInfo {
  level?: number;
  classLetter?: string;
  classNo?: string;
  className?: string;
  seatNo?: string;
  candidateNo?: string;
  confidence: number;
}

/**
 * Where the three answer blocks sit on the sheets of one batch, measured from
 * the sheets that show the normal layout (see buildLayoutGuide).
 */
export interface LayoutGuide {
  /** One box per answer block, in pixels measured from the page centre. */
  frames: Frame[];
  rotation: 0 | 90 | 180 | 270;
  /** Sheets that were measured to build it. */
  pages: number;
}

export interface Detection {
  ok: boolean;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  frames: Frame[];
  rows: DetectedRow[];
  warnings: string[];
  header?: HeaderInfo;
  /**
   * The sheet's own frame detection found a block twice or not at all, and the
   * blocks were placed from the other sheets of the batch. Needs review.
   */
  realigned?: boolean;
  /**
   * The three answer blocks could not be confirmed on this sheet. After the
   * cross-check with the batch they still do not sit where the other sheets
   * have them (too few, unevenly spaced, or off in place or size), or there
   * were too few sheets to compare with and the sheet itself does not show
   * three blocks. The answers may have been read from the wrong place.
   * Needs review.
   */
  layoutMismatch?: boolean;
  elapsedMs: number;
}

export interface TaskMeta {
  id: string;
  title: string;
  subject: string;
  formLevel: string;
  sheetCount: number;
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

export type SheetStatus = 'idle' | 'processing' | 'done' | 'error';

export interface SuggestedFields {
  className?: boolean;
  seatNo?: boolean;
  name?: boolean;
}

export type NameSource = 'default' | 'roster' | 'manual' | 'suggested';

export interface SheetRecord {
  id: string;
  fileName: string;
  name: string;
  className: string;
  seatNo: string;
  /** Maths lesson group (from the roster Group column). */
  group?: string;
  /** English lesson group (from the roster EngGroup column). */
  groupEng?: string;
  candidateNo?: string;
  isKey: boolean;
  status: SheetStatus;
  detection?: Detection;
  error?: string;
  addedAt: number;
  nameSource?: NameSource;
  suggested?: SuggestedFields;
  /** Teacher pressed 完成覆核 for this sheet. */
  reviewed?: boolean;
}

export interface RuntimeSheet extends SheetRecord {
  blob: Blob;
  previewUrl: string;
}

export interface Settings {
  title: string;
  subject: string;
  className: string;
  /** S1–S6 (empty = not selected). */
  formLevel: string;
  /** Add per-class breakdown/sheets when the task spans multiple classes. */
  splitByClass: boolean;
  date: string;
  passMark: number;
  /** Auto: S4–S6 = 40%, S1–S3 = 50%. */
  passMarkAuto: boolean;
  includeKey: boolean;
  marksPerQuestion: number;
  questionCount: number;
  autoQuestionCount: boolean;
}

export type AnswerOverrides = Record<number, AnswerValue>;

export interface SheetOverrides {
  answers: AnswerOverrides;
  name?: string;
  className?: string;
  seatNo?: string;
}

export interface QuestionOptionStat {
  count: number;
  percent: number;
}

export interface QuestionStat {
  q: number;
  key: AnswerValue;
  keyValid: boolean;
  correctCount: number;
  correctPercent: number;
  answeredCount: number;
  options: Record<'A' | 'B' | 'C' | 'D' | 'blank' | 'multi', QuestionOptionStat>;
  flagged: boolean;
}

export interface StudentResult {
  id: string;
  name: string;
  className: string;
  seatNo: string;
  /** Maths lesson group, e.g. 1A1 / 4AB2 / 6CD1. */
  group?: string;
  /** English lesson group, e.g. 1AB1 / 4CD2 / 6AB1. */
  groupEng?: string;
  candidateNo?: string;
  isKey: boolean;
  answers: Record<number, AnswerValue>;
  correct: Record<number, boolean>;
  score: number;
  total: number;
  percent: number;
  blankCount: number;
  multiCount: number;
  lowCount: number;
  /** For detected multi answers: the selected options, e.g. "B, C". */
  multiChoices?: Record<number, string>;
  needsReview: boolean;
  /** The teacher pressed 完成覆核 for this sheet. */
  reviewed: boolean;
  /** The answer blocks were placed from the other sheets of the batch. */
  realigned: boolean;
  /** The answer blocks still do not match the other sheets of the batch. */
  layoutMismatch: boolean;
  suggested?: SuggestedFields;
}

export interface Summary {
  includedCount: number;
  average: number;
  median: number;
  highest: number;
  lowest: number;
  passRate: number;
  stdDev: number;
  distribution: { label: string; count: number }[];
}

export interface Analysis {
  students: StudentResult[];
  included: StudentResult[];
  questions: QuestionStat[];
  summary: Summary;
}

export interface SourcePdf {
  name: string;
  blob: Blob;
}

export interface SavedSession {
  version: 1;
  savedAt: number;
  sheetMeta: SheetRecord[];
  settings: Settings;
  edits: Record<string, SheetOverrides>;
  keyOverrides: AnswerOverrides;
  files: Record<string, Blob>;
  /** Original PDF uploads, kept for the "all reports + PDF" export ZIP. */
  sourcePdfs?: SourcePdf[];
}
