/**
 * 中三選科表（S3 subject-preference survey）engine.
 *
 * The blank form PDF is the source of truth for the form structure: every
 * bubble is a Wingdings character in the PDF text layer, and every subject is
 * real Chinese text. That gives the row labels and the grid layout without any
 * OCR. Scanned forms are then matched to the blank pages by their bubble-grid
 * layout and read by sampling the centre of each bubble.
 *
 * This module is deliberately DOM-free so it can be exercised in Node against
 * rendered page images (tools/survey_*). PDF rendering lives in surveyPdf.ts.
 */

export const SURVEY_BUBBLE_CHAR = '\uf081';

/** Task subject used for the 中三選科表 task kind. */
export const SURVEY_SUBJECT = '中三選科表';

export interface SurveyTextItem {
  text: string;
  /** Horizontal position in PDF points. */
  x: number;
  /** Vertical position in PDF points, measured from the top of the page. */
  y: number;
  height: number;
  width: number;
}

export interface SurveyTextPage {
  page: number;
  width: number;
  height: number;
  items: SurveyTextItem[];
}

export interface SurveyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SurveyBubble {
  x: number;
  y: number;
  r: number;
}

export interface SurveyTemplateGrid {
  /** Stable id, e.g. p1g2. */
  id: string;
  page: number;
  /** 1-based order of the bubble grid on its page. */
  index: number;
  title: string;
  rows: string[];
  /** APL course codes, parallel to rows (only on the applied-learning page). */
  codes?: (string | undefined)[];
  columns: number;
  mode: 'rank' | 'single';
  isCandidate: boolean;
  rect: SurveyRect;
  rowY: number[];
  columnX: number[];
  bubbleSize: number;
}

export interface SurveyTemplatePage {
  page: number;
  width: number;
  height: number;
  title: string;
  grids: SurveyTemplateGrid[];
  bubbleSize: number;
}

export interface SurveyTemplate {
  name: string;
  createdAt: number;
  pages: SurveyTemplatePage[];
}

export interface SurveyGrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A bubble grid found on a scanned page. */
export interface SurveyScanGrid {
  rect: SurveyRect;
  rows: number;
  columns: number;
  rowY: number[];
  columnX: number[];
  bubbleSize: number;
  isCandidate: boolean;
}

export interface SurveyGridRead {
  /** One value per template row: the marked rank (1-based) or null. */
  values: (number | null)[];
  /** Highest ink fraction per row, for diagnostics. */
  ink: number[];
  /** Rows where two bubbles are too close to call. */
  ambiguous: number[];
  /** Rows whose ink is faint enough to doubt. */
  faint: number[];
}

export interface SurveyPageRead {
  /** Template page number, or 0 when nothing matched. */
  templatePage: number;
  cost: number;
  candidateNo: string;
  candidateFlags: number[];
  grids: Record<string, SurveyGridRead>;
  /** Grid geometry on this scanned page, for the review overlay. */
  scanGrids: SurveyScanGrid[];
  flags: string[];
  inkFraction: number;
}

export interface SurveyLogicalPage {
  id: string;
  fileIndex: number;
  fileName: string;
  pageNo: number;
  half: 'full' | 'left' | 'right';
  width: number;
  height: number;
  blank: boolean;
  read?: SurveyPageRead;
}

export interface SurveyFormPageRef {
  pageId: string;
  templatePage: number;
  fileName: string;
  pageNo: number;
  half: 'full' | 'left' | 'right';
}

export interface SurveyForm {
  id: string;
  candidateNo: string;
  name: string;
  className: string;
  seatNo: string;
  pages: SurveyFormPageRef[];
  /** Grid id → values per template row. */
  values: Record<string, (number | null)[]>;
  /** "gridId:row" entries that need a human look. */
  ambiguous: string[];
  flags: string[];
  reviewed: boolean;
}

/** A bubble grid found on a scanned page. */
export interface SurveyScanGrid {
  rect: SurveyRect;
  rows: number;
  columns: number;
  rowY: number[];
  columnX: number[];
  bubbleSize: number;
  isCandidate: boolean;
}

export interface SurveyGridRead {
  /** One value per template row: the marked rank (1-based) or null. */
  values: (number | null)[];
  /** Highest ink fraction per row, for diagnostics. */
  ink: number[];
  /** Rows where two bubbles are too close to call. */
  ambiguous: number[];
  /** Rows whose ink is faint enough to doubt. */
  faint: number[];
}

export interface SurveyPageRead {
  /** Template page number, or 0 when nothing matched. */
  templatePage: number;
  cost: number;
  candidateNo: string;
  candidateFlags: number[];
  grids: Record<string, SurveyGridRead>;
  /** Grid geometry on this scanned page, for the review overlay. */
  scanGrids: SurveyScanGrid[];
  flags: string[];
  inkFraction: number;
}

export interface SurveyLogicalPage {
  id: string;
  fileIndex: number;
  fileName: string;
  pageNo: number;
  half: 'full' | 'left' | 'right';
  width: number;
  height: number;
  blank: boolean;
  read?: SurveyPageRead;
}

export interface SurveyFormPageRef {
  pageId: string;
  templatePage: number;
  fileName: string;
  pageNo: number;
  half: 'full' | 'left' | 'right';
}

export interface SurveyForm {
  id: string;
  candidateNo: string;
  name: string;
  className: string;
  seatNo: string;
  pages: SurveyFormPageRef[];
  /** Grid id → values per template row. */
  values: Record<string, (number | null)[]>;
  /** "gridId:row" entries that need a human look. */
  ambiguous: string[];
  flags: string[];
  reviewed: boolean;
}

export interface SurveySummary {
  forms: number;
  matched: number;
  review: number;
  pages: number;
  blankPages: number;
  templatePages: number;
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

interface RawRow {
  y: number;
  xs: number[];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function modeNumber(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0] ?? 0;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function clusterRows(bubbles: SurveyBubble[], tolerance: number): RawRow[] {
  const sorted = [...bubbles].sort((a, b) => a.y - b.y);
  const rows: { y: number; xs: number[] }[] = [];
  for (const bubble of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - bubble.y) <= tolerance) {
      last.xs.push(bubble.x);
      last.y = (last.y * (last.xs.length - 1) + bubble.y) / last.xs.length;
    } else {
      rows.push({ y: bubble.y, xs: [bubble.x] });
    }
  }
  for (const row of rows) row.xs.sort((a, b) => a - b);
  return rows;
}

/**
 * Split rows into bubble grids. A new grid starts when the row pattern changes
 * (different number of bubbles or a shifted left edge) or when the vertical gap
 * is much larger than the row pitch — the gaps between the survey questions.
 */
export function segmentGrids(rows: RawRow[], unit: number): RawRow[][] {
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i].y - rows[i - 1].y);
  const initialPitch = median(gaps.filter((gap) => gap > 0)) || unit;
  const groups: RawRow[][] = [];
  let current: RawRow[] = [];
  let recent: number[] = [];
  for (const row of rows) {
    if (!current.length) {
      current = [row];
      recent = [];
      continue;
    }
    const last = current[current.length - 1];
    const gap = row.y - last.y;
    const pitch = recent.length ? median(recent) : initialPitch;
    const lastCount = modeNumber(current.map((item) => item.xs.length));
    // Scans drop the odd bubble (faint print, a pencil stroke over the ring),
    // so a row may have two fewer bubbles than its neighbours.
    const sameCount =
      Math.abs(row.xs.length - lastCount) <= (lastCount <= 6 ? 1 : 2);
    const sameStart =
      lastCount > 6 ||
      Math.abs(row.xs[0] - last.xs[0]) <= Math.max(unit * 1.2, pitch * 0.6);
    const singleColumn =
      row.xs.length === 1 &&
      last.xs.length === 1 &&
      Math.abs(row.xs[0] - last.xs[0]) <= unit;
    const overlap =
      Math.min(
        row.xs[row.xs.length - 1],
        Math.max(...current.map((item) => item.xs[item.xs.length - 1])),
      ) - Math.max(row.xs[0], Math.min(...current.map((item) => item.xs[0])));
    const samePlace = singleColumn || overlap > unit * 1.5;
    const maxGap = Math.max(pitch * 2.1, unit * 1.8);
    if (!sameCount || !sameStart || !samePlace || gap > maxGap) {
      groups.push(current);
      current = [row];
      recent = [];
    } else {
      current.push(row);
      recent.push(gap);
      if (recent.length > 5) recent.shift();
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function columnPositions(rows: RawRow[], columns: number): number[] {
  // Cluster every bubble x position. Rows with a dropped ring still vote for
  // the right column, unlike an index-based median.
  const xs = rows.flatMap((row) => row.xs).sort((a, b) => a - b);
  const span = xs.length ? xs[xs.length - 1] - xs[0] : 0;
  const tolerance = Math.max(6, span * 0.006);
  const clusters: { sum: number; count: number }[] = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(x - last.sum / last.count) <= tolerance) {
      last.sum += x;
      last.count += 1;
    } else {
      clusters.push({ sum: x, count: 1 });
    }
  }
  if (clusters.length >= columns) {
    return clusters
      .map((cluster) => ({ x: cluster.sum / cluster.count, count: cluster.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, columns)
      .sort((a, b) => a.x - b.x)
      .map((cluster) => cluster.x);
  }
  const full = rows.filter((row) => row.xs.length === columns);
  const source = full.length ? full : rows;
  const result: number[] = [];
  for (let i = 0; i < columns; i++) {
    const values: number[] = [];
    for (const row of source) {
      if (i < row.xs.length) values.push(row.xs[i]);
    }
    result.push(median(values));
  }
  return result;
}

function regularColumns(xs: number[], unit: number): boolean {
  if (xs.length < 2) return true;
  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (mean < unit * 0.8) return false;
  const variance =
    gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / Math.max(1, gaps.length);
  return Math.sqrt(variance) / mean < 0.2;
}

function buildTemplateGrids(
  page: SurveyTextPage,
  bubbles: SurveyBubble[],
): SurveyTemplateGrid[] {
  if (!bubbles.length) return [];
  const unit = median(bubbles.map((bubble) => bubble.r * 2));
  const rows = clusterRows(bubbles, unit * 0.5);
  const groups = segmentGrids(rows, unit);
  const grids: SurveyTemplateGrid[] = [];
  groups.forEach((group, groupIndex) => {
    const columns = modeNumber(group.map((row) => row.xs.length));
    if (columns < 1) return;
    const columnX = columnPositions(group, columns);
    if (!regularColumns(columnX, unit)) return;
    const rowY = group.map((row) => row.y);
    const top = Math.min(...group.map((row) => row.y));
    const bottom = Math.max(...group.map((row) => row.y));
    const left = Math.min(...group.flatMap((row) => row.xs));
    const right = Math.max(...group.flatMap((row) => row.xs));
    const isCandidate =
      group.length === 10 && columns === 4 && top < page.height * 0.45;
    grids.push({
      id: `p${page.page}g${groupIndex + 1}`,
      page: page.page,
      index: groupIndex + 1,
      title: '',
      rows: group.map((_, index) => `第 ${index + 1} 行`),
      columns,
      mode: columns === 1 ? 'single' : 'rank',
      isCandidate,
      rect: { x: left - unit, y: top - unit, w: right - left + unit * 2, h: bottom - top + unit * 2 },
      rowY,
      columnX,
      bubbleSize: unit,
    });
  });
  return grids;
}

function chineseOnly(value: string): boolean {
  return /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef()]/.test(value);
}

function stripLabel(value: string): string {
  return value
    .replace(/[\s\u3000]/g, '')
    .replace(/[（(]\s*$/g, '')
    .replace(/[@#*^%&]+$/g, '')
    .trim();
}

interface RowLabel {
  label: string;
  code?: string;
}

function rowLabel(
  items: SurveyTextItem[],
  top: number,
  bottom: number,
  gridLeft: number,
  columns: number,
): RowLabel {
  const band = items
    .filter((item) => {
      const centre = item.y - item.height * 0.4;
      return centre >= top && centre <= bottom && item.x < gridLeft - 1;
    })
    .filter((item) => item.text.trim());

  if (!band.length) return { label: '' };

  const numeric = band
    .filter((item) => /^\d{2,3}$/.test(item.text.trim()))
    .sort((a, b) => a.x - b.x);
  const codeItem = columns === 1 ? numeric[numeric.length - 1] : undefined;

  let labelItems = band.filter((item) => chineseOnly(item.text));
  let code: string | undefined;
  if (codeItem) {
    code = codeItem.text.trim();
    const named = labelItems.filter((item) => item.x > codeItem.x + 1);
    if (named.length) labelItems = named;
  }
  labelItems = labelItems.sort((a, b) => a.y - b.y || a.x - b.x);
  return { label: stripLabel(labelItems.map((item) => item.text).join('')), code };
}

function textLines(items: SurveyTextItem[]): { y: number; text: string }[] {
  const lines: { y: number; items: SurveyTextItem[] }[] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - item.y) <= item.height * 0.7) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => ({
    y: line.y,
    text: line.items
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join('')
      .replace(/[\s\u3000]/g, ''),
  }));
}

function gridTitle(
  items: SurveyTextItem[],
  grid: SurveyTemplateGrid,
  pageTitle: string,
  isFirst: boolean,
): string {
  const top = grid.rowY[0] - grid.bubbleSize * 8;
  const lines = textLines(
    items.filter((item) => {
      const centre = item.y - item.height * 0.4;
      return centre < grid.rowY[0] - grid.bubbleSize && centre >= top;
    }),
  ).filter((line) => chineseOnly(line.text));
  const questions = lines.filter(
    (line) => /^[0-9０-９]+[.．]/.test(line.text) || line.text.includes('考慮以下'),
  );
  const best = questions[questions.length - 1];
  if (best) {
    const cleaned = best.text
      .replace(/^[0-9０-９]+[.．]\s*/, '')
      .split(/[，。；]/)[0]
      .trim();
    return cleaned.slice(0, 30) || pageTitle;
  }
  return isFirst ? pageTitle || '第 1 部分' : `第 ${grid.index} 部分`;
}

function pageTitle(items: SurveyTextItem[], height: number): string {
  const lines = textLines(items.filter((item) => item.y < height * 0.35));
  for (const line of lines) {
    const match = /中三升中四第[一二三]次選科意願調查問卷[（(]?[0-9]{4}-[0-9]{4}[)）]?/.exec(
      line.text,
    );
    if (match) return match[0];
  }
  const top = lines.filter((line) => chineseOnly(line.text));
  return top.length ? top[0].text.slice(0, 30) : '';
}

function assignLabels(
  page: SurveyTextPage,
  items: SurveyTextItem[],
  grids: SurveyTemplateGrid[],
): void {
  const title = pageTitle(items, page.height);
  let contentIndex = 0;
  for (const grid of grids) {
    if (grid.isCandidate) {
      grid.rows = grid.rowY.map((_, index) => String(index));
      grid.title = '考生號碼';
      continue;
    }
    const pitch = grid.rowY.length > 1 ? grid.rowY[1] - grid.rowY[0] : grid.bubbleSize * 2;
    const labels: string[] = [];
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < grid.rowY.length; i++) {
      const top =
        i === 0 ? grid.rowY[0] - pitch * 0.55 : (grid.rowY[i - 1] + grid.rowY[i]) / 2;
      const bottom =
        i === grid.rowY.length - 1
          ? grid.rowY[i] + pitch * 0.55
          : (grid.rowY[i] + grid.rowY[i + 1]) / 2;
      const found = rowLabel(items, top, bottom, grid.rect.x + grid.bubbleSize, grid.columns);
      labels.push(found.label || `第 ${i + 1} 行`);
      codes.push(found.code);
    }
    grid.rows = labels;
    if (codes.some(Boolean)) grid.codes = codes;
    grid.title = gridTitle(items, grid, title, contentIndex === 0);
    contentIndex += 1;
  }
}

/**
 * Build the form definition from the blank form PDF's text layer. Each bubble
 * in these Word-generated forms is one Wingdings glyph, and the subject names
 * are ordinary text, so no OCR is involved.
 */
export function buildSurveyTemplateFromPages(
  name: string,
  textPages: SurveyTextPage[],
): SurveyTemplate {
  const pages: SurveyTemplatePage[] = [];
  for (const textPage of textPages) {
    const bubbles: SurveyBubble[] = [];
    const items: SurveyTextItem[] = [];
    for (const item of textPage.items) {
      const text = item.text;
      if (!text) continue;
      if (text.includes(SURVEY_BUBBLE_CHAR)) {
        const count = [...text].filter((char) => char === SURVEY_BUBBLE_CHAR).length;
        const step = count ? item.width / count : item.width;
        for (let i = 0; i < count; i++) {
          bubbles.push({
            x: item.x + step * (i + 0.5),
            y: item.y,
            r: Math.max(2, item.height / 2),
          });
        }
      } else if (text.trim()) {
        items.push(item);
      }
    }
    const grids = buildTemplateGrids(textPage, bubbles);
    assignLabels(textPage, items, grids);
    const bubbleSize = median(bubbles.map((bubble) => bubble.r * 2)) || 12;
    pages.push({
      page: textPage.page,
      width: textPage.width,
      height: textPage.height,
      title: pageTitle(items, textPage.height),
      grids,
      bubbleSize,
    });
  }
  return { name, createdAt: Date.now(), pages };
}

/* ------------------------------------------------------------------ */
/* Scanning a rendered page                                            */
/* ------------------------------------------------------------------ */

interface Component {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  sumX: number;
  sumY: number;
}

function paperLevel(data: Uint8Array): number {
  // The most common bright value is the paper. A percentile is unreliable on
  // A3 scans: the black margins around the sheet can be >10% of the pixels.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) histogram[data[i]] += 1;
  let best = 255;
  let bestCount = -1;
  for (let value = 128; value < 256; value++) {
    if (histogram[value] > bestCount) {
      best = value;
      bestCount = histogram[value];
    }
  }
  return best;
}

function darkFraction(data: Uint8Array, threshold: number): number {
  let dark = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < threshold) dark += 1;
  return dark / Math.max(1, data.length);
}

function sampleMean(
  gray: SurveyGrayImage,
  cx: number,
  cy: number,
  radius: number,
): number {
  const { data, width, height } = gray;
  const left = Math.max(0, Math.round(cx - radius));
  const right = Math.min(width - 1, Math.round(cx + radius));
  const top = Math.max(0, Math.round(cy - radius));
  const bottom = Math.min(height - 1, Math.round(cy + radius));
  let sum = 0;
  let count = 0;
  for (let y = top; y <= bottom; y++) {
    const row = y * width;
    for (let x = left; x <= right; x++) {
      sum += data[row + x];
      count += 1;
    }
  }
  return count ? sum / count : 255;
}

function isBubbleShape(
  gray: SurveyGrayImage,
  component: Component,
  threshold: number,
): boolean {
  const bw = component.maxX - component.minX + 1;
  const bh = component.maxY - component.minY + 1;
  const diameter = Math.max(bw, bh);
  const cx = (component.minX + component.maxX) / 2;
  const cy = (component.minY + component.maxY) / 2;
  const centre = sampleMean(gray, cx, cy, Math.max(1, diameter * 0.1));
  const fill = component.area / Math.max(1, bw * bh);
  const circle = component.area / Math.max(1, Math.PI * (diameter / 2) ** 2);
  if (centre > threshold + 25) {
    // Printed ring: the centre is paper, the rim is ink all the way round.
    // Chinese glyphs with a small enclosed hole fail the 12-point rim test.
    let dark = 0;
    for (let k = 0; k < 12; k++) {
      const angle = (k * Math.PI) / 6;
      const value = sampleMean(
        gray,
        cx + Math.cos(angle) * diameter * 0.42,
        cy + Math.sin(angle) * diameter * 0.42,
        1.2,
      );
      if (value < threshold) dark += 1;
    }
    return dark >= 8 && centre > 210;
  }
  // Shaded bubble: a mostly solid round disc.
  return fill > 0.5 && circle > 0.5;
}

export function findBubbleCenters(gray: SurveyGrayImage, expected: number): SurveyBubble[] {
  const { data, width, height } = gray;
  const paper = paperLevel(data);
  const threshold = Math.max(110, Math.min(205, paper - 55));
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = data[i] < threshold ? 1 : 0;
  const visited = new Uint8Array(data.length);
  const stack = new Int32Array(data.length);
  const minSize = expected * 0.62;
  const maxSize = expected * 1.6;
  const bubbles: SurveyBubble[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    while (top > 0) {
      const pixel = stack[--top];
      const y = (pixel / width) | 0;
      const x = pixel - y * width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        const row = ny * width;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = row + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            stack[top++] = next;
          }
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const diameter = Math.max(bw, bh);
    if (diameter < minSize || diameter > maxSize) continue;
    if (Math.abs(bw - bh) > diameter * 0.4) continue;
    if (area < 12) continue;
    const component: Component = { minX, minY, maxX, maxY, area, sumX, sumY };
    if (!isBubbleShape(gray, component, threshold)) continue;
    bubbles.push({
      // The centroid is stable when a faint speck joins the ring; the bbox
      // centre is not.
      x: sumX / area,
      y: sumY / area,
      r: diameter / 2,
    });
  }
  return bubbles;
}

interface TemplatePoint {
  x: number;
  y: number;
  candidate: boolean;
}

interface Alignment {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  matched: number;
  total: number;
  score: number;
  median: number;
  /** Per-column and per-row positions measured on this page. */
  columns?: number[];
  rows?: number[];
}

function templatePoints(page: SurveyTemplatePage): TemplatePoint[] {
  const points: TemplatePoint[] = [];
  for (const grid of page.grids) {
    for (const y of grid.rowY) {
      for (const x of grid.columnX) {
        points.push({
          x: x + grid.bubbleSize * 0.47,
          y,
          candidate: grid.isCandidate,
        });
      }
    }
  }
  return points;
}

function fitAxis(source: number[], target: number[]): [number, number] {
  const count = source.length;
  if (!count) return [1, 0];
  const meanSource = source.reduce((sum, value) => sum + value, 0) / count;
  const meanTarget = target.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < count; i++) {
    numerator += (source[i] - meanSource) * (target[i] - meanTarget);
    denominator += (source[i] - meanSource) ** 2;
  }
  const scale = denominator > 1e-6 ? numerator / denominator : 1;
  return [scale, meanTarget - scale * meanSource];
}

/**
 * Fit the blank page's bubble lattice onto the scanned page. The rest of the
 * page (subject text, signatures, table lines) is treated as noise: a correct
 * alignment is the one where most template bubbles land on a printed circle.
 */
function alignPage(
  detections: SurveyBubble[],
  points: TemplatePoint[],
  gray: SurveyGrayImage,
  page: SurveyTemplatePage,
): Alignment | null {
  if (detections.length < 10 || points.length === 0) return null;
  const expected = page.bubbleSize * (gray.width / Math.max(1, page.width));
  const baseX = gray.width / page.width;
  const baseY = gray.height / page.height;
  const templateXs = points.map((point) => point.x);
  const templateYs = points.map((point) => point.y);
  const centreX = median(templateXs);
  const centreY = median(templateYs);
  const detCentreX = median(detections.map((bubble) => bubble.x));
  const detCentreY = median(detections.map((bubble) => bubble.y));
  let best: Alignment | null = null;
  for (let factor = 0.94; factor <= 1.0601; factor += 0.005) {
    const baseSx = baseX * factor;
    const baseSy = baseY * factor;
    // Full-page coarse translation search: page 3 is mostly text, so a
    // centre-of-mass guess is unreliable (the APL bubbles are one column).
    const step = 6;
    const originX = -gray.width / 2;
    const originY = -gray.height / 2;
    const bins = Math.ceil(gray.width / step) + 2;
    const binsY = Math.ceil(gray.height / step) + 2;
    const votes = new Int32Array(bins * binsY);
    for (let i = 0; i < points.length; i += 2) {
      const px = points[i].x * baseSx;
      const py = points[i].y * baseSy;
      for (const det of detections) {
        const bx = Math.round((det.x - px - originX) / step);
        const by = Math.round((det.y - py - originY) / step);
        if (bx >= 0 && bx < bins && by >= 0 && by < binsY) {
          votes[by * bins + bx] += 1;
        }
      }
    }
    let bestBin = 0;
    for (let i = 1; i < votes.length; i++) {
      if (votes[i] > votes[bestBin]) bestBin = i;
    }
    if (votes[bestBin] < Math.max(5, Math.ceil(points.length * 0.15))) continue;
    let tx = originX + (bestBin % bins) * step;
    let ty = originY + Math.floor(bestBin / bins) * step;
    let sx = baseSx;
    let sy = baseSy;
    let matchedCount = 0;
    let distances: number[] = [];
    for (let iteration = 0; iteration < 4; iteration++) {
      const tolerance = iteration === 0 ? 16 : iteration === 1 ? 11 : 7;
      const srcX: number[] = [];
      const srcY: number[] = [];
      const dstX: number[] = [];
      const dstY: number[] = [];
      for (const point of points) {
        const px = point.x * sx + tx;
        const py = point.y * sy + ty;
        let bestDistance = Infinity;
        let bestBubble: SurveyBubble | null = null;
        for (const det of detections) {
          const distance = (det.x - px) ** 2 + (det.y - py) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestBubble = det;
          }
        }
        if (bestBubble && Math.sqrt(bestDistance) <= tolerance) {
          srcX.push(point.x);
          srcY.push(point.y);
          dstX.push(bestBubble.x);
          dstY.push(bestBubble.y);
        }
      }
      matchedCount = srcX.length;
      if (matchedCount < 10) break;
      const [nextSx, nextTx] = fitAxis(srcX, dstX);
      const [nextSy, nextTy] = fitAxis(srcY, dstY);
      // Keep the scale sane; a bad pairing must not stretch the page.
      if (nextSx > baseX * 0.9 && nextSx < baseX * 1.1) {
        sx = nextSx;
        tx = nextTx;
      }
      if (nextSy > baseY * 0.9 && nextSy < baseY * 1.1) {
        sy = nextSy;
        ty = nextTy;
      }
      distances = [];
      for (const point of points) {
        const px = point.x * sx + tx;
        const py = point.y * sy + ty;
        let bestDistance = Infinity;
        for (const det of detections) {
          const distance = (det.x - px) ** 2 + (det.y - py) ** 2;
          if (distance < bestDistance) bestDistance = distance;
        }
        distances.push(Math.sqrt(bestDistance));
      }
    }
    const matched = distances.filter((distance) => distance <= expected * 0.45).length;
    const medianDistance = median(distances);
    const alignment: Alignment = {
      sx,
      sy,
      tx,
      ty,
      matched,
      total: points.length,
      score: points.length ? matched / points.length : 0,
      median: medianDistance,
    };
    if (
      !best ||
      alignment.score > best.score + 0.01 ||
      (Math.abs(alignment.score - best.score) <= 0.01 && alignment.median < best.median)
    ) {
      best = alignment;
    }
  }
  return best;
}

function refineGrid(
  grid: SurveyTemplateGrid,
  detections: SurveyBubble[],
  base: Alignment,
  expected: number,
): Alignment {
  const tplX = grid.columnX.map((x) => x + grid.bubbleSize * 0.47);
  const tplY = grid.rowY;
  if (!tplX.length || !tplY.length || !detections.length) return base;
  const pitchX = tplX.length > 1 ? (tplX[tplX.length - 1] - tplX[0]) / (tplX.length - 1) : grid.bubbleSize * 2;
  const pitchY = tplY.length > 1 ? (tplY[tplY.length - 1] - tplY[0]) / (tplY.length - 1) : grid.bubbleSize * 2;
  const baseLeft = Math.min(...tplX) * base.sx + base.tx;
  const baseRight = Math.max(...tplX) * base.sx + base.tx;
  const baseTop = Math.min(...tplY) * base.sy + base.ty;
  const baseBottom = Math.max(...tplY) * base.sy + base.ty;
  const marginX = pitchX * base.sx * 2.2;
  const marginY = pitchY * base.sy * 2.4;
  const inGrid = detections.filter(
    (det) =>
      det.x >= baseLeft - marginX &&
      det.x <= baseRight + marginX &&
      det.y >= baseTop - marginY &&
      det.y <= baseBottom + marginY,
  );
  if (inGrid.length < 3) return base;

  const rowGroups: { y: number; items: SurveyBubble[] }[] = [];
  for (const det of [...inGrid].sort((a, b) => a.y - b.y)) {
    const group = rowGroups[rowGroups.length - 1];
    if (group && Math.abs(group.y - det.y) <= expected * 0.55) {
      group.items.push(det);
      group.y = group.items.reduce((sum, item) => sum + item.y, 0) / group.items.length;
    } else {
      rowGroups.push({ y: det.y, items: [det] });
    }
  }
  const minRowItems = Math.max(1, Math.ceil(grid.columns * 0.6));
  const usableRows = rowGroups.filter((group) => group.items.length >= minRowItems);
  if (!usableRows.length) return base;

  // Bottom edge: nothing is printed below a grid, so the lowest bubble row is
  // a reliable anchor even when the candidate header handwriting sits above.
  const sy = base.sy;
  const ty = usableRows[usableRows.length - 1].y - tplY[tplY.length - 1] * sy;
  const rowPositions = tplY.map((y) => {
    const predicted = y * sy + ty;
    let best: { y: number; items: SurveyBubble[] } | null = null;
    let bestDistance = Infinity;
    for (const group of usableRows) {
      const distance = Math.abs(group.y - predicted);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = group;
      }
    }
    return best && bestDistance <= pitchY * sy * 0.5 ? best.y : predicted;
  });

  // Right edge: the 排序 handwriting is to the left of the bubble table, so the
  // rightmost bubble column is the stable anchor for x.
  const rowRights = usableRows.map((group) => Math.max(...group.items.map((item) => item.x)));
  const detRight = median(rowRights);
  let sx = base.sx;
  let tx = detRight - tplX[tplX.length - 1] * sx;
  const columns = tplX.map((x) => x * sx + tx);
  for (let column = 0; column < tplX.length; column++) {
    const predicted = columns[column];
    const offsets: number[] = [];
    for (const det of inGrid) {
      if (Math.abs(det.x - predicted) > pitchX * sx * 0.35) continue;
      if (det.y < rowPositions[0] - pitchY * sy * 0.8) continue;
      if (det.y > rowPositions[rowPositions.length - 1] + pitchY * sy * 0.8) continue;
      offsets.push(det.x - predicted);
    }
    if (offsets.length) columns[column] = predicted + median(offsets);
  }
  if (columns.length >= 2) {
    const guessSx = (columns[columns.length - 1] - columns[0]) / (tplX[tplX.length - 1] - tplX[0]);
    if (Number.isFinite(guessSx) && guessSx > base.sx * 0.9 && guessSx < base.sx * 1.1) {
      sx = guessSx;
      tx = columns[0] - tplX[0] * sx;
    }
  }

  const distances: number[] = [];
  for (const x of columns) {
    for (const y of rowPositions) {
      let bestDistance = Infinity;
      for (const det of detections) {
        const distance = (det.x - x) ** 2 + (det.y - y) ** 2;
        if (distance < bestDistance) bestDistance = distance;
      }
      distances.push(Math.sqrt(bestDistance));
    }
  }
  const matched = distances.filter((distance) => distance <= expected * 0.45).length;
  return {
    ...base,
    sx,
    sy,
    tx,
    ty,
    columns,
    rows: rowPositions,
    matched,
    total: distances.length,
    score: distances.length ? matched / distances.length : 0,
    median: median(distances),
  };
}

function coreInk(
  gray: SurveyGrayImage,
  cx: number,
  cy: number,
  radius: number,
  threshold: number,
): number {
  const { data, width, height } = gray;
  const left = Math.max(0, Math.floor(cx - radius));
  const right = Math.min(width - 1, Math.ceil(cx + radius));
  const top = Math.max(0, Math.floor(cy - radius));
  const bottom = Math.min(height - 1, Math.ceil(cy + radius));
  let dark = 0;
  let count = 0;
  for (let y = top; y <= bottom; y++) {
    const row = y * width;
    for (let x = left; x <= right; x++) {
      count += 1;
      if (data[row + x] < threshold) dark += 1;
    }
  }
  return count ? dark / count : 0;
}

function mappedX(grid: SurveyTemplateGrid, column: number, align: Alignment): number {
  return (
    align.columns?.[column] ??
    (grid.columnX[column] + grid.bubbleSize * 0.47) * align.sx + align.tx
  );
}

function mappedY(grid: SurveyTemplateGrid, row: number, align: Alignment): number {
  return align.rows?.[row] ?? grid.rowY[row] * align.sy + align.ty;
}

function readGridAligned(
  gray: SurveyGrayImage,
  grid: SurveyTemplateGrid,
  align: Alignment,
  threshold: number,
): SurveyGridRead {
  const values: (number | null)[] = [];
  const ink: number[] = [];
  const ambiguous: number[] = [];
  const faint: number[] = [];
  const radius = Math.max(2, grid.bubbleSize * align.sx * 0.22);
  for (let row = 0; row < grid.rows.length; row++) {
    const scores: number[] = [];
    for (let column = 0; column < grid.columns; column++) {
      scores.push(coreInk(gray, mappedX(grid, column, align), mappedY(grid, row, align), radius, threshold));
    }
    if (grid.id === 'p1g2' && row === 0) {
    }
    const order = scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score);
    const top = order[0];
    const second = order[1] ?? { score: 0, index: -1 };
    ink.push(top.score);
    if (grid.mode === 'single') {
      if (top.score >= 0.28) {
        values.push(1);
        if (top.score < 0.4) faint.push(row);
      } else {
        values.push(null);
      }
      continue;
    }
    // A blank ring leaves up to ~0.24 of ink in its centre on a dark scan;
    // a real pencil mark is 0.3+.
    if (top.score < 0.25) {
      values.push(null);
      continue;
    }
    values.push(top.index + 1);
    if (top.score < 0.32) faint.push(row);
    if (second.score >= top.score * 0.62 && top.score - second.score < 0.07) {
      ambiguous.push(row);
    }
  }
  return { values, ink, ambiguous, faint };
}

function readCandidateAligned(
  gray: SurveyGrayImage,
  grid: SurveyTemplateGrid,
  align: Alignment,
  threshold: number,
): { candidateNo: string; flags: number[] } {
  let candidateNo = '';
  const flags: number[] = [];
  const radius = Math.max(2, grid.bubbleSize * align.sx * 0.22);
  for (let column = 0; column < Math.min(4, grid.columns); column++) {
    const scores: number[] = [];
    for (let row = 0; row < Math.min(10, grid.rows.length); row++) {
      scores.push(coreInk(gray, mappedX(grid, column, align), mappedY(grid, row, align), radius, threshold));
    }
    const order = scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score);
    const top = order[0];
    const second = order[1] ?? { score: 0, index: -1 };
    if (!top || top.score < 0.05) {
      candidateNo += '?';
      flags.push(column);
    } else {
      candidateNo += String(top.index);
      if (second.score > top.score * 0.7) flags.push(column);
    }
  }
  return { candidateNo, flags };
}

function scanGeometry(
  template: SurveyTemplatePage,
  base: Alignment,
  aligns: Map<string, Alignment>,
): SurveyScanGrid[] {
  return template.grids.map((grid) => {
    const align = aligns.get(grid.id) ?? base;
    return {
      rect: {
        x: Math.min(...grid.columnX.map((_, c) => mappedX(grid, c, align))) - grid.bubbleSize * align.sx,
        y: Math.min(...grid.rowY.map((_, r) => mappedY(grid, r, align))) - grid.bubbleSize * align.sy,
        w:
          Math.max(...grid.columnX.map((_, c) => mappedX(grid, c, align))) -
          Math.min(...grid.columnX.map((_, c) => mappedX(grid, c, align))) +
          grid.bubbleSize * align.sx * 2,
        h:
          Math.max(...grid.rowY.map((_, r) => mappedY(grid, r, align))) -
          Math.min(...grid.rowY.map((_, r) => mappedY(grid, r, align))) +
          grid.bubbleSize * align.sy * 2,
      },
      rows: grid.rows.length,
      columns: grid.columns,
      rowY: grid.rowY.map((_, r) => mappedY(grid, r, align)),
      columnX: grid.columnX.map((_, c) => mappedX(grid, c, align)),
      bubbleSize: grid.bubbleSize * align.sx,
      isCandidate: grid.isCandidate,
    };
  });
}

/**
 * Read one logical page (a full A4, or one half of an A3) against the template.
 * Every template page is tried; the one whose bubble lattice fits the scan is
 * used. Returns the marked value of every row and the 4-digit candidate number.
 */
export function analyseSurveyGrayPage(
  gray: SurveyGrayImage,
  template: SurveyTemplate,
  expectedPage?: SurveyTemplatePage,
): SurveyPageRead {
  const data = gray.data;
  const paper = paperLevel(data);
  const threshold = Math.max(110, Math.min(205, paper - 55));
  const inkFraction = darkFraction(data, threshold);
  const hintPage = expectedPage ?? template.pages[0];
  const hint = hintPage.bubbleSize * (gray.width / Math.max(1, hintPage.width));
  const bubbles = findBubbleCenters(gray, hint);
  const flags: string[] = [];
  const grids: Record<string, SurveyGridRead> = {};
  let candidateNo = '';
  let candidateFlags: number[] = [];
  let bestPage: SurveyTemplatePage | undefined;
  let bestAlign: Alignment | null = null;
  let bestGridAligns = new Map<string, Alignment>();
  let bestScore = 0;
  for (const page of template.pages) {
    const points = templatePoints(page);
    const align = alignPage(bubbles, points, gray, page);
    if (!align) continue;
    const gridAligns = new Map<string, Alignment>();
    let weighted = 0;
    let totalPoints = 0;
    for (const grid of page.grids) {
      const own = refineGrid(grid, bubbles, align, hint);
      gridAligns.set(grid.id, own);
      const weight = grid.rows.length * grid.columns;
      weighted += own.score * weight;
      totalPoints += weight;
    }
    let score = totalPoints ? weighted / totalPoints : align.score;
    // A page with the candidate block must also fit that block: otherwise a
    // handful of matching bubbles on another page can win.
    const candidate = page.grids.find((grid) => grid.isCandidate);
    if (candidate) {
      const own = gridAligns.get(candidate.id);
      if (own) score = Math.min(score, own.score * 0.55 + score * 0.45);
    }
    if (
      !bestAlign ||
      score > bestScore + 0.01 ||
      (Math.abs(score - bestScore) <= 0.01 && align.median < bestAlign.median)
    ) {
      bestScore = score;
      bestAlign = { ...align, score };
      bestPage = page;
      bestGridAligns = gridAligns;
    }
  }
  if (!bestPage || !bestAlign || bestScore < 0.45) {
    return {
      templatePage: 0,
      cost: 99,
      candidateNo,
      candidateFlags,
      grids,
      scanGrids: [],
      flags: ['未能辨識頁面'],
      inkFraction,
    };
  }
  if (bestScore < 0.75) flags.push('頁面配對不準');
  const gridAligns = bestGridAligns;
  const candidateGrid = bestPage.grids.find((grid) => grid.isCandidate);
  if (candidateGrid) {
    const read = readCandidateAligned(
      gray,
      candidateGrid,
      gridAligns.get(candidateGrid.id) ?? bestAlign,
      threshold,
    );
    candidateNo = read.candidateNo;
    candidateFlags = read.flags;
    if (candidateNo.includes('?')) flags.push('考生號碼未能讀取');
    if (candidateFlags.length) flags.push('考生號碼有兩個填畫');
  }
  const contentGrids = bestPage.grids.filter((grid) => !grid.isCandidate);
  for (const grid of contentGrids) {
    const read = readGridAligned(
      gray,
      grid,
      gridAligns.get(grid.id) ?? bestAlign,
      threshold,
    );
    grids[grid.id] = read;
    const name =
      grid.mode === 'single'
        ? '應用學習'
        : contentGrids.length > 1
          ? `第 ${grid.page} 頁第 ${contentGrids.indexOf(grid) + 1} 組`
          : `第 ${grid.page} 頁`;
    if (read.ambiguous.length) flags.push(`「${name}」有雙填畫`);
    if (read.faint.length) flags.push(`「${name}」有淡色填畫`);
  }
  return {
    templatePage: bestPage.page,
    cost: Math.round((1 - bestScore) * 100) / 10,
    candidateNo,
    candidateFlags,
    grids,
    scanGrids: scanGeometry(bestPage, bestAlign, gridAligns),
    flags,
    inkFraction,
  };
}

/* ------------------------------------------------------------------ */
/* Form assembly                                                       */
/* ------------------------------------------------------------------ */

export interface SurveyRosterLookup {
  (candidateNo: string): { name: string; className: string; seatNo: string } | undefined;
}

export function assembleSurveyForms(
  pages: SurveyLogicalPage[],
  template: SurveyTemplate,
  lookup?: SurveyRosterLookup,
): SurveyForm[] {
  const ordered = [...pages]
    .filter((page) => !page.blank && page.read && page.read.templatePage > 0)
    .sort(
      (a, b) =>
        a.fileIndex - b.fileIndex ||
        a.pageNo - b.pageNo ||
        (a.half === 'left' ? 0 : 1) - (b.half === 'left' ? 0 : 1),
    );
  const contentPages = template.pages.filter((page) =>
    page.grids.some((grid) => !grid.isCandidate),
  );
  const expectedPages = contentPages.map((page) => page.page);
  const forms: SurveyForm[] = [];
  let current: SurveyLogicalPage[] = [];
  const flush = () => {
    if (!current.length) return;
    const formIndex = forms.length + 1;
    const pagesRef: SurveyFormPageRef[] = current.map((page) => ({
      pageId: page.id,
      templatePage: page.read?.templatePage ?? 0,
      fileName: page.fileName,
      pageNo: page.pageNo,
      half: page.half,
    }));
    const values: Record<string, (number | null)[]> = {};
    const ambiguous: string[] = [];
    const flags: string[] = [];
    let candidateNo = '';
    for (const page of current) {
      const read = page.read;
      if (!read) continue;
      if (read.templatePage === 1) candidateNo = read.candidateNo;
      for (const [gridId, grid] of Object.entries(read.grids)) {
        if (!values[gridId]) values[gridId] = grid.values;
        for (const row of grid.ambiguous) ambiguous.push(`${gridId}:${row}`);
      }
      for (const flag of read.flags) if (!flags.includes(flag)) flags.push(flag);
    }
    const present = new Set(pagesRef.map((page) => page.templatePage));
    const missing = expectedPages.filter((page) => !present.has(page));
    if (missing.length) flags.push(`缺少第 ${missing.join('、')} 頁`);
    const duplicated = pagesRef
      .map((page) => page.templatePage)
      .filter((page, index, all) => all.indexOf(page) !== index);
    if (duplicated.length) flags.push(`重複頁 ${[...new Set(duplicated)].join('、')}`);
    if (!candidateNo || candidateNo.includes('?')) {
      flags.push('未有考生號碼');
    }
    const roster = candidateNo ? lookup?.(candidateNo) : undefined;
    if (candidateNo && !candidateNo.includes('?') && !roster) {
      flags.push('名單冇此考生');
    }
    forms.push({
      id: `form${formIndex}`,
      candidateNo,
      name: roster?.name ?? '',
      className: roster?.className ?? '',
      seatNo: roster?.seatNo ?? '',
      pages: pagesRef,
      values,
      ambiguous,
      flags,
      reviewed: false,
    });
    current = [];
  };
  let lastTemplatePage = 0;
  for (const page of ordered) {
    const templatePage = page.read?.templatePage ?? 0;
    if (templatePage === 1) {
      flush();
      current = [page];
      lastTemplatePage = 1;
      continue;
    }
    if (!current.length || templatePage <= lastTemplatePage) {
      flush();
      current = [page];
      // A form that starts mid-way is incomplete; the flag is added on flush.
      if (templatePage !== 1) {
        page.read?.flags.push('缺少第 1 頁');
      }
    } else {
      current.push(page);
    }
    lastTemplatePage = templatePage;
  }
  flush();
  return forms;
}

export function formNeedsReview(form: SurveyForm): boolean {
  if (form.reviewed) return false;
  return form.flags.length > 0 || form.ambiguous.length > 0;
}

/** Value lookup that honours the teacher's per-form corrections. */
export function surveyValue(
  form: SurveyForm,
  gridId: string,
  row: number,
): number | null {
  return form.values[gridId]?.[row] ?? null;
}
