import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  SurveyForm,
  SurveyFormPageRef,
  SurveyPageRead,
  SurveyTemplatePage,
} from '../lib/survey';
import { renderSurveyReviewPage } from '../lib/surveyPdf';
import { enhanceCanvasContrast } from '../lib/canvasEnhance';

interface SurveyReviewPageCanvasProps {
  form: SurveyForm;
  pageRef: SurveyFormPageRef;
  read?: SurveyPageRead;
  templatePage?: SurveyTemplatePage;
  scan?: { name: string; blob: Blob };
  shouldLoad: boolean;
  enhanced: boolean;
  showMarkers: boolean;
  onRendered: (pageId: string) => void;
}

const COLORS = {
  ok: 'rgba(18,128,108,0.95)',
  faint: 'rgba(201,150,50,0.95)',
  multi: '#6a4c93',
  multiSoft: 'rgba(106,76,147,0.2)',
};

/** One lazily rendered logical page; corrections redraw markers without re-reading the PDF. */
export default function SurveyReviewPageCanvas({
  form,
  pageRef,
  read,
  templatePage,
  scan,
  shouldLoad,
  enhanced,
  showMarkers,
  onRendered,
}: SurveyReviewPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!shouldLoad || source) return;
    let cancelled = false;
    if (!scan) {
      setError('找不到這一頁的原始掃描。');
      return;
    }
    setLoading(true);
    setError('');
    const file = new File([scan.blob], scan.name, { type: scan.blob.type || '' });
    renderSurveyReviewPage(file, pageRef.pageNo, pageRef.half)
      .then((image) => {
        if (!cancelled) setSource(image);
      })
      .catch(() => {
        if (!cancelled) setError('未能顯示這一頁，請再試一次。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, pageRef.half, pageRef.pageNo, scan, shouldLoad, source]);

  useEffect(() => {
    if (!source) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = source.width;
    canvas.height = source.height;
    ctx.drawImage(source, 0, 0);
    if (enhanced) enhanceCanvasContrast(canvas, ctx);

    if (!read || !templatePage) {
      ctx.fillStyle = 'rgba(174,69,60,0.9)';
      ctx.font = `${Math.round(canvas.width / 34)}px sans-serif`;
      ctx.fillText('這一頁未能辨識', 30, 60);
      onRendered(pageRef.pageId);
      return;
    }

    if (!showMarkers) {
      onRendered(pageRef.pageId);
      return;
    }

    const lineWidth = Math.max(3, Math.round(canvas.width / 500));
    const labels = canvas.width > 1200;
    for (const [gridIndex, grid] of templatePage.grids.entries()) {
      const geometry = read.scanGrids[gridIndex];
      if (!geometry) continue;
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = grid.isCandidate
        ? 'rgba(55,108,142,0.9)'
        : 'rgba(55,108,142,0.55)';
      ctx.strokeRect(geometry.rect.x, geometry.rect.y, geometry.rect.w, geometry.rect.h);
      if (grid.isCandidate) {
        ctx.fillStyle = 'rgba(21,41,61,0.85)';
        ctx.font = `${Math.max(14, Math.round(canvas.width / 80))}px sans-serif`;
        ctx.fillText(`考生號碼 ${read.candidateNo || '未能讀取'}`, geometry.rect.x, geometry.rect.y - 10);
        continue;
      }

      const radius = Math.max(4, geometry.bubbleSize * 0.55);
      for (let row = 0; row < grid.rows.length; row++) {
        const key = `${grid.id}:${row}`;
        const isDouble = form.ambiguous.includes(key);
        if (isDouble) {
          const choices =
            form.doubleChoices?.[key]?.length
              ? form.doubleChoices[key]
              : read.grids[grid.id]?.markedOptions?.[row] ?? [];
          for (const value of choices) {
            const x = geometry.columnX[value - 1];
            const y = geometry.rowY[row];
            if (x === undefined || y === undefined) continue;
            ctx.fillStyle = COLORS.multiSoft;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            ctx.strokeStyle = COLORS.multi;
            ctx.lineWidth = lineWidth * 1.7;
            ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
            if (labels) {
              ctx.fillStyle = COLORS.multi;
              ctx.font = `${Math.max(11, Math.round(canvas.width / 120))}px sans-serif`;
              ctx.fillText(String(value), x + radius + 3, y - radius);
            }
          }
          continue;
        }

        const value = form.values[grid.id]?.[row];
        if (!value) continue;
        const x = geometry.columnX[value - 1] ?? geometry.columnX[0];
        const y = geometry.rowY[row];
        if (x === undefined || y === undefined) continue;
        const faint = form.faint?.includes(key) ?? false;
        const color = faint ? COLORS.faint : COLORS.ok;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth * 1.6;
        ctx.stroke();
        if (grid.mode === 'rank' && labels) {
          ctx.fillStyle = color;
          ctx.font = `${Math.max(11, Math.round(canvas.width / 120))}px sans-serif`;
          ctx.fillText(String(value), x + radius + 3, y - radius);
        }
      }
    }
    onRendered(pageRef.pageId);
  }, [enhanced, form, onRendered, pageRef.pageId, read, showMarkers, source, templatePage]);

  const ratio = templatePage
    ? `${templatePage.width} / ${templatePage.height}`
    : '1 / 1.414';

  return (
    <div className="survey-review-page-stage" style={{ aspectRatio: ratio }}>
      {loading && (
        <div className="survey-canvas-loading">
          <Loader2 size={18} className="spin" /> 載入頁面…
        </div>
      )}
      {error ? (
        <div className="survey-canvas-error" role="alert">
          <span>{error}</span>
          <button className="btn ghost small" onClick={() => setAttempt((value) => value + 1)}>
            重試
          </button>
        </div>
      ) : source ? (
        <canvas
          ref={canvasRef}
          className="survey-canvas"
          aria-label={showMarkers ? '選科表標記圖' : '選科表掃描圖'}
        />
      ) : (
        <div className="survey-canvas-placeholder">
          {shouldLoad ? '準備載入…' : '捲動到此頁時載入'}
        </div>
      )}
    </div>
  );
}
