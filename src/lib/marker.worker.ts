/// <reference lib="webworker" />
import { analyseWithRotation, enhanceGray, rgbaToGray } from './marker';

const scope = self as unknown as DedicatedWorkerGlobalScope;

interface Job {
  id: string;
  blob: Blob;
}

async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(blob);
  }
}

scope.onmessage = async (event: MessageEvent<Job>) => {
  const { id, blob } = event.data;
  try {
    const bitmap = await loadBitmap(blob);
    const targetWidth = 1500;
    let width = targetWidth;
    let height = Math.round((bitmap.height * targetWidth) / bitmap.width);
    // Keep memory bounded for very long phone screenshots.
    if (height > 4600) {
      const scale = 4600 / height;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const gray = rgbaToGray(imageData.data, width, height);
    const enhanced = enhanceGray(gray, width, height);
    const detection = analyseWithRotation(enhanced, width, height, gray);
    bitmap.close();
    scope.postMessage({ id, detection });
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
