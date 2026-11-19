import { useEffect, useState } from 'react';
import { CalendarDays, Plus, UploadCloud, X } from 'lucide-react';
import { FORM_LEVELS, subjectGroups } from '../lib/subjects';

interface TaskSetupModalProps {
  mode: 'new' | 'upload';
  initialFormLevel: string;
  initialSubject: string;
  onCancel: () => void;
  onConfirm: (formLevel: string, subject: string) => void;
}

export default function TaskSetupModal({
  mode,
  initialFormLevel,
  initialSubject,
  onCancel,
  onConfirm,
}: TaskSetupModalProps) {
  const [formLevel, setFormLevel] = useState(initialFormLevel);
  const [subject, setSubject] = useState(initialSubject);

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
  const ready = Boolean(formLevel && subject);

  const changeFormLevel = (value: string) => {
    setFormLevel(value);
    const nextSubjects = subjectGroups(value).flatMap((group) => group.subjects);
    if (subject && !nextSubjects.includes(subject)) setSubject('');
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
            <strong>{mode === 'new' ? '建立新任務' : '先設定年級及科目'}</strong>
          </div>
          <button className="icon-btn close" onClick={onCancel} aria-label="關閉">
            <X size={18} />
          </button>
        </div>

        <div className="setup-body">
          <p className="setup-lead">
            {mode === 'new'
              ? '選擇年級及科目，之後上載的答題紙會存入這個任務。'
              : '設定好年級及科目，才會開始處理你揀選的檔案。'}
          </p>

          <div className="setup-grid">
            <label className="field">
              <span>年級</span>
              <select
                value={formLevel}
                onChange={(event) => changeFormLevel(event.target.value)}
                autoFocus
              >
                <option value="">請選擇</option>
                {FORM_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>

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
          </div>

          <p className="setup-note">
            及格線會按年級自動設定：S1–S3 為 50%，S4–S6 為 40%。之後可在匯出頁更改。
          </p>
        </div>

        <div className="setup-actions">
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() => onConfirm(formLevel, subject)}
            disabled={!ready}
          >
            {mode === 'new' ? <Plus size={15} /> : <UploadCloud size={15} />}
            {mode === 'new' ? '建立任務' : '繼續上載'}
          </button>
        </div>
      </div>
    </div>
  );
}
