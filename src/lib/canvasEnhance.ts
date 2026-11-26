// Keep the paper white while deepening faint pencil marks. The old CSS-style
// brightness/contrast filter also darkened the paper, so the net contrast barely
// changed. Levels + gamma maps 105→0, 248→255 and lifts the midtones.
const ENHANCE_LUT = (() => {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const normalized = Math.min(1, Math.max(0, (i - 105) / (248 - 105)));
    lut[i] = Math.round(Math.pow(normalized, 1.4) * 255);
  }
  return lut;
})();

/** Enhance only the displayed canvas; callers draw coloured markers afterwards. */
export function enhanceCanvasContrast(
  canvas: HTMLCanvasElement,
  context?: CanvasRenderingContext2D,
): void {
  const ctx = context ?? canvas.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = ENHANCE_LUT[data[i]];
    data[i + 1] = ENHANCE_LUT[data[i + 1]];
    data[i + 2] = ENHANCE_LUT[data[i + 2]];
  }
  ctx.putImageData(imageData, 0, 0);
}
