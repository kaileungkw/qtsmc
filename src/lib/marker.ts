import type {
  AnswerValue,
  CellMark,
  DetectedRow,
  Detection,
  Frame,
  HeaderInfo,
} from '../types';

/**
 * Geometry of the QTSMC answer sheet, expressed relative to each of the three
 * printed answer frames.  These numbers were measured across 63 answer blocks
 * (21 real scans) and are stable to within ~1.5 px at 1500 px page width.
 */
export const OPTIONS = ['A', 'B', 'C', 'D'] as const;
export const ROWS_PER_BLOCK = 20;
const COL_FRACS = [0.3, 0.501, 0.701, 0.901];
const ROW0_FRAC = 0.0719;
const ROW_PITCH_FRAC = 0.04751;
const BUBBLE_W_FRAC = 0.0681;
const BUBBLE_H_FRAC = 0.0129;

interface Segment {
  x: number;
  y0: number;
  y1: number;
}

interface Line {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  xc: number;
  len: number;
}

interface FramePair {
  a: Line;
  b: Line;
  gap: number;
  h: number;
  y0: number;
  y1: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}


/**
 * Normalise the paper to white and deepen the mid-tones. Scans from a phone or
 * photocopier often have uneven lighting and very light pencil marks; this LUT
 * makes those marks easier to measure without changing bubble geometry.
 */
export function enhanceGray(
  gray: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let acc = 0;
  let paper = 255;
  const target = gray.length * 0.9;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) {
      paper = v;
      break;
    }
  }
  const white = Math.max(60, paper);
  const black = 40;
  const span = Math.max(20, white - black);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.max(0, Math.min(1, (v - black) / span));
    lut[v] = Math.round(255 * Math.pow(t, 1.5));
  }
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = lut[gray[i]];
  void width;
  void height;
  return out;
}

export function rgbaToGray(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return out;
}

/** Adaptive mean threshold. 1 = ink, 0 = paper. */
export function adaptiveBinary(
  gray: Uint8Array,
  width: number,
  height: number,
  radius = 15,
  c = 9,
): Uint8Array {
  const iw = width + 1;
  const integral = new Int32Array(iw * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    const rowOff = y * iw;
    const prevOff = (y - 1) * iw;
    const srcOff = (y - 1) * width;
    for (let x = 1; x <= width; x++) {
      rowSum += gray[srcOff + x - 1];
      integral[rowOff + x] = integral[prevOff + x] + rowSum;
    }
  }
  const binary = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    const rowOff = y * width;
    const iy0 = y0 * iw;
    const iy1 = y1 * iw;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum =
        integral[iy1 + x1] - integral[iy0 + x1] - integral[iy1 + x0] + integral[iy0 + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (gray[rowOff + x] < mean - c) binary[rowOff + x] = 1;
    }
  }
  return binary;
}

export function collectVerticalSegments(
  binary: Uint8Array,
  width: number,
  height: number,
): Segment[] {
  // Automatic document feeders can skew a page by ~0.2°. A long frame line
  // then drifts across a few columns, so no single column contains the whole
  // line. Keep shorter runs and let mergeSegments join them; frameGridSupport
  // still rejects table cells and other false frames.
  const minLen = Math.floor(height * 0.12);
  const segs: Segment[] = [];
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      while (y < height && binary[y * width + x] === 0) y++;
      if (y >= height) break;
      const start = y;
      let last = y;
      let gap = 0;
      while (y < height) {
        if (binary[y * width + x]) {
          last = y;
          gap = 0;
        } else {
          gap++;
          if (gap > 4) break;
        }
        y++;
      }
      if (last - start + 1 >= minLen) {
        segs.push({ x, y0: start, y1: last });
      }
    }
  }
  return segs;
}

export function mergeSegments(segs: Segment[]): Line[] {
  const lines: Line[] = [];
  for (const seg of segs) {
    let target: Line | undefined;
    const segLen = seg.y1 - seg.y0;
    for (const line of lines) {
      if (seg.x - line.x1 > 3) continue;
      if (seg.x < line.x0) continue;
      const overlap = Math.min(seg.y1, line.y1) - Math.max(seg.y0, line.y0);
      const minLen = Math.min(segLen, line.y1 - line.y0);
      const yGap = Math.max(seg.y0, line.y0) - Math.min(seg.y1, line.y1);
      // JPEG/scanner noise can split a printed border into two runs. Merge
      // runs that overlap substantially, or that meet with only a tiny gap.
      if (overlap > 0.5 * minLen || yGap <= 6) {
        target = line;
        break;
      }
    }
    if (target) {
      target.x1 = Math.max(target.x1, seg.x);
      target.y0 = Math.min(target.y0, seg.y0);
      target.y1 = Math.max(target.y1, seg.y1);
    } else {
      lines.push({
        x0: seg.x,
        x1: seg.x,
        y0: seg.y0,
        y1: seg.y1,
        xc: seg.x,
        len: segLen,
      });
    }
  }
  for (const line of lines) {
    line.xc = (line.x0 + line.x1) / 2;
    line.len = line.y1 - line.y0;
  }
  return lines;
}

export function findAnswerFrames(
  binary: Uint8Array,
  width: number,
  height: number,
): Frame[] {
  const lines = mergeSegments(collectVerticalSegments(binary, width, height)).sort(
    (a, b) => a.xc - b.xc,
  );
  const pairs: FramePair[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      const gap = b.xc - a.xc;
      if (gap < 0.08 * width) continue;
      if (gap > 0.35 * width) break;
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const maxLen = Math.max(a.len, b.len);
      // The two borders of one block can be broken at different heights, so
      // compare their overlapping extent rather than exact endpoints.
      if (overlap < 0.62 * maxLen) continue;
      // Phone photos can contain large black borders / a second sheet, so the
      // frame height is not a fixed fraction of the whole image. Use a modest
      // absolute floor; grid verification later rejects header-table cells.
      const minFrameHeight = Math.max(0.22 * height, 350);
      if (Math.min(a.len, b.len) < minFrameHeight) continue;
      const y0 = Math.min(a.y0, b.y0);
      const y1 = Math.max(a.y1, b.y1);
      const h = y1 - y0;
      if (h < minFrameHeight) continue;
      const ratio = h / gap;
      if (ratio < 2.4 || ratio > 7) continue;
      pairs.push({ a, b, gap, h, y0, y1 });
    }
  }
  // Prefer the nearest valid vertical borders; this pairs each block's own
  // left and right frame lines instead of skipping a block.
  pairs.sort((p, q) => p.gap - q.gap);
  const used = new Set<Line>();
  const chosen: FramePair[] = [];
  for (const pair of pairs) {
    if (used.has(pair.a) || used.has(pair.b)) continue;
    used.add(pair.a);
    used.add(pair.b);
    chosen.push(pair);
  }
  const frames = chosen
    .map((p) => ({
      x: Math.round(p.a.xc),
      y: Math.round(p.y0),
      w: Math.round(p.b.xc - p.a.xc),
      h: Math.round(p.h),
    }))
    .filter((f) => f.w > 0 && f.h > 0)
    .sort((a, b) => a.x - b.x);

  if (frames.length <= 3) return frames;

  // A photo may contain two stacked sheets. Keep the group with the most
  // frames (normally the complete sheet).
  const groups: Frame[][] = [];
  for (const frame of [...frames].sort((a, b) => a.y - b.y)) {
    let group = groups.find(
      (g) =>
        Math.abs(frame.y - g[0].y) < 0.45 * Math.max(frame.h, g[0].h) &&
        Math.abs(frame.h - g[0].h) < 0.35 * g[0].h,
    );
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(frame);
  }
  const best = groups.sort((g1, g2) => {
    if (g2.length !== g1.length) return g2.length - g1.length;
    return g2.reduce((s, f) => s + f.w * f.h, 0) - g1.reduce((s, f) => s + f.w * f.h, 0);
  })[0];
  return best.slice(0, 4).sort((a, b) => a.x - b.x);
}

function percentile90(
  gray: Uint8Array,
  width: number,
  frame: Frame,
): number {
  const hist = new Uint32Array(256);
  const x0 = Math.max(0, frame.x);
  const x1 = Math.min(width, frame.x + frame.w);
  let count = 0;
  for (let y = Math.max(0, frame.y); y < frame.y + frame.h; y++) {
    const off = y * width;
    for (let x = x0; x < x1; x++) {
      hist[gray[off + x]]++;
      count++;
    }
  }
  if (count === 0) return 245;
  const target = count * 0.9;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

function ringMean(
  gray: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): number {
  const left = cx - hw + 1;
  const right = cx + hw - 1;
  const top = cy - hh + 1;
  const bottom = cy + hh - 1;
  const xs0 = cx - hw + 2;
  const xs1 = cx + hw - 2;
  const ys0 = cy - hh + 2;
  const ys1 = cy + hh - 2;
  if (left < 0 || right >= width || top < 0 || bottom >= height) return 255;
  let sum = 0;
  let n = 0;
  for (let x = xs0; x <= xs1; x++) {
    sum += gray[top * width + x] + gray[bottom * width + x];
    n += 2;
  }
  for (let y = ys0; y <= ys1; y++) {
    sum += gray[y * width + left] + gray[y * width + right];
    n += 2;
  }
  return n ? sum / n : 255;
}

interface CellScore {
  ink: number;
  base: number;
  faint: number;
  median: number;
  cx: number;
  cy: number;
  ring: number;
}

function measureBubble(
  gray: Uint8Array,
  width: number,
  height: number,
  cx0: number,
  cy0: number,
  bw: number,
  bh: number,
  paper: number,
  thr: number,
): CellScore {
  const hw = Math.max(6, Math.round(bw / 2));
  const hh = Math.max(4, Math.round(bh / 2));
  let best = { score: Infinity, dx: 0, dy: 0, ring: 255 };
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const rm = ringMean(gray, width, height, cx0 + dx, cy0 + dy, hw, hh);
      // Tiny preference for a centred match avoids drifting inside a solid mark.
      const score = rm + 1.2 * (Math.abs(dx) + Math.abs(dy));
      if (score < best.score) best = { score, dx, dy, ring: rm };
    }
  }
  const cx = cx0 + best.dx;
  const cy = cy0 + best.dy;
  const rx = Math.max(2, Math.round(bw * 0.22));
  const ry = Math.max(2, Math.round(bh * 0.22));
  let darkCount = 0;
  let depth = 0;
  let n = 0;
  const values: number[] = [];
  for (let y = cy - ry; y <= cy + ry; y++) {
    if (y < 0 || y >= height) continue;
    const off = y * width;
    for (let x = cx - rx; x <= cx + rx; x++) {
      if (x < 0 || x >= width) continue;
      const v = gray[off + x];
      values.push(v);
      if (v < thr) darkCount++;
      depth += clamp((paper - v) / Math.max(20, paper - 40), 0, 1);
      n++;
    }
  }
  const dark = n ? darkCount / n : 0;
  const depthAvg = n ? depth / n : 0;
  // A very light pencil mark can leave the middle of the bubble almost white
  // yet still shade most of its centre. Use the median of the central patch as
  // a second, conservative signal; show-through from the back of the page
  // tends to be patchy and leaves the median near paper white.
  values.sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : paper;
  const shade = clamp((paper - median) / Math.max(30, paper - 170), 0, 1);
  const faint = shade >= 0.27 ? shade * 0.65 : 0;
  const base = 0.55 * dark + 0.45 * depthAvg;
  return {
    ink: Math.max(base, faint),
    base,
    faint,
    median,
    cx,
    cy,
    ring: best.ring,
  };
}

function decide(scores: Record<'A' | 'B' | 'C' | 'D', number>): {
  answer: AnswerValue;
  status: 'ok' | 'low' | 'blank' | 'multi';
  confidence: number;
} {
  const sorted = OPTIONS.map((o) => [o, scores[o]] as const).sort(
    (a, b) => b[1] - a[1],
  );
  const [first, s1] = sorted[0];
  const [, s2] = sorted[1];
  const margin = s1 - s2;
  if (s1 < 0.17) {
    return { answer: 'blank', status: 'blank', confidence: 0 };
  }
  // A double mark normally has two similar-strength fills. A single solid
  // answer plus a grey scan shadow can otherwise look like two marks.
  if (s2 >= 0.21 && (margin < 0.06 || (s2 >= 0.32 && s2 >= 0.5 * s1))) {
    return { answer: 'multi', status: 'multi', confidence: 0 };
  }
  const low = s1 < 0.3 || margin < 0.075;
  return {
    answer: first,
    status: low ? 'low' : 'ok',
    confidence: clamp((margin - 0.01) / 0.25, 0, 1),
  };
}

/**
 * Estimate the small per-frame grid offset caused by scanner skew. The printed
 * bubble outlines give a strong periodic signal; choosing one offset for the
 * whole frame prevents the lower rows of the third block from drifting onto
 * their bottom outline on a slightly rotated page.
 */
function findFrameGridOffset(
  gray: Uint8Array,
  width: number,
  height: number,
  frame: Frame,
): { dx: number; dy: number } {
  const bw = BUBBLE_W_FRAC * frame.w;
  const bh = BUBBLE_H_FRAC * frame.h;
  const hw = Math.max(6, Math.round(bw / 2));
  const hh = Math.max(4, Math.round(bh / 2));
  let best = { score: Infinity, dx: 0, dy: 0 };
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      let sum = 0;
      let count = 0;
      for (let r = 0; r < ROWS_PER_BLOCK; r++) {
        const cy = Math.round(
          frame.y + (ROW0_FRAC + ROW_PITCH_FRAC * r) * frame.h + dy,
        );
        for (let c = 0; c < 4; c++) {
          const cx = Math.round(frame.x + COL_FRACS[c] * frame.w + dx);
          sum += ringMean(gray, width, height, cx, cy, hw, hh);
          count++;
        }
      }
      const score = count ? sum / count : Infinity;
      if (score < best.score) best = { score, dx, dy };
    }
  }
  return { dx: best.dx, dy: best.dy };
}

function readFrame(
  gray: Uint8Array,
  width: number,
  height: number,
  frame: Frame,
  blockIndex: number,
): DetectedRow[] {
  const paper = percentile90(gray, width, frame);
  const thr = Math.max(120, Math.min(210, paper - 55));
  const bw = BUBBLE_W_FRAC * frame.w;
  const bh = BUBBLE_H_FRAC * frame.h;
  const offset = findFrameGridOffset(gray, width, height, frame);
  const rows: DetectedRow[] = [];
  for (let r = 0; r < ROWS_PER_BLOCK; r++) {
    const cy0 =
      frame.y + (ROW0_FRAC + ROW_PITCH_FRAC * r) * frame.h + offset.dy;
    const cells: CellMark[] = [];
    const baseScores = { A: 0, B: 0, C: 0, D: 0 };
    const faintScores = { A: 0, B: 0, C: 0, D: 0 };
    for (let c = 0; c < 4; c++) {
      const cx0 = frame.x + COL_FRACS[c] * frame.w + offset.dx;
      const measured = measureBubble(
        gray,
        width,
        height,
        Math.round(cx0),
        Math.round(cy0),
        bw,
        bh,
        paper,
        thr,
      );
      const option = OPTIONS[c];
      baseScores[option] = measured.base;
      faintScores[option] = measured.faint;
      cells.push({
        option,
        cx: measured.cx,
        cy: measured.cy,
        ink: measured.ink,
      });
    }
    // Very light marks are useful only when no option has a normal-strength
    // mark. Otherwise a single solid answer plus surrounding paper texture can
    // be misread as "multi". Compute the row decision from base ink first.
    const maxBase = Math.max(baseScores.A, baseScores.B, baseScores.C, baseScores.D);
    const scores = { A: 0, B: 0, C: 0, D: 0 };
    for (const option of OPTIONS) {
      scores[option] =
        maxBase >= 0.3
          ? baseScores[option]
          : Math.max(baseScores[option], faintScores[option]);
      const cell = cells.find((entry) => entry.option === option);
      if (cell) cell.ink = scores[option];
    }
    const decision = decide(scores);
    rows.push({
      q: blockIndex * ROWS_PER_BLOCK + r + 1,
      block: blockIndex,
      answer: decision.answer,
      status: decision.status,
      confidence: decision.confidence,
      scores,
      cells,
    });
  }
  return rows;
}


/** Verify that a frame really contains the 4 x 20 printed bubble grid. */
export function frameGridSupport(
  gray: Uint8Array,
  width: number,
  height: number,
  frame: Frame,
): number {
  const paper = percentile90(gray, width, frame);
  const bw = BUBBLE_W_FRAC * frame.w;
  const bh = BUBBLE_H_FRAC * frame.h;
  const hw = Math.max(6, Math.round(bw / 2));
  const hh = Math.max(4, Math.round(bh / 2));
  let good = 0;
  let total = 0;
  for (let r = 0; r < ROWS_PER_BLOCK; r++) {
    const cy = Math.round(frame.y + (ROW0_FRAC + ROW_PITCH_FRAC * r) * frame.h);
    for (let c = 0; c < 4; c++) {
      const cx = Math.round(frame.x + COL_FRACS[c] * frame.w);
      // Find the darkest ring within a small search window.
      let darkest = 255;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const rm = ringMean(gray, width, height, cx + dx, cy + dy, hw, hh);
          if (rm < darkest) darkest = rm;
        }
      }
      if (darkest < paper - 30) good++;
      total++;
    }
  }
  return total ? good / total : 0;
}

/**
 * On an upright sheet the short vertical lines of the candidate-information
 * table sit above the answer frames. If they sit below, the page is upside down.
 */
function isUpsideDown(
  binary: Uint8Array,
  width: number,
  height: number,
  frames: Frame[],
): boolean {
  const lines = mergeSegments(collectVerticalSegments(binary, width, height));
  const top = Math.min(...frames.map((f) => f.y));
  const bottom = Math.max(...frames.map((f) => f.y + f.h));
  const xMin = Math.min(...frames.map((f) => f.x));
  const xMax = Math.max(...frames.map((f) => f.x + f.w));
  let above = 0;
  let below = 0;
  for (const line of lines) {
    if (line.len < 0.22 * height || line.len > 0.42 * height) continue;
    if (line.xc < xMin - 0.05 * width || line.xc > xMax + 0.05 * width) continue;
    if (line.y1 < top - 5) above++;
    else if (line.y0 > bottom + 5) below++;
  }
  return below >= 2 && above === 0;
}


/** Read Level / Class / Class No from the printed table above the answer grid. */
export function readHeaderFields(
  gray: Uint8Array,
  width: number,
  height: number,
  frame: Frame,
): HeaderInfo | undefined {
  const paper = percentile90(gray, width, frame);
  const thr = Math.max(120, Math.min(210, paper - 55));
  const bw = BUBBLE_W_FRAC * frame.w;
  const bh = BUBBLE_H_FRAC * frame.h;
  const hw = Math.max(6, Math.round(bw / 2));
  const hh = Math.max(4, Math.round(bh / 2));
  const y0 = frame.y - 0.461 * frame.h;
  const pitch = 0.0458 * frame.h;
  const levelX = frame.x - 0.507 * frame.w;
  const classX = frame.x - 0.055 * frame.w;
  const noTensX = frame.x + 0.367 * frame.w;
  const noUnitsX = frame.x + 0.592 * frame.w;
  if (y0 < 20 || levelX < 0 || noUnitsX > width) return undefined;

  const centers: { cx: number; cy: number }[] = [];
  for (let row = 0; row < 6; row++) {
    centers.push({ cx: levelX, cy: y0 + row * pitch });
  }
  for (let row = 0; row < 4; row++) {
    centers.push({ cx: classX, cy: y0 + row * pitch });
  }
  for (let row = 0; row < 10; row++) {
    centers.push({ cx: noTensX, cy: y0 + row * pitch });
    centers.push({ cx: noUnitsX, cy: y0 + row * pitch });
  }
  // Verify the printed header table is actually present; a cropped image must
  // not accidentally read background paper as a class.
  let printed = 0;
  for (const center of centers) {
    const cx = Math.round(center.cx);
    const cy = Math.round(center.cy);
    let darkest = 255;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        darkest = Math.min(darkest, ringMean(gray, width, height, cx + dx, cy + dy, hw, hh));
      }
    }
    if (darkest < paper - 30) printed++;
  }
  if (printed < 18) return undefined;

  const measure = (cx: number, cy: number): number => {
    const measured = measureBubble(
      gray,
      width,
      height,
      Math.round(cx),
      Math.round(cy),
      bw,
      bh,
      paper,
      thr,
    );
    // Header bubbles are sometimes filled solid, and sometimes marked with a
    // couple of pencil strokes. Use the normal ink measure; the printed table
    // support check above already rejects images without a header.
    return measured.ink;
  };

  const pickScores = (
    scores: number[],
    minInk = 0.24,
    minMargin = 0.05,
  ): { index: number; score: number; margin: number } | undefined => {
    const order = scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score);
    const top = order[0];
    const second = order[1] ?? { score: 0, index: -1 };
    if (top.score < minInk) return undefined;
    if (top.score - second.score < minMargin) return undefined;
    return { index: top.index, score: top.score, margin: top.score - second.score };
  };

  const levelPoints = centers.slice(0, 6);
  const classPoints = centers.slice(6, 10);
  const tensPoints = centers.slice(10).filter((_, i) => i % 2 === 0);
  const unitsPoints = centers.slice(10).filter((_, i) => i % 2 === 1);
  const levelScores = levelPoints.map((p) => measure(p.cx, p.cy));
  const classScores = classPoints.map((p) => measure(p.cx, p.cy));
  const tensScores = tensPoints.map((p) => measure(p.cx, p.cy));
  const unitsScores = unitsPoints.map((p) => measure(p.cx, p.cy));
  const levelPick = pickScores(levelScores, 0.18);
  const classPick = pickScores(classScores, 0.18);
  const tensPick = pickScores(tensScores, 0.13, 0.005);
  const unitsPick = pickScores(unitsScores, 0.15, 0.04);

  if (!levelPick && !classPick && !tensPick && !unitsPick) return undefined;
  const level = levelPick ? levelPick.index + 1 : undefined;
  const classLetter = classPick ? 'ABCD'[classPick.index] : undefined;
  let classNo: string | undefined;
  if (tensPick || unitsPick) {
    const tens = tensPick?.index;
    const units = unitsPick?.index;
    if (tens !== undefined && units !== undefined) classNo = `${tens}${units}`;
    else if (units !== undefined) classNo = `0${units}`;
    // Only the tens digit is incomplete; do not invent a trailing zero.
  }
  const className = level && classLetter ? `${level}${classLetter}` : undefined;
  let seatNo: string | undefined;
  if (level && classPick && classNo) {
    const candidate = level * 1000 + (classPick.index + 1) * 100 + Number(classNo);
    seatNo = String(candidate).padStart(4, '0');
  }
  const confidence =
    (levelPick ? 1 : 0) * 0.4 +
    (classPick ? 1 : 0) * 0.35 +
    (unitsPick ? 1 : 0) * 0.15 +
    (tensPick ? 1 : 0) * 0.1;
  return {
    level,
    classLetter,
    classNo,
    className,
    seatNo,
    candidateNo: seatNo,
    confidence: Math.round(confidence * 100) / 100,
  };
}


function mergeHeaderFields(
  primary: HeaderInfo | undefined,
  fallback: HeaderInfo | undefined,
): HeaderInfo | undefined {
  if (!primary && !fallback) return undefined;
  const level = primary?.level ?? fallback?.level;
  const classLetter = primary?.classLetter ?? fallback?.classLetter;
  const classNo = primary?.classNo ?? fallback?.classNo;
  const classIndex = classLetter ? 'ABCD'.indexOf(classLetter) + 1 : undefined;
  let className = level && classLetter ? `${level}${classLetter}` : primary?.className ?? fallback?.className;
  let seatNo = primary?.seatNo ?? fallback?.seatNo;
  if (level && classIndex && classNo) {
    const candidate = level * 1000 + classIndex * 100 + Number(classNo);
    seatNo = String(candidate).padStart(4, '0');
  }
  return {
    level,
    classLetter,
    classNo,
    className,
    seatNo,
    candidateNo: seatNo,
    confidence: Math.max(primary?.confidence ?? 0, fallback?.confidence ?? 0),
  };
}

export function analyseGray(
  gray: Uint8Array,
  width: number,
  height: number,
  headerFallbackGray?: Uint8Array,
): Detection {
  const started = performance.now();
  const binary = adaptiveBinary(gray, width, height);
  const allFrames = findAnswerFrames(binary, width, height);
  if (allFrames.length < 2) {
    return {
      ok: false,
      width,
      height,
      rotation: 0,
      frames: allFrames,
      rows: [],
      warnings: [
        allFrames.length === 1
          ? '只找到一個答題欄。請確認相片包含完整答題紙，或裁剪後重新上載。'
          : '找不到答題框。請確認影像清晰、包含完整答題紙，或改用 PDF 掃描。',
      ],
      elapsedMs: Math.round(performance.now() - started),
    };
  }
  let frames = allFrames.slice(0, 4);
  // The three answer blocks are printed side by side on one baseline. A broken
  // scan edge can truncate one block's border lines; normalise their vertical
  // geometry to the group median so every block keeps the same row template.
  if (frames.length >= 2) {
    const sortedY = frames.map((f) => f.y).sort((a, b) => a - b);
    const sortedH = frames.map((f) => f.h).sort((a, b) => a - b);
    const mid = Math.floor(frames.length / 2);
    const medianY =
      frames.length % 2 === 0
        ? (sortedY[mid - 1] + sortedY[mid]) / 2
        : sortedY[mid];
    const medianH =
      frames.length % 2 === 0
        ? (sortedH[mid - 1] + sortedH[mid]) / 2
        : sortedH[mid];
    frames = frames.map((f) => ({ ...f, y: Math.round(medianY), h: Math.round(medianH) }));
  }
  // Reject false "frames" such as page-table cells on a sideways scan. Every
  // genuine block has printed bubble outlines at all 80 template positions.
  frames = frames.filter((f) => frameGridSupport(gray, width, height, f) >= 0.65);
  if (frames.length < 2) {
    return {
      ok: false,
      width,
      height,
      rotation: 0,
      frames,
      rows: [],
      warnings: ['找不到完整的 4 × 20 答題格。請確認影像沒有旋轉或裁切。'],
      elapsedMs: Math.round(performance.now() - started),
    };
  }
  if (isUpsideDown(binary, width, height, frames)) {
    return {
      ok: false,
      width,
      height,
      rotation: 0,
      frames,
      rows: [],
      warnings: ['偵測到倒轉的答題紙，正在自動校正方向。'],
      elapsedMs: Math.round(performance.now() - started),
    };
  }
  const header = frames.length
    ? mergeHeaderFields(
        readHeaderFields(gray, width, height, frames[0]),
        headerFallbackGray
          ? readHeaderFields(headerFallbackGray, width, height, frames[0])
          : undefined,
      )
    : undefined;
  const rows: DetectedRow[] = [];
  for (let i = 0; i < frames.length; i++) {
    rows.push(...readFrame(gray, width, height, frames[i], i));
  }
  const warnings: string[] = [];
  if (frames.length < 3) {
    warnings.push(
      `只偵測到 ${frames.length} 個答題欄；題號可能不完整，請檢查影像是否被裁切。`,
    );
  }
  return {
    ok: true,
    width,
    height,
    rotation: 0,
    frames,
    rows,
    warnings,
    header,
    elapsedMs: Math.round(performance.now() - started),
  };
}

export function rotateGray90CW(
  gray: Uint8Array,
  width: number,
  height: number,
): { gray: Uint8Array; width: number; height: number } {
  const newW = height;
  const newH = width;
  const out = new Uint8Array(newW * newH);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      const nx = height - 1 - y;
      const ny = x;
      out[ny * newW + nx] = gray[off + x];
    }
  }
  return { gray: out, width: newW, height: newH };
}

export function analyseWithRotation(
  gray: Uint8Array,
  width: number,
  height: number,
  headerFallbackGray?: Uint8Array,
): Detection {
  let current = { gray, width, height };
  let fallback = headerFallbackGray;
  let fallbackSize = { width, height };
  let rotation: 0 | 90 | 180 | 270 = 0;
  let last: Detection | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = analyseGray(current.gray, current.width, current.height, fallback);
    result.rotation = rotation;
    if (result.ok) return result;
    last = result;
    const rotated = rotateGray90CW(current.gray, current.width, current.height);
    current = rotated;
    if (fallback) {
      const rotatedFallback = rotateGray90CW(
        fallback,
        fallbackSize.width,
        fallbackSize.height,
      );
      fallback = rotatedFallback.gray;
      fallbackSize = {
        width: rotatedFallback.width,
        height: rotatedFallback.height,
      };
    }
    rotation = (((rotation + 90) % 360) as 0 | 90 | 180 | 270);
  }
  return (
    last ?? {
      ok: false,
      width,
      height,
      rotation: 0,
      frames: [],
      rows: [],
      warnings: ['無法讀取影像。'],
      elapsedMs: 0,
    }
  );
}
