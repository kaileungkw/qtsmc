import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Contrast,
  ChevronRight,
  Crown,
  Filter,
  Minus,
  Plus,
  RotateCcw,
  ScanLine,
  X,
} from 'lucide-react';
import type {
  Analysis,
  AnswerValue,
  RuntimeSheet,
  Settings,
  SheetOverrides,
} from '../types';
import { getSheetAnswers, uiAnswerLabel } from '../lib/scoring';
import SheetCanvas from './SheetCanvas';

interface ReviewModalProps {
  sheet: RuntimeSheet;
  index: number;
  total: number;
  analysis: Analysis;
  settings: Settings;
  keyAnswers: Record<number, AnswerValue>;
  overrides?: SheetOverrides;
  onAnswer: (q: number, value: AnswerValue) => void;
  onResetAnswers: () => void;
  onMeta: (patch: Partial<Pick<RuntimeSheet, 'name' | 'className' | 'seatNo'>>) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onOpenKeyEditor: () => void;
}

const OPTIONS: AnswerValue[] = ['A', 'B', 'C', 'D', 'blank', 'multi'];

export default function ReviewModal({
  sheet,
  index,
  total,
  analysis,
  settings,
  keyAnswers,
  overrides,
  onAnswer,
  onResetAnswers,
  onMeta,
  onClose,
  onPrev,
  onNext,
  onOpenKeyEditor,
}: ReviewModalProps) {
  const [zoom, setZoom] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 560 ? 130 : 100,
  );
  const [enhanceView, setEnhanceView] = useState(true);
  const [onlyReview, setOnlyReview] = useState(false);
  const answers = useMemo(() => getSheetAnswers(sheet, overrides), [sheet, overrides]);
  const student = analysis.students.find((s) => s.id === sheet.id);
  const detection = sheet.detection;
  const count = settings.questionCount;
  const overrideMap = overrides?.answers ?? {};
  const overrideCount = Object.keys(overrideMap).length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const questionRows = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const q = i + 1;
      const value = answers[q] ?? 'blank';
      const detected = detection?.rows.find((row) => row.q === q);
      const multiLabel = value === 'multi' ? student?.multiChoices?.[q] : undefined;
      const key = keyAnswers[q];
      const isCorrect = !sheet.isKey && key && key !== 'blank' && key !== 'multi' && value === key;
      const flagged =
        Boolean(overrideMap[q]) ||
        detected?.status === 'low' ||
        detected?.status === 'multi' ||
        value === 'multi' ||
        value === 'blank';
      return {
        q,
        value,
        multiLabel,
        detected,
        key,
        isCorrect,
        flagged,
        overridden: Boolean(overrideMap[q]),
      };
    });
  }, [answers, count, detection, keyAnswers, overrideMap, sheet.isKey, student]);

  const visibleRows = onlyReview ? questionRows.filter((r) => r.flagged) : questionRows;
  const lowCount = student?.lowCount ?? 0;
  const multiCount = student?.multiCount ?? 0;
  const blankCount = student?.blankCount ?? 0;
  const suggested = sheet.suggested;
  const hasSuggestion = Boolean(
    suggested?.className || suggested?.seatNo || suggested?.name,
  );

  if (!detection?.ok) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="review-modal error-modal">
          <div className="review-topbar">
            <div>
              <span className="topbar-kicker">答題紙 {index + 1} / {total}</span>
              <strong>{sheet.fileName}</strong>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="關閉">
              <X size={18} />
            </button>
          </div>
          <div className="review-error-body">
            <AlertTriangle size={34} />
            <h2>這張答題紙未能辨識</h2>
            <p>{sheet.error ?? detection?.warnings[0] ?? '請檢查影像是否完整。'}</p>
            <button className="btn secondary" onClick={onClose}>
              返回成績表
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="答題紙覆核">
      <div className="review-modal">
        <div className="review-topbar">
          <div className="review-topbar-left">
            <span className="topbar-kicker">
              <ScanLine size={13} /> 答題紙 {index + 1} / {total}
            </span>
            <strong>{sheet.fileName}</strong>
            {sheet.isKey && (
              <span className="identity-badge key">
                <Crown size={12} /> 答案卷
              </span>
            )}
          </div>
          <div className="review-topbar-nav">
            <button className="icon-btn" onClick={onPrev} aria-label="上一張">
              <ChevronLeft size={18} />
            </button>
            <button className="icon-btn" onClick={onNext} aria-label="下一張">
              <ChevronRight size={18} />
            </button>
            <button className="icon-btn close" onClick={onClose} aria-label="關閉">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="review-body">
          <div className="review-canvas-pane">
            <div className="canvas-toolbar">
              <div className="canvas-legend">
                <span className="lg correct">正確</span>
                <span className="lg wrong">答錯</span>
                <span className="lg low" title="系統未能確定這個答案，請覆核">存疑</span>
                <span className="lg blank">未填</span>
                <span className="lg multi">多選</span>
              </div>
              <div className="canvas-view-actions">
                <button
                  className={`view-toggle ${enhanceView ? 'active' : ''}`}
                  onClick={() => setEnhanceView((value) => !value)}
                  title={enhanceView ? '切換原圖' : '加深淡色筆跡，方便覆核'}
                >
                  <Contrast size={13} />
                  {enhanceView ? '增強中' : '增強對比'}
                </button>
                <div className="zoom-controls">
                <button
                  className="icon-btn"
                  onClick={() => setZoom((z) => Math.max(60, z - 20))}
                  aria-label="縮小"
                >
                  <Minus size={15} />
                </button>
                <span>{zoom}%</span>
                <button
                  className="icon-btn"
                  onClick={() => setZoom((z) => Math.min(200, z + 20))}
                  aria-label="放大"
                >
                  <Plus size={15} />
                </button>
                </div>
              </div>
            </div>
            <div className="canvas-scroll">
              <div className="canvas-zoom" style={{ width: `${zoom}%` }}>
                <SheetCanvas
                  src={sheet.previewUrl}
                  detection={detection!}
                  answers={answers}
                  keyAnswers={keyAnswers}
                  questionCount={count}
                  isKey={sheet.isKey}
                  brightness={enhanceView ? 0.92 : 1}
                  contrast={enhanceView ? 1.55 : 1}
                />
              </div>
            </div>
          </div>

          <aside className="review-side">
            <div className="student-card">
              <div className="student-card-head">
                <div>
                  <strong>{sheet.isKey ? '答案卷（滿分）' : '學生'}</strong>
                </div>
                {sheet.isKey ? (
                  <span className="score-badge key">100%</span>
                ) : (
                  <span className={`score-badge ${student && student.percent >= settings.passMark ? 'pass' : 'fail'}`}>
                    {student ? student.percent.toFixed(1) : '—'}%
                  </span>
                )}
              </div>
              {hasSuggestion && (
                <div className="suggested-banner">
                  <AlertTriangle size={14} />
                  <span>班別／學號／姓名有系統建議，請確認。</span>
                </div>
              )}
              <div className="student-fields">
                <label>
                  <span>姓名</span>
                  <input
                    className={suggested?.name ? 'suggested-input' : undefined}
                    title={suggested?.name ? '系統建議姓名，請確認' : undefined}
                    value={sheet.name}
                    onChange={(event) => onMeta({ name: event.target.value })}
                    placeholder="輸入姓名"
                  />
                </label>
                <div className="student-field-row">
                  <label>
                    <span>班別</span>
                    <input
                      className={suggested?.className ? 'suggested-input' : undefined}
                      title={suggested?.className ? '系統建議班別，請確認' : undefined}
                      value={sheet.className}
                      onChange={(event) => onMeta({ className: event.target.value })}
                      placeholder="4A"
                    />
                  </label>
                  <label>
                    <span>學號</span>
                    <input
                      className={suggested?.seatNo ? 'suggested-input' : undefined}
                      title={suggested?.seatNo ? '系統建議學號，請確認' : undefined}
                      value={sheet.seatNo}
                      onChange={(event) => onMeta({ seatNo: event.target.value })}
                      placeholder="01"
                    />
                  </label>
                </div>
              </div>
              <div className="student-stats">
                <div>
                  <span>得分</span>
                  <strong>
                    {sheet.isKey ? count : student?.score ?? '—'}
                    <small>/{count}</small>
                  </strong>
                </div>
                <div>
                  <span>未填</span>
                  <strong>{blankCount}</strong>
                </div>
                <div>
                  <span>多選</span>
                  <strong>{multiCount}</strong>
                </div>
                <div>
                  <span>存疑</span>
                  <strong>{lowCount}</strong>
                </div>
              </div>
              {sheet.isKey && (
                <div className="key-edit-banner">
                  <Crown size={15} />
                  <div>
                    <strong>這是答案卷</strong>
                    <span>修改這裡只會改本頁顯示；答案標準請用答案卷編輯器。</span>
                  </div>
                  <button className="btn small secondary" onClick={onOpenKeyEditor}>
                    編輯答案
                  </button>
                </div>
              )}
            </div>

            <div className="answers-head">
              <div>
                <strong>逐題覆核</strong>
                <span>
                  {overrideCount > 0
                    ? `已手動修正 ${overrideCount} 題`
                    : '可修改任何答案；存疑題已標示'}
                </span>
              </div>
              <div className="answers-head-actions">
                <button
                  className={`filter-pill ${onlyReview ? 'active' : ''}`}
                  onClick={() => setOnlyReview((v) => !v)}
                >
                  <Filter size={12} /> 需覆核 {questionRows.filter((r) => r.flagged).length}
                </button>
                {overrideCount > 0 && (
                  <button className="icon-text-btn" onClick={onResetAnswers}>
                    <RotateCcw size={13} /> 重設
                  </button>
                )}
              </div>
            </div>

            <div className="answer-list">
              {visibleRows.map((row) => (
                <div
                  key={row.q}
                  className={`answer-row ${
                    row.value === 'blank' ? 'blank' : row.isCorrect ? 'correct' : 'wrong'
                  } ${row.flagged ? 'flagged' : ''}`}
                >
                  <div className="answer-q">
                    <strong>Q{row.q}</strong>
                    <span className={row.detected?.status === 'multi' ? 'multi' : ''}>
                      {row.detected?.status === 'low'
                        ? '存疑'
                        : row.detected?.status === 'multi'
                          ? row.multiLabel ?? '多選'
                          : ''}
                    </span>
                  </div>
                  <div className="answer-key-hint">
                    答案 <b>{row.key && row.key !== 'blank' && row.key !== 'multi' ? row.key : '—'}</b>
                  </div>
                  <div className="answer-select-wrap">
                    {sheet.isKey ? (
                      <span className={`answer-readonly ${row.value}`}>
                        {uiAnswerLabel(row.value, row.multiLabel)}
                      </span>
                    ) : (
                      <select
                        className={`answer-select ${row.value}`}
                        value={row.value}
                        onChange={(event) => onAnswer(row.q, event.target.value as AnswerValue)}
                        aria-label={`第 ${row.q} 題答案`}
                      >
                        {OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option === 'blank' ? '未填' : option === 'multi' ? row.multiLabel ?? '多選' : option}
                          </option>
                        ))}
                      </select>
                    )}
                    {row.overridden && <span className="edited-dot" title="已手動修正" />}
                  </div>
                  <div className="answer-result">
                    {sheet.isKey ? (
                      <span className="ok-mini">答案</span>
                    ) : row.value === 'blank' ? null : row.isCorrect ? (
                      <CheckCircle2 size={16} className="correct-icon" />
                    ) : (
                      <X size={16} className="wrong-icon" />
                    )}
                  </div>
                </div>
              ))}
              {visibleRows.length === 0 && (
                <div className="answer-empty">
                  <CheckCircle2 size={24} />
                  <p>這頁沒有需要覆核的題目。</p>
                </div>
              )}
            </div>

            <div className="review-footer">
              <button className="btn ghost small" onClick={onClose}>
                完成覆核
              </button>
              <div className="review-nav">
                <button className="icon-btn" onClick={onPrev} aria-label="上一張">
                  <ArrowLeft size={16} />
                </button>
                <button className="icon-btn" onClick={onNext} aria-label="下一張">
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
