import type { Analysis, Settings, StudentResult, Summary } from '../types';

export interface ClassQuestionResult {
  q: number;
  keyValid: boolean;
  correctCount: number;
  correctPercent: number;
}

export interface ClassStat {
  name: string;
  students: StudentResult[];
  count: number;
  summary: Summary;
  questions: ClassQuestionResult[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function summarise(students: StudentResult[], passMark: number): Summary {
  const distribution = Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}–${index * 10 + 9}`,
    count: 0,
  }));
  if (students.length === 0) {
    return {
      includedCount: 0,
      average: 0,
      median: 0,
      highest: 0,
      lowest: 0,
      passRate: 0,
      stdDev: 0,
      distribution,
    };
  }
  const percents = students.map((student) => student.percent).sort((a, b) => a - b);
  const mean = percents.reduce((sum, value) => sum + value, 0) / percents.length;
  const mid = Math.floor(percents.length / 2);
  const median =
    percents.length % 2 === 0
      ? (percents[mid - 1] + percents[mid]) / 2
      : percents[mid];
  const variance =
    percents.reduce((sum, value) => sum + (value - mean) ** 2, 0) / percents.length;
  for (const student of students) {
    const index = Math.min(9, Math.max(0, Math.floor(student.percent / 10)));
    distribution[index].count++;
  }
  return {
    includedCount: students.length,
    average: round1(mean),
    median: round1(median),
    highest: round1(percents[percents.length - 1]),
    lowest: round1(percents[0]),
    passRate: round1(
      (students.filter((student) => student.percent >= passMark).length / students.length) * 100,
    ),
    stdDev: round1(Math.sqrt(variance)),
    distribution,
  };
}

export const UNGROUPED = '未分組';

function buildStat(
  name: string,
  students: StudentResult[],
  analysis: Analysis,
  settings: Settings,
): ClassStat {
  return {
    name,
    students,
    count: students.length,
    summary: summarise(students, settings.passMark),
    questions: analysis.questions.map((question) => {
      const correctCount = question.keyValid
        ? students.filter((student) => student.answers[question.q] === question.key).length
        : 0;
      return {
        q: question.q,
        keyValid: question.keyValid,
        correctCount,
        correctPercent: round1((correctCount / Math.max(1, students.length)) * 100),
      };
    }),
  };
}

export function buildClassStats(analysis: Analysis, settings: Settings): ClassStat[] {
  const groups = new Map<string, StudentResult[]>();
  for (const student of analysis.included) {
    if (student.isKey) continue;
    const name = student.className.trim();
    if (!name) continue;
    const list = groups.get(name) ?? [];
    list.push(student);
    groups.set(name, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'zh-HK', { numeric: true }))
    .map(([name, students]) => buildStat(name, students, analysis, settings));
}

/**
 * Maths lesson groups. Students whose roster row has no Group value are kept
 * in a visible 未分組 bucket instead of being dropped from the statistics.
 */
export function buildGroupStats(analysis: Analysis, settings: Settings): ClassStat[] {
  const groups = new Map<string, StudentResult[]>();
  for (const student of analysis.included) {
    if (student.isKey) continue;
    const name = student.group?.trim() || UNGROUPED;
    const list = groups.get(name) ?? [];
    list.push(student);
    groups.set(name, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b, 'zh-HK', { numeric: true });
    })
    .map(([name, students]) => buildStat(name, students, analysis, settings));
}
