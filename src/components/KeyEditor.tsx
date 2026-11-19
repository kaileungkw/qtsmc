import { useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  RotateCcw,
  X,
} from 'lucide-react';
import type { AnswerOverrides, AnswerValue, RuntimeSheet } from '../types';
import { multiChoiceLabel } from '../lib/scoring';

interface KeyEditorProps {
  keySheet: RuntimeSheet;
  keyAnswers: Record<number, AnswerValue>;
  keyOverrides: AnswerOverrides;
  questionCount: number;
  onQuestionCountChange: (count: number) => void;
  onSetKey: (q: number, value: AnswerValue) => void;
  onClear: () => void;
  onClose: () => void;
}

const OPTIONS: AnswerValue[] = ['A', 'B', 'C', 'D', 'blank', 'multi'];

export default function KeyEditor({
  keySheet,
  keyAnswers,
  keyOverrides,
  questionCount,
  onQuestionCountChange,
  onSetKey,
  onClear,
  onClose,
}: KeyEditorProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = useMemo(
    () =>
      Array.from({ length: questionCount }, (_, index) => {
        const q = index + 1;
        const detected = keySheet.detection?.rows.find((row) => row.q === q);
        return {
          q,
          detected: detected?.answer ?? 'blank',
          status: detected?.status ?? 'blank',
          multiLabel:
            detected?.status === 'multi'
              ? multiChoiceLabel(detected.scores) ?? 'multi'
              : undefined,
          value: keyAnswers[q] ?? 'blank',
          overridden: keyOverrides[q] !== undefined,
        };
      }),
    [questionCount, keySheet, keyAnswers, keyOverrides],
  );

  const invalid = rows.filter(
    (row) => row.value === 'blank' || row.value === 'multi',
  ).length;
  const overrideCount = Object.keys(keyOverrides).length;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="答案卷編輯器">
      <div className="key-editor-modal">
        <div className="review-topbar">
          <div className="review-topbar-left">
            <span className="topbar-kicker">
              <Crown size={13} /> ANSWER KEY
            </span>
            <strong>答案卷編輯器</strong>
            <span className="topbar-file">{keySheet.fileName}</span>
          </div>
          <button className="icon-btn close" onClick={onClose} aria-label="關閉">
            <X size={18} />
          </button>
        </div>

        <div className="key-editor-info">
          <div>
            <strong>
              共 {questionCount} 題 · {overrideCount > 0 ? `已手動修正 ${overrideCount} 題` : '使用偵測答案'}
            </strong>
            <span>
              修改後會即時重新計算所有學生成績及題目統計。答案卷本身永遠以滿分顯示。
            </span>
          </div>
          <div className="key-count-control">
            <span>本次題數</span>
            <input
              type="number"
              min={1}
              max={60}
              value={questionCount}
              onChange={(event) =>
                onQuestionCountChange(
                  Math.max(1, Math.min(60, Number(event.target.value) || 1)),
                )
              }
              aria-label="本次測驗題數"
            />
          </div>
          <div className={`key-validity ${invalid ? 'has-invalid' : 'all-valid'}`}>
            {invalid ? (
              <>
                <AlertTriangle size={15} />
                {invalid} 題未設定
              </>
            ) : (
              <>
                <CheckCircle2 size={15} />
                全部已設定
              </>
            )}
          </div>
        </div>

        <div className="key-grid">
          {rows.map((row) => (
            <article
              key={row.q}
              className={`key-card ${row.value === 'blank' || row.value === 'multi' ? 'missing' : ''}`}
            >
              <div className="key-card-head">
                <span className="q-label">Q{row.q}</span>
                <span className="detected-answer">
                  偵測 <b>{row.detected === 'blank' ? '未填' : row.detected === 'multi' ? row.multiLabel ?? '多選' : row.detected}</b>
                  {row.status === 'low' && <i>低信心</i>}
                  {row.status === 'multi' && <i>{row.multiLabel ?? 'multi'}</i>}
                </span>
                {row.overridden && <span className="edited-pill">已修正</span>}
              </div>
              <div className="key-options">
                {OPTIONS.map((option) => (
                  <button
                    key={option}
                    className={`key-option ${row.value === option ? 'active' : ''} ${option}`}
                    onClick={() => onSetKey(row.q, option)}
                    aria-pressed={row.value === option}
                  >
                    {option === 'blank' ? '未填' : option === 'multi' ? row.multiLabel ?? '多選' : option}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="key-editor-footer">
          <div className="key-footer-note">
            {invalid > 0 ? (
              <>
                <AlertTriangle size={14} />
                尚有 {invalid} 題未設定；這些題目暫不計分。
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                答案卷已完整，可以匯出報告。
              </>
            )}
          </div>
          <div className="key-footer-actions">
            {overrideCount > 0 && (
              <button className="btn ghost" onClick={onClear}>
                <RotateCcw size={15} />
                清除手動修正
              </button>
            )}
            <button className="btn primary" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
