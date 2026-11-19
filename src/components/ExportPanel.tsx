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
        kind === 'xlsx' ? '已下載 Excel 檔。' : '已下載 CSV 壓縮檔（4 個 CSV）。',
        'success',
      );
    } catch (error) {
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
              <p>這些資料會寫入 Excel 及 CSV 的標題與設定頁。</p>
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
              <span>科目</span>
              <input
                value={settings.subject}
                onChange={(event) => onSettingsChange({ subject: event.target.value })}
                placeholder="例如：Physics"
              />
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
              <input
                type="number"
                min={0}
                max={100}
                value={settings.passMark}
                onChange={(event) =>
                  onSettingsChange({
                    passMark: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                  })
                }
              />
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
              <p>所有檔案即時在你的瀏覽器產生。</p>
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
              <small>6 個工作表：成績、題目分析、選項統計、答案卷、統計摘要、設定</small>
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
              <small>成績總表、題目分析、選項統計、答案卷各一個 UTF-8 CSV</small>
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
            JSON 備份包含答案、設定及分數，不包含原始掃描影像。
          </p>

          <div className="export-file-preview">
            <div className="file-preview-head">
              <Crown size={14} />
              <span>答案卷</span>
              <strong>{settings.questionCount} 題</strong>
            </div>
            <p>
              第一個工作表會以「答案卷」列標示，並以滿分顯示，但預設不計入平均、答對率及選項百分比。其他學生按每題
              {settings.marksPerQuestion} 分計算。
            </p>
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
