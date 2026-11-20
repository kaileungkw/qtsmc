import { useEffect, useRef } from 'react';
import type { AnswerValue, Detection } from '../types';
import { selectedMultiOptions } from '../lib/scoring';

interface SheetCanvasProps {
  src: string;
  detection: Detection;
  answers: Record<number, AnswerValue>;
  keyAnswers: Record<number, AnswerValue>;
  questionCount: number;
  isKey: boolean;
  enhanced?: boolean;
  showMarkers?: boolean;
  className?: string;
}

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

const COLORS = {
  ink: '#17324d',
  key: '#b8861f',
  keySoft: 'rgba(201,147,46,0.24)',
  correct: '#1d7a5c',
  correctSoft: 'rgba(29,122,92,0.18)',
  wrong: '#b3453c',
  wrongSoft: 'rgba(179,69,60,0.18)',
  blank: '#8a8378',
  blankSoft: 'rgba(138,131,120,0.16)',
  multi: '#6a4c93',
  multiSoft: 'rgba(106,76,147,0.2)',
  low: '#c57a17',
  lowSoft: 'rgba(197,122,23,0.18)',
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export default function SheetCanvas({
  src,
  detection,
  answers,
  keyAnswers,
  questionCount,
  isKey,
  enhanced = false,
  showMarkers = true,
  className,
}: SheetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = detection.width;
      const H = detection.height;
      const targetWidth = Math.min(1180, W);
      const k = targetWidth / W;
      canvas.width = Math.round(W * k);
      canvas.height = Math.round(H * k);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fffdf7';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(k, k);
      // Draw the scan in the same orientation the detector used, then reset
      // the transform so overlay coordinates stay in detector space.
      ctx.save();
      ctx.filter = 'none';
      switch (detection.rotation) {
        case 90:
          ctx.translate(W, 0);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(image, 0, 0, H, W);
          break;
        case 180:
          ctx.translate(W, H);
          ctx.rotate(Math.PI);
          ctx.drawImage(image, 0, 0, W, H);
          break;
        case 270:
          ctx.translate(0, H);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(image, 0, 0, H, W);
          break;
        default:
          ctx.drawImage(image, 0, 0, W, H);
      }
      ctx.filter = 'none';
      ctx.restore();

      if (enhanced) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = ENHANCE_LUT[data[i]];
          data[i + 1] = ENHANCE_LUT[data[i + 1]];
          data[i + 2] = ENHANCE_LUT[data[i + 2]];
        }
        ctx.putImageData(imageData, 0, 0);
      }

      const scale = W / 1500;
      const frameLine = Math.max(1.2, 2 * scale);
      const chosenLine = Math.max(2, 2.8 * scale);

      if (showMarkers) {
      for (const frame of detection.frames) {
        ctx.strokeStyle = 'rgba(23,50,77,0.20)';
        ctx.lineWidth = frameLine;
        ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
      }

      for (const row of detection.rows) {
        if (row.q > questionCount) continue;
        const frame = detection.frames[row.block];
        if (!frame) continue;
        const value = answers[row.q] ?? 'blank';
        const detectedStatus = row.status;
        const keyValue = keyAnswers[row.q];
        let color = COLORS.correct;
        let soft = COLORS.correctSoft;
        let label: string = value;
        if (isKey) {
          color = COLORS.key;
          soft = COLORS.keySoft;
          label = value === 'blank' ? 'blank' : value;
        } else if (value === 'blank') {
          color = COLORS.blank;
          soft = COLORS.blankSoft;
          label = 'blank';
        } else if (value === 'multi') {
          color = COLORS.multi;
          soft = COLORS.multiSoft;
          label = 'multi';
        } else if (detectedStatus === 'low' && answers[row.q] === undefined) {
          color = COLORS.low;
          soft = COLORS.lowSoft;
          label = `${value}?`;
        } else if (keyValue && value === keyValue) {
          color = COLORS.correct;
          soft = COLORS.correctSoft;
        } else {
          color = COLORS.wrong;
          soft = COLORS.wrongSoft;
        }

        // Faint boxes show exactly which cells the detector looked at.
        for (const cell of row.cells) {
          ctx.strokeStyle = 'rgba(23,50,77,0.12)';
          ctx.lineWidth = Math.max(0.7, scale);
          roundedRect(ctx, cell.cx - 11, cell.cy - 8, 22, 16, 3);
          ctx.stroke();
        }

        if (value === 'A' || value === 'B' || value === 'C' || value === 'D') {
          const index = value.charCodeAt(0) - 65;
          const cell = row.cells[index];
          if (cell) {
            ctx.fillStyle = soft;
            roundedRect(ctx, cell.cx - 12, cell.cy - 9, 24, 18, 4);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = chosenLine;
            roundedRect(ctx, cell.cx - 12, cell.cy - 9, 24, 18, 4);
            ctx.stroke();
          }
        } else if (value === 'multi') {
          // Frame exactly the options reported as the multi answer. This must
          // use the same floor as multiChoiceLabel, otherwise a lighter second
          // mark can be listed as "A, B" but not boxed on the scan.
          const selected = new Set(selectedMultiOptions(row.scores));
          for (const cell of row.cells) {
            if (!selected.has(cell.option)) continue;
            ctx.fillStyle = soft;
            roundedRect(ctx, cell.cx - 12, cell.cy - 9, 24, 18, 4);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = chosenLine;
            roundedRect(ctx, cell.cx - 12, cell.cy - 9, 24, 18, 4);
            ctx.stroke();
          }
        }

      }
      }
      ctx.restore();
    };
    image.onerror = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = 900;
      canvas.height = 1200;
      ctx.fillStyle = '#f7f3ea';
      ctx.fillRect(0, 0, 900, 1200);
      ctx.fillStyle = '#7b7061';
      ctx.font = '600 28px "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('未能載入原始影像', 450, 580);
      ctx.font = '18px "Microsoft JhengHei", sans-serif';
      ctx.fillText('請重新上載此答題紙', 450, 620);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, detection, answers, keyAnswers, questionCount, isKey, enhanced, showMarkers]);

  return (
    <canvas
      ref={canvasRef}
      className={`sheet-canvas ${className ?? ''}`}
      aria-label={showMarkers ? '答題紙標記圖' : '答題紙原圖'}
    />
  );
}
