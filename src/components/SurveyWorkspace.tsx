import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  ScanLine,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { TaskMeta } from '../types';
import { surveyRoundLabel } from '../lib/academic';
import type { RosterData } from '../lib/roster';
import {
  analyseSurveyGrayPage,
  assembleSurveyForms,
  buildSurveyTemplateFromPages,
  formNeedsReview,
  type SurveyForm,
  type SurveyLogicalPage,
  type SurveyTemplate,
  type SurveyTemplateGrid,
} from '../lib/survey';
import {
  forEachSurveyPage,
  isSurveyScanImage,
  isSurveyScanPdf,
  readSurveyTextPages,
} from '../lib/surveyPdf';
import { exportSurveyZip } from '../lib/surveyExport';
import type { ToastKind } from './Toast';
import SurveyReviewModal from './SurveyReviewModal';

interface SurveySavedState {
  version: 1;
  savedAt: number;
  template?: SurveyTemplate;
  blankName?: string;
  blankPdf?: Blob;
  scans: { name: string; blob: Blob }[];
  pages: SurveyLogicalPage[];
  forms: SurveyForm[];
}

interface SurveyWorkspaceProps {
  task: TaskMeta;
  roster: RosterData | null;
  onToast: (message: string, kind?: ToastKind) => void;
  onTaskUpdate: (patch: Partial<TaskMeta>) => void;
  onBusy: (busy: boolean) => void;
}

const sessionKey = (id: string) => `qtsmc-survey-v1-${id}`;

function shortGridLabel(
  template: SurveyTemplate,
  grid: SurveyTemplateGrid,
): string {
  const page = template.pages.find((item) => item.page === grid.page);
  const content = page?.grids.filter((item) => !item.isCandidate) ?? [];
  const index = content.findIndex((item) => item.id === grid.id);
  const parts = [`第 ${grid.page} 頁`];
  if (content.length > 1) parts.push(`第 ${index + 1} 組`);
  if (grid.mode === 'single') parts.push('應用學習');
  return parts.join(' · ');
}

function initials(name: string): string {
  return name.trim().slice(0, 1) || '?';
}

export default function SurveyWorkspace({
  task,
  roster,
  onToast,
  onTaskUpdate,
  onBusy,
}: SurveyWorkspaceProps) {
  const [template, setTemplate] = useState<SurveyTemplate | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [blankName, setBlankName] = useState('');
  const [blankPdf, setBlankPdf] = useState<Blob | null>(null);
  const [scans, setScans] = useState<{ name: string; blob: Blob }[]>([]);
  const [pages, setPages] = useState<SurveyLogicalPage[]>([]);
  const [forms, setForms] = useState<SurveyForm[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [detail, setDetail] = useState<{
    fileName: string;
    page: number;
    pages: number;
    half: string;
    phase: string;
  } | null>(null);
  const [filter, setFilter] = useState<'all' | 'review' | 'reviewed'>('all');
  const [view, setView] = useState<'results' | 'stats'>('results');
  const [reviewForm, setReviewForm] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [exporting, setExporting] = useState(false);
  const templateInput = useRef<HTMLInputElement>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const latestState = useRef<SurveySavedState | null>(null);

  // Load this task's survey state.
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    get<SurveySavedState>(sessionKey(task.id))
      .then((saved) => {
        if (cancelled || !saved) return;
        setTemplate(saved.template ?? null);
        setTemplateError('');
        setTemplateBusy(false);
        setBlankName(saved.blankName ?? '');
        setBlankPdf(saved.blankPdf ?? null);
        setScans(saved.scans ?? []);
        setPages(saved.pages ?? []);
        setForms(saved.forms ?? []);
        setFilter('all');
        setReviewForm(null);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  // Autosave the survey session (results + original PDFs).
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const state: SurveySavedState = {
        version: 1,
        savedAt: Date.now(),
        template: template ?? undefined,
        blankName,
        blankPdf: blankPdf ?? undefined,
        scans,
        pages,
        forms,
      };
      void set(sessionKey(task.id), state).catch(() => undefined);
    }, 700);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [hydrated, task.id, template, blankName, blankPdf, scans, pages, forms]);

  latestState.current = {
    version: 1,
    savedAt: Date.now(),
    template: template ?? undefined,
    blankName,
    blankPdf: blankPdf ?? undefined,
    scans,
    pages,
    forms,
  };

  // The debounced autosave can be cancelled when the teacher switches task
  // immediately after processing; flush the latest state on unmount too.
  useEffect(() => {
    return () => {
      // React StrictMode mounts, unmounts and remounts in development. Saving
      // the initial empty state on that first unmount would erase the task we
      // are about to load, so only flush a session that has a template.
      if (latestState.current?.template) {
        void set(sessionKey(task.id), latestState.current).catch(() => undefined);
      }
    };
  }, [task.id]);

  // The roster is fetched on page load; if it arrives after the scan was
  // processed, fill in names without asking the teacher to re-run.
  useEffect(() => {
    if (!roster) return;
    setForms((prev) =>
      prev.map((form) => {
        if (form.name) return form;
        const entry = roster.byExam.get(Number(form.candidateNo));
        if (!entry) return form;
        return {
          ...form,
          name: entry.name,
          className: entry.class,
          seatNo: String(entry.num).padStart(2, '0'),
          flags: form.flags.filter((flag) => flag !== '名單冇此考生'),
        };
      }),
    );
    // Only when the roster arrives or the form count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, forms.length]);

  const loadTemplate = useCallback(
    async (file: File) => {
      setTemplateError('');
      if (!isSurveyScanPdf(file)) {
        const message = '空白表格必須是學校原本的 PDF（有文字層）；掃描版或圖片沒有科目名稱。';
        setTemplateError(message);
        onToast(message, 'warning');
        return;
      }
      setTemplateBusy(true);
      onBusy(true);
      try {
        const textPages = await readSurveyTextPages(file);
        const built = buildSurveyTemplateFromPages(file.name, textPages);
        if (!built.pages.some((page) => page.grids.some((grid) => !grid.isCandidate))) {
          const message =
            '這個 PDF 找不到選科表格。請上載學校原本的空白表格 PDF，不要上載已填寫的掃描。';
          setTemplateError(message);
          onToast(message, 'error');
          return;
        }
        setTemplate(built);
        setTemplateError('');
        setBlankName(file.name);
        setBlankPdf(file);
        setPages([]);
        setForms([]);
        onToast(
          `已讀取表格：${built.pages.length} 頁、${built.pages
            .flatMap((page) => page.grids.filter((grid) => !grid.isCandidate))
            .length} 個選科部分。`,
          'success',
        );
      } catch {
        const message =
          '未能讀取這個 PDF。請確認它是學校原本的空白表格（Word 產生的 PDF），不是掃描影像。';
        setTemplateError(message);
        onToast(message, 'error');
      } finally {
        setTemplateBusy(false);
        onBusy(false);
      }
    },
    [onBusy, onToast],
  );

  const addScans = useCallback(
    (files: File[]) => {
      const valid = files.filter(
        (file) => isSurveyScanPdf(file) || isSurveyScanImage(file),
      );
      if (!valid.length) {
        onToast('請上載掃描後的 PDF 或 JPG／PNG 圖片。', 'warning');
        return;
      }
      setScans((prev) => [
        ...prev,
        ...valid.map((file) => ({ name: file.name, blob: file as Blob })),
      ]);
      setPages([]);
      setForms([]);
      if (!template) {
        onToast('已加入掃描；請先上載空白表格 PDF（步驟 01）才可開始辨識。', 'warning');
        return;
      }
      onToast(`已加入 ${valid.length} 個掃描檔案，請按「開始辨識」。`, 'success');
    },
    [onToast, template],
  );

  const removeScan = useCallback((index: number) => {
    setScans((prev) => prev.filter((_, i) => i !== index));
    setPages([]);
    setForms([]);
  }, []);

  const process = useCallback(async () => {
    if (!template || !scans.length || processing) return;
    setProcessing(true);
    onBusy(true);
    setProgress({ done: 0, total: scans.length, label: '準備中' });
    setDetail(null);
    const collected: SurveyLogicalPage[] = [];
    try {
      for (let fileIndex = 0; fileIndex < scans.length; fileIndex++) {
        const scan = scans[fileIndex];
        setProgress({ done: fileIndex, total: scans.length, label: scan.name });
        setDetail({
          fileName: scan.name,
          page: 0,
          pages: 0,
          half: '',
          phase: '分拆／校正',
        });
        const file = new File([scan.blob], scan.name, { type: scan.blob.type || '' });
        await forEachSurveyPage(
          file,
          async (page) => {
            setDetail((previous) => ({
              fileName: scan.name,
              page: page.pageNo,
              pages: previous?.pages ?? 0,
              half: page.half === 'left' ? '左頁' : page.half === 'right' ? '右頁' : '整頁',
              phase: page.blank ? '空白頁' : '辨識中',
            }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            const id = `${fileIndex}-${page.pageNo}-${page.half}`;
            if (page.blank) {
              collected.push({
                id,
                fileIndex,
                fileName: scan.name,
                pageNo: page.pageNo,
                half: page.half,
                width: page.width,
                height: page.height,
                blank: true,
              });
              return;
            }
            const read = analyseSurveyGrayPage(page.gray, template);
            collected.push({
              id,
              fileIndex,
              fileName: scan.name,
              pageNo: page.pageNo,
              half: page.half,
              width: page.width,
              height: page.height,
              blank: false,
              read,
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
          },
          (pageNo, total) => {
            setDetail({
              fileName: scan.name,
              page: pageNo,
              pages: total,
              half: '',
              phase: pageNo ? '完成本頁' : '分拆／校正',
            });
          },
        );
      }
      const lookup = (candidateNo: string) => {
        const entry = roster?.byExam.get(Number(candidateNo));
        if (!entry) return undefined;
        return {
          name: entry.name,
          className: entry.class,
          seatNo: String(entry.num).padStart(2, '0'),
        };
      };
      setDetail(null);
      const assembled = assembleSurveyForms(collected, template, lookup);
      setPages(collected);
      setForms(assembled);
      onTaskUpdate({ sheetCount: assembled.length, questionCount: 0 });
      await set(sessionKey(task.id), {
        version: 1,
        savedAt: Date.now(),
        template,
        blankName,
        blankPdf: blankPdf ?? undefined,
        scans,
        pages: collected,
        forms: assembled,
      } satisfies SurveySavedState).catch(() => undefined);
      const review = assembled.filter((form) => formNeedsReview(form)).length;
      onToast(
        assembled.length
          ? `已辨識 ${assembled.length} 份選科表${review ? `，${review} 份需覆核` : ''}。`
          : '未能組成任何選科表，請檢查掃描頁及空白表格是否同一版本。',
        assembled.length ? (review ? 'warning' : 'success') : 'error',
      );
      setFilter('all');
    } catch {
      onToast('辨識時發生錯誤，請重新整理後再試。', 'error');
    } finally {
      setProcessing(false);
      onBusy(false);
    }
  }, [onBusy, onTaskUpdate, onToast, processing, roster, scans, template]);

  const updateForm = useCallback(
    (id: string, patch: Partial<SurveyForm>) => {
      setForms((prev) => prev.map((form) => (form.id === id ? { ...form, ...patch } : form)));
    },
    [],
  );

  const setValue = useCallback(
    (formId: string, gridId: string, row: number, value: number | null) => {
      setForms((prev) =>
        prev.map((form) => {
          if (form.id !== formId) return form;
          const values = { ...(form.values[gridId] ?? []) };
          values[row] = value;
          const ambiguous = form.ambiguous.filter((key) => key !== `${gridId}:${row}`);
          return {
            ...form,
            values: { ...form.values, [gridId]: values },
            ambiguous,
            reviewed: false,
          };
        }),
      );
    },
    [],
  );

  const counts = useMemo(() => {
    const review = forms.filter((form) => formNeedsReview(form)).length;
    const reviewed = forms.filter((form) => form.reviewed).length;
    const named = forms.filter((form) => form.name).length;
    return { all: forms.length, review, reviewed, named };
  }, [forms]);

  const visible = useMemo(
    () =>
      forms.filter((form) => {
        if (filter === 'review') return formNeedsReview(form);
        if (filter === 'reviewed') return form.reviewed;
        return true;
      }),
    [filter, forms],
  );

  const contentGrids = useMemo(() => {
    if (!template) return [];
    return template.pages.flatMap((page) =>
      page.grids
        .filter((grid) => !grid.isCandidate)
        .map((grid) => ({ page: page.page, grid })),
    );
  }, [template]);

  const tableWidth = useMemo(
    () =>
      158 +
      72 +
      92 +
      contentGrids.reduce(
        (sum, { grid }) =>
          sum + grid.rows.length * (grid.mode === 'single' ? 92 : 44),
        0,
      ),
    [contentGrids],
  );

  const statsRows = useMemo(
    () =>
      contentGrids.flatMap(({ grid }) =>
        grid.rows.map((label, index) => {
          const values = forms
            .map((form) => form.values[grid.id]?.[index] ?? null)
            .filter((value): value is number => value !== null);
          const code = grid.codes?.[index];
          return {
            key: `${grid.id}-${index}`,
            group: shortGridLabel(template!, grid),
            label: `${code ? `${code} ` : ''}${label}`,
            single: grid.mode === 'single',
            count:
              grid.mode === 'single'
                ? values.filter((value) => value === 1).length
                : values.length,
            first: values.filter((value) => value === 1).length,
            second: values.filter((value) => value === 2).length,
            third: values.filter((value) => value === 3).length,
            average: values.length
              ? Math.round(
                  (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
                ) / 100
              : null,
          };
        }),
      ),
    [contentGrids, forms, template],
  );

  const selectedForm = forms.find((form) => form.id === reviewForm) ?? null;
  const overallPercent = processing
    ? Math.min(
        99,
        Math.round(
          ((progress.done +
            (detail?.pages ? detail.page / detail.pages : 0)) /
            Math.max(1, progress.total)) *
            100,
        ),
      )
    : 0;
  const done = forms.length > 0;
  const scanPageCount = pages.filter((page) => !page.blank).length;

  const doExport = useCallback(async () => {
    if (!template || !forms.length || exporting) return;
    setExporting(true);
    try {
      await exportSurveyZip({
        template,
        forms,
        scans,
        blank:
          blankName && blankPdf ? { name: blankName, blob: blankPdf } : undefined,
        date: task.date,
        formLevel: task.formLevel,
        subject: `${task.subject}（${surveyRoundLabel(task.date)}）`,
      });
      onToast('已下載選科表報告。', 'success');
    } catch {
      onToast('匯出失敗，請再試一次。', 'error');
    } finally {
      setExporting(false);
    }
  }, [exporting, forms, onToast, scans, task.date, task.formLevel, task.subject, template]);

  if (!hydrated) {
    return (
      <div className="survey-loading">
        <Loader2 size={20} className="spin" /> 載入選科表任務…
      </div>
    );
  }

  return (
    <div className="survey-workspace">
      {!done && (
        <div className="intro-strip survey-intro-strip">
          <p className="intro-title">QTSMC 中三選科表工具</p>
          <p className="intro-line">
            先上載學校原本的空白表格 PDF，再上載已填寫的掃描；所有影像及結果只留在你的裝置，不會上傳至任何伺服器。
          </p>
        </div>
      )}

      <section className="panel survey-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">STEP 01 · 表格</span>
            <h2>空白選科表</h2>
            <p className="panel-sub">
              上載學校原本的空白 PDF；科目名稱直接由文字層讀取，不必逐頁輸入。
            </p>
          </div>
          <div className="panel-head-meta">
            <span className={`count-pill ${template ? 'ready' : ''}`}>
              {template ? `${template.pages.length} 頁` : '未上載'}
            </span>
            {template ? (
              <button
                className="btn ghost small"
                onClick={() => templateInput.current?.click()}
                disabled={templateBusy}
              >
                更換表格
              </button>
            ) : null}
            <input
              ref={templateInput}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadTemplate(file);
                event.target.value = '';
              }}
            />
          </div>
        </div>

        {templateBusy && (
          <div className="survey-template-busy">
            <Loader2 size={16} className="spin" /> 正在讀取表格的科目名稱…
          </div>
        )}
        {templateError && (
          <p className="survey-template-error" role="alert">
            <AlertTriangle size={15} /> {templateError}
          </p>
        )}

        {template ? (
          <div className="survey-template-summary">
            <div className="survey-template-name">
              <FileText size={18} />
              <div>
                <strong>{blankName || template.name}</strong>
                <span>
                  {template.pages.length} 頁 ·{' '}
                  {template.pages
                    .flatMap((page) => page.grids.filter((grid) => !grid.isCandidate))
                    .length}{' '}
                  個選科部分
                </span>
              </div>
            </div>
            <div className="survey-template-pages">
              {template.pages.map((page) => {
                const grids = page.grids.filter((grid) => !grid.isCandidate);
                return (
                  <div key={page.page} className="survey-template-page">
                    <span>第 {page.page} 頁</span>
                    {grids.length ? (
                      grids.map((grid) => (
                        <em key={grid.id}>
                          {grid.mode === 'single'
                            ? `${grid.rows.length} 個課程`
                            : `${grid.rows.length} 科 · 排 1–${grid.columns}`}
                        </em>
                      ))
                    ) : (
                      <em>考生號碼</em>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <button
            className="survey-upload"
            onClick={() => templateInput.current?.click()}
            disabled={templateBusy}
          >
            <UploadCloud size={22} />
            <strong>{templateBusy ? '正在讀取表格…' : '上載空白表格 PDF'}</strong>
            <span>學校產生的原稿（有文字層），例如「2526 Subject_Preference_Survey1」</span>
          </button>
        )}
      </section>

      <section className="panel survey-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">STEP 02 · 掃描</span>
            <h2>已填寫的選科表</h2>
            <p className="panel-sub">
              可一次過上載整班。系統會自動分份，不需要先回答每份表有幾頁。
            </p>
          </div>
          <div className="panel-head-meta">
            <span className="count-pill">{scans.length} 個檔案</span>
            {scans.length > 0 && (
              <button
                className="text-btn danger"
                onClick={() => {
                  setScans([]);
                  setPages([]);
                  setForms([]);
                }}
                disabled={processing}
              >
                清除掃描
              </button>
            )}
          </div>
        </div>

        <div
          className={`dropzone survey-dropzone ${scans.length ? 'compact' : ''}`}
          onClick={() => !processing && scanInput.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!processing) addScans(Array.from(event.dataTransfer.files));
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') scanInput.current?.click();
          }}
        >
          <input
            ref={scanInput}
            type="file"
            accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/bmp,.jpg,.jpeg,.png,.webp,.bmp"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) addScans(files);
              event.target.value = '';
            }}
          />
          <div className="dropzone-icon">
            {processing ? <Loader2 size={26} className="spin" /> : <ScanLine size={26} />}
          </div>
          <div className="dropzone-copy">
            <strong>{processing ? '正在辨識…' : '拖放或點擊上載掃描 PDF／圖片'}</strong>
            <span>A3 會自動分左右兩頁；PDF、JPG、PNG 均可，整班可直接上載。</span>
          </div>
          <span className="btn secondary small dropzone-btn">
            <UploadCloud size={15} /> 選擇檔案
          </span>
        </div>

        {scans.length > 0 && (
          <ul className="survey-file-list">
            {scans.map((scan, index) => (
              <li key={`${scan.name}-${index}`}>
                <FileText size={14} />
                <span>{scan.name}</span>
                <button
                  type="button"
                  className="icon-btn danger"
                  onClick={() => removeScan(index)}
                  disabled={processing}
                  aria-label={`移除 ${scan.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

      {processing && (
        <div
          className="processing-banner survey-processing-banner"
          role="status"
          aria-live="polite"
        >
          <div className="processing-copy">
            <span className="spinner" />
            <div>
              <strong>正在分拆及辨識選科表</strong>
              <small>
                {detail
                  ? `${detail.fileName} · ${detail.phase}${
                      detail.page
                        ? ` · 第 ${detail.page}/${detail.pages || '?'} 頁`
                        : ''
                    }${detail.half ? `（${detail.half}）` : ''}`
                  : '準備中'}
              </small>
            </div>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.max(4, overallPercent)}%` }}
            />
          </div>
        </div>
      )}

        <div className="survey-requirements" aria-live="polite">
          <span className={template ? 'ok' : 'missing'}>
            {template ? <Check size={13} /> : <AlertTriangle size={13} />}
            空白表格：{template ? '已讀取' : '未上載'}
            {!template && (
              <button
                type="button"
                className="text-btn"
                onClick={() => templateInput.current?.click()}
                disabled={templateBusy}
              >
                上載
              </button>
            )}
          </span>
          <span className={scans.length ? 'ok' : 'missing'}>
            {scans.length ? <Check size={13} /> : <AlertTriangle size={13} />}
            掃描：{scans.length ? `${scans.length} 個檔案` : '未加入'}
            {!scans.length && (
              <button type="button" className="text-btn" onClick={() => scanInput.current?.click()}>
                加入
              </button>
            )}
          </span>
        </div>

        <div className="survey-process-row">
          {processing ? (
            <span className="survey-progress">
              <Loader2 size={16} className="spin" />
              {progress.label} · {progress.done}/{progress.total}
            </span>
          ) : (
            <span className="survey-hint">
              {template
                ? scans.length
                  ? roster
                    ? '辨識後會自動配對全校名單的姓名。'
                    : '全校名單未載入；姓名會留空，考生號碼仍會讀取。'
                  : '請先加入掃描（PDF 或 JPG／PNG）。'
                : '請先上載學校原本的空白表格 PDF。'}
            </span>
          )}
          <button
            className="btn primary large"
            onClick={() => void process()}
            disabled={!template || !scans.length || processing}
            title={
              !template
                ? '請先上載空白表格 PDF'
                : !scans.length
                  ? '請先加入掃描'
                  : ''
            }
          >
            {processing ? <Loader2 size={17} className="spin" /> : <ScanLine size={17} />}
            {processing ? '辨識中' : done ? '重新辨識' : '開始辨識'}
          </button>
        </div>
      </section>

      {done && (
        <section className="panel survey-panel survey-results" id="survey-results">
          <div className="panel-head">
            <div>
              <span className="section-kicker">STEP 03 · 結果</span>
              <h2>選科排序</h2>
              <p className="panel-sub">
                {surveyRoundLabel(task.date)} · {scanPageCount} 頁掃描 · {forms.length} 份表 ·
                姓名由考生號碼配對全校名單。
              </p>
            </div>
            <div className="panel-head-meta">
              <button
                className="btn primary export-btn"
                onClick={() => void doExport()}
                disabled={exporting}
              >
                {exporting ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                所有報告及 PDF (.zip)
              </button>
            </div>
          </div>

          <div className="survey-stats">
            <article className="stat-card stat-main">
              <span className="stat-label">
                <ClipboardList size={15} /> 選科表
              </span>
              <strong className="stat-value">{counts.all}</strong>
              <span className="stat-note">份</span>
            </article>
            <article className="stat-card">
              <span className="stat-label">已對名單</span>
              <strong className="stat-value">{counts.named}</strong>
              <span className="stat-note">{counts.all - counts.named} 份未有姓名</span>
            </article>
            <article className="stat-card">
              <span className="stat-label">需覆核</span>
              <strong className="stat-value">{counts.review}</strong>
              <span className="stat-note">雙填、淡色或缺頁</span>
            </article>
            <article className="stat-card">
              <span className="stat-label">覆核完成</span>
              <strong className="stat-value">{counts.reviewed}</strong>
              <span className="stat-note">可按學生重看</span>
            </article>
          </div>

          <div className="survey-toolbar">
            <div className="survey-view-tabs">
              <button
                className={view === 'results' ? 'active' : ''}
                onClick={() => setView('results')}
              >
                選科結果
              </button>
              <button
                className={view === 'stats' ? 'active' : ''}
                onClick={() => setView('stats')}
              >
                科目統計
              </button>
            </div>
            {view === 'results' && (
            <div className="filter-chips">
              <button
                className={`chip ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                全部 {counts.all}
              </button>
              {counts.review > 0 && (
                <button
                  className={`chip ${filter === 'review' ? 'active' : ''}`}
                  onClick={() => setFilter('review')}
                >
                  需覆核 {counts.review}
                </button>
              )}
              {counts.reviewed > 0 && (
                <button
                  className={`chip ${filter === 'reviewed' ? 'active' : ''}`}
                  onClick={() => setFilter('reviewed')}
                >
                  覆核完成 {counts.reviewed}
                </button>
              )}
            </div>
            )}
            {view === 'results' && (
              <span className="survey-hint">點擊一行可覆核該名學生。</span>
            )}
          </div>

          {view === 'stats' ? (
            <div className="survey-stats-wrap">
              <table className="survey-stats-table">
                <thead>
                  <tr>
                    <th>組別</th>
                    <th>科目／課程</th>
                    <th>有效／選擇</th>
                    <th>第 1 志願</th>
                    <th>第 2 志願</th>
                    <th>第 3 志願</th>
                    <th>平均排序</th>
                  </tr>
                </thead>
                <tbody>
                  {statsRows.map((row) => (
                    <tr key={row.key} className={row.single ? 'single' : ''}>
                      <td>{row.group}</td>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      {row.single ? (
                        <>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                        </>
                      ) : (
                        <>
                          <td>{row.first}</td>
                          <td>{row.second}</td>
                          <td>{row.third}</td>
                          <td>{row.average ?? '—'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
          <div className="survey-table-wrap">
            <table className="survey-table" style={{ width: tableWidth }}>
              <colgroup>
                <col style={{ width: 158 }} />
                <col style={{ width: 72 }} />
                {contentGrids.flatMap(({ grid }) =>
                  grid.rows.map((_, index) => (
                    <col
                      key={`${grid.id}-col-${index}`}
                      style={{ width: grid.mode === 'single' ? 92 : 44 }}
                    />
                  )),
                )}
                <col style={{ width: 92 }} />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2} className="sticky survey-name-col">
                    學生
                  </th>
                  <th rowSpan={2} className="survey-id-col">
                    考生號碼
                  </th>
                  {contentGrids.map(({ page, grid }) => (
                    <th key={grid.id} colSpan={grid.rows.length} className="survey-group-head">
                      <span>{shortGridLabel(template!, grid)}</span>
                      <small>{grid.title}</small>
                    </th>
                  ))}
                  <th rowSpan={2} className="survey-status-col">
                    狀態
                  </th>
                </tr>
                <tr>
                  {contentGrids.flatMap(({ grid }) =>
                    grid.rows.map((label, index) => (
                      <th
                        key={`${grid.id}-${index}`}
                        className="survey-subject-head"
                        title={
                          grid.mode === 'single' && grid.codes?.[index]
                            ? `${grid.codes[index]} ${label}`
                            : label
                        }
                      >
                        {grid.mode === 'single' && grid.codes?.[index] ? (
                          <>
                            <span className="survey-apl-code">{grid.codes[index]}</span>
                            <small>{label}</small>
                          </>
                        ) : (
                          label
                        )}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((form) => (
                  <tr
                    key={form.id}
                    className={formNeedsReview(form) ? 'survey-review-row' : ''}
                    onClick={() => setReviewForm(form.id)}
                  >
                    <td className="sticky survey-name-col">
                      <span className="survey-student">
                        <i>{initials(form.name)}</i>
                        <span>
                          <strong>{form.name || '姓名不詳'}</strong>
                          <small>
                            {[form.className, form.seatNo].filter(Boolean).join(' / ') || '未有班別'}
                          </small>
                        </span>
                      </span>
                    </td>
                    <td className="survey-id-col">
                      <code>{form.candidateNo || '—'}</code>
                    </td>
                    {contentGrids.flatMap(({ grid }) =>
                      grid.rows.map((_, index) => {
                        const value = form.values[grid.id]?.[index] ?? null;
                        const flag = form.ambiguous.includes(`${grid.id}:${index}`);
                        return (
                          <td
                            key={`${form.id}-${grid.id}-${index}`}
                            className={`survey-value ${flag ? 'flag' : ''} ${
                              value === null ? 'empty' : ''
                            }`}
                          >
                            {grid.mode === 'single'
                              ? value
                                ? '●'
                                : ''
                              : value ?? '—'}
                          </td>
                        );
                      }),
                    )}
                    <td className="survey-status-col">
                      {form.reviewed ? (
                        <span className="survey-badge done">
                          <Check size={12} /> 覆核完成
                        </span>
                      ) : formNeedsReview(form) ? (
                        <span className="survey-badge review">
                          <AlertTriangle size={12} /> 需覆核
                        </span>
                      ) : (
                        <span className="survey-badge ok">已讀取</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visible.length === 0 && (
            <p className="survey-empty">這個篩選沒有選科表。</p>
          )}

          <div className="survey-cards">
            {visible.map((form) => (
              <article
                key={form.id}
                className={`survey-card ${formNeedsReview(form) ? 'review' : ''}`}
                onClick={() => setReviewForm(form.id)}
              >
                <header>
                  <span className="survey-avatar">{initials(form.name)}</span>
                  <div>
                    <strong>{form.name || '姓名不詳'}</strong>
                    <small>
                      {form.candidateNo || '—'} ·{' '}
                      {[form.className, form.seatNo].filter(Boolean).join(' / ') || '未有班別'}
                    </small>
                  </div>
                  {form.reviewed ? (
                    <span className="survey-badge done">覆核完成</span>
                  ) : formNeedsReview(form) ? (
                    <span className="survey-badge review">需覆核</span>
                  ) : (
                    <span className="survey-badge ok">已讀取</span>
                  )}
                </header>
                <div className="survey-card-summary">
                  {(() => {
                    const first = contentGrids.find(({ grid }) => grid.mode === 'rank');
                    if (!first) return <span>未有排序</span>;
                    const chosen = first.grid.rows
                      .map((label, index) => ({
                        label,
                        rank: form.values[first.grid.id]?.[index] ?? null,
                      }))
                      .filter(
                        (item): item is { label: string; rank: number } =>
                          item.rank !== null && item.rank <= 3,
                      )
                      .sort((a, b) => a.rank - b.rank)
                      .slice(0, 3);
                    return chosen.length ? (
                      <>
                        {chosen.map((item) => (
                          <em key={`${item.rank}-${item.label}`}>
                            第{item.rank}志願 {item.label}
                          </em>
                        ))}
                      </>
                    ) : (
                      <span>未有排序</span>
                    );
                  })()}
                </div>
                {(() => {
                  const apl = contentGrids.filter(({ grid }) => grid.mode === 'single');
                  const selected = apl.flatMap(({ grid }) =>
                    grid.rows
                      .map((label, index) => ({
                        code: grid.codes?.[index],
                        label,
                        value: form.values[grid.id]?.[index] ?? null,
                      }))
                      .filter((item) => item.value),
                  );
                  if (!selected.length) return null;
                  return (
                    <p className="survey-card-apl">
                      <span>應用學習</span>
                      {selected.map((item) => (
                        <em key={`${item.code}-${item.label}`}>
                          {item.code ? `${item.code} ` : ''}
                          {item.label}
                        </em>
                      ))}
                    </p>
                  );
                })()}
                <small className="survey-card-more">
                  共 {contentGrids.length} 組 · 點擊查看全部
                </small>
              </article>
            ))}
          </div>
            </>
          )}
        </section>
      )}

      {selectedForm && template && (
        <SurveyReviewModal
          form={selectedForm}
          template={template}
          pages={pages}
          scans={scans}
          roster={roster}
          onClose={() => setReviewForm(null)}
          onChange={(patch) => updateForm(selectedForm.id, patch)}
          onValue={(gridId, row, value) =>
            setValue(selectedForm.id, gridId, row, value)
          }
          onToast={onToast}
        />
      )}
    </div>
  );
}
