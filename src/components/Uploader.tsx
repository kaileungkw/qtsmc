import { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Crown,
  FilePlus2,
  FileJson,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { RuntimeSheet } from '../types';

interface UploaderProps {
  sheets: RuntimeSheet[];
  processing: boolean;
  progress: { done: number; total: number; current: string };
  importProgress: { active: boolean; label: string; page: number; total: number };
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onSetKey: (id: string) => void;
  onProcess: () => void;
  onClear: () => void;
  onImportBackup: (file: File) => void;
}

export default function Uploader({
  sheets,
  processing,
  progress,
  importProgress,
  onFiles,
  onRemove,
  onMove,
  onSetKey,
  onProcess,
  onClear,
  onImportBackup,
}: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = processing || importProgress.active;

  const pick = () => {
    if (!busy) inputRef.current?.click();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <section className="panel uploader-panel" aria-labelledby="upload-title">
      <div className="panel-head">
        <div>
          <span className="section-kicker">STEP 01 · 上載</span>
          <h2 id="upload-title">把整疊答題紙放進來</h2>
          <p className="panel-sub">
            支援 JPG、PNG、WEBP 及 PDF。多頁 PDF 會自動拆成逐頁答題紙。
          </p>
        </div>
        <div className="panel-head-meta">
          <span className="count-pill">{sheets.length} 張</span>
          {sheets.length > 0 && (
            <button className="text-btn danger" onClick={onClear} disabled={busy}>
              清除全部
            </button>
          )}
        </div>
      </div>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${sheets.length ? 'compact' : ''}`}
        onClick={pick}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') pick();
        }}
        aria-label="上載答題紙"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/bmp,application/pdf,.pdf"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onFiles(files);
            event.target.value = '';
          }}
        />
        <div className="dropzone-icon">
          {busy ? <Loader2 size={26} className="spin" /> : <UploadCloud size={26} />}
        </div>
        <div className="dropzone-copy">
          <strong>
            {importProgress.active
              ? `正在拆頁 ${importProgress.page}/${importProgress.total}`
              : '拖放檔案到這裡，或點擊選擇'}
          </strong>
          <span>
            {importProgress.active
              ? importProgress.label
              : sheets.length
                ? '可繼續加入更多答題紙；第一張預設為答案卷。'
                : '一次過上載整班；JPG / PNG / PDF 均可。'}
          </span>
        </div>
        <span className="btn secondary small dropzone-btn">
          <FilePlus2 size={15} />
          選擇檔案
        </span>
      </div>

      {importProgress.active && (
        <div className="inline-progress">
          <div
            className="progress-fill"
            style={{
              width: `${
                importProgress.total
                  ? (importProgress.page / importProgress.total) * 100
                  : 5
              }%`,
            }}
          />
        </div>
      )}

      {sheets.length > 0 && (
        <div className="sheet-grid">
          {sheets.map((sheet, index) => {
            const isError = sheet.status === 'error';
            return (
              <article
                key={sheet.id}
                className={`sheet-card ${sheet.isKey ? 'is-key' : ''} ${
                  isError ? 'has-error' : ''
                }`}
              >
                <div className="sheet-thumb">
                  <img src={sheet.previewUrl} alt={sheet.fileName} loading="lazy" />
                  <span className="sheet-index">{String(index + 1).padStart(2, '0')}</span>
                  {sheet.isKey && (
                    <span className="key-badge">
                      <Crown size={12} />
                      答案卷
                    </span>
                  )}
                  {sheet.status === 'processing' && (
                    <span className="thumb-status processing">
                      <Loader2 size={13} className="spin" />
                      辨識中
                    </span>
                  )}
                  {sheet.status === 'done' && (
                    <span className="thumb-status done">
                      <Check size={13} />
                      已批改
                    </span>
                  )}
                  {isError && (
                    <span className="thumb-status error">
                      <AlertTriangle size={13} />
                      需檢查
                    </span>
                  )}
                </div>
                <div className="sheet-body">
                  <strong title={sheet.fileName}>{sheet.fileName}</strong>
                  <span className="sheet-meta">
                    {sheet.status === 'idle' && (
                      <>
                        <ScanLine size={12} />
                        待批改
                      </>
                    )}
                    {sheet.status === 'done' &&
                      sheet.detection?.ok &&
                      `${sheet.detection.rows.filter((r) => r.answer !== 'blank').length} 個填畫`}
                    {isError && (
                      <>
                        <AlertTriangle size={12} />
                        {sheet.error ?? '辨識失敗'}
                      </>
                    )}
                    {sheet.status === 'processing' && '正在分析影像…'}
                  </span>
                </div>
                <div className="sheet-actions">
                  {!sheet.isKey && (
                    <button
                      className="mini-action"
                      onClick={() => onSetKey(sheet.id)}
                      disabled={busy}
                      title="設為答案卷"
                    >
                      <Crown size={14} />
                      設為答案卷
                    </button>
                  )}
                  {sheet.isKey && (
                    <span className="mini-note">
                      <Crown size={13} />
                      答案標準 · 不計入統計
                    </span>
                  )}
                  <div className="sheet-move">
                    <button
                      className="icon-btn"
                      onClick={() => onMove(sheet.id, -1)}
                      disabled={busy || index === 0}
                      aria-label="向前移動"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => onMove(sheet.id, 1)}
                      disabled={busy || index === sheets.length - 1}
                      aria-label="向後移動"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => onRemove(sheet.id)}
                      disabled={busy}
                      aria-label="移除答題紙"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          <button className="add-sheet-card" onClick={pick} disabled={busy}>
            <Plus size={22} />
            <span>加入更多</span>
            <small>JPG / PNG / PDF</small>
          </button>
        </div>
      )}

      <div className="upload-footer">
        <div className="upload-hint">
          <Sparkles size={16} />
          <span>
            第一張答題紙會成為<strong>答案卷</strong>，以滿分計算，但<strong>預設不計入全班統計</strong>。你可以隨時把任何一張設為答案卷。
          </span>
        </div>
        <div className="upload-actions">
          {sheets.length === 1 && (
            <span className="soft-warning">
              <AlertTriangle size={14} />
              至少 2 張才會有學生成績統計
            </span>
          )}
          <button
            className="btn primary large"
            onClick={onProcess}
            disabled={!sheets.length || busy}
          >
            {processing ? <Loader2 size={17} className="spin" /> : <ScanLine size={17} />}
            {processing
              ? `批改中 ${progress.done}/${progress.total}`
              : sheets.some((s) => s.status === 'done')
                ? '重新自動批改'
                : '開始自動批改'}
          </button>
        </div>
      </div>

      <div className="format-note">
        <span>
          <ImageIcon size={13} /> 手機相片或掃描影像
        </span>
        <span>
          <FileText size={13} /> 多頁 PDF 自動拆頁
        </span>
        <span>
          <Crown size={13} /> 第一張 = 答案卷
        </span>
        <button
          className="backup-link"
          onClick={() => backupRef.current?.click()}
          disabled={busy}
        >
          <FileJson size={13} /> 載入 JSON 備份
        </button>
        <input
          ref={backupRef}
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
    </section>
  );
}
