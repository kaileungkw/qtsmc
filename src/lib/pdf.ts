import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfPageImage {
  blob: Blob;
  fileName: string;
}

/**
 * Estimate the page skew from the printed vertical lines. The math scans from
 * the older copier are off by up to ~2.2°, which is too much for the column-wise
 * frame detector without correction. A small projection search over ±3° is
 * cheap and robust; the result is the angle of the lines in the image.
 */
export function estimateSkew(canvas: HTMLCanvasElement): number {
  const target = 400;
  const scale = target / canvas.width;
  const sw = target;
  const sh = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  if (!smallCtx) return 0;
  smallCtx.drawImage(canvas, 0, 0, sw, sh);
  const data = smallCtx.getImageData(0, 0, sw, sh).data;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (gray < 180) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 200) return 0;

  const maxShift = Math.ceil(sh * Math.tan((3.2 * Math.PI) / 180)) + 3;
  let bestScore = -1;
  let bestAngle = 0;
  const hist = new Uint32Array(sw + maxShift * 2);
  for (let angle = -3; angle <= 3.001; angle += 0.1) {
    hist.fill(0);
    const tan = Math.tan((angle * Math.PI) / 180);
    for (let i = 0; i < xs.length; i++) {
      const bin = Math.round(xs[i] - ys[i] * tan) + maxShift;
      if (bin >= 0 && bin < hist.length) hist[bin]++;
    }
    let score = 0;
    for (let i = 0; i < hist.length; i++) score += hist[i] * hist[i];
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return Math.abs(bestAngle) < 0.35 ? 0 : bestAngle;
}

export function rotateCanvas(canvas: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const w = canvas.width;
  const h = canvas.height;
  const out = document.createElement('canvas');
  out.width = Math.ceil(w * cos + h * sin);
  out.height = Math.ceil(w * sin + h * cos);
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(radians);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

export async function pdfToImages(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<PdfPageImage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const base = file.name.replace(/\.pdf$/i, '');
  const images: PdfPageImage[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = 1500 / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器不支援 Canvas，無法轉換 PDF。');
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Correct the small scan skew before storing the page image, so both the
    // frame detector and the review overlay use the same upright image.
    const skew = estimateSkew(canvas);
    const pageCanvas = skew ? rotateCanvas(canvas, skew) : canvas;
    const blob = await new Promise<Blob | null>((resolve) =>
      pageCanvas.toBlob(resolve, 'image/jpeg', 0.93),
    );
    if (blob) {
      images.push({
        blob,
        fileName: `${base}_p${String(pageNo).padStart(2, '0')}.jpg`,
      });
    }
    page.cleanup();
    onProgress?.(pageNo, pdf.numPages);
    // Yield to the UI between pages.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await pdf.destroy();
  return images;
}
