import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { TaskMeta } from '../types';
import { FORM_LEVELS, subjectGroups } from '../lib/subjects';

interface TaskBarProps {
  tasks: TaskMeta[];
  activeTaskId: string | null;
  formLevel: string;
  subject: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: () => void;
  onFormLevelChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  disabled?: boolean;
}

function taskLabel(task: TaskMeta, index: number): string {
  const title = task.title.trim();
  const subject = task.subject.trim();
  if (title && subject) return `${title} · ${subject}`;
  if (title) return title;
  if (subject) return subject;
  return `任務 ${index + 1}`;
}

export default function TaskBar({
  tasks,
  activeTaskId,
  formLevel,
  subject,
  onSwitch,
  onNew,
  onDelete,
  onFormLevelChange,
  onSubjectChange,
  disabled = false,
}: TaskBarProps) {
  const groups = subjectGroups(formLevel);
  const knownSubjects = new Set(groups.flatMap((group) => group.subjects));
  const activeIndex = Math.max(
    0,
    tasks.findIndex((task) => task.id === activeTaskId),
  );

  return (
    <div className="task-bar" aria-label="任務設定">
      <div className="task-current">
        <span className="task-kicker">
          <FolderOpen size={13} />
          任務
        </span>
        <select
          className="task-select"
          value={activeTaskId ?? ''}
          onChange={(event) => onSwitch(event.target.value)}
          disabled={disabled || tasks.length === 0}
          aria-label="選擇任務"
        >
          {tasks.map((task, index) => (
            <option key={task.id} value={task.id}>
              {taskLabel(task, index)}
              {task.sheetCount > 0 ? `（${task.sheetCount} 張）` : '（空白）'}
            </option>
          ))}
        </select>
      </div>

      <label className="task-form">
        <span className="task-kicker">年級</span>
        <select
          className="task-select"
          value={formLevel}
          onChange={(event) => onFormLevelChange(event.target.value)}
          disabled={disabled}
          aria-label="年級"
        >
          <option value="">未設定</option>
          {FORM_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>

      <label className="task-subject">
        <span className="task-kicker">科目</span>
        <select
          className="task-select"
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          disabled={disabled}
          aria-label="科目"
        >
          <option value="">未選擇</option>
          {subject && !knownSubjects.has(subject) && (
            <option value={subject}>{subject}</option>
          )}
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

      <div className="task-actions">
        <button
          className="btn ghost small"
          onClick={onNew}
          disabled={disabled}
          title="建立新任務"
          aria-label="建立新任務"
        >
          <Plus size={15} />
          <span>新任務</span>
        </button>
        <button
          className="icon-btn task-delete"
          onClick={onDelete}
          disabled={disabled || tasks.length === 0}
          title="刪除目前任務"
          aria-label="刪除目前任務"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
