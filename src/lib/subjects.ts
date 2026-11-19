export const FORM_LEVELS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;

export const JUNIOR_SUBJECTS = [
  '中國語文',
  '英國語文',
  '數學',
  '科學',
  '地理',
  '歷史',
  '中國歷史',
  '公民、經濟與社會',
  '生活與社會',
  '普通電腦',
  '體育',
  '視覺藝術',
  '科技與生活',
  '音樂',
  '普通話',
  'QTS Stars',
  'STEAM教育',
];

export const SENIOR_SUBJECTS = [
  '中國語文',
  '英國語文',
  '數學',
  '數學延伸部分單元一（微積分與統計）',
  '數學延伸部分單元二（代數與微積分）',
  '公民與社會發展',
  '歷史',
  '中國歷史',
  '經濟',
  '企業會計與財務概論',
  '地理',
  '資訊及通訊科技',
  '物理',
  '化學',
  '生物',
  '科技與生活',
  '健康管理與社會關懷',
  '體育',
  '視覺藝術',
  '應用學習',
  '日文',
];

export interface SubjectGroup {
  label: string;
  subjects: string[];
}

export function subjectGroups(formLevel: string): SubjectGroup[] {
  const level = formLevel.match(/[1-6]/)?.[0];
  if (level === '1' || level === '2' || level === '3') {
    return [{ label: '初中科目', subjects: JUNIOR_SUBJECTS }];
  }
  if (level === '4' || level === '5' || level === '6') {
    return [{ label: '高中科目', subjects: SENIOR_SUBJECTS }];
  }
  return [
    { label: '初中科目', subjects: JUNIOR_SUBJECTS },
    { label: '高中科目', subjects: SENIOR_SUBJECTS },
  ];
}

export function allSubjects(formLevel: string): string[] {
  return [...new Set(subjectGroups(formLevel).flatMap((group) => group.subjects))];
}
