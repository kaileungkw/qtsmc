import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Crown,
  Download,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  Info,
  Loader2,
  Settings2,
  Upload,
} from 'lucide-react';
import type {
  Analysis,
  RuntimeSheet,
  Settings,
  SheetOverrides,
} from '../types';
import { exportCsvZip, exportXlsx } from '../lib/export';
import { FORM_LEVELS, allSubjects, subjectGroups } from '../lib/subjects';
import type { ToastKind } from './Toast';

interface ExportPanelProps {
  analysis: Analysis;
  settings: Settings;
  sheets: RuntimeSheet[];
  overrides: Record<string, SheetOverrides>;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onQuestionCountChange: (count: number) => void;
  onAutoCountChange: (auto: boolean) => void;
  onBackup: () => void;
  onImportBackup: (file: File) => void;
  onOpenKeyEditor: () => void;
  onToast: (message: string, kind?: ToastKind) => void;
  autoCount: number;
}

function isStaleAssetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(message);
}

export default function ExportPanel({
  analysis,
  settings,
  sheets,
  overrides,
  onSettingsChange,
  onQuestionCountChange,
  onAutoCountChange,
  onBackup,
  onImportBackup,
  onOpenKeyEditor,
  onToast,
  autoCount,
}: ExportPanelProps) {
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const invalidKeys = analysis.questions.filter((q) => !q.keyValid).length;
  const ready =
    settings.questionCount > 0 && analysis.included.length > 0 && sheets.length > 0;

  const runExport = async (kind: 'xlsx' | 'csv') => {
    if (!ready) {
      onToast('尚未有足夠資料匯出。請確認答案卷及學生答題紙。', 'warning');
      return;
    }
    setBusy(kind);
    try {
      const ctx = { analysis, settings, sheets };
      if (kind === 'xlsx') await exportXlsx(ctx);
      else await exportCsvZip(ctx);
      onToast(
        kind === 'xlsx' ? '已下載 Excel 檔。' : '已下載 CSV 壓縮檔（5 個 CSV，含統計摘要）。',
        'success',
      );
    } catch (error) {
      if (isStaleAssetError(error)) {
        const reload = window.confirm(
          '網站已更新，下載元件需要重新載入。現有任務會保留；重新整理後再按一次下載。要現在重新整理嗎？',
        );
        if (reload) {
          try {
            sessionStorage.setItem('qtsmc-pending-export', kind);
          } catch {
            // Reload still recovers the current deployment.
          }
          window.location.reload();
        } else {
          onToast('請重新整理頁面後再下載。', 'warning');
        }
        return;
      }
      onToast(
        `匯出失敗：${error instanceof Error ? error.message : '未知錯誤'}`,
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export-panel">
      <div className="export-grid">
        <section className="export-settings">
          <div className="export-section-head">
            <Settings2 size={17} />
            <div>
              <h3>報告設定</h3>
            </div>
          </div>
          <div className="form-grid">
            <label className="field span-2">
              <span>測驗名稱</span>
              <input
                value={settings.title}
                onChange={(event) => onSettingsChange({ title: event.target.value })}
                placeholder="例如：S4 Physics Quiz 3"
              />
            </label>
            <label className="field">
              <span>年級</span>
              <select
                value={settings.formLevel}
                onChange={(event) => {
                  const formLevel = event.target.value;
                  const keepSubject = allSubjects(formLevel).includes(settings.subject);
                  onSettingsChange({
                    formLevel,
                    subject: keepSubject ? settings.subject : '',
                  });
                }}
              >
                <option value="">未選擇</option>
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
                value={settings.subject}
                onChange={(event) => onSettingsChange({ subject: event.target.value })}
              >
                <option value="">未選擇</option>
                {settings.subject &&
                  !subjectGroups(settings.formLevel)
                    .flatMap((group) => group.subjects)
                    .includes(settings.subject) && (
                    <option value={settings.subject}>{settings.subject}</option>
                  )}
                {subjectGroups(settings.formLevel).map((group) => (
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
            <label className="field">
              <span>班別</span>
              <input
                value={settings.className}
                onChange={(event) => onSettingsChange({ className: event.target.value })}
                placeholder="例如：4A"
              />
            </label>
            <label className="field">
              <span>
                <CalendarDays size={13} /> 日期
              </span>
              <input
                type="date"
                value={settings.date}
                onChange={(event) => onSettingsChange({ date: event.target.value })}
              />
            </label>
            <label className="field">
              <span>每題分數</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={settings.marksPerQuestion}
                onChange={(event) =>
                  onSettingsChange({
                    marksPerQuestion: Math.max(0.5, Number(event.target.value) || 1),
                  })
                }
              />
            </label>
            <label className="field">
              <span>及格分數（%）</span>
              <div className="inline-field">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.passMark}
                  disabled={settings.passMarkAuto}
                  onChange={(event) =>
                    onSettingsChange({
                      passMark: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                    })
                  }
                />
                <label className="checkbox compact">
                  <input
                    type="checkbox"
                    checked={settings.passMarkAuto}
                    onChange={(event) =>
                      onSettingsChange({ passMarkAuto: event.target.checked })
                    }
                  />
                  <span>自動</span>
                </label>
              </div>
              <small className="field-hint">
                {settings.passMarkAuto ? '高中 40% · 初中 50%' : '手動設定'}
              </small>
            </label>
            <label className="field">
              <span>本次題數</span>
              <div className="inline-field">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.questionCount || autoCount || 1}
                  disabled={settings.autoQuestionCount}
                  onChange={(event) => onQuestionCountChange(Number(event.target.value))}
                />
                <label className="checkbox compact">
                  <input
                    type="checkbox"
                    checked={settings.autoQuestionCount}
                    onChange={(event) => onAutoCountChange(event.target.checked)}
                  />
                  <span>自動</span>
                </label>
              </div>
              <small className="field-hint">
                答案卷自動判斷：{autoCount || '—'} 題
              </small>
            </label>
            <label className="field field-toggle">
              <span>按班別分拆匯出</span>
              <span className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings.splitByClass}
                  onChange={(event) =>
                    onSettingsChange({ splitByClass: event.target.checked })
                  }
                />
                <span className="toggle-track"><i /></span>
                <small>選修科可取消</small>
              </span>
            </label>
            <label className="field field-toggle">
              <span>答案卷計入統計</span>
              <span className="toggle-row">
                <input
                  type="checkbox"
                  checked={settings.includeKey}
                  onChange={(event) =>
                    onSettingsChange({ includeKey: event.target.checked })
                  }
                />
                <span className="toggle-track"><i /></span>
                <small>預設不計入</small>
              </span>
            </label>
          </div>

          <div className="export-summary">
            <div>
              <span>計入學生</span>
              <strong>{analysis.included.length}</strong>
            </div>
            <div>
              <span>滿分</span>
              <strong>{settings.questionCount * settings.marksPerQuestion}</strong>
            </div>
            <div>
              <span>平均</span>
              <strong>
                {analysis.included.length ? `${analysis.summary.average.toFixed(1)}%` : '—'}
              </strong>
            </div>
            <div>
              <span>答案卷</span>
              <strong>{settings.includeKey ? '計入' : '不計入'}</strong>
            </div>
          </div>

          {invalidKeys > 0 && (
            <div className="export-warning">
              <AlertTriangle size={16} />
              <div>
                <strong>答案卷有 {invalidKeys} 題未設定</strong>
                <span>匯出仍可進行，但該些題目會標示為「未設定」且不會有人答對。</span>
              </div>
              <button className="text-btn" onClick={onOpenKeyEditor}>
                補上答案
              </button>
            </div>
          )}
        </section>

        <section className="export-actions-card">
          <div className="export-section-head">
            <Download size={17} />
            <div>
              <h3>下載成績</h3>
              </div>
          </div>

          <button
            className="export-btn xlsx"
            onClick={() => runExport('xlsx')}
            disabled={!ready || busy !== null}
          >
            <span className="export-icon">
              {busy === 'xlsx' ? (
                <Loader2 size={22} className="spin" />
              ) : (
                <FileSpreadsheet size={22} />
              )}
            </span>
            <span className="export-btn-copy">
              <strong>Excel 成績報告 (.xlsx)</strong>
              <small>6 個工作表（可按班分拆）</small>
            </span>
            <Download size={18} />
          </button>

          <button
            className="export-btn csv"
            onClick={() => runExport('csv')}
            disabled={!ready || busy !== null}
          >
            <span className="export-icon">
              {busy === 'csv' ? (
                <Loader2 size={22} className="spin" />
              ) : (
                <FileArchive size={22} />
              )}
            </span>
            <span className="export-btn-copy">
              <strong>CSV 壓縮檔 (.zip)</strong>
              <small>5 個 CSV + XLSX</small>
            </span>
            <Download size={18} />
          </button>

          <div className="export-divider">
            <span>資料備份</span>
          </div>

          <div className="backup-actions">
            <button className="btn ghost" onClick={onBackup} disabled={!sheets.length}>
              <FileJson size={16} />
              下載 JSON 備份
            </button>
            <button className="btn ghost" onClick={() => importRef.current?.click()}>
              <Upload size={16} />
              載入備份
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImportBackup(file);
                event.target.value = '';
              }}
            />
          </div>
          <p className="backup-note">
            <Info size={13} />
            不含原始掃描影像。
          </p>

          <div className="export-file-preview">
            <div className="file-preview-head">
              <Crown size={14} />
              <span>答案卷</span>
              <strong>{settings.questionCount} 題</strong>
            </div>
            <p>以答案卷為滿分標準，預設不計入統計。</p>
            <div className="file-name-preview">
              QTSMC_{settings.title ? settings.title.replace(/\s+/g, '_') : '成績'}_
              {settings.date || '日期'}.xlsx
            </div>
          </div>

          <div className={`ready-banner ${ready ? 'ready' : 'not-ready'}`}>
            {ready ? (
              <>
                <CheckCircle2 size={16} />
                已準備好 {analysis.included.length} 位學生的完整報告
              </>
            ) : (
              <>
                <AlertTriangle size={16} />
                尚未有足夠資料；請確認答案卷及學生答題紙。
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
