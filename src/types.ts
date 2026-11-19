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

export interface Detection {
  ok: boolean;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  frames: Frame[];
  rows: DetectedRow[];
  warnings: string[];
  header?: HeaderInfo;
  elapsedMs: number;
}

export interface NamingEntry {
  seatNo?: string;
  name: string;
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
  isKey: boolean;
  status: SheetStatus;
  detection?: Detection;
  error?: string;
  addedAt: number;
  nameSource?: NameSource;
  suggested?: SuggestedFields;
}

export interface RuntimeSheet extends SheetRecord {
  blob: Blob;
  previewUrl: string;
}

export interface Settings {
  title: string;
  subject: string;
  className: string;
  date: string;
  passMark: number;
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
  isKey: boolean;
  answers: Record<number, AnswerValue>;
  correct: Record<number, boolean>;
  score: number;
  total: number;
  percent: number;
  blankCount: number;
  multiCount: number;
  lowCount: number;
  needsReview: boolean;
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

export interface SavedSession {
  version: 1;
  savedAt: number;
  sheetMeta: SheetRecord[];
  settings: Settings;
  edits: Record<string, SheetOverrides>;
  keyOverrides: AnswerOverrides;
  files: Record<string, Blob>;
}
