import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, Plus, ScanLine, UploadCloud, X } from 'lucide-react';
import { FORM_LEVELS, subjectGroups } from '../lib/subjects';
import type { TaskKind } from '../types';

export const SURVEY_SUBJECTS = [
  '選科表（第一次）',
  '選科表（第二次）',
  '選科表（第三次）',
] as const;

interface TaskSetupModalProps {
  mode: 'new' | 'upload';
  initialFormLevel: string;
  initialSubject: string;
  onCancel: () => void;
  onConfirm: (
    formLevel: string,
    subject: string,
    kind: TaskKind,
    surveyNumber: number,
  ) => void;
}

export default function TaskSetupModal({
  mode,
  initialFormLevel,
  initialSubject,
  onCancel,
  onConfirm,
}: TaskSetupModalProps) {
  const surveyHint = SURVEY_SUBJECTS.some((item) => item === initialSubject);
  const [kind, setKind] = useState<TaskKind>(surveyHint ? 'survey' : 'mcq');
  const [surveyNumber, setSurveyNumber] = useState(
    surveyHint
      ? Math.max(
          1,
          SURVEY_SUBJECTS.indexOf(initialSubject as (typeof SURVEY_SUBJECTS)[number]) + 1,
        )
      : 1,
  );
  const [formLevel, setFormLevel] = useState(
    surveyHint ? initialFormLevel || 'S3' : initialFormLevel,
  );
  const [subject, setSubject] = useState(surveyHint ? '' : initialSubject);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const groups = subjectGroups(formLevel);
  const subjects = groups.flatMap((group) => group.subjects);
  const keepCurrent = Boolean(subject) && !subjects.includes(subject);
  const surveySubject = SURVEY_SUBJECTS[surveyNumber - 1];
  const ready = Boolean(formLevel && (kind === 'survey' || subject));

  const changeFormLevel = (value: string) => {
    setFormLevel(value);
    const nextSubjects = subjectGroups(value).flatMap((group) => group.subjects);
    if (subject && !nextSubjects.includes(subject)) setSubject('');
  };

  const confirm = () => {
    if (!ready) return;
    onConfirm(
      formLevel,
      kind === 'survey' ? surveySubject : subject,
      kind,
      surveyNumber,
    );
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'new' ? '建立新任務' : '設定任務'}
    >
      <div className="setup-modal">
        <div className="review-topbar">
          <div className="review-topbar-left">
            <span className="topbar-kicker">
              <CalendarDays size={13} /> {mode === 'new' ? 'NEW TASK' : 'SET UP'}
            </span>
            <strong>{mode === 'new' ? '建立新任務' : '先設定任務'}</strong>
          </div>
          <button className="icon-btn close" onClick={onCancel} aria-label="關閉">
            <X size={18} />
          </button>
        </div>

        <div className="setup-body">
          <p className="setup-lead">
            {kind === 'survey'
              ? '上載空白表格及已填寫的掃描，辨識每名學生的選科排序。'
              : mode === 'new'
                ? '選擇年級及科目，之後上載的答題紙會存入這個任務。'
                : '設定好年級及科目，才會開始處理你揀選的檔案。'}
          </p>

          {mode === 'new' && (
          <div className="task-kind-grid" role="radiogroup" aria-label="任務類型">
            <button
              type="button"
              className={`task-kind-card ${kind === 'mcq' ? 'active' : ''}`}
              onClick={() => setKind('mcq')}
              role="radio"
              aria-checked={kind === 'mcq'}
            >
              <ScanLine size={20} />
              <strong>答題紙批改</strong>
              <span>選擇題答題紙，自動計分及統計</span>
            </button>
            <button
              type="button"
              className={`task-kind-card ${kind === 'survey' ? 'active' : ''}`}
              onClick={() => {
                setKind('survey');
                setFormLevel('S3');
              }}
              role="radio"
              aria-checked={kind === 'survey'}
            >
              <ClipboardList size={20} />
              <strong>中三選科表</strong>
              <span>選科意願調查，讀取科目排序</span>
            </button>
          </div>
          )}

          <div className="setup-grid">
            <label className="field">
              <span>年級</span>
              <select
                value={formLevel}
                onChange={(event) => changeFormLevel(event.target.value)}
                autoFocus={kind === 'mcq'}
              >
                <option value="">請選擇</option>
                {FORM_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>

            {kind === 'survey' ? (
              <label className="field">
                <span>第幾次調查</span>
                <select
                  value={surveyNumber}
                  onChange={(event) => setSurveyNumber(Number(event.target.value))}
                  autoFocus
                >
                  {SURVEY_SUBJECTS.map((item, index) => (
                    <option key={item} value={index + 1}>
                      第{[...'一二三'][index]}次
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span>科目</span>
                <select
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  disabled={!formLevel}
                >
                  <option value="">{formLevel ? '請選擇' : '請先選年級'}</option>
                  {keepCurrent && <option value={subject}>{subject}</option>}
                  {groups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.subjects.map((item) => (
                        <option key={`${group.label}-${item}`} value={item}>
                          {item}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
          </div>

          <p className="setup-note">
            {kind === 'survey'
              ? '選科表任務會分開儲存；不會計分，也不會影響答題紙任務。'
              : '及格線會按年級自動設定：S1–S3 為 50%，S4–S6 為 40%。之後可在匯出頁更改。'}
          </p>
        </div>

        <div className="setup-actions">
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" onClick={confirm} disabled={!ready}>
            {mode === 'new' ? <Plus size={15} /> : <UploadCloud size={15} />}
            {mode === 'new' ? '建立任務' : '繼續上載'}
          </button>
        </div>
      </div>
    </div>
  );
}
