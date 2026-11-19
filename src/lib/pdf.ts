import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfPageImage {
  blob: Blob;
  fileName: string;
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
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.93),
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
