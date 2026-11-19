import type {
  Analysis,
  AnswerValue,
  SavedSession,
  Settings,
  SheetRecord,
} from '../types';
import { displayAnswer } from './scoring';

export interface ExportContext {
  analysis: Analysis;
  settings: Settings;
  sheets: SheetRecord[];
}

const COLORS = {
  navy: 'FF15293D',
  navySoft: 'FF2F4357',
  cream: 'FFF7F3EA',
  gold: 'FFC9932E',
  goldSoft: 'FFF6EBCF',
  teal: 'FF0F6B5C',
  greenSoft: 'FFE4F2EA',
  redSoft: 'FFFBE7E4',
  greySoft: 'FFF0F0F0',
  purpleSoft: 'FFEFE9F7',
  white: 'FFFFFFFF',
  line: 'FFE4DCCB',
  text: 'FF243747',
};

const FONT = 'Aptos, Calibri, Microsoft JhengHei, sans-serif';

function safeName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 70) || 'QTSMC'
  );
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function answerFill(value: AnswerValue, correct: boolean, isKey: boolean): string {
  if (isKey) return COLORS.goldSoft;
  if (value === 'blank') return COLORS.greySoft;
  if (value === 'multi') return COLORS.purpleSoft;
  return correct ? COLORS.greenSoft : COLORS.redSoft;
}

function answerText(value: AnswerValue, multiChoice?: string): string {
  return displayAnswer(value, multiChoice);
}

function studentName(studentName: string, index: number): string {
  return studentName.trim() || `學生 ${index + 1}`;
}

function questionHeader(q: number): string {
  return `Q${q}`;
}

function exportNote(student: {
  isKey: boolean;
  needsReview: boolean;
  suggested?: { className?: boolean; seatNo?: boolean; name?: boolean };
}): string {
  const notes: string[] = [];
  if (student.isKey) notes.push('答案卷（滿分）');
  else if (student.needsReview) notes.push('需覆核');
  const suggested = student.suggested;
  const suggestedFields: string[] = [];
  if (suggested?.className) suggestedFields.push('班別');
  if (suggested?.seatNo) suggestedFields.push('學號');
  if (suggested?.name) suggestedFields.push('姓名');
  if (suggestedFields.length) {
    notes.push(`${suggestedFields.join('／')}為系統建議`);
  }
  return notes.join('；');
}

function allQuestionColumns(count: number): string[] {
  return Array.from({ length: count }, (_, i) => questionHeader(i + 1));
}

function distributionPercent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function percentileColor(percent: number): string {
  // soft red -> soft gold -> soft green
  if (percent >= 75) return 'FFDDF0E4';
  if (percent >= 55) return 'FFECF2DC';
  if (percent >= 35) return 'FFF9EFD3';
  return 'FFF8E2DD';
}

function excelDateLabel(value: string): string {
  return value || new Date().toISOString().slice(0, 10);
}

export async function exportXlsx(ctx: ExportContext): Promise<void> {
  const ExcelJSmod = await import('exceljs');
  const ExcelJS = (ExcelJSmod as unknown as { default?: any }).default ?? ExcelJSmod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QTSMC';
  wb.created = new Date();
  const { analysis, settings, sheets } = ctx;
  const count = settings.questionCount;
  const qCols = allQuestionColumns(count);
  const headerFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLORS.navy },
  } as const;
  const thinBorder = {
    top: { style: 'thin', color: { argb: COLORS.line } },
    left: { style: 'thin', color: { argb: COLORS.line } },
    bottom: { style: 'thin', color: { argb: COLORS.line } },
    right: { style: 'thin', color: { argb: COLORS.line } },
  } as const;

  function styleTitle(ws: any, title: string, subtitle: string, colCount: number): void {
    const end = ws.getColumn(colCount).letter;
    ws.mergeCells(`A1:${end}1`);
    const t = ws.getCell('A1');
    t.value = title;
    t.font = { name: FONT, size: 16, bold: true, color: { argb: COLORS.white } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
    t.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 30;
    ws.mergeCells(`A2:${end}2`);
    const s = ws.getCell('A2');
    s.value = subtitle;
    s.font = { name: FONT, size: 10, color: { argb: COLORS.navySoft } };
    s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.cream } };
    s.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(2).height = 22;
  }

  function styleHeader(ws: any, rowNumber: number): void {
    const row = ws.getRow(rowNumber);
    row.height = 28;
    row.eachCell((cell: any) => {
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.white } };
      cell.fill = headerFill;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder;
    });
  }

  function metaSubtitle(): string {
    const parts = [
      settings.subject ? `科目：${settings.subject}` : '',
      settings.className ? `班別：${settings.className}` : '',
      `日期：${excelDateLabel(settings.date)}`,
      `題數：${count}`,
      `每題 ${settings.marksPerQuestion} 分`,
      settings.includeKey ? '答案卷計入統計' : '答案卷不計入統計',
    ].filter(Boolean);
    return parts.join('　·　');
  }

  // -------------------------------------------------------------------------
  // 成績總表
  // -------------------------------------------------------------------------
  const scoreSheet = wb.addWorksheet('成績總表', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });
  styleTitle(
    scoreSheet,
    `QTSMC 答題紙批改 — ${settings.title || '成績報告'}`,
    metaSubtitle(),
    14 + count,
  );
  const scoreHeaders = [
    '序號',
    '班別',
    '學號',
    '姓名',
    '身份',
    '得分',
    '滿分',
    '百分比',
    '答對',
    '答錯',
    'blank',
    'multi',
    '低信心',
    '備註',
    ...qCols,
  ];
  scoreSheet.getRow(4).values = scoreHeaders;
  styleHeader(scoreSheet, 4);
  const widths = [6, 9, 9, 18, 11, 8, 8, 10, 8, 8, 8, 8, 8, 18];
  widths.forEach((width, i) => {
    scoreSheet.getColumn(i + 1).width = width;
  });
  for (let i = 0; i < count; i++) {
    scoreSheet.getColumn(15 + i).width = 7;
  }

  analysis.students.forEach((student, idx) => {
    const wsRow = scoreSheet.getRow(5 + idx);
    const wrong = Math.max(0, student.total - student.score);
    wsRow.values = [
      idx + 1,
      student.className || '',
      student.seatNo || '',
      studentName(student.name, idx),
      student.isKey ? '答案卷' : '學生',
      student.isKey ? student.total : student.score,
      student.total,
      student.isKey ? 100 : student.percent,
      student.isKey ? student.total : student.score,
      student.isKey ? 0 : wrong,
      student.blankCount,
      student.multiCount,
      student.lowCount,
      exportNote(student),
      ...qCols.map((_, i) => answerText(student.answers[i + 1] ?? 'blank', student.multiChoices?.[i + 1])),
    ];
    wsRow.height = 22;
    wsRow.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
      cell.font = { name: FONT, size: 10, color: { argb: COLORS.text } };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (col <= 14) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: student.isKey ? COLORS.goldSoft : COLORS.white },
        };
      }
    });
    if (student.isKey) {
      wsRow.getCell(4).font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.gold } };
    }
    wsRow.getCell(8).numFmt = '0.0"%"';
    for (let q = 1; q <= count; q++) {
      const cell = wsRow.getCell(14 + q);
      const value = student.answers[q] ?? 'blank';
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: answerFill(value, Boolean(student.correct[q]), student.isKey),
        },
      };
      if (value === 'multi') {
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FF5B3E86' } };
      } else if (value === 'blank') {
        cell.font = { name: FONT, size: 9, color: { argb: 'FF7A7A7A' } };
      }
    }
  });
  if (analysis.students.length === 0) {
    scoreSheet.getCell('A5').value = '沒有可匯出的學生資料。';
  }
  scoreSheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + analysis.students.length, column: 14 + count },
  };
  scoreSheet.getCell(6 + analysis.students.length, 1).value =
    '顏色：綠色＝答對、紅色＝答錯、灰色＝blank、紫色＝multi（逐題列出所選選項，例如 B, C）；金色列＝答案卷。';

  // -------------------------------------------------------------------------
  // 題目分析
  // -------------------------------------------------------------------------
  const qSheet = wb.addWorksheet('題目分析', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });
  styleTitle(qSheet, '題目分析 — 每題答對率與選項分佈', metaSubtitle(), 18);
  const qHeaders = [
    '題號',
    '正確答案',
    '答對人數',
    '答對 %',
    '有效作答',
    'A 人數',
    'A %',
    'B 人數',
    'B %',
    'C 人數',
    'C %',
    'D 人數',
    'D %',
    'blank 人數',
    'blank %',
    'multi 人數',
    'multi %',
    '備註',
  ];
  qSheet.getRow(4).values = qHeaders;
  styleHeader(qSheet, 4);
  [7, 9, 8, 9, 9, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 22].forEach((width, i) => {
    qSheet.getColumn(i + 1).width = width;
  });
  const totalStudents = analysis.included.length;
  analysis.questions.forEach((stat, idx) => {
    const row = qSheet.getRow(5 + idx);
    const o = stat.options;
    row.values = [
      `Q${stat.q}`,
      stat.keyValid ? stat.key : '未設定',
      stat.correctCount,
      stat.correctPercent,
      stat.answeredCount,
      o.A.count,
      o.A.percent,
      o.B.count,
      o.B.percent,
      o.C.count,
      o.C.percent,
      o.D.count,
      o.D.percent,
      o.blank.count,
      o.blank.percent,
      o.multi.count,
      o.multi.percent,
      stat.keyValid ? '' : '答案卷未設定此題',
    ];
    row.height = 21;
    row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.font = { name: FONT, size: 10, color: { argb: COLORS.text } };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    row.getCell(2).font = { name: FONT, size: 11, bold: true, color: { argb: COLORS.teal } };
    row.getCell(4).numFmt = '0.0"%"';
    row.getCell(4).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: percentileColor(stat.correctPercent) },
    };
    for (const col of [7, 9, 11, 13, 15, 17]) {
      row.getCell(col).numFmt = '0.0"%"';
    }
    if (!stat.keyValid) {
      row.getCell(2).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLORS.redSoft },
      };
    }
    row.getCell(5).value = `${stat.answeredCount} / ${totalStudents}`;
    row.getCell(5).alignment = { vertical: 'middle', horizontal: 'center' };
  });
  qSheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + analysis.questions.length, column: 18 },
  };

  // -------------------------------------------------------------------------
  // 選項統計 (long format, pivot-friendly)
  // -------------------------------------------------------------------------
  const optSheet = wb.addWorksheet('選項統計');
  styleTitle(optSheet, '選項統計 — 長表格式（可直接做樞紐分析）', metaSubtitle(), 6);
  optSheet.getRow(4).values = ['題號', '正確答案', '選項', '人數', '百分比', '是否正確選項'];
  styleHeader(optSheet, 4);
  [8, 10, 10, 8, 10, 14].forEach((width, i) => {
    optSheet.getColumn(i + 1).width = width;
  });
  let optRow = 5;
  for (const stat of analysis.questions) {
    for (const option of ['A', 'B', 'C', 'D', 'blank', 'multi'] as const) {
      const row = optSheet.getRow(optRow++);
      const isCorrect = stat.keyValid && option === stat.key;
      row.values = [
        `Q${stat.q}`,
        stat.keyValid ? stat.key : '未設定',
        option,
        stat.options[option].count,
        stat.options[option].percent,
        isCorrect ? '是' : '',
      ];
      row.eachCell({ includeEmpty: true }, (cell: any) => {
        cell.font = { name: FONT, size: 10, color: { argb: COLORS.text } };
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      row.getCell(5).numFmt = '0.0"%"';
      if (isCorrect) {
        row.eachCell({ includeEmpty: true }, (cell: any) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: COLORS.greenSoft },
          };
        });
      }
      if (option === 'blank') {
        row.getCell(3).font = { name: FONT, size: 10, color: { argb: 'FF777777' } };
      }
      if (option === 'multi') {
        row.getCell(3).font = { name: FONT, size: 10, color: { argb: 'FF5B3E86' } };
      }
    }
  }
  optSheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: optRow - 1, column: 6 },
  };

  // -------------------------------------------------------------------------
  // 答案卷
  // -------------------------------------------------------------------------
  const keySheet = wb.addWorksheet('答案卷');
  styleTitle(keySheet, '答案卷 — 本次測驗答案', metaSubtitle(), 3);
  keySheet.getRow(4).values = ['題號', '答案', '狀態'];
  styleHeader(keySheet, 4);
  [10, 12, 24].forEach((width, i) => {
    keySheet.getColumn(i + 1).width = width;
  });
  analysis.questions.forEach((stat, idx) => {
    const row = keySheet.getRow(5 + idx);
    row.values = [
      `Q${stat.q}`,
      stat.keyValid ? stat.key : '未設定',
      stat.keyValid ? '正常' : '請於系統補上答案',
    ];
    row.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.font = { name: FONT, size: 10, color: { argb: COLORS.text } };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    row.getCell(2).font = { name: FONT, size: 12, bold: true, color: { argb: COLORS.teal } };
    if (!stat.keyValid) {
      row.getCell(2).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLORS.redSoft },
      };
    }
  });

  // -------------------------------------------------------------------------
  // 統計摘要
  // -------------------------------------------------------------------------
  const summarySheet = wb.addWorksheet('統計摘要');
  styleTitle(summarySheet, '統計摘要', metaSubtitle(), 2);
  summarySheet.getColumn(1).width = 24;
  summarySheet.getColumn(2).width = 18;
  const s = analysis.summary;
  const rows: [string, string | number][] = [
    ['計入統計學生數', s.includedCount],
    ['平均分（%）', s.average],
    ['中位數（%）', s.median],
    ['最高分（%）', s.highest],
    ['最低分（%）', s.lowest],
    ['標準差', s.stdDev],
    [`及格率（≥${settings.passMark}%）`, s.passRate],
  ];
  rows.forEach(([label, value], idx) => {
    const row = summarySheet.getRow(4 + idx);
    row.values = [label, value];
    row.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.navy } };
    row.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.cream },
    };
    row.getCell(2).font = { name: FONT, size: 11, bold: true, color: { argb: COLORS.teal } };
    row.getCell(1).border = thinBorder;
    row.getCell(2).border = thinBorder;
    row.getCell(2).alignment = { horizontal: 'center' };
  });
  const distStart = 13;
  summarySheet.getCell(`A${distStart}`).value = '分數分佈';
  summarySheet.getCell(`A${distStart}`).font = {
    name: FONT,
    size: 12,
    bold: true,
    color: { argb: COLORS.navy },
  };
  summarySheet.getCell(`A${distStart + 1}`).value = '分數區間';
  summarySheet.getCell(`B${distStart + 1}`).value = '人數';
  styleHeader(summarySheet, distStart + 1);
  s.distribution.forEach((bucket, idx) => {
    const row = summarySheet.getRow(distStart + 2 + idx);
    row.values = [bucket.label, bucket.count];
    row.getCell(1).border = thinBorder;
    row.getCell(2).border = thinBorder;
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(1).font = { name: FONT, size: 10, color: { argb: COLORS.text } };
    row.getCell(2).font = { name: FONT, size: 10, color: { argb: COLORS.text } };
  });

  // -------------------------------------------------------------------------
  // 設定
  // -------------------------------------------------------------------------
  const settingsSheet = wb.addWorksheet('設定');
  styleTitle(settingsSheet, '匯出設定', '此頁記錄產生檔案時使用的參數。', 2);
  settingsSheet.getColumn(1).width = 26;
  settingsSheet.getColumn(2).width = 34;
  const settingRows: [string, string | number][] = [
    ['測驗名稱', settings.title || ''],
    ['科目', settings.subject || ''],
    ['班別', settings.className || ''],
    ['日期', excelDateLabel(settings.date)],
    ['題數', count],
    ['每題分數', settings.marksPerQuestion],
    ['滿分', count * settings.marksPerQuestion],
    ['及格分數（%）', settings.passMark],
    ['及格分數規則', settings.passMarkAuto ? '自動（高中40%／初中50%）' : '手動'],
    ['答案卷是否計入統計', settings.includeKey ? '是' : '否'],
    ['學生數（計入統計）', analysis.included.length],
    ['產生時間', new Date().toLocaleString('zh-HK')],
    ['系統', 'QTSMC 答題紙批改'],
  ];
  settingRows.forEach(([label, value], idx) => {
    const row = settingsSheet.getRow(4 + idx);
    row.values = [label, value];
    row.getCell(1).font = { name: FONT, size: 10, bold: true };
    row.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.cream },
    };
    row.getCell(1).border = thinBorder;
    row.getCell(2).border = thinBorder;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const base = `QTSMC_${safeName(settings.title || '成績')}_${excelDateLabel(settings.date)}`;
  download(blob, `${base}.xlsx`);
}

function csvEscape(value: string | number): string {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(values: (string | number)[]): string {
  return values.map(csvEscape).join(',');
}

export async function exportCsvZip(ctx: ExportContext): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const { analysis, settings } = ctx;
  const count = settings.questionCount;
  const qCols = allQuestionColumns(count);
  const date = excelDateLabel(settings.date);
  const lines: string[] = [];
  lines.push(csvLine([`QTSMC 答題紙批改 — ${settings.title || '成績報告'}`]));
  lines.push(
    csvLine([
      `科目：${settings.subject || ''}`,
      `班別：${settings.className || ''}`,
      `日期：${date}`,
      `題數：${count}`,
      `每題分數：${settings.marksPerQuestion}`,
      `答案卷：${settings.includeKey ? '計入統計' : '不計入統計'}`,
    ]),
  );
  lines.push('');
  lines.push(
    csvLine([
      '序號',
      '班別',
      '學號',
      '姓名',
      '身份',
      '得分',
      '滿分',
      '百分比',
      '答對',
      '答錯',
      'blank',
      'multi',
      '低信心',
      '備註',
      ...qCols,
    ]),
  );
  analysis.students.forEach((student, idx) => {
    lines.push(
      csvLine([
        idx + 1,
        student.className,
        student.seatNo,
        studentName(student.name, idx),
        student.isKey ? '答案卷' : '學生',
        student.isKey ? student.total : student.score,
        student.total,
        student.isKey ? 100 : student.percent,
        student.isKey ? student.total : student.score,
        student.isKey ? 0 : Math.max(0, student.total - student.score),
        student.blankCount,
        student.multiCount,
        student.lowCount,
        exportNote(student),
        ...qCols.map((_, i) => answerText(student.answers[i + 1] ?? 'blank', student.multiChoices?.[i + 1])),
      ]),
    );
  });

  const qLines: string[] = [];
  qLines.push(csvLine(['QTSMC 題目分析', settings.title || '']));
  qLines.push(csvLine(['題號', '正確答案', '答對人數', '答對 %', '有效作答', 'A 人數', 'A %', 'B 人數', 'B %', 'C 人數', 'C %', 'D 人數', 'D %', 'blank 人數', 'blank %', 'multi 人數', 'multi %']));
  for (const stat of analysis.questions) {
    qLines.push(
      csvLine([
        `Q${stat.q}`,
        stat.keyValid ? stat.key : '未設定',
        stat.correctCount,
        stat.correctPercent,
        `${stat.answeredCount}/${analysis.included.length}`,
        stat.options.A.count,
        stat.options.A.percent,
        stat.options.B.count,
        stat.options.B.percent,
        stat.options.C.count,
        stat.options.C.percent,
        stat.options.D.count,
        stat.options.D.percent,
        stat.options.blank.count,
        stat.options.blank.percent,
        stat.options.multi.count,
        stat.options.multi.percent,
      ]),
    );
  }

  const optLines: string[] = [];
  optLines.push(csvLine(['QTSMC 選項統計', settings.title || '']));
  optLines.push(csvLine(['題號', '正確答案', '選項', '人數', '百分比', '是否正確選項']));
  for (const stat of analysis.questions) {
    for (const option of ['A', 'B', 'C', 'D', 'blank', 'multi'] as const) {
      optLines.push(
        csvLine([
          `Q${stat.q}`,
          stat.keyValid ? stat.key : '未設定',
          option,
          stat.options[option].count,
          stat.options[option].percent,
          stat.keyValid && option === stat.key ? '是' : '',
        ]),
      );
    }
  }

  const keyLines: string[] = [];
  keyLines.push(csvLine(['QTSMC 答案卷', settings.title || '']));
  keyLines.push(csvLine(['題號', '答案', '狀態']));
  for (const stat of analysis.questions) {
    keyLines.push(
      csvLine([`Q${stat.q}`, stat.keyValid ? stat.key : '未設定', stat.keyValid ? '正常' : '請補上答案']),
    );
  }

  const summaryLines: string[] = [];
  summaryLines.push(csvLine(['QTSMC 統計摘要', settings.title || '']));
  summaryLines.push(
    csvLine([
      `科目：${settings.subject || ''}`,
      `班別：${settings.className || ''}`,
      `日期：${date}`,
      `題數：${count}`,
      `答案卷：${settings.includeKey ? '計入統計' : '不計入統計'}`,
    ]),
  );
  summaryLines.push('');
  summaryLines.push(csvLine(['指標', '數值']));
  const summary = analysis.summary;
  const summaryRows: [string, string | number][] = [
    ['計入統計學生數', summary.includedCount],
    ['平均分（%）', summary.average],
    ['中位數（%）', summary.median],
    ['最高分（%）', summary.highest],
    ['最低分（%）', summary.lowest],
    ['標準差', summary.stdDev],
    [`及格率（≥${settings.passMark}%）`, summary.passRate],
    ['滿分', count * settings.marksPerQuestion],
    ['每題分數', settings.marksPerQuestion],
  ];
  for (const [label, value] of summaryRows) {
    summaryLines.push(csvLine([label, value]));
  }
  summaryLines.push('');
  summaryLines.push(csvLine(['分數區間', '人數']));
  for (const bucket of summary.distribution) {
    summaryLines.push(csvLine([bucket.label, bucket.count]));
  }

  const zip = new JSZip();
  zip.file('成績總表.csv', `\uFEFF${lines.join('\r\n')}`);
  zip.file('題目分析.csv', `\uFEFF${qLines.join('\r\n')}`);
  zip.file('選項統計.csv', `\uFEFF${optLines.join('\r\n')}`);
  zip.file('答案卷.csv', `\uFEFF${keyLines.join('\r\n')}`);
  zip.file('統計摘要.csv', `\uFEFF${summaryLines.join('\r\n')}`);

  const blob = await zip.generateAsync({ type: 'blob' });
  const base = `QTSMC_${safeName(settings.title || '成績')}_${date}_csv`;
  download(blob, `${base}.zip`);
}

export function buildBackup(session: SavedSession): Blob {
  return new Blob([JSON.stringify(session, null, 2)], {
    type: 'application/json',
  });
}

export function downloadBackup(session: SavedSession): void {
  const date = new Date().toISOString().slice(0, 10);
  download(buildBackup(session), `qtsmc_backup_${date}.json`);
}

export async function parseBackupFile(file: File): Promise<SavedSession> {
  const text = await file.text();
  const parsed = JSON.parse(text) as SavedSession;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sheetMeta)) {
    throw new Error('備份檔案格式不正確。');
  }
  return parsed;
}

export function percentageLabel(part: number, total: number): string {
  return total > 0 ? `${distributionPercent(part, total).toFixed(1)}%` : '—';
}
