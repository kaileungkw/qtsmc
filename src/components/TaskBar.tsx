import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { TaskMeta } from '../types';

interface TaskBarProps {
  tasks: TaskMeta[];
  activeTaskId: string | null;
  subject: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: () => void;
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
  subject,
  onSwitch,
  onNew,
  onDelete,
  onSubjectChange,
  disabled = false,
}: TaskBarProps) {
  const activeIndex = Math.max(
    0,
    tasks.findIndex((task) => task.id === activeTaskId),
  );

  return (
    <div className="task-bar" aria-label="任務切換">
      <div className="task-current">
        <span className="task-kicker">
          <FolderOpen size={14} />
          目前任務
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

      <label className="task-subject">
        <span>科目</span>
        <input
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          placeholder="例如 Physics、化學"
          disabled={disabled}
          aria-label="目前任務的科目"
        />
      </label>

      <div className="task-actions">
        <button className="btn ghost small" onClick={onNew} disabled={disabled}>
          <Plus size={15} />
          新任務
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
