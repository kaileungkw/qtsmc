import { del, get, set } from 'idb-keyval';
import type { SavedSession, TaskMeta } from '../types';
import { toDateInputValue } from './academic';

const INDEX_KEY = 'qtsmc-tasks-v1';

export interface TaskIndex {
  tasks: TaskMeta[];
  activeTaskId: string | null;
}

export function createTaskMeta(
  id: string,
  title = '',
  subject = '',
  formLevel = '',
): TaskMeta {
  const now = Date.now();
  return {
    id,
    title,
    subject,
    formLevel,
    date: toDateInputValue(new Date(now)),
    sheetCount: 0,
    questionCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadTaskIndex(): TaskIndex {
  try {
    if (typeof localStorage === 'undefined') return { tasks: [], activeTaskId: null };
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return { tasks: [], activeTaskId: null };
    const parsed = JSON.parse(raw) as TaskIndex;
    if (!parsed || !Array.isArray(parsed.tasks)) return { tasks: [], activeTaskId: null };
    return {
      tasks: parsed.tasks
        .filter((task) => task && typeof task.id === 'string' && task.id.length > 0)
        .map((task) => ({
          ...task,
          title: typeof task.title === 'string' ? task.title : '',
          subject: typeof task.subject === 'string' ? task.subject : '',
          formLevel: typeof task.formLevel === 'string' ? task.formLevel : '',
          date:
            typeof task.date === 'string' && task.date
              ? task.date
              : toDateInputValue(new Date(Number(task.createdAt) || Date.now())),
          sheetCount: Number(task.sheetCount) || 0,
          questionCount: Number(task.questionCount) || 0,
        })),
      activeTaskId:
        typeof parsed.activeTaskId === 'string' ? parsed.activeTaskId : null,
    };
  } catch {
    return { tasks: [], activeTaskId: null };
  }
}

export function saveTaskIndex(index: TaskIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Private mode / quota: task switching still works for this session.
  }
}

export async function loadTaskSession(id: string): Promise<SavedSession | undefined> {
  return get<SavedSession>(`qtsmc-task-session-${id}`);
}

export async function saveTaskSession(id: string, session: SavedSession): Promise<void> {
  await set(`qtsmc-task-session-${id}`, session);
}

export async function deleteTaskSession(id: string): Promise<void> {
  await del(`qtsmc-task-session-${id}`);
}
