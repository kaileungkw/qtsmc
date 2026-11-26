/**
 * PDF rendering for the S3 subject-preference survey mode.
 *
 * Scans of the survey are A3 sheets with two A4 pages side by side. Every
 * landscape page is split down the middle, each half is deskewed with the same
 * projection method as the MCQ pipeline, and the result is handed to the pure
 * analyser in survey.ts as a grayscale buffer.
 */
import * as pdfjsLib from 'pdfjs-dist';
import { estimateSkew, rotateCanvas } from './pdf';
import type { SurveyGrayImage, SurveyTextPage } from './survey';

const PORTRAIT_WIDTH = 1500;
const LANDSCAPE_WIDTH = 3000;

const PDF_NAME = /\.pdf$/i;
const IMAGE_NAME = /\.(jpe?g|png|webp|bmp)$/i;

export function isSurveyScanPdf(file: { name: string; type?: string }): boolean {
  if (PDF_NAME.test(file.name)) return true;
  if (IMAGE_NAME.test(file.name)) return false;
  return file.type === 'application/pdf';
}

export function isSurveyScanImage(file: { name: string; type?: string }): boolean {
  if (IMAGE_NAME.test(file.name)) return true;
  if (PDF_NAME.test(file.name)) return false;
  return Boolean(file.type?.startsWith('image/'));
}

export interface SurveyRenderedPage {
  pageNo: number;
  half: 'full' | 'left' | 'right';
  width: number;
  height: number;
  /** True when the half has almost no ink (the back of the booklet). */
  blank: boolean;
  gray: SurveyGrayImage;
}

function grayFromCanvas(canvas: HTMLCanvasElement): SurveyGrayImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('瀏覽器不支援 Canvas。');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return { data: gray, width, height };
}

function splitCanvas(canvas: HTMLCanvasElement, side: 'left' | 'right'): HTMLCanvasElement {
  const width = Math.floor(canvas.width / 2);
  const x = side === 'left' ? 0 : canvas.width - width;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援 Canvas。');
  ctx.drawImage(canvas, x, 0, width, canvas.height, 0, 0, width, canvas.height);
  return out;
}

async function imageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const landscape = bitmap.width > bitmap.height * 1.25;
    const target = landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH;
    const scale = Math.min(3, Math.max(0.05, target / bitmap.width));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器不支援 Canvas。');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** Deskew each A4 page of a rendered A3 sheet (or the whole A4 sheet). */
async function emitCanvasPages(
  canvas: HTMLCanvasElement,
  pageNo: number,
  onPage: (page: SurveyRenderedPage) => Promise<void> | void,
): Promise<void> {
  const landscape = canvas.width > canvas.height * 1.25;
  if (landscape) {
    for (const side of ['left', 'right'] as const) {
      const halfCanvas = splitCanvas(canvas, side);
      const skew = estimateSkew(halfCanvas);
      const upright = skew ? rotateCanvas(halfCanvas, skew) : halfCanvas;
      const gray = grayFromCanvas(upright);
      await onPage({
        pageNo,
        half: side,
        width: gray.width,
        height: gray.height,
        blank: inkFraction(gray) < 0.002,
        gray,
      });
    }
  } else {
    const skew = estimateSkew(canvas);
    const upright = skew ? rotateCanvas(canvas, skew) : canvas;
    const gray = grayFromCanvas(upright);
    await onPage({
      pageNo,
      half: 'full',
      width: gray.width,
      height: gray.height,
      blank: inkFraction(gray) < 0.002,
      gray,
    });
  }
}

function inkFraction(gray: SurveyGrayImage): number {
  let dark = 0;
  for (let i = 0; i < gray.data.length; i++) if (gray.data[i] < 150) dark += 1;
  return dark / Math.max(1, gray.data.length);
}

async function renderPageCanvas(
  page: pdfjsLib.PDFPageProxy,
  targetWidth: number,
): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援 Canvas。');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function openPdf(file: Blob): Promise<pdfjsLib.PDFDocumentProxy> {
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjsLib.getDocument({ data }).promise;
}

/**
 * 逐頁渲染一份掃描 PDF。A3 會分左右兩半，每半獨立校正傾斜。
 * The callback receives one logical A4 page at a time so the page image can be
 * released before the next one is rendered (a 150-page batch would not fit).
 */
export async function forEachSurveyPage(
  file: File,
  onPage: (page: SurveyRenderedPage) => Promise<void> | void,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!isSurveyScanPdf(file)) {
    if (!isSurveyScanImage(file)) {
      throw new Error('請上載 PDF 或 JPG／PNG 掃描。');
    }
    const canvas = await imageToCanvas(file);
    onProgress?.(0, 1);
    await emitCanvasPages(canvas, 1, onPage);
    onProgress?.(1, 1);
    return;
  }
  const pdf = await openPdf(file);
  try {
    onProgress?.(0, pdf.numPages);
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const landscape = base.width > base.height * 1.25;
      const canvas = await renderPageCanvas(
        page,
        landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH,
      );
      await emitCanvasPages(canvas, pageNo, onPage);
      page.cleanup();
      onProgress?.(pageNo, pdf.numPages);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    await pdf.destroy();
  }
}

/** Text layer of the blank form: the bubble glyphs and the subject names. */
export async function readSurveyTextPages(file: File): Promise<SurveyTextPage[]> {
  const pdf = await openPdf(file);
  const pages: SurveyTextPage[] = [];
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: SurveyTextPage['items'] = [];
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str) continue;
        const transform = item.transform;
        items.push({
          text: item.str,
          x: transform[4],
          y: viewport.height - transform[5],
          height: Math.abs(transform[3]) || item.height || 10,
          width: item.width || 0,
        });
      }
      pages.push({
        page: pageNo,
        width: viewport.width,
        height: viewport.height,
        items,
      });
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

async function renderReviewImage(
  file: File,
  half: 'full' | 'left' | 'right',
): Promise<HTMLCanvasElement> {
  const canvas = await imageToCanvas(file);
  const landscape = canvas.width > canvas.height * 1.25;
  const part = landscape ? splitCanvas(canvas, half === 'right' ? 'right' : 'left') : canvas;
  const skew = estimateSkew(part);
  return skew ? rotateCanvas(part, skew) : part;
}

async function renderReviewPdfPage(
  file: File,
  pageNo: number,
  half: 'full' | 'left' | 'right',
  pdf: pdfjsLib.PDFDocumentProxy,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const landscape = base.width > base.height * 1.25;
  const canvas = await renderPageCanvas(
    page,
    landscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH,
  );
  const part = landscape ? splitCanvas(canvas, half === 'right' ? 'right' : 'left') : canvas;
  const skew = estimateSkew(part);
  return skew ? rotateCanvas(part, skew) : part;
}

/** Render one logical page for the review viewer. */
export async function renderSurveyReviewPage(
  file: File,
  pageNo: number,
  half: 'full' | 'left' | 'right',
): Promise<HTMLCanvasElement> {
  if (!isSurveyScanPdf(file)) return renderReviewImage(file, half);
  const pdf = await openPdf(file);
  try {
    return await renderReviewPdfPage(file, pageNo, half, pdf);
  } finally {
    await pdf.destroy();
  }
}

export interface SurveyReviewLoader {
  render(
    scan: { name: string; blob: Blob },
    pageNo: number,
    half: 'full' | 'left' | 'right',
  ): Promise<HTMLCanvasElement>;
  dispose(): Promise<void>;
  stats(): { documents: number; pages: number };
}

/** Share one PDF per source and keep only the six most recent logical pages. */
export function createSurveyReviewLoader(): SurveyReviewLoader {
  const sourceIds = new WeakMap<Blob, number>();
  const files = new Map<number, File>();
  const documents = new Map<number, Promise<pdfjsLib.PDFDocumentProxy>>();
  const rendered = new Map<string, Promise<HTMLCanvasElement>>();
  const recent: string[] = [];
  let nextSource = 0;
  let disposed = false;

  const sourceKey = (scan: { name: string; blob: Blob }): number => {
    let key = sourceIds.get(scan.blob);
    if (!key) {
      key = ++nextSource;
      sourceIds.set(scan.blob, key);
      files.set(key, new File([scan.blob], scan.name, { type: scan.blob.type || '' }));
    }
    return key;
  };

  const documentFor = (key: number): Promise<pdfjsLib.PDFDocumentProxy> => {
    const existing = documents.get(key);
    if (existing) return existing;
    const file = files.get(key);
    if (!file) return Promise.reject(new Error('找不到原始掃描。'));
    const promise = openPdf(file).catch((error) => {
      documents.delete(key);
      throw error;
    });
    documents.set(key, promise);
    return promise;
  };

  const touch = (pageKey: string) => {
    const index = recent.indexOf(pageKey);
    if (index >= 0) recent.splice(index, 1);
    recent.push(pageKey);
    while (recent.length > 6) {
      const oldest = recent.shift();
      if (oldest) rendered.delete(oldest);
    }
  };

  return {
    async render(scan, pageNo, half) {
      if (disposed) throw new Error('覆核檢視器已關閉。');
      const source = sourceKey(scan);
      const pageKey = `${source}:${pageNo}:${half}`;
      const cached = rendered.get(pageKey);
      if (cached) {
        touch(pageKey);
        return cached;
      }
      const task = (async () => {
        const file = files.get(source);
        if (!file) throw new Error('找不到原始掃描。');
        if (!isSurveyScanPdf(file)) return renderReviewImage(file, half);
        const pdf = await documentFor(source);
        return renderReviewPdfPage(file, pageNo, half, pdf);
      })();
      rendered.set(pageKey, task);
      touch(pageKey);
      try {
        return await task;
      } catch (error) {
        rendered.delete(pageKey);
        const index = recent.indexOf(pageKey);
        if (index >= 0) recent.splice(index, 1);
        throw error;
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      rendered.clear();
      recent.length = 0;
      const pending = [...documents.values()];
      documents.clear();
      await Promise.allSettled(
        pending.map(async (promise) => (await promise).destroy()),
      );
      files.clear();
    },
    stats() {
      return { documents: documents.size, pages: rendered.size };
    },
  };
}
