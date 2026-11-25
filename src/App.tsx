import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import Uploader from './components/Uploader';
import Results from './components/Results';
import ReviewModal from './components/ReviewModal';
import KeyEditor from './components/KeyEditor';
import TaskSetupModal from './components/TaskSetupModal';
import SurveyWorkspace from './components/SurveyWorkspace';
import Toast, { type ToastKind } from './components/Toast';
import Footer from './components/Footer';
import { analyseResults, getKeyAnswers, getSheetAnswers, suggestPassMark, suggestQuestionCountFromClass, MAX_QUESTIONS } from './lib/scoring';
import { pdfToImages } from './lib/pdf';
import { buildLayoutGuide, needsLayoutGuide } from './lib/marker';
import { clearSession, loadSession } from './lib/storage';
import {
  createTaskMeta,
  deleteSurveySession,
  deleteTaskSession,
  loadTaskIndex,
  loadTaskSession,
  saveTaskIndex,
  saveTaskSession,
} from './lib/tasks';
import { downloadBackup, parseBackupFile } from './lib/export';
import { toDateInputValue } from './lib/academic';
import { loadRoster, lookupRoster, type RosterData } from './lib/roster';
import { applyRosterAndSuggestions } from './lib/assign';
import type {
  Analysis,
  AnswerOverrides,
  AnswerValue,
  Detection,
  LayoutGuide,
  RuntimeSheet,
  SavedSession,
  Settings,
  SheetOverrides,
  SourcePdf,
  TaskKind,
  TaskMeta,
} from './types';

const today = toDateInputValue();
const DEFAULT_SETTINGS: Settings = {
  title: '',
  subject: '',
  className: '',
  formLevel: '',
  splitByClass: true,
  date: today,
  passMark: 50,
  passMarkAuto: true,
  includeKey: false,
  marksPerQuestion: 1,
  questionCount: 0,
  autoQuestionCount: true,
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Tab = 'scores' | 'questions' | 'options' | 'export';

interface WorkerReply {
  id: string;
  detection?: Detection;
  error?: string;
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function runWorkerJob(
  worker: Worker,
  blob: Blob,
  guide?: LayoutGuide,
): Promise<Detection> {
  return new Promise((resolve, reject) => {
    const id = uid();
    const timeout = window.setTimeout(() => {
      worker.removeEventListener('message', handler);
      reject(new Error('辨識逾時，請重試這張答題紙。'));
    }, 120000);
    const handler = (event: MessageEvent<WorkerReply>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      worker.removeEventListener('message', handler);
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.detection) resolve(event.data.detection);
      else reject(new Error('辨識失敗。'));
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ id, blob, guide });
  });
}

function makeSheet(blob: Blob, fileName: string, index: number): RuntimeSheet {
  return {
    id: uid(),
    fileName,
    name: '',
    className: '',
    seatNo: '',
    candidateNo: undefined,
    isKey: false,
    status: 'idle',
    nameSource: 'default',
    suggested: {},
    blob,
    previewUrl: URL.createObjectURL(blob),
    addedAt: Date.now() + index,
  };
}

function placeholderImage(): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#f5f1e8"/><text x="50%" y="46%" font-family="sans-serif" font-size="30" fill="#7a6f5e" text-anchor="middle">備份未包含原始影像</text><text x="50%" y="52%" font-family="sans-serif" font-size="18" fill="#9b907f" text-anchor="middle">成績與答案資料已載入</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function runtimeFromSaved(saved: SavedSession): RuntimeSheet[] {
  const restored: RuntimeSheet[] = [];
  for (const meta of saved.sheetMeta) {
    const blob = saved.files?.[meta.id];
    if (!blob) continue;
    const status =
      meta.status === 'processing'
        ? meta.detection?.ok
          ? 'done'
          : 'idle'
        : meta.status;
    const nameSource =
      meta.nameSource ??
      (meta.name === baseName(meta.fileName) ? 'default' : 'manual');
    // Older sessions stored the PDF page name as the student name. A name that
    // was never matched from the roster should stay blank, not look real.
    const name =
      nameSource === 'default' && meta.name === baseName(meta.fileName)
        ? ''
        : meta.name;
    restored.push({
      ...meta,
      name,
      status,
      nameSource,
      suggested: meta.suggested ?? {},
      blob,
      previewUrl: URL.createObjectURL(blob),
    });
  }
  return restored;
}

interface BootResult {
  tasks: TaskMeta[];
  activeTaskId: string;
  session?: SavedSession;
  migrated: boolean;
  loadError?: string;
}

function emptyTask(): { task: TaskMeta; index: { tasks: TaskMeta[]; activeTaskId: string } } {
  const task = createTaskMeta(uid());
  const index = { tasks: [task], activeTaskId: task.id };
  saveTaskIndex(index);
  return { task, index };
}

async function bootTasks(): Promise<BootResult> {
  const index = loadTaskIndex();
  if (index.tasks.length > 0) {
    const active =
      index.tasks.find((task) => task.id === index.activeTaskId) ?? index.tasks[0];
    if (active.id !== index.activeTaskId) {
      saveTaskIndex({ tasks: index.tasks, activeTaskId: active.id });
    }
    let session: SavedSession | undefined;
    try {
      session = await loadTaskSession(active.id);
    } catch {
      return {
        tasks: index.tasks,
        activeTaskId: active.id,
        migrated: false,
        loadError: '瀏覽器未能讀取目前任務。請重新載入並重試。',
      };
    }
    return { tasks: index.tasks, activeTaskId: active.id, session, migrated: false };
  }

  // Upgrade the old single-session format into the first named task.
  try {
    const legacy = await loadSession();
    if (legacy) {
      const id = uid();
      const title = legacy.settings.title.trim() || '上一個任務';
      const meta = createTaskMeta(
        id,
        title,
        legacy.settings.subject,
        legacy.settings.formLevel ?? '',
      );
      meta.sheetCount = legacy.sheetMeta.length;
      meta.questionCount = legacy.settings.questionCount || 0;
      meta.date = legacy.settings.date || meta.date;
      meta.updatedAt = legacy.savedAt || Date.now();
      await saveTaskSession(id, legacy);
      const tasks = [meta];
      saveTaskIndex({ tasks, activeTaskId: id });
      await clearSession().catch(() => undefined);
      return { tasks, activeTaskId: id, session: legacy, migrated: true };
    }
  } catch {
    // If migration fails, still open a clean task instead of blocking the app.
  }

  const { task, index: freshIndex } = emptyTask();
  return { tasks: freshIndex.tasks, activeTaskId: task.id, migrated: false };
}

function headerPatch(
  sheet: RuntimeSheet,
  detection: Detection,
): Partial<Pick<RuntimeSheet, 'className' | 'seatNo' | 'candidateNo'>> {
  const header = detection.header;
  if (!header) return {};
  const previous = sheet.detection?.header;
  const classNameEdited = Boolean(
    previous?.className && sheet.className && sheet.className !== previous.className,
  );
  const seatEdited = Boolean(
    previous?.seatNo && sheet.seatNo && sheet.seatNo !== previous.seatNo,
  );
  const rawClassNo = header.classNo
    ? header.classNo.replace(/\D/g, '').padStart(2, '0')
    : header.seatNo
      ? header.seatNo.replace(/\D/g, '').slice(-2).padStart(2, '0')
      : '';
  return {
    className:
      !classNameEdited && header.className ? header.className : sheet.className,
    // The printed Class No (last two digits) is the student number; the
    // four-digit value is the candidate/exam number used for roster matching.
    seatNo: seatEdited
      ? sheet.seatNo
      : rawClassNo || (header.className ? '' : sheet.seatNo),
    candidateNo: seatEdited
      ? sheet.candidateNo
      : header.candidateNo ?? header.seatNo ?? sheet.candidateNo,
  };
}

export default function App() {
  const [sheets, setSheets] = useState<RuntimeSheet[]>([]);
  const [sourcePdfs, setSourcePdfs] = useState<SourcePdf[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [overrides, setOverrides] = useState<Record<string, SheetOverrides>>({});
  const [keyOverrides, setKeyOverrides] = useState<AnswerOverrides>({});
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [importProgress, setImportProgress] = useState<{
    active: boolean;
    label: string;
    page: number;
    total: number;
  }>({ active: false, label: '', page: 0, total: 0 });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showManager, setShowManager] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('scores');
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [rosterStatus, setRosterStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const rosterRequest = useRef(0);
  const [tasks, setTasks] = useState<TaskMeta[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [setupMode, setSetupMode] = useState<'new' | 'upload' | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const activeTask = tasks.find((task) => task.id === activeTaskId);
  const isSurveyTask = activeTask?.kind === 'survey';
  const bootRef = useRef<Promise<BootResult> | null>(null);

  const showToast = useCallback((message: string, kind: ToastKind = 'info') => {
    setToast({ message, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const loadRosterNow = useCallback(
    async (force = false) => {
      const requestId = ++rosterRequest.current;
      setRosterStatus('loading');
      try {
        const data = await loadRoster(force);
        if (requestId !== rosterRequest.current) return;
        setRoster(data);
        setRosterStatus('ready');
        if (force) {
          showToast(`全校名單已更新（${data.entries.length} 人）。`, 'success');
        }
      } catch {
        if (requestId !== rosterRequest.current) return;
        setRosterStatus('error');
        if (force) {
          showToast('未能載入全校名單；可手動輸入姓名。', 'warning');
        }
      }
    },
    [showToast],
  );

  // Teachers only need to upload PDFs: the whole-school roster is automatic.
  useEffect(() => {
    void loadRosterNow(false);
  }, [loadRosterNow]);

  // Apply roster names whenever the roster arrives or the saved session is ready.
  useEffect(() => {
    if (!roster || !hydrated) return;
    setSheets((prev) => applyRosterAndSuggestions(prev, roster));
  }, [roster, hydrated]);

  // Load the task list and restore the task that was last open. The old
  // single-session format is migrated into the first task automatically.
  useEffect(() => {
    let cancelled = false;
    const boot = bootRef.current ?? (bootRef.current = bootTasks());
    boot
      .then((result) => {
        if (cancelled) return;
        setTasks(result.tasks);
        setActiveTaskId(result.activeTaskId);
        setTaskLoadError(result.loadError ?? null);
        if (result.loadError) setSaveState('error');
        if (result.session) {
          const restored = runtimeFromSaved(result.session);
          setSettings({ ...DEFAULT_SETTINGS, ...result.session.settings });
          setOverrides(result.session.edits ?? {});
          setKeyOverrides(result.session.keyOverrides ?? {});
          setSheets(restored);
          setSourcePdfs(result.session.sourcePdfs ?? []);
          setShowManager(restored.length === 0);
          setSaveState('saved');
          if (restored.length > 0) {
            showToast(
              result.migrated
                ? '已將上一個工作階段儲存為任務，可繼續使用。'
                : '已載入目前任務。',
              'success',
            );
          }
        } else {
          // If IndexedDB has the metadata but not the session (for example
          // after a quota error), still show the task name and subject.
          const active = result.tasks.find((task) => task.id === result.activeTaskId);
          if (active) {
            setSettings({
              ...DEFAULT_SETTINGS,
              title: active.title,
              subject: active.subject,
              formLevel: active.formLevel,
              date: active.date,
              questionCount: active.questionCount,
            });
          }
        }
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const keySheet = useMemo(
    () => sheets.find((s) => s.isKey) ?? sheets[0],
    [sheets],
  );
  const keyAnswers = useMemo(
    () => getKeyAnswers(keySheet, keyOverrides),
    [keySheet, keyOverrides],
  );
  const autoCount = useMemo(
    () => suggestQuestionCountFromClass(sheets, overrides, keySheet, keyAnswers, keyOverrides),
    [sheets, overrides, keySheet, keyAnswers, keyOverrides],
  );
  const autoPassMark = useMemo(() => {
    const match = settings.formLevel.match(/[1-6]/);
    if (match) return Number(match[0]) >= 4 ? 40 : 50;
    return suggestPassMark(sheets);
  }, [settings.formLevel, sheets]);

  // Keep the automatic question count in sync with the answer sheet.
  useEffect(() => {
    if (!settings.autoQuestionCount) return;
    if (autoCount > 0 && autoCount !== settings.questionCount) {
      setSettings((prev) => ({ ...prev, questionCount: autoCount }));
    }
  }, [autoCount, settings.autoQuestionCount, settings.questionCount]);

  // HK junior forms pass at 50%, senior forms at 40%.
  useEffect(() => {
    if (!settings.passMarkAuto || !autoPassMark) return;
    if (settings.passMark !== autoPassMark) {
      setSettings((prev) =>
        prev.passMark === autoPassMark ? prev : { ...prev, passMark: autoPassMark },
      );
    }
  }, [autoPassMark, settings.passMarkAuto, settings.passMark]);

  const analysis: Analysis = useMemo(
    () =>
      analyseResults(
        sheets,
        settings.questionCount,
        settings.passMark,
        settings.includeKey,
        overrides,
        keyOverrides,
      ),
    [sheets, settings.questionCount, settings.passMark, settings.includeKey, overrides, keyOverrides],
  );

  const buildSession = useCallback((): SavedSession => {
    const sheetMeta = sheets.map(({ blob: _blob, previewUrl: _url, ...meta }) => meta);
    const files: Record<string, Blob> = {};
    for (const sheet of sheets) files[sheet.id] = sheet.blob;
    return {
      version: 1,
      savedAt: Date.now(),
      sheetMeta,
      settings,
      edits: overrides,
      keyOverrides,
      files,
      sourcePdfs,
    };
  }, [sheets, settings, overrides, keyOverrides, sourcePdfs]);

  // Autosave the active task (including an empty task's subject/settings).
  useEffect(() => {
    if (!hydrated || processing || !activeTaskId || taskLoadError || isSurveyTask) return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      saveTaskSession(activeTaskId, buildSession())
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [hydrated, processing, activeTaskId, buildSession, taskLoadError, isSurveyTask]);

  // Keep the task switcher labels and counts in sync immediately.
  useEffect(() => {
    if (!activeTaskId || isSurveyTask) return;
    setTasks((prev) => {
      const index = prev.findIndex((task) => task.id === activeTaskId);
      if (index < 0) return prev;
      const task = prev[index];
      if (
        task.title === settings.title &&
        task.subject === settings.subject &&
        task.formLevel === settings.formLevel &&
        task.date === settings.date &&
        task.sheetCount === sheets.length &&
        task.questionCount === settings.questionCount
      ) {
        return prev;
      }
      const next = [...prev];
      next[index] = {
        ...task,
        title: settings.title,
        subject: settings.subject,
        formLevel: settings.formLevel,
        date: settings.date,
        sheetCount: sheets.length,
        questionCount: settings.questionCount,
        updatedAt: Date.now(),
      };
      return next;
    });
  }, [
    activeTaskId,
    settings.title,
    settings.subject,
    settings.formLevel,
    settings.date,
    settings.questionCount,
    sheets.length,
    isSurveyTask,
  ]);

  useEffect(() => {
    if (!hydrated || !activeTaskId || tasks.length === 0) return;
    saveTaskIndex({ tasks, activeTaskId });
  }, [tasks, activeTaskId, hydrated]);

  // If an export failed because a deployment replaced a lazy-loaded chunk,
  // ExportPanel reloads the page and leaves this flag. Re-open the export tab
  // so the teacher only needs to press the download button once more.
  useEffect(() => {
    if (!hydrated) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem('qtsmc-pending-export');
    } catch {
      return;
    }
    if (pending !== 'xlsx' && pending !== 'csv') return;
    try {
      sessionStorage.removeItem('qtsmc-pending-export');
    } catch {
      // Ignore storage restrictions; the tab is still opened below.
    }
    setActiveTab('export');
    showToast('網站已更新，請再按一次下載。', 'info');
  }, [hydrated, showToast]);

  // Load images and PDFs. PDF pages become individual sheets.
  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || processing || taskBusy) return;
      const added: RuntimeSheet[] = [];
      const addedPdfs: SourcePdf[] = [];
      let created = sheets.length;
      for (const file of files) {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf) {
          try {
            setImportProgress({
              active: true,
              label: file.name,
              page: 0,
              total: 0,
            });
            const pages = await pdfToImages(file, (page, total) => {
              setImportProgress({
                active: true,
                label: file.name,
                page,
                total,
              });
            });
            for (const page of pages) {
              added.push(makeSheet(page.blob, page.fileName, created++));
            }
            addedPdfs.push({ name: file.name, blob: file });
            showToast(`已將 PDF 分成 ${pages.length} 頁。`, 'success');
          } catch (error) {
            showToast(
              `${file.name} 轉換失敗：${error instanceof Error ? error.message : '未知錯誤'}`,
              'error',
            );
          } finally {
            setImportProgress({ active: false, label: '', page: 0, total: 0 });
          }
        } else if (
          file.type.startsWith('image/') ||
          /\.(jpe?g|png|webp|bmp)$/i.test(file.name)
        ) {
          added.push(makeSheet(file, file.name, created++));
        } else {
          showToast(`${file.name} 不是支援的格式（JPG / PNG / WEBP / PDF）。`, 'error');
        }
      }
      if (!added.length) return;
      if (addedPdfs.length) {
        setSourcePdfs((prev) => [...prev, ...addedPdfs]);
      }
      setSheets((prev) => {
        const next = [...prev, ...added];
        if (!next.some((s) => s.isKey)) {
          next[0] = { ...next[0], isKey: true };
        }
        return next;
      });
      // Give a fresh task a meaningful name from the first uploaded file.
      setSettings((prev) =>
        prev.title.trim() ? prev : { ...prev, title: baseName(files[0].name) },
      );
      setShowManager(true);
    },
    [processing, sheets.length, showToast, taskBusy],
  );

  // Year and subject are required before the first upload, so every task has a
  // readable label and the pass mark can follow the form level.
  const handleFiles = useCallback(
    (files: File[]) => {
      if (!files.length || processing || taskBusy || importProgress.active) return;
      if (!settings.formLevel.trim() || !settings.subject.trim()) {
        setPendingFiles(files);
        setSetupMode('upload');
        return;
      }
      void addFiles(files);
    },
    [
      addFiles,
      importProgress.active,
      processing,
      settings.formLevel,
      settings.subject,
      taskBusy,
    ],
  );

  const removeSheet = useCallback(
    (id: string) => {
      setSheets((prev) => {
        const target = prev.find((s) => s.id === id);
        if (target) URL.revokeObjectURL(target.previewUrl);
        const next = prev.filter((s) => s.id !== id);
        if (next.length && !next.some((s) => s.isKey)) {
          next[0] = { ...next[0], isKey: true };
        }
        return next;
      });
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (reviewId === id) setReviewId(null);
      if (keySheet?.id === id) setKeyOverrides({});
    },
    [keySheet?.id, reviewId],
  );

  const moveSheet = useCallback((id: string, direction: -1 | 1) => {
    setSheets((prev) => {
      const index = prev.findIndex((s) => s.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const setKeySheet = useCallback(
    (id: string) => {
      setSheets((prev) => prev.map((s) => ({ ...s, isKey: s.id === id })));
      setKeyOverrides({});
      setSettings((prev) => ({ ...prev, autoQuestionCount: true }));
      showToast('已設定新的答案卷。', 'success');
    },
    [showToast],
  );

  const processAll = useCallback(async () => {
    if (processing || importProgress.active || sheets.length === 0) return;
    setProcessing(true);
    setShowManager(false);
    setProgress({ done: 0, total: sheets.length, current: '' });
    let updated = [...sheets];
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./lib/marker.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      showToast('此瀏覽器不支援 Worker，請使用最新版 Chrome / Edge / Safari。', 'error');
      setProcessing(false);
      return;
    }
    // Reads one sheet and stores the result. `updated` is replaced on every
    // change, so the helper always works on the latest array.
    const detect = async (sheet: RuntimeSheet, guide?: LayoutGuide) => {
      updated = updated.map((s) =>
        s.id === sheet.id
          ? { ...s, status: 'processing', error: undefined, reviewed: false }
          : s,
      );
      setSheets(updated);
      try {
        const detection = await runWorkerJob(worker, sheet.blob, guide);
        const patch = detection.ok ? headerPatch(sheet, detection) : {};
        const header = detection.ok ? detection.header : undefined;
        updated = updated.map((s) =>
          s.id === sheet.id
            ? {
                ...s,
                ...patch,
                suggested: {
                  ...s.suggested,
                  ...(header?.className ? { className: false } : {}),
                  ...(header?.seatNo ? { seatNo: false } : {}),
                },
                status: detection.ok ? 'done' : 'error',
                detection,
                error: detection.ok ? undefined : detection.warnings[0],
              }
            : s,
        );
      } catch (error) {
        updated = updated.map((s) =>
          s.id === sheet.id
            ? {
                ...s,
                status: 'error',
                error: error instanceof Error ? error.message : '辨識失敗。',
              }
            : s,
        );
      }
      setSheets(updated);
    };
    for (let i = 0; i < updated.length; i++) {
      setProgress({ done: i, total: updated.length, current: updated[i].fileName });
      await detect(updated[i]);
    }
    // A sheet whose own frame detection found a block twice, or not at all, is
    // read again with the block positions the other sheets of the batch share.
    const guide = buildLayoutGuide(
      updated.map((s) => s.detection).filter((d): d is Detection => Boolean(d)),
    );
    if (guide) {
      const retry = updated.filter(
        (s) => s.detection && needsLayoutGuide(s.detection, guide),
      );
      for (let i = 0; i < retry.length; i++) {
        setProgress({ done: i, total: retry.length, current: retry[i].fileName });
        await detect(retry[i], guide);
      }
    }
    worker.terminate();
    if (roster) {
      updated = applyRosterAndSuggestions(updated, roster);
    }
    setSheets(updated);
    setProcessing(false);
    setProgress({ done: updated.length, total: updated.length, current: '' });
    const nextKey = updated.find((s) => s.isKey) ?? updated[0];
    const auto = suggestQuestionCountFromClass(
      updated,
      overrides,
      nextKey,
      getKeyAnswers(nextKey, keyOverrides),
      keyOverrides,
    );
    if (auto > 0) {
      setSettings((prev) => ({
        ...prev,
        questionCount: auto,
        autoQuestionCount: true,
      }));
    }
    const failed = updated.filter((s) => s.status === 'error').length;
    if (failed) {
      showToast(`批改完成，但有 ${failed} 張需要檢查。`, 'warning');
    } else {
      showToast('批改完成，已計算成績及題目統計。', 'success');
    }
    setActiveTab('scores');
  }, [
    importProgress.active,
    processing,
    sheets,
    keyOverrides,
    overrides,
    showToast,
    roster,
  ]);

  const editSheet = useCallback(
    (id: string, patch: Partial<Pick<RuntimeSheet, 'name' | 'className' | 'seatNo'>>) => {
      setSheets((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const next: RuntimeSheet = { ...s, ...patch };
          const classOrSeatChanged =
            patch.className !== undefined || patch.seatNo !== undefined;
          if (patch.name !== undefined) {
            next.nameSource = 'manual';
          }
          if (classOrSeatChanged) {
            const entry = lookupRoster(
              roster,
              patch.className ?? s.className,
              patch.seatNo ?? s.seatNo,
            );
            // Entering a class and number is the source of truth: replace any
            // previous suggestion, or leave the name blank for a transfer
            // student who is not in the roster.
            next.name = entry?.name ?? '';
            next.nameSource = entry ? 'roster' : 'default';
            next.group = entry?.group;
            next.groupEng = entry?.groupEng;
            next.candidateNo = entry
              ? String(entry.examId).padStart(4, '0')
              : undefined;
            next.suggested = {
              ...s.suggested,
              name: false,
              className: false,
              seatNo: false,
            };
          } else if (patch.name !== undefined) {
            next.suggested = { ...s.suggested, name: false };
          }
          return next;
        }),
      );
    },
    [roster],
  );

  const setAnswer = useCallback(
    (sheetId: string, q: number, value: AnswerValue) => {
      const sheet = sheets.find((s) => s.id === sheetId);
      const detected = sheet ? getSheetAnswers(sheet)[q] : undefined;
      setOverrides((prev) => {
        const current = prev[sheetId]?.answers ?? {};
        const nextAnswers = { ...current };
        if (detected === value) delete nextAnswers[q];
        else nextAnswers[q] = value;
        return {
          ...prev,
          [sheetId]: { ...(prev[sheetId] ?? { answers: {} }), answers: nextAnswers },
        };
      });
    },
    [sheets],
  );

  const resetSheetAnswers = useCallback((sheetId: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[sheetId];
      return next;
    });
  }, []);

  const setKeyAnswer = useCallback(
    (q: number, value: AnswerValue) => {
      const detected = keySheet ? getSheetAnswers(keySheet)[q] : undefined;
      if (keyAnswers[q] === value) return;
      setKeyOverrides((prev) => {
        const next = { ...prev };
        if (detected === value) delete next[q];
        else next[q] = value;
        return next;
      });
    },
    [keySheet, keyAnswers],
  );

  const setQuestionCount = useCallback((count: number) => {
    setSettings((prev) => ({
      ...prev,
      questionCount: Math.max(1, Math.min(MAX_QUESTIONS, Math.round(count))),
      autoQuestionCount: false,
    }));
  }, []);

  const setAutoQuestionCount = useCallback(
    (auto: boolean) => {
      setSettings((prev) => ({
        ...prev,
        autoQuestionCount: auto,
        questionCount: auto && autoCount > 0 ? autoCount : prev.questionCount,
      }));
    },
    [autoCount],
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyTaskContent = useCallback(
    (saved: SavedSession | undefined, fallback?: TaskMeta) => {
      const restored = saved ? runtimeFromSaved(saved) : [];
      const nextSheets = roster
        ? applyRosterAndSuggestions(restored, roster)
        : restored;
      for (const sheet of sheets) URL.revokeObjectURL(sheet.previewUrl);
      setSheets(nextSheets);
      setSourcePdfs(saved?.sourcePdfs ?? []);
      if (saved) {
        setSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
        setOverrides(saved.edits ?? {});
        setKeyOverrides(saved.keyOverrides ?? {});
        setSaveState('saved');
      } else {
        setSettings(
          fallback
            ? {
                ...DEFAULT_SETTINGS,
                title: fallback.title,
                subject: fallback.subject,
                formLevel: fallback.formLevel,
                date: fallback.date,
                questionCount: fallback.questionCount,
              }
            : DEFAULT_SETTINGS,
        );
        setOverrides({});
        setKeyOverrides({});
        setSaveState('idle');
      }
      setReviewId(null);
      setKeyEditorOpen(false);
      setShowManager(!saved || nextSheets.length === 0);
      setActiveTab('scores');
    },
    [roster, sheets],
  );

  const switchTask = useCallback(
    async (id: string) => {
      if (!id || id === activeTaskId || processing || taskBusy || importProgress.active) return;
      if (!tasks.some((task) => task.id === id)) {
        showToast('找不到這個任務。', 'error');
        return;
      }
      setTaskBusy(true);
      try {
        const current = tasks.find((task) => task.id === activeTaskId);
        if (activeTaskId && current?.kind !== 'survey') {
          try {
            await saveTaskSession(activeTaskId, buildSession());
          } catch {
            showToast(
              '目前任務未能儲存，未切換或建立任務。請重試，並檢查瀏覽器儲存空間。',
              'error',
            );
            return;
          }
        }
        const target = tasks.find((task) => task.id === id);
        if (target?.kind === 'survey') {
          for (const sheet of sheets) URL.revokeObjectURL(sheet.previewUrl);
          setSheets([]);
          setSourcePdfs([]);
          setOverrides({});
          setKeyOverrides({});
          setSettings({
            ...DEFAULT_SETTINGS,
            formLevel: target.formLevel,
            subject: target.subject,
            date: target.date,
          });
          setActiveTaskId(id);
          showToast('已切換至選科表任務。', 'success');
          return;
        }
        const saved = await loadTaskSession(id);
        applyTaskContent(saved, target);
        setActiveTaskId(id);
        showToast('已切換任務；影像、成績及設定會一併保留。', 'success');
      } catch {
        showToast('未能載入這個任務，請再試一次。', 'error');
      } finally {
        setTaskBusy(false);
      }
    },
    [
      activeTaskId,
      applyTaskContent,
      buildSession,
      importProgress.active,
      processing,
      showToast,
      taskBusy,
      tasks,
    ],
  );

  const createNewTask = useCallback(async (formLevel: string, subject: string, kind: TaskKind = 'mcq') => {
    if (processing || taskBusy || importProgress.active) return;
    setTaskBusy(true);
    try {
      const currentKind = tasks.find((task) => task.id === activeTaskId)?.kind;
      if (activeTaskId && currentKind !== 'survey') {
        try {
          await saveTaskSession(activeTaskId, buildSession());
        } catch {
          showToast(
            '目前任務未能儲存，未切換或建立任務。請重試，並檢查瀏覽器儲存空間。',
            'error',
          );
          return;
        }
      }
      // Replace an unused task instead of leaving an empty entry behind. A
      // survey task's form count lives on the task meta, not in `sheets`.
      const current = tasks.find((task) => task.id === activeTaskId);
      const currentEmpty =
        current?.kind === 'survey'
          ? (current.sheetCount ?? 0) === 0
          : sheets.length === 0 && !current?.title.trim();
      const replaceCurrent = Boolean(activeTaskId) && currentEmpty;
      if (replaceCurrent && activeTaskId) {
        await deleteTaskSession(activeTaskId).catch(() => undefined);
        if (current?.kind === 'survey') {
          await deleteSurveySession(activeTaskId).catch(() => undefined);
        }
      }
      const meta = createTaskMeta(uid(), '', subject, formLevel, kind);
      for (const sheet of sheets) URL.revokeObjectURL(sheet.previewUrl);
      setSheets([]);
      setSourcePdfs([]);
      setSettings({
        ...DEFAULT_SETTINGS,
        formLevel,
        subject,
        date: meta.date,
      });
      setOverrides({});
      setKeyOverrides({});
      setReviewId(null);
      setKeyEditorOpen(false);
      setShowManager(true);
      setSaveState('idle');
      setActiveTab('scores');
      setTasks((prev) =>
        replaceCurrent && activeTaskId
          ? [...prev.filter((task) => task.id !== activeTaskId), meta]
          : [...prev, meta],
      );
      setActiveTaskId(meta.id);
      showToast(
        kind === 'survey' ? '已建立選科表任務；請上載空白表格及掃描。' : '已建立新任務；請上載答題紙。',
        'success',
      );
    } finally {
      setTaskBusy(false);
    }
  }, [
    activeTaskId,
    buildSession,
    importProgress.active,
    processing,
    sheets,
    showToast,
    taskBusy,
    tasks,
  ]);

  const requestNewTask = useCallback(() => {
    if (processing || taskBusy || importProgress.active) return;
    setPendingFiles([]);
    setSetupMode('new');
  }, [importProgress.active, processing, taskBusy]);

  const cancelSetup = useCallback(() => {
    setSetupMode(null);
    setPendingFiles([]);
  }, []);

  const confirmSetup = useCallback(
    (formLevel: string, subject: string, kind: TaskKind = 'mcq') => {
      const mode = setupMode;
      const files = pendingFiles;
      setSetupMode(null);
      setPendingFiles([]);
      if (mode === 'new') {
        void createNewTask(formLevel, subject, kind);
        return;
      }
      if (mode === 'upload' && files.length) {
        setSettings((prev) => ({ ...prev, formLevel, subject }));
        void addFiles(files);
      }
    },
    [addFiles, createNewTask, pendingFiles, setupMode],
  );

  const clearCurrentSheets = useCallback(() => {
    if (processing || importProgress.active || sheets.length === 0) return;
    if (
      !window.confirm(
        '確定清除目前任務的所有答題紙及批改結果？其他任務不會受影響。',
      )
    ) {
      return;
    }
    for (const sheet of sheets) URL.revokeObjectURL(sheet.previewUrl);
    setSheets([]);
    setSourcePdfs([]);
    setOverrides({});
    setKeyOverrides({});
    setReviewId(null);
    setShowManager(true);
    setSaveState('saving');
    showToast('已清除目前任務的答題紙；可重新上載。', 'success');
  }, [importProgress.active, processing, sheets, showToast]);

  const deleteCurrentTask = useCallback(async () => {
    if (!activeTaskId || processing || taskBusy || importProgress.active) return;
    const activeIndex = tasks.findIndex((task) => task.id === activeTaskId);
    if (activeIndex < 0) return;
    const active = tasks[activeIndex];
    const label = active.title.trim() || active.subject.trim() || '目前任務';
    if (
      !window.confirm(
        `確定刪除「${label}」？此任務的影像、成績及設定會一併刪除，不能復原。`,
      )
    ) {
      return;
    }
    setTaskBusy(true);
    try {
      await deleteTaskSession(activeTaskId);
      if (active.kind === 'survey') await deleteSurveySession(activeTaskId);
      const remaining = tasks.filter((task) => task.id !== activeTaskId);
      if (remaining.length === 0) {
        const meta = createTaskMeta(uid());
        applyTaskContent(undefined);
        setTasks([meta]);
        setActiveTaskId(meta.id);
        showToast('已刪除任務，並建立一個新的空白任務。', 'success');
      } else {
        const nextIndex = Math.min(activeIndex, remaining.length - 1);
        const next = remaining[nextIndex];
        const saved = await loadTaskSession(next.id).catch(() => undefined);
        applyTaskContent(saved, next);
        setTasks(remaining);
        setActiveTaskId(next.id);
        showToast('已刪除目前任務，並切換到下一個任務。', 'success');
      }
    } catch {
      showToast('未能刪除任務，請再試一次。', 'error');
    } finally {
      setTaskBusy(false);
    }
  }, [
    activeTaskId,
    applyTaskContent,
    importProgress.active,
    processing,
    showToast,
    taskBusy,
    tasks,
  ]);

  const backup = useCallback(() => {
    if (!sheets.length) return;
    const sheetMeta = sheets.map(({ blob: _blob, previewUrl: _url, ...meta }) => meta);
    const session: SavedSession = {
      version: 1,
      savedAt: Date.now(),
      sheetMeta,
      settings,
      edits: overrides,
      keyOverrides,
      files: {},
    };
    downloadBackup(session);
    showToast('已下載 JSON 備份（不含原始影像）。', 'success');
  }, [sheets, settings, overrides, keyOverrides, showToast]);

  const importBackup = useCallback(
    async (file: File) => {
      try {
        if (
          sheets.length &&
          !window.confirm('載入備份會取代目前任務的答題紙及成績，確定繼續嗎？')
        ) {
          return;
        }
        const saved = await parseBackupFile(file);
        const placeholder = placeholderImage();
        const restored: RuntimeSheet[] = saved.sheetMeta.map((meta) => {
          const blob = saved.files?.[meta.id] ?? placeholder;
          const nameSource =
            meta.nameSource ??
            (meta.name === baseName(meta.fileName) ? 'default' : 'manual');
          const name =
            nameSource === 'default' && meta.name === baseName(meta.fileName)
              ? ''
              : meta.name;
          return {
            ...meta,
            name,
            nameSource,
            blob,
            previewUrl: URL.createObjectURL(blob),
            status: meta.detection?.ok ? 'done' : 'error',
          };
        });
        for (const sheet of sheets) URL.revokeObjectURL(sheet.previewUrl);
        setSheets(roster ? applyRosterAndSuggestions(restored, roster) : restored);
        setSourcePdfs([]);
        setSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
        setOverrides(saved.edits ?? {});
        setKeyOverrides(saved.keyOverrides ?? {});
        setShowManager(false);
        setReviewId(null);
        setActiveTab('scores');
        showToast('已載入備份資料；原始影像需重新上載才能覆核。', 'warning');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : '備份檔案讀取失敗。',
          'error',
        );
      }
    },
    [sheets, showToast, roster],
  );

  const reviewIndex = sheets.findIndex((s) => s.id === reviewId);
  const reviewSheet = reviewIndex >= 0 ? sheets[reviewIndex] : null;
  const completeReview = useCallback(
    (id: string) => {
      const target = sheets.find((sheet) => sheet.id === id);
      setReviewId(null);
      if (!target || target.isKey) return;
      setSheets((prev) =>
        prev.map((sheet) =>
          sheet.id === id ? { ...sheet, reviewed: true } : sheet,
        ),
      );
      showToast('已完成覆核。', 'success');
    },
    [sheets, showToast],
  );
  // Undo 完成覆核; keep the modal open so the teacher can continue looking.
  const undoCompleteReview = useCallback(
    (id: string) => {
      setSheets((prev) =>
        prev.map((sheet) =>
          sheet.id === id ? { ...sheet, reviewed: false } : sheet,
        ),
      );
      showToast('已取消覆核完成；如仍有未填／多選／存疑，會重新列入需覆核。', 'success');
    },
    [showToast],
  );
  const canShowResults =
    settings.questionCount > 0 &&
    sheets.some((s) => s.status === 'done' || s.detection?.ok);

  // The survey workspace owns its own data; it reports the form count back so
  // the task switcher shows the right number.
  const updateSurveyMeta = useCallback(
    (patch: Partial<TaskMeta>) => {
      if (!activeTaskId) return;
      setTasks((prev) =>
        prev.map((task) =>
          task.id === activeTaskId ? { ...task, ...patch, updatedAt: Date.now() } : task,
        ),
      );
    },
    [activeTaskId],
  );

  return (
    <div className="app-shell">
      <Header
        tasks={tasks}
        activeTaskId={activeTaskId}
        onSwitchTask={(id) => void switchTask(id)}
        onNewTask={requestNewTask}
        onDeleteTask={() => void deleteCurrentTask()}
        taskDisabled={
          !hydrated || processing || taskBusy || importProgress.active || Boolean(taskLoadError)
        }
      />

      <main>
        {isSurveyTask && activeTask ? (
          <SurveyWorkspace
            task={activeTask}
            roster={roster}
            onToast={showToast}
            onTaskUpdate={updateSurveyMeta}
            onBusy={setTaskBusy}
          />
        ) : (
        <>
        {sheets.length === 0 && (
          <div className="intro-strip">
            <p className="intro-title">QTSMC 答題紙批改工具</p>
            <p className="intro-line">
              毋須安裝或登入；所有掃描頁分析及計分均於瀏覽器內完成，試卷影像及成績僅存於使用者裝置，不會上傳至任何伺服器。
            </p>
          </div>
        )}

        {(showManager || sheets.length === 0) && (
          <Uploader
            sheets={sheets}
            processing={processing || taskBusy}
            progress={progress}
            importProgress={importProgress}
            onFiles={handleFiles}
            onRemove={removeSheet}
            onMove={moveSheet}
            onSetKey={setKeySheet}
            onProcess={processAll}
            onClear={clearCurrentSheets}
            onImportBackup={importBackup}
          />
        )}

        {sheets.length > 0 && !showManager && (
          <div className="workspace-bar">
            <div className="workspace-summary">
              <span className="workspace-count">{sheets.length} 張答題紙</span>
              <span className="workspace-key">
                答案卷：{keySheet?.name || keySheet?.fileName || '未設定'}
              </span>
              {processing && (
                <span className="workspace-processing">
                  <span className="spinner small" /> 正在批改 {progress.done + 1}/{progress.total}
                </span>
              )}
            </div>
            <div className="workspace-actions">
              <button className="btn ghost small" onClick={() => setShowManager(true)}>
                管理 / 新增
              </button>
              <button
                className="btn ghost small"
                onClick={processAll}
                disabled={processing}
              >
                重新批改全部
              </button>
            </div>
          </div>
        )}

        {processing && (
          <div className="processing-banner" role="status" aria-live="polite">
            <div className="processing-copy">
              <span className="spinner" />
              <div>
                <strong>正在辨識答題格與計分</strong>
                <small>
                  {progress.current || '準備中'} · {progress.done}/{progress.total}
                </small>
              </div>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 4}%`,
                }}
              />
            </div>
          </div>
        )}

        {!processing && canShowResults && (
          <Results
            analysis={analysis}
            settings={settings}
            sheets={sheets}
            sourcePdfs={sourcePdfs}
            keySheet={keySheet}
            overrides={overrides}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onReview={setReviewId}
            onEditSheet={editSheet}
            onOpenKeyEditor={() => setKeyEditorOpen(true)}
            onOpenManager={() => setShowManager(true)}
            onSettingsChange={updateSettings}
            onQuestionCountChange={setQuestionCount}
            onAutoCountChange={setAutoQuestionCount}
            onBackup={backup}
            onImportBackup={importBackup}
            onToast={showToast}
            autoCount={autoCount}
            rosterStatus={rosterStatus}
            onRefreshRoster={() => void loadRosterNow(true)}
          />
        )}

        {!processing && sheets.length > 0 && !canShowResults && (
          <div className="empty-results">
            <div className="empty-icon">?</div>
            <h2>未能讀取答案卷</h2>
            <p>
              請確認答案卷（第一張）有清楚填畫的答案，或到「管理 / 新增」改用另一張作答案卷。
            </p>
            <button className="btn secondary" onClick={() => setShowManager(true)}>
              檢查答題紙
            </button>
          </div>
        )}
        </>
        )}
      </main>

      <Footer
        onDeleteTask={() => void deleteCurrentTask()}
        kind={activeTask?.kind}
      />

      {taskLoadError && (
        <div
          className="modal-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-label="任務載入失敗"
        >
          <div className="setup-modal">
            <div className="review-error-body">
              <h2>未能載入目前任務</h2>
              <p>{taskLoadError} 為免覆蓋原有資料，系統已停止自動儲存。</p>
              <button className="btn primary" onClick={() => window.location.reload()}>
                重新載入
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewSheet && (
        <ReviewModal
          sheet={reviewSheet}
          index={reviewIndex}
          total={sheets.length}
          analysis={analysis}
          settings={settings}
          keyAnswers={keyAnswers}
          overrides={overrides[reviewSheet.id]}
          onAnswer={(q, value) => setAnswer(reviewSheet.id, q, value)}
          onResetAnswers={() => resetSheetAnswers(reviewSheet.id)}
          onMeta={(patch) => editSheet(reviewSheet.id, patch)}
          onClose={() => setReviewId(null)}
          onComplete={() => completeReview(reviewSheet.id)}
          onUndoComplete={() => undoCompleteReview(reviewSheet.id)}
          onPrev={() =>
            setReviewId(sheets[(reviewIndex - 1 + sheets.length) % sheets.length].id)
          }
          onNext={() =>
            setReviewId(sheets[(reviewIndex + 1) % sheets.length].id)
          }
          onOpenKeyEditor={() => setKeyEditorOpen(true)}
        />
      )}

      {keyEditorOpen && keySheet && (
        <KeyEditor
          keySheet={keySheet}
          keyAnswers={keyAnswers}
          keyOverrides={keyOverrides}
          questionCount={Math.max(settings.questionCount, 1)}
          onQuestionCountChange={setQuestionCount}
          onSetKey={setKeyAnswer}
          onClear={() => {
            setKeyOverrides({});
            showToast('已清除答案卷的手動修正。', 'success');
          }}
          onClose={() => setKeyEditorOpen(false)}
        />
      )}

      {setupMode && (
        <TaskSetupModal
          mode={setupMode}
          initialFormLevel={settings.formLevel}
          initialSubject={setupMode === 'new' ? '' : settings.subject}
          onCancel={cancelSetup}
          onConfirm={confirmSetup}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          kind={toast.kind}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
