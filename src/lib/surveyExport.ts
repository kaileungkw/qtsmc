/**
 * Exports for the S3 subject-preference survey: one XLSX with the complete
 * result, a long-format sheet and per-subject statistics, plus a ZIP with the
 * XLSX, UTF-8 CSVs and the original scanned PDFs.
 */
import type { SurveyForm, SurveyTemplate, SurveyTemplateGrid } from './survey';
import { reportFileBase } from './export';

const FONT = 'Microsoft JhengHei';
const NAVY = 'FF243747';
const TEAL = 'FF0D6657';
const TEAL_SOFT = 'FFE2F0E9';
const LINE = 'FFE5DDCC';
const GREY_SOFT = 'FFF3F0EA';
const GOLD_SOFT = 'FFF7EDD4';

interface ExportInput {
  template: SurveyTemplate;
  forms: SurveyForm[];
  scans: { name: string; blob: Blob }[];
  blank?: { name: string; blob: Blob };
  date: string;
  formLevel: string;
  subject: string;
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

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values: (string | number)[]): string {
  return values.map(csvEscape).join(',');
}

function contentGrids(template: SurveyTemplate): { page: number; grid: SurveyTemplateGrid }[] {
  return template.pages.flatMap((page) =>
    page.grids
      .filter((grid) => !grid.isCandidate)
      .map((grid) => ({ page: page.page, grid })),
  );
}

function gridLabel(template: SurveyTemplate, grid: SurveyTemplateGrid): string {
  const page = template.pages.find((item) => item.page === grid.page);
  const content = page?.grids.filter((item) => !item.isCandidate) ?? [];
  const index = content.findIndex((item) => item.id === grid.id);
  const parts = [`第${grid.page}頁`];
  if (content.length > 1) parts.push(`第${index + 1}組`);
  if (grid.mode === 'single') parts.push('應用學習');
  return parts.join(' ');
}

function cellValue(form: SurveyForm, grid: SurveyTemplateGrid, row: number): string | number {
  const value = form.values[grid.id]?.[row];
  if (grid.mode === 'single') return value ? '✓' : '';
  return value ?? 'BLANK';
}

function styleHeader(cell: import('exceljs').Cell, fill = NAVY): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: LINE } },
    left: { style: 'thin', color: { argb: LINE } },
    bottom: { style: 'thin', color: { argb: LINE } },
    right: { style: 'thin', color: { argb: LINE } },
  };
}

async function buildXlsx(input: ExportInput): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QTSMC';
  workbook.created = new Date();
  const grids = contentGrids(input.template);
  const lastColumn = 4 + grids.reduce((sum, { grid }) => sum + grid.rows.length, 0) + 1;

  const sheet = workbook.addWorksheet('選科結果', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 4 }],
  });
  sheet.mergeCells(1, 1, 1, lastColumn);
  const title = sheet.getCell(1, 1);
  title.value = `中三選科表結果 — ${input.subject || input.template.name}`;
  title.font = { name: FONT, size: 15, bold: true, color: { argb: NAVY } };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells(2, 1, 2, lastColumn);
  const meta = sheet.getCell(2, 1);
  meta.value = `年級：${input.formLevel}　日期：${input.date}　份數：${input.forms.length}　空白表格：${input.template.name}`;
  meta.font = { name: FONT, size: 10, color: { argb: 'FF3D5063' } };

  const head1 = sheet.getRow(3);
  const head2 = sheet.getRow(4);
  ['考生號碼', '姓名', '班別', '學號'].forEach((label, index) => {
    sheet.mergeCells(3, index + 1, 4, index + 1);
    const cell = head1.getCell(index + 1);
    cell.value = label;
    styleHeader(cell);
  });
  let column = 5;
  for (const { grid } of grids) {
    sheet.mergeCells(3, column, 3, column + grid.rows.length - 1);
    const cell = head1.getCell(column);
    cell.value = `${gridLabel(input.template, grid)}${grid.title ? ` — ${grid.title}` : ''}`;
    styleHeader(cell, TEAL);
    for (let row = 0; row < grid.rows.length; row++) {
      const sub = head2.getCell(column + row);
      sub.value =
        grid.mode === 'single' && grid.codes?.[row]
          ? `${grid.codes[row]}`.trim()
          : grid.rows[row];
      styleHeader(sub, TEAL);
      sub.font = { name: FONT, size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getColumn(column + row).width = grid.mode === 'single' ? 13 : 9;
    }
    column += grid.rows.length;
  }
  const statusCell = head1.getCell(column);
  sheet.mergeCells(3, column, 4, column);
  statusCell.value = '狀態';
  styleHeader(statusCell);
  sheet.getColumn(column).width = 14;
  sheet.getRow(3).height = 34;
  sheet.getRow(4).height = 44;

  const sorted = [...input.forms].sort(
    (a, b) => a.candidateNo.localeCompare(b.candidateNo) || a.name.localeCompare(b.name),
  );
  for (const form of sorted) {
    const row = sheet.addRow([]);
    row.getCell(1).value = form.candidateNo || '';
    row.getCell(2).value = form.name || '';
    row.getCell(3).value = form.className || '';
    row.getCell(4).value = form.seatNo || '';
    let col = 5;
    for (const { grid } of grids) {
      for (let index = 0; index < grid.rows.length; index++) {
        const cell = row.getCell(col);
        cell.value = cellValue(form, grid, index);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (grid.mode === 'single' && cell.value === '✓') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL_SOFT } };
        }
        if (cell.value === 'BLANK' || cell.value === '') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY_SOFT } };
        }
        if (form.ambiguous.includes(`${grid.id}:${index}`)) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_SOFT } };
        }
        cell.border = {
          bottom: { style: 'hair', color: { argb: LINE } },
        };
        cell.font = { name: FONT, size: 10 };
        col += 1;
      }
    }
    const status = row.getCell(col);
    status.value = form.reviewed
      ? '覆核完成'
      : form.flags.length || form.ambiguous.length
        ? form.flags[0] || '有雙填畫'
        : '已讀取';
    status.font = { name: FONT, size: 9 };
    status.alignment = { wrapText: true, vertical: 'middle' };
    row.commit();
  }
  [1, 2, 3, 4].forEach((index) => {
    sheet.getColumn(index).width = index === 2 ? 14 : 10;
  });

  // Long format: one row per student per subject.
  const long = workbook.addWorksheet('原始資料');
  const longHead = ['考生號碼', '姓名', '班別', '學號', '頁', '組', '科目', '排序／選擇', '備註'];
  long.addRow(longHead).eachCell((cell) => styleHeader(cell));
  longHead.forEach((_, index) => {
    long.getColumn(index + 1).width = [10, 14, 8, 8, 7, 20, 26, 10, 26][index];
  });
  for (const form of sorted) {
    for (const { page, grid } of grids) {
      for (let index = 0; index < grid.rows.length; index++) {
        const value = form.values[grid.id]?.[index];
        const flagged = form.ambiguous.includes(`${grid.id}:${index}`);
        const note = form.reviewed
          ? '覆核完成'
          : flagged
            ? '有雙填畫'
            : form.flags[0] ?? '';
        long.addRow([
          form.candidateNo,
          form.name,
          form.className,
          form.seatNo,
          page,
          gridLabel(input.template, grid),
          grid.rows[index],
          grid.mode === 'single' ? (value ? '✓' : '') : (value ?? 'BLANK'),
          note,
        ]);
      }
    }
  }

  // Subject statistics.
  const stats = workbook.addWorksheet('科目統計');
  stats.addRow(['頁', '組', '科目', '有效填寫', '第1志願', '第2志願', '第3志願', '平均排序']).eachCell((cell) => styleHeader(cell));
  [7, 20, 30, 10, 9, 9, 9, 10].forEach((width, index) => {
    stats.getColumn(index + 1).width = width;
  });
  for (const { page, grid } of grids) {
    for (let index = 0; index < grid.rows.length; index++) {
      const values = input.forms
        .map((form) => form.values[grid.id]?.[index])
        .filter((value): value is number => value !== null && value !== undefined);
      if (grid.mode === 'single') {
        stats.addRow([
          page,
          gridLabel(input.template, grid),
          grid.rows[index],
          values.filter((value) => value === 1).length,
          '',
          '',
          '',
          '',
        ]);
        continue;
      }
      const average = values.length
        ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
        : '';
      stats.addRow([
        page,
        gridLabel(input.template, grid),
        grid.rows[index],
        values.length,
        values.filter((value) => value === 1).length,
        values.filter((value) => value === 2).length,
        values.filter((value) => value === 3).length,
        average,
      ]);
    }
  }

  const settings = workbook.addWorksheet('設定');
  settings.addRow(['項目', '內容']).eachCell((cell) => styleHeader(cell));
  settings.getColumn(1).width = 22;
  settings.getColumn(2).width = 60;
  const reviewCount = input.forms.filter(
    (form) => !form.reviewed && (form.flags.length || form.ambiguous.length),
  ).length;
  [
    ['調查', input.subject],
    ['年級', input.formLevel],
    ['日期', input.date],
    ['份數', input.forms.length],
    ['已對名單', input.forms.filter((form) => form.name).length],
    ['需覆核', reviewCount],
    ['空白表格', input.template.name],
    ['表格頁數', input.template.pages.length],
    ['產生時間', new Date().toLocaleString('zh-HK')],
    ['說明', '排序數字由掃描的填畫位置讀取；空白＝未填，金色＝雙填畫需覆核。'],
  ].forEach(([label, value]) => {
    const row = settings.addRow([label, value]);
    row.getCell(1).font = { name: FONT, size: 10, bold: true };
    row.getCell(2).font = { name: FONT, size: 10 };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function buildCsvFiles(input: ExportInput): { name: string; text: string }[] {
  const grids = contentGrids(input.template);
  const sorted = [...input.forms].sort((a, b) =>
    a.candidateNo.localeCompare(b.candidateNo),
  );

  const resultLines: string[] = [];
  resultLines.push(csvLine([`中三選科表結果 — ${input.subject}`]));
  resultLines.push(
    csvLine([`年級：${input.formLevel}`, `日期：${input.date}`, `份數：${input.forms.length}`]),
  );
  resultLines.push('');
  resultLines.push(
    csvLine([
      '考生號碼',
      '姓名',
      '班別',
      '學號',
      ...grids.flatMap(({ grid }) => grid.rows.map((label) => `${gridLabel(input.template, grid)} ${label}`)),
      '狀態',
    ]),
  );
  for (const form of sorted) {
    resultLines.push(
      csvLine([
        form.candidateNo,
        form.name,
        form.className,
        form.seatNo,
        ...grids.flatMap(({ grid }) =>
          grid.rows.map((_, index) => {
            const value = form.values[grid.id]?.[index];
            if (grid.mode === 'single') return value ? '✓' : '';
            return value ?? 'BLANK';
          }),
        ),
        form.reviewed ? '覆核完成' : form.flags[0] || (form.ambiguous.length ? '有雙填畫' : '已讀取'),
      ]),
    );
  }

  const longLines: string[] = [
    csvLine(['考生號碼', '姓名', '班別', '學號', '頁', '組', '科目', '排序／選擇', '備註']),
  ];
  for (const form of sorted) {
    for (const { page, grid } of grids) {
      for (let index = 0; index < grid.rows.length; index++) {
        const value = form.values[grid.id]?.[index];
        longLines.push(
          csvLine([
            form.candidateNo,
            form.name,
            form.className,
            form.seatNo,
            page,
            gridLabel(input.template, grid),
            grid.rows[index],
            grid.mode === 'single' ? (value ? '✓' : '') : (value ?? 'BLANK'),
            form.reviewed
              ? '覆核完成'
              : form.ambiguous.includes(`${grid.id}:${index}`)
                ? '有雙填畫'
                : form.flags[0] ?? '',
          ]),
        );
      }
    }
  }

  const statLines: string[] = [
    csvLine(['頁', '組', '科目', '有效填寫', '第1志願', '第2志願', '第3志願', '平均排序']),
  ];
  for (const { page, grid } of grids) {
    for (let index = 0; index < grid.rows.length; index++) {
      const values = input.forms
        .map((form) => form.values[grid.id]?.[index])
        .filter((value): value is number => value !== null && value !== undefined);
      if (grid.mode === 'single') {
        statLines.push(
          csvLine([
            page,
            gridLabel(input.template, grid),
            grid.rows[index],
            values.filter((value) => value === 1).length,
            '',
            '',
            '',
            '',
          ]),
        );
      } else {
        statLines.push(
          csvLine([
            page,
            gridLabel(input.template, grid),
            grid.rows[index],
            values.length,
            values.filter((value) => value === 1).length,
            values.filter((value) => value === 2).length,
            values.filter((value) => value === 3).length,
            values.length
              ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
              : '',
          ]),
        );
      }
    }
  }

  return [
    { name: '選科結果.csv', text: resultLines.join('\r\n') },
    { name: '原始資料.csv', text: longLines.join('\r\n') },
    { name: '科目統計.csv', text: statLines.join('\r\n') },
  ];
}

export async function exportSurveyZip(input: ExportInput): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const base = reportFileBase(input);
  const xlsx = await buildXlsx(input);
  const zip = new JSZip();
  zip.file(`${base}.xlsx`, xlsx);
  const csvFolder = zip.folder('csv');
  for (const file of buildCsvFiles(input)) {
    csvFolder?.file(file.name, `\ufeff${file.text}`);
  }
  const used = new Set<string>();
  if (input.blank) {
    const name = input.blank.name.replace(/[\/:*?"<>|]/g, '_');
    used.add(name);
    zip.file(name, input.blank.blob);
  }
  for (const scan of input.scans) {
    let name = scan.name.replace(/[\\/:*?"<>|]/g, '_');
    let index = 2;
    while (used.has(name)) {
      name = `${scan.name.replace(/\.pdf$/i, '')} (${index}).pdf`;
      index += 1;
    }
    used.add(name);
    zip.file(name, scan.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  download(blob, `${base}.zip`);
}
