import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { TaskMeta } from '../types';
import { academicPeriod } from '../lib/academic';

interface HeaderProps {
  tasks: TaskMeta[];
  activeTaskId: string | null;
  onSwitchTask: (id: string) => void;
  onNewTask: () => void;
  onDeleteTask: () => void;
  taskDisabled?: boolean;
}

function taskLabel(task: TaskMeta, index: number): string {
  const prefix = academicPeriod(task.date || task.createdAt).prefix;
  const parts = [task.formLevel.trim(), task.subject.trim()].filter(Boolean);
  if (parts.length) return [prefix, ...parts].join('_');
  const title = task.title.trim();
  return `${prefix}_${title || `任務 ${index + 1}`}`;
}

export default function Header({
  tasks,
  activeTaskId,
  onSwitchTask,
  onNewTask,
  onDeleteTask,
  taskDisabled = false,
}: HeaderProps) {
  const activeTask = tasks.find((task) => task.id === activeTaskId);
  const isSurvey = activeTask?.kind === 'survey';

  return (
    <header className="site-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span>Q</span>
          <i />
        </div>
        <div className="brand-text">
          <strong>QTSMC</strong>
          <span>{isSurvey ? '選科表辨識' : '答題紙批改'}</span>
        </div>
      </div>

      <div className="header-right">
        <div className="header-task">
          <span className="header-task-label">目前任務</span>
          <select
            className="task-select"
            value={activeTaskId ?? ''}
            onChange={(event) => onSwitchTask(event.target.value)}
            disabled={taskDisabled || tasks.length === 0}
            aria-label="切換目前任務"
          >
            {tasks.length === 0 ? (
              <option value="">載入中…</option>
            ) : (
              tasks
                .filter((task) => task.sheetCount > 0 || task.id === activeTaskId)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {taskLabel(task, tasks.indexOf(task))}
                    {task.sheetCount > 0
                      ? `（${task.sheetCount} ${task.kind === 'survey' ? '份' : '張'}）`
                      : '（空白）'}
                  </option>
                ))
            )}
          </select>
        </div>

        <button
          className="icon-btn task-delete"
          onClick={onDeleteTask}
          disabled={taskDisabled || tasks.length === 0}
          title="刪除目前任務"
          aria-label="刪除目前任務"
        >
          <Trash2 size={16} />
        </button>

        <div className="privacy-pill" title="所有影像只在你的瀏覽器中處理">
          <ShieldCheck size={15} />
          <span>本機處理 · 不上傳</span>
        </div>

        <button
          className="btn primary small new-task-btn"
          onClick={onNewTask}
          disabled={taskDisabled}
          title="建立新任務（需選類型、年級及科目）"
        >
          <Plus size={15} />
          <span>新任務</span>
        </button>
      </div>
    </header>
  );
}
