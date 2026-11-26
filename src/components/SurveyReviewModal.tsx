import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import type { RosterData } from '../lib/roster';
import {
  formNeedsReview,
  type SurveyForm,
  type SurveyLogicalPage,
  type SurveyTemplate,
} from '../lib/survey';
import SurveyReviewPageCanvas from './SurveyReviewPageCanvas';

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

interface FocusRequest {
  pageId: string;
  pageIndex: number;
  gridId: string;
  row: number;
}

const VALUE_FLAG = /^「.*」有(?:雙填畫|淡色填畫)$/;

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
  const [loadThrough, setLoadThrough] = useState(1);
  const [zoom, setZoom] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 560 ? 130 : 100,
  );
  const [candidate, setCandidate] = useState(form.candidateNo);
  const [onlyReview, setOnlyReview] = useState(
    () => new Set([...form.ambiguous, ...(form.faint ?? [])]).size > 0,
  );
  const viewerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLElement | null>>({});
  const groupRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const focusRef = useRef<FocusRequest | null>(null);
  const [dragging, setDragging] = useState(false);

  const issueKeys = useMemo(
    () => new Set([...form.ambiguous, ...(form.faint ?? [])]),
    [form.ambiguous, form.faint],
  );
  const issueCount = issueKeys.size;
  const formFlags = useMemo(
    () => form.flags.filter((flag) => !VALUE_FLAG.test(flag)),
    [form.flags],
  );
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
  const totalValues = useMemo(
    () => contentGroups.reduce((sum, { grid }) => sum + grid.rows.length, 0),
    [contentGroups],
  );

  useEffect(() => {
    setCandidate(form.candidateNo);
    setPageIndex(0);
    setLoadThrough(Math.min(1, Math.max(0, form.pages.length - 1)));
    setOnlyReview(new Set([...form.ambiguous, ...(form.faint ?? [])]).size > 0);
    focusRef.current = null;
    window.requestAnimationFrame(() => {
      viewerRef.current?.scrollTo({ top: 0, left: 0 });
      listRef.current?.scrollTo({ top: 0 });
    });
    // Only reset the viewing state when changing students, not after each edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  const syncRightToPage = useCallback(
    (index: number) => {
      if (window.innerWidth <= 860) return;
      const pageNo = form.pages[index]?.templatePage;
      const list = listRef.current;
      const group = pageNo ? groupRefs.current[pageNo] : null;
      if (!list || !group) return;
      const top =
        group.getBoundingClientRect().top -
        list.getBoundingClientRect().top +
        list.scrollTop -
        8;
      list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    },
    [form.pages],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => syncRightToPage(pageIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [form.id, onlyReview, pageIndex, syncRightToPage]);

  const selectPage = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const next = Math.max(0, Math.min(form.pages.length - 1, index));
      setPageIndex(next);
      setLoadThrough((current) =>
        Math.max(current, Math.min(form.pages.length - 1, next + 1)),
      );
      window.requestAnimationFrame(() => {
        const viewer = viewerRef.current;
        const section = pageRefs.current[next];
        if (!viewer || !section) return;
        const top =
          section.getBoundingClientRect().top -
          viewer.getBoundingClientRect().top +
          viewer.scrollTop -
          6;
        viewer.scrollTo({ top: Math.max(0, top), behavior });
      });
    },
    [form.pages],
  );

  const attemptFocus = useCallback(() => {
    const request = focusRef.current;
    const viewer = viewerRef.current;
    if (!request || !viewer) return;
    const section = pageRefs.current[request.pageIndex];
    const canvas = section?.querySelector('canvas');
    if (!section || !canvas || !canvas.width) return;
    const pageRef = form.pages[request.pageIndex];
    const read = pages.find((page) => page.id === pageRef?.pageId)?.read;
    const templatePage = template.pages.find((page) => page.page === read?.templatePage);
    const gridIndex = templatePage?.grids.findIndex((grid) => grid.id === request.gridId) ?? -1;
    const geometry = gridIndex >= 0 ? read?.scanGrids[gridIndex] : undefined;
    const y = geometry?.rowY[request.row];
    if (!geometry || y === undefined) {
      focusRef.current = null;
      return;
    }
    const x = geometry.columnX[0];
    const canvasRect = canvas.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();
    const top =
      viewer.scrollTop +
      canvasRect.top -
      viewerRect.top +
      (y / canvas.height) * canvasRect.height -
      viewer.clientHeight * 0.35;
    const left =
      viewer.scrollLeft +
      canvasRect.left -
      viewerRect.left +
      (x / canvas.width) * canvasRect.width -
      viewer.clientWidth * 0.25;
    viewer.scrollTo({
      top: Math.max(0, top),
      left: Math.max(0, left),
      behavior: 'smooth',
    });
    focusRef.current = null;
  }, [form.pages, pages, template]);

  const focusRow = useCallback(
    (pageNo: number, gridId: string, row: number) => {
      const index = form.pages.findIndex((page) => page.templatePage === pageNo);
      if (index < 0) return;
      focusRef.current = {
        pageId: form.pages[index].pageId,
        pageIndex: index,
        gridId,
        row,
      };
      selectPage(index);
      window.requestAnimationFrame(attemptFocus);
    },
    [attemptFocus, form.pages, selectPage],
  );

  const handleRendered = useCallback(
    (pageId: string) => {
      if (focusRef.current?.pageId !== pageId) return;
      window.requestAnimationFrame(attemptFocus);
    },
    [attemptFocus],
  );

  const handleViewerScroll = () => {
    if (scrollFrame.current) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const viewer = viewerRef.current;
      if (!viewer) return;
      const marker = viewer.getBoundingClientRect().top + Math.min(140, viewer.clientHeight * 0.22);
      let nearest = 0;
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < form.pages.length; index++) {
        const section = pageRefs.current[index];
        if (!section) continue;
        const nextDistance = Math.abs(section.getBoundingClientRect().top - marker);
        if (nextDistance < distance) {
          nearest = index;
          distance = nextDistance;
        }
      }
      setPageIndex((current) => (current === nearest ? current : nearest));
      setLoadThrough((current) =>
        Math.max(current, Math.min(form.pages.length - 1, nearest + 1)),
      );
    });
  };

  const applyCandidate = () => {
    const digits = candidate.replace(/\D/g, '').slice(0, 4);
    setCandidate(digits);
    const entry = digits.length === 4 ? roster?.byExam.get(Number(digits)) : undefined;
    const flags = form.flags.filter(
      (flag) =>
        flag !== '名單冇此考生' &&
        flag !== '未有考生號碼' &&
        flag !== '考生號碼未能讀取' &&
        flag !== '考生號碼有兩個填畫' &&
        !/^考生號碼重複（\d+ 份）$/.test(flag),
    );
    if (digits.length !== 4) flags.push('未有考生號碼');
    else if (!entry) flags.push('名單冇此考生');
    onChange({
      candidateNo: digits,
      name: entry?.name ?? '',
      className: entry?.class ?? '',
      seatNo: entry ? String(entry.num).padStart(2, '0') : '',
      flags,
      reviewed: false,
    });
    if (!entry && digits.length === 4) {
      onToast('名單找不到這個考生號碼；姓名會留空。', 'warning');
    }
  };

  const complete = () => {
    onChange({ reviewed: !form.reviewed });
    onToast(form.reviewed ? '已取消覆核完成。' : '已完成覆核。', 'success');
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, select, a')) return;
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
            <button className="icon-btn" onClick={onPrevStudent} disabled={!onPrevStudent} aria-label="上一個學生" title="上一個學生">
              <ChevronLeft size={17} />
            </button>
            <button className="icon-btn" onClick={onNextStudent} disabled={!onNextStudent} aria-label="下一個學生" title="下一個學生">
              <ChevronRight size={17} />
            </button>
            <button className="icon-btn close" onClick={onClose} aria-label="關閉">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="survey-review-body">
          <div className="survey-review-viewer">
            <div className="survey-page-tabs">
              {form.pages.map((page, index) => (
                <button
                  key={page.pageId}
                  className={index === pageIndex ? 'active' : ''}
                  onClick={() => selectPage(index)}
                  aria-pressed={index === pageIndex}
                >
                  第 {page.templatePage || index + 1} 頁
                </button>
              ))}
              <div className="zoom-controls" aria-label="掃描圖縮放">
                <button
                  className="icon-btn"
                  onClick={() => setZoom((value) => Math.max(60, value - 20))}
                  disabled={zoom <= 60}
                  aria-label="縮小"
                >
                  <Minus size={15} />
                </button>
                <span>{zoom}%</span>
                <button
                  className="icon-btn"
                  onClick={() => setZoom((value) => Math.min(200, value + 20))}
                  disabled={zoom >= 200}
                  aria-label="放大"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div
              ref={viewerRef}
              className={`survey-canvas-wrap ${dragging ? 'dragging' : ''}`}
              onScroll={handleViewerScroll}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {form.pages.map((page, index) => {
                const read = pages.find((item) => item.id === page.pageId)?.read;
                const templatePage = template.pages.find(
                  (item) => item.page === (page.templatePage || read?.templatePage),
                );
                const pageIssueCount = contentGroups
                  .filter((group) => group.page === page.templatePage)
                  .reduce(
                    (sum, group) =>
                      sum + group.grid.rows.filter((_, row) => issueKeys.has(`${group.grid.id}:${row}`)).length,
                    0,
                  );
                return (
                  <section
                    key={`${form.id}-${page.pageId}`}
                    ref={(element) => {
                      pageRefs.current[index] = element;
                    }}
                    className={`survey-review-page ${index === pageIndex ? 'active' : ''}`}
                    data-page-index={index}
                  >
                    <div className="survey-review-page-label">
                      <strong>第 {page.templatePage || index + 1} 頁</strong>
                      {pageIssueCount > 0 && <span>{pageIssueCount} 項需覆核</span>}
                    </div>
                    <div className="survey-review-page-zoom" style={{ width: `${zoom}%` }}>
                      <SurveyReviewPageCanvas
                        form={form}
                        pageRef={page}
                        read={read}
                        templatePage={templatePage}
                        scan={scans.find((item) => item.name === page.fileName)}
                        shouldLoad={index <= loadThrough}
                        onRendered={handleRendered}
                      />
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="survey-legend">
              <span><i className="ring ok" /> 已讀取</span>
              <span><i className="ring flag" /> 淡色／需覆核</span>
              <span><i className="ring multi" /> 雙填</span>
            </div>
          </div>

          <aside className="survey-review-side">
            <div className="survey-review-side-top">
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
              {formFlags.length > 0 && (
                <div className="survey-review-form-flags">
                  {formFlags.map((flag) => (
                    <span key={flag}><AlertTriangle size={13} /> {flag}</span>
                  ))}
                </div>
              )}
              <div className="survey-review-filter">
                <div>
                  <strong>逐項覆核</strong>
                  <span>{onlyReview ? `${issueCount} 項待處理` : `全部 ${totalValues} 項`}</span>
                </div>
                <div className="survey-review-filter-actions">
                  <button
                    className={`filter-pill ${onlyReview ? 'active' : ''}`}
                    onClick={() => setOnlyReview(true)}
                    aria-pressed={onlyReview}
                  >
                    <Filter size={12} /> 需覆核 {issueCount}
                  </button>
                  <button
                    className={`filter-pill ${!onlyReview ? 'active' : ''}`}
                    onClick={() => setOnlyReview(false)}
                    aria-pressed={!onlyReview}
                  >
                    顯示全部
                  </button>
                </div>
              </div>
            </div>

            <div className="survey-review-list" ref={listRef}>
              {contentGroups.map(({ page: pageNo, grid, index: groupIndex, count }) => {
                const rows = grid.rows
                  .map((label, row) => ({ label, row }))
                  .filter(({ row }) => !onlyReview || issueKeys.has(`${grid.id}:${row}`));
                const activePage = form.pages[pageIndex]?.templatePage;
                const firstIssueGroup = contentGroups.find(
                  (group) =>
                    group.page === pageNo &&
                    group.grid.rows.some((_, row) => issueKeys.has(`${group.grid.id}:${row}`)),
                )?.index ?? 0;
                const pageHasIssues = contentGroups.some(
                  (group) =>
                    group.page === pageNo &&
                    group.grid.rows.some((_, row) => issueKeys.has(`${group.grid.id}:${row}`)),
                );
                if (
                  onlyReview &&
                  rows.length === 0 &&
                  (pageNo !== activePage || pageHasIssues || groupIndex !== 0)
                ) {
                  return null;
                }
                return (
                  <div
                    key={grid.id}
                    className={`survey-review-grid ${pageNo === activePage ? 'active' : ''}`}
                    ref={(element) => {
                      if (groupIndex === (onlyReview ? firstIssueGroup : 0)) {
                        groupRefs.current[pageNo] = element;
                      }
                    }}
                    data-page={pageNo}
                  >
                    <div className="survey-review-grid-head">
                      <strong>{grid.mode === 'single' ? '應用學習課程' : '選修科排序'}</strong>
                      <span>
                        第 {pageNo} 頁{count > 1 ? ` · 第 ${groupIndex + 1} 組` : ''} ·{' '}
                        {onlyReview ? `${rows.length} 項` : `${grid.rows.length} ${grid.mode === 'single' ? '個課程' : '科'}`}
                      </span>
                    </div>
                    {rows.map(({ label, row }) => {
                      const key = `${grid.id}:${row}`;
                      const value = form.values[grid.id]?.[row] ?? null;
                      const isDouble = form.ambiguous.includes(key);
                      const isFaint = form.faint?.includes(key) ?? false;
                      const choices = form.doubleChoices?.[key] ?? [];
                      const display = grid.codes?.[row] ? `${grid.codes[row]} ${label}` : label;
                      return (
                        <div
                          key={key}
                          className={`survey-review-item ${isDouble ? 'double' : ''} ${isFaint ? 'faint' : ''}`}
                          data-issue-key={key}
                        >
                          <button
                            className="survey-subject-locate"
                            onClick={() => focusRow(pageNo, grid.id, row)}
                            aria-label={`在掃描圖檢視 ${display}`}
                            title="在左圖定位"
                          >
                            <span>{display}</span>
                            {isDouble && (
                              <small>雙填{choices.length ? `：${choices.join('、')}` : ''}</small>
                            )}
                            {!isDouble && isFaint && <small>淡色</small>}
                          </button>
                          {grid.mode === 'single' ? (
                            <input
                              type="checkbox"
                              checked={value === 1}
                              onChange={(event) => onValue(grid.id, row, event.target.checked ? 1 : null)}
                              aria-label={`${display} 的選擇`}
                            />
                          ) : (
                            <select
                              value={value === null ? (isDouble ? '' : 'blank') : String(value)}
                              onChange={(event) =>
                                onValue(
                                  grid.id,
                                  row,
                                  event.target.value === 'blank' ? null : Number(event.target.value),
                                )
                              }
                              aria-label={`${label} 的排序`}
                            >
                              {isDouble && <option value="" disabled>請選定</option>}
                              <option value="blank">未填</option>
                              {Array.from({ length: grid.columns }, (_, option) => (
                                <option key={option + 1} value={option + 1}>
                                  {option + 1}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                    {rows.length === 0 && (
                      <div className="survey-review-empty">
                        <Check size={14} /> 本頁沒有需要覆核的項目
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        </div>

        <div className="survey-review-actions">
          <span className="survey-review-nav">
            <button className="btn ghost small" onClick={() => selectPage(pageIndex - 1)} disabled={pageIndex === 0}>
              <ChevronLeft size={14} /> 上一頁
            </button>
            <button
              className="btn ghost small"
              onClick={() => selectPage(pageIndex + 1)}
              disabled={pageIndex >= form.pages.length - 1}
            >
              下一頁 <ChevronRight size={14} />
            </button>
          </span>
          <span className="survey-review-finish">
            {form.reviewed ? (
              <span className="survey-review-ok"><Check size={13} /> 已標記覆核完成</span>
            ) : formNeedsReview(form) ? (
              <span className="survey-review-warning">
                <AlertTriangle size={13} /> 仍有 {issueCount + formFlags.length} 項需留意
              </span>
            ) : (
              <span className="survey-review-ok"><Check size={13} /> 沒有待處理項目</span>
            )}
            <button className={`btn ${form.reviewed ? 'ghost' : 'primary'}`} onClick={complete}>
              {form.reviewed ? '取消覆核完成' : '完成覆核'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
