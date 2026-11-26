import type { RosterData, RosterEntry } from './roster';
import type { SurveyForm, SurveyTemplate, SurveyTemplateGrid } from './survey';

export const SURVEY_UNASSIGNED = '__unassigned';

export interface MissingClassGroup {
  className: string;
  entries: RosterEntry[];
}

/** Students absent from each recognisable class, based on the current roster. */
export function surveyMissingByClass(
  forms: SurveyForm[],
  roster: RosterData | null,
): MissingClassGroup[] {
  if (!roster) return [];
  const classNames = [...new Set(
    forms.map((form) => form.className.trim().toUpperCase()).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return classNames.map((className) => {
    const present = new Set(
      forms
        .filter((form) => form.className.trim().toUpperCase() === className)
        .map((form) => form.candidateNo)
        .filter((candidate) => /^\d{4}$/.test(candidate))
        .map(Number),
    );
    const entries = roster.entries
      .filter((entry) => entry.class === className && !present.has(entry.examId))
      .sort((a, b) => a.examId - b.examId);
    return { className, entries };
  });
}

/** All analysis scopes, including students whose class could not be confirmed. */
export function surveyClassScopes(forms: SurveyForm[]): string[] {
  const classes = [...new Set(
    forms.map((form) => form.className.trim().toUpperCase()).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (forms.some((form) => !form.className.trim())) classes.push(SURVEY_UNASSIGNED);
  return ['all', ...classes];
}

export function surveyScopeLabel(scope: string): string {
  if (scope === 'all') return '全級';
  if (scope === SURVEY_UNASSIGNED) return '未分班';
  return scope;
}

export function surveyScopeForms(forms: SurveyForm[], scope: string): SurveyForm[] {
  if (scope === 'all') return forms;
  if (scope === SURVEY_UNASSIGNED) return forms.filter((form) => !form.className.trim());
  return forms.filter((form) => form.className.trim().toUpperCase() === scope);
}

export interface SurveyFirstChoiceRow {
  row: number;
  label: string;
  code?: string;
  count: number;
  percent: number;
}

export interface SurveyFirstChoiceGroup {
  page: number;
  grid: SurveyTemplateGrid;
  total: number;
  undetermined: number;
  rows: SurveyFirstChoiceRow[];
}

/** The actual chosen subject in each page-2 group is its formal rank 1. */
export function surveyGroupFirstChoices(
  forms: SurveyForm[],
  template: SurveyTemplate,
): SurveyFirstChoiceGroup[] {
  const groups: SurveyFirstChoiceGroup[] = [];
  for (const page of template.pages) {
    for (const grid of page.grids) {
      if (grid.isCandidate || grid.mode !== 'rank') continue;
      const rows = grid.rows.map((label, row) => {
        const count = forms.filter((form) => form.values[grid.id]?.[row] === 1).length;
        return {
          row,
          label,
          code: grid.codes?.[row],
          count,
          percent: forms.length ? Math.round((count / forms.length) * 1000) / 10 : 0,
        };
      });
      const undetermined = forms.filter((form) =>
        grid.rows.every((_, row) => form.values[grid.id]?.[row] !== 1),
      ).length;
      groups.push({ page: page.page, grid, total: forms.length, undetermined, rows });
    }
  }
  return groups;
}
