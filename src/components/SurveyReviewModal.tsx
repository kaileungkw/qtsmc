import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import type { RosterData } from '../lib/roster';
import {
  formNeedsReview,
  type SurveyForm,
  type SurveyLogicalPage,
  type SurveyTemplate,
} from '../lib/survey';
import { renderSurveyReviewPage } from '../lib/surveyPdf';

interface SurveyReviewModalProps {
  form: SurveyForm;
  template: SurveyTemplate;
  pages: SurveyLogicalPage[];
  scans: { name: string; blob: Blob }[];
  roster: RosterData | null;
  onClose: () => void;
  onChange: (patch: Partial<SurveyForm>) => void;
  onValue: (gridId: string, row: number, value: number | null) => void;
  onPrevStudent?: () => void;
  onNextStudent?: () => void;
  onToast: (message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

const RANK_COLORS = { ok: 'rgba(18,128,108,0.95)', flag: 'rgba(201,150,50,0.95)' };

export default function SurveyReviewModal({
  form,
  template,
  pages,
  scans,
  roster,
  onClose,
  onChange,
  onValue,
  onPrevStudent,
  onNextStudent,
  onToast,
}: SurveyReviewModalProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [candidate, setCandidate] = useState(form.candidateNo);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const viewerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pageRef = form.pages[pageIndex];
  const read = useMemo(
    () => pages.find((page) => page.id === pageRef?.pageId)?.read,
    [pageRef?.pageId, pages],
  );

  useEffect(() => {
    setCandidate(form.candidateNo);
    setPageIndex(0);
    sideRef.current?.scrollTo({ top: 0 });
  }, [form.candidateNo, form.id]);

  const draw = useCallback(async () => {
    if (!pageRef) return;
    const scan = scans.find((item) => item.name === pageRef.fileName);
    if (!scan) {
      onToast('找不到這一頁的原始 PDF。', 'warning');
      return;
    }
    setLoading(true);
    try {
      const file = new File([scan.blob], scan.name, { type: scan.blob.type || '' });
      const image = await renderSurveyReviewPage(file, pageRef.pageNo, pageRef.half);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);

      if (!read) {
        ctx.fillStyle = 'rgba(174,69,60,0.9)';
        ctx.font = `${Math.round(canvas.width / 34)}px sans-serif`;
        ctx.fillText('這一頁未能辨識', 30, 60);
        return;
      }
      const page = template.pages.find((item) => item.page === read.templatePage);
      if (!page) return;
      const lineWidth = Math.max(3, Math.round(canvas.width / 500));
      const labels = canvas.width > 1200;
      let contentIndex = 0;
      for (const grid of page.grids) {
        const geometry = read.scanGrids[page.grids.indexOf(grid)];
        if (!geometry) continue;
        const selected = read.grids[grid.id];
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
        contentIndex += 1;
        if (!selected) continue;
        const radius = Math.max(4, geometry.bubbleSize * 0.55);
        for (let row = 0; row < grid.rows.length; row++) {
          const value = selected.values[row];
          if (!value) continue;
          const x = geometry.columnX[value - 1] ?? geometry.columnX[0];
          const y = geometry.rowY[row];
          if (x === undefined || y === undefined) continue;
          const flagged = selected.ambiguous.includes(row);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = flagged ? RANK_COLORS.flag : RANK_COLORS.ok;
          ctx.lineWidth = lineWidth * 1.6;
          ctx.stroke();
          if (grid.mode === 'rank' && labels) {
            ctx.fillStyle = flagged ? RANK_COLORS.flag : RANK_COLORS.ok;
            ctx.font = `${Math.max(11, Math.round(canvas.width / 120))}px sans-serif`;
            ctx.fillText(String(value), x + radius + 3, y - radius);
          }
        }
      }
    } catch {
      onToast('未能顯示這一頁，請再試一次。', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast, pageRef, read, scans, template]);

  useEffect(() => {
    void draw();
  }, [draw]);

  // The right-hand editor lists every page's grids: the page tabs only switch
  // the scan image, and the whole set stays scrollable in one place.
  const contentGroups = useMemo(
    () =>
      template.pages.flatMap((page) => {
        const content = page.grids.filter((grid) => !grid.isCandidate);
        return content.map((grid, index) => ({
          page: page.page,
          grid,
          index,
          count: content.length,
        }));
      }),
    [template],
  );

  const selectPage = (index: number) => {
    setPageIndex(index);
    const pageNo = form.pages[index]?.templatePage;
    const side = sideRef.current;
    const group = pageNo ? groupRefs.current[pageNo] : null;
    if (!side || !group) return;
    if (side.scrollHeight > side.clientHeight + 4) {
      const top =
        group.getBoundingClientRect().top -
        side.getBoundingClientRect().top +
        side.scrollTop;
      side.scrollTo({ top, behavior: 'smooth' });
    } else {
      group.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  const applyCandidate = () => {
    const digits = candidate.replace(/\D/g, '').slice(0, 4);
    setCandidate(digits);
    const entry = digits.length === 4 ? roster?.byExam.get(Number(digits)) : undefined;
    onChange({
      candidateNo: digits,
      name: entry?.name ?? '',
      className: entry?.class ?? '',
      seatNo: entry ? String(entry.num).padStart(2, '0') : '',
      reviewed: false,
    });
    if (!entry && digits.length === 4) {
      onToast('名單找不到這個考生號碼；姓名會留空。', 'warning');
    }
  };

  const complete = () => {
    onChange({ reviewed: !form.reviewed });
    if (form.reviewed) {
      onToast('已取消覆核完成。', 'success');
    } else {
      onToast('已完成覆核。', 'success');
    }
  };

  // Mouse drag-to-pan on the scan, like the answer-sheet review. Touch keeps
  // the browser's native scrolling.
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewer.scrollLeft,
      top: viewer.scrollTop,
    };
    setDragging(true);
    viewer.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewer = viewerRef.current;
    if (!drag || !viewer) return;
    viewer.scrollLeft = drag.left - (event.clientX - drag.x);
    viewer.scrollTop = drag.top - (event.clientY - drag.y);
    event.preventDefault();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    const viewer = viewerRef.current;
    if (viewer?.hasPointerCapture(event.pointerId)) {
      viewer.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="覆核選科表">
      <div className="survey-review-modal">
        <div className="review-topbar">
          <div className="review-topbar-left">
            <span className="topbar-kicker">
              選科表覆核 · {form.candidateNo || '未有考生號碼'}
            </span>
            <strong>
              {form.name || '姓名不詳'}
              <small>
                {[form.className, form.seatNo].filter(Boolean).join(' / ') || '未有班別'}
              </small>
            </strong>
          </div>
          <div className="survey-student-nav">
            <button
              className="icon-btn"
              onClick={onPrevStudent}
              disabled={!onPrevStudent}
              aria-label="上一個學生"
              title="上一個學生"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="icon-btn"
              onClick={onNextStudent}
              disabled={!onNextStudent}
              aria-label="下一個學生"
              title="下一個學生"
            >
              <ChevronRight size={17} />
            </button>
            <button className="icon-btn close" onClick={onClose} aria-label="關閉">
              <X size={18} />
            </button>
          </div>
        </div>

        {form.flags.length > 0 && (
          <div className="survey-review-flags">
            {form.flags.map((flag) => (
              <span key={flag}>
                <AlertTriangle size={13} /> {flag}
              </span>
            ))}
          </div>
        )}

        <div className="survey-review-body">
          <div className="survey-review-viewer">
            <div className="survey-page-tabs">
              {form.pages.map((page, index) => (
                <button
                  key={page.pageId}
                  className={index === pageIndex ? 'active' : ''}
                  onClick={() => selectPage(index)}
                >
                  第 {page.templatePage || index + 1} 頁
                </button>
              ))}
              <button className="survey-zoom" onClick={() => setZoom((value) => !value)}>
                {zoom ? '縮小' : '放大'}
              </button>
            </div>
            <div
              ref={viewerRef}
              className={`survey-canvas-wrap ${zoom ? 'zoomed' : ''} ${dragging ? 'dragging' : ''}`}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {loading && (
                <div className="survey-canvas-loading">
                  <Loader2 size={18} className="spin" /> 載入頁面…
                </div>
              )}
              <canvas ref={canvasRef} className="survey-canvas" />
            </div>
            <div className="survey-legend">
              <span><i className="ring ok" /> 已讀取的排序</span>
              <span><i className="ring flag" /> 雙填／需覆核</span>
            </div>
          </div>

          <div className="survey-review-side" ref={sideRef}>
            <label className="field survey-candidate-field">
              <span>考生號碼</span>
              <div className="survey-candidate-row">
                <input
                  value={candidate}
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) => setCandidate(event.target.value)}
                  onBlur={applyCandidate}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyCandidate();
                  }}
                  aria-label="考生號碼"
                />
                <button className="btn ghost small" onClick={applyCandidate}>
                  套用名單
                </button>
              </div>
            </label>

            {contentGroups.map(({ page: pageNo, grid, index: groupIndex, count }) => (
              <div
                key={grid.id}
                className="survey-review-grid"
                ref={(el) => {
                  if (groupIndex === 0) groupRefs.current[pageNo] = el;
                }}
              >
                <div className="survey-review-grid-head">
                  <strong>{grid.mode === 'single' ? '應用學習課程' : '選修科排序'}</strong>
                  <span>
                    第 {pageNo} 頁{count > 1 ? ` · 第 ${groupIndex + 1} 組` : ''} ·{' '}
                    {grid.rows.length} {grid.mode === 'single' ? '個課程' : `科 · 1–${grid.columns}`}
                  </span>
                </div>
                {grid.rows.map((label, index) => {
                  const value = form.values[grid.id]?.[index] ?? null;
                  const flag = form.ambiguous.includes(`${grid.id}:${index}`);
                  const display = grid.codes?.[index] ? `${grid.codes[index]} ${label}` : label;
                  return (
                    <label key={`${grid.id}-${index}`} className={`survey-review-row ${flag ? 'flag' : ''}`}>
                      <span title={display}>{display}</span>
                      {grid.mode === 'single' ? (
                        <input
                          type="checkbox"
                          checked={value === 1}
                          onChange={(event) =>
                            onValue(grid.id, index, event.target.checked ? 1 : null)
                          }
                        />
                      ) : (
                        <select
                          value={value ?? ''}
                          onChange={(event) =>
                            onValue(
                              grid.id,
                              index,
                              event.target.value === '' ? null : Number(event.target.value),
                            )
                          }
                          aria-label={`${label} 的排序`}
                        >
                          <option value="">未填</option>
                          {Array.from({ length: grid.columns }, (_, option) => (
                            <option key={option + 1} value={option + 1}>
                              {option + 1}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="survey-review-actions">
          <span className="survey-review-nav">
            <button
              className="btn ghost small"
              onClick={() => selectPage(Math.max(0, pageIndex - 1))}
              disabled={pageIndex === 0}
            >
              <ChevronLeft size={14} /> 上一頁
            </button>
            <button
              className="btn ghost small"
              onClick={() => selectPage(Math.min(form.pages.length - 1, pageIndex + 1))}
              disabled={pageIndex >= form.pages.length - 1}
            >
              下一頁 <ChevronRight size={14} />
            </button>
          </span>
          <span className="survey-review-finish">
            {form.reviewed ? (
              <span className="survey-review-ok">
                <Check size={13} /> 已標記覆核完成
              </span>
            ) : formNeedsReview(form) ? (
              <span className="survey-review-warning">
                <AlertTriangle size={13} /> 仍有 {form.ambiguous.length + form.flags.length} 項需留意
              </span>
            ) : (
              <span className="survey-review-ok">
                <Check size={13} /> 沒有待處理項目
              </span>
            )}
            <button
              className={`btn ${form.reviewed ? 'ghost' : 'primary'}`}
              onClick={complete}
            >
              {form.reviewed ? '取消覆核完成' : '完成覆核'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
