import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header';
import Uploader from './components/Uploader';
import Results from './components/Results';
import ReviewModal from './components/ReviewModal';
import KeyEditor from './components/KeyEditor';
import NamingModal from './components/NamingModal';
import Toast, { type ToastKind } from './components/Toast';
import Footer from './components/Footer';
import { analyseResults, getKeyAnswers, getSheetAnswers, suggestQuestionCountFromClass, MAX_QUESTIONS } from './lib/scoring';
import { pdfToImages } from './lib/pdf';
import { clearSession, loadSession, saveSession } from './lib/storage';
import { downloadBackup, parseBackupFile } from './lib/export';
import { loadRoster, type RosterData } from './lib/roster';
import { applyRosterAndSuggestions } from './lib/assign';
import type {
  Analysis,
  NamingEntry,
  AnswerOverrides,
  AnswerValue,
  Detection,
  RuntimeSheet,
  SavedSession,
  Settings,
  SheetOverrides,
} from './types';

const today = new Date().toISOString().slice(0, 10);
const DEFAULT_SETTINGS: Settings = {
  title: '',
  subject: '',
  className: '',
  date: today,
  passMark: 50,
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

function runWorkerJob(worker: Worker, blob: Blob): Promise<Detection> {
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
    worker.postMessage({ id, blob });
  });
}

function makeSheet(blob: Blob, fileName: string, index: number): RuntimeSheet {
  return {
    id: uid(),
    fileName,
    name: baseName(fileName),
    className: '',
    seatNo: '',
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

function headerPatch(
  sheet: RuntimeSheet,
  detection: Detection,
): Partial<Pick<RuntimeSheet, 'className' | 'seatNo'>> {
  const header = detection.header;
  if (!header) return {};
  const previous = sheet.detection?.header;
  const classNameEdited = Boolean(
    previous?.className && sheet.className && sheet.className !== previous.className,
  );
  const seatEdited = Boolean(
    previous?.seatNo && sheet.seatNo && sheet.seatNo !== previous.seatNo,
  );
  return {
    className:
      !classNameEdited && header.className ? header.className : sheet.className,
    // If the header exists but one field could not be read, clear the old
    // placeholder rather than showing a misleading default seat number.
    seatNo: seatEdited
      ? sheet.seatNo
      : header.seatNo ?? (header.className ? '' : sheet.seatNo),
  };
}

export default function App() {
  const [sheets, setSheets] = useState<RuntimeSheet[]>([]);
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
  const [hydrated, setHydrated] = useState(false);
  const [showManager, setShowManager] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [keyEditorOpen, setKeyEditorOpen] = useState(false);
  const [namingOpen, setNamingOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('scores');
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [rosterStatus, setRosterStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rosterFromCache, setRosterFromCache] = useState(false);
  const rosterRequest = useRef(0);

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
        setRosterFromCache(data.fromCache);
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

  // Restore the previous browser-local session (images included, IndexedDB).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadSession();
        if (!cancelled && saved) {
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
            restored.push({
              ...meta,
              status,
              nameSource,
              suggested: meta.suggested ?? {},
              blob,
              previewUrl: URL.createObjectURL(blob),
            });
          }
          if (restored.length) {
            setSheets(restored);
            setSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
            setOverrides(saved.edits ?? {});
            setKeyOverrides(saved.keyOverrides ?? {});
            setShowManager(false);
            setSaveState('saved');
            showToast('已恢復上次的工作進度。', 'success');
          }
        }
      } catch {
        // A corrupted session should not prevent the app from opening.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
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

  // Keep the automatic question count in sync with the answer sheet.
  useEffect(() => {
    if (!settings.autoQuestionCount) return;
    if (autoCount > 0 && autoCount !== settings.questionCount) {
      setSettings((prev) => ({ ...prev, questionCount: autoCount }));
    }
  }, [autoCount, settings.autoQuestionCount, settings.questionCount]);

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

  // Autosave metadata, detections, edits and image blobs into IndexedDB.
  useEffect(() => {
    if (!hydrated || processing || sheets.length === 0) return;
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      const sheetMeta = sheets.map(({ blob: _blob, previewUrl: _url, ...meta }) => meta);
      const files: Record<string, Blob> = {};
      for (const sheet of sheets) files[sheet.id] = sheet.blob;
      const session: SavedSession = {
        version: 1,
        savedAt: Date.now(),
        sheetMeta,
        settings,
        edits: overrides,
        keyOverrides,
        files,
      };
      saveSession(session)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [hydrated, processing, sheets, settings, overrides, keyOverrides]);

  // Load images and PDFs. PDF pages become individual sheets.
  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || processing) return;
      const added: RuntimeSheet[] = [];
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
      setSheets((prev) => {
        const next = [...prev, ...added];
        if (!next.some((s) => s.isKey)) {
          next[0] = { ...next[0], isKey: true };
        }
        return next;
      });
      setShowManager(true);
    },
    [processing, sheets.length, showToast],
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
    if (processing || sheets.length === 0) return;
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
    for (let i = 0; i < updated.length; i++) {
      const sheet = updated[i];
      setProgress({ done: i, total: updated.length, current: sheet.fileName });
      updated = updated.map((s) =>
        s.id === sheet.id
          ? { ...s, status: 'processing', error: undefined }
          : s,
      );
      setSheets(updated);
      try {
        const detection = await runWorkerJob(worker, sheet.blob);
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
  }, [processing, sheets, keyOverrides, overrides, showToast, roster]);

  const editSheet = useCallback(
    (id: string, patch: Partial<Pick<RuntimeSheet, 'name' | 'className' | 'seatNo'>>) => {
      setSheets((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const next: RuntimeSheet = { ...s, ...patch };
          if (patch.name !== undefined) {
            next.nameSource = 'manual';
          }
          if (
            patch.name !== undefined ||
            patch.className !== undefined ||
            patch.seatNo !== undefined
          ) {
            next.suggested = {
              ...s.suggested,
              ...(patch.name !== undefined ? { name: false } : {}),
              ...(patch.className !== undefined ? { className: false } : {}),
              ...(patch.seatNo !== undefined ? { seatNo: false } : {}),
            };
          }
          return next;
        }),
      );
    },
    [],
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

  const applyNames = useCallback((entries: NamingEntry[]) => {
    let unmatched = 0;
    setSheets((prev) => {
      const next = prev.map((sheet) => ({ ...sheet }));
      const used = new Set<string>();
      for (const entry of entries.filter((e) => e.seatNo)) {
        const target = next.find(
          (sheet) => sheet.seatNo === entry.seatNo && !used.has(sheet.id),
        );
        if (target) {
          target.name = entry.name;
          target.nameSource = 'manual';
          target.suggested = { ...target.suggested, name: false };
          used.add(target.id);
        } else {
          unmatched++;
        }
      }
      const unnumbered = entries.filter((e) => !e.seatNo);
      let nextIndex = 0;
      for (const entry of unnumbered) {
        while (nextIndex < next.length && used.has(next[nextIndex].id)) nextIndex++;
        if (nextIndex < next.length) {
          next[nextIndex].name = entry.name;
          next[nextIndex].nameSource = 'manual';
          next[nextIndex].suggested = { ...next[nextIndex].suggested, name: false };
          used.add(next[nextIndex].id);
          nextIndex++;
        }
      }
      return next;
    });
    setNamingOpen(false);
    if (unmatched > 0) {
      showToast(`已套用名單，但有 ${unmatched} 個學號找不到對應答題紙。`, 'warning');
    } else {
      showToast('已套用姓名名單。', 'success');
    }
  }, [showToast]);

  const resetWorkspace = useCallback(async () => {
    if (processing) return;
    if (
      !window.confirm(
        '確定要清除目前所有答題紙、批改結果及本機儲存的工作階段嗎？此動作不可復原。',
      )
    ) {
      return;
    }
    for (const sheet of sheets) URL.revokeObjectURL(sheet.previewUrl);
    await clearSession().catch(() => undefined);
    setSheets([]);
    setSettings(DEFAULT_SETTINGS);
    setOverrides({});
    setKeyOverrides({});
    setReviewId(null);
    setKeyEditorOpen(false);
    setShowManager(true);
    setSaveState('idle');
    setActiveTab('scores');
    showToast('已清除工作階段。', 'success');
  }, [processing, sheets, showToast]);

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
          !window.confirm('載入備份會取代目前的工作階段，確定繼續嗎？')
        ) {
          return;
        }
        const saved = await parseBackupFile(file);
        const placeholder = placeholderImage();
        const restored: RuntimeSheet[] = saved.sheetMeta.map((meta) => {
          const blob = saved.files?.[meta.id] ?? placeholder;
          return {
            ...meta,
            blob,
            previewUrl: URL.createObjectURL(blob),
            status: meta.detection?.ok ? 'done' : 'error',
          };
        });
        for (const sheet of sheets) URL.revokeObjectURL(sheet.previewUrl);
        setSheets(restored);
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
    [sheets, showToast],
  );

  const reviewIndex = sheets.findIndex((s) => s.id === reviewId);
  const reviewSheet = reviewIndex >= 0 ? sheets[reviewIndex] : null;
  const canShowResults =
    settings.questionCount > 0 &&
    sheets.some((s) => s.status === 'done' || s.detection?.ok);

  return (
    <div className="app-shell">
      <Header
        sheetCount={sheets.length}
        saveState={saveState}
        processing={processing}
        onReset={resetWorkspace}
      />

      <main>
        {sheets.length === 0 && (
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                QESOSA Tong Kwok Wah Secondary School
              </div>
              <h1>
                一疊答題紙，
                <br />
                變成品質清楚的成績表。
              </h1>
              <p className="hero-lead">
                上載掃描或 PDF，系統自動找出答案格、計算分數，並整理每題答對率與每個選項的百分比。
                第一張預設為答案卷（只作標準，不計入全班統計）。
              </p>
              <div className="hero-points">
                <span>本機辨識 · 不上傳</span>
                <span>自動判斷題數</span>
                <span>Excel / CSV 匯出</span>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="paper-stack paper-back" />
              <div className="paper-stack paper-mid" />
              <div className="paper-sheet">
                <div className="paper-head">
                  <span className="paper-school">QTSMC</span>
                  <span className="paper-pill">ANSWER SHEET</span>
                </div>
                <div className="paper-id">
                  <span />
                  <span />
                  <span />
                </div>
                {[0, 1, 2, 3, 4].map((row) => (
                  <div className="bubble-row" key={row}>
                    <b>{row + 1}</b>
                    {[0, 1, 2, 3].map((col) => (
                      <i
                        key={col}
                        className={
                          (row === 0 && col === 3) ||
                          (row === 1 && col === 0) ||
                          (row === 2 && col === 2) ||
                          (row === 3 && col === 1) ||
                          (row === 4 && col === 0)
                            ? 'filled'
                            : ''
                        }
                      />
                    ))}
                  </div>
                ))}
                <div className="paper-stamp">24 / 24</div>
              </div>
            </div>
          </section>
        )}

        {(showManager || sheets.length === 0) && (
          <Uploader
            sheets={sheets}
            processing={processing}
            progress={progress}
            importProgress={importProgress}
            onFiles={addFiles}
            onRemove={removeSheet}
            onMove={moveSheet}
            onSetKey={setKeySheet}
            onProcess={processAll}
            onClear={resetWorkspace}
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
            keySheet={keySheet}
            overrides={overrides}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onReview={setReviewId}
            onEditSheet={editSheet}
            onOpenKeyEditor={() => setKeyEditorOpen(true)}
            onOpenNaming={() => setNamingOpen(true)}
            onOpenManager={() => setShowManager(true)}
            onSettingsChange={updateSettings}
            onQuestionCountChange={setQuestionCount}
            onAutoCountChange={setAutoQuestionCount}
            onBackup={backup}
            onImportBackup={importBackup}
            onToast={showToast}
            autoCount={autoCount}
            rosterStatus={rosterStatus}
            rosterCount={roster?.entries.length ?? 0}
            rosterFromCache={rosterFromCache}
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
      </main>

      <Footer onReset={resetWorkspace} />

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

      {namingOpen && (
        <NamingModal
          students={sheets.map((s) => ({
            id: s.id,
            name: s.name,
            className: s.className,
            seatNo: s.seatNo,
          }))}
          onApply={applyNames}
          onClose={() => setNamingOpen(false)}
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
