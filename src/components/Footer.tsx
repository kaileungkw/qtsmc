import { useRef } from 'react';
import { Lock, MousePointerClick, ScanLine, Table2, Users } from 'lucide-react';

interface FooterProps {
  onDeleteTask: () => void;
  onImportRoster: (file: File) => void;
  customRoster: boolean;
  onResetRoster: () => void;
}

export default function Footer({
  onDeleteTask,
  onImportRoster,
  customRoster,
  onResetRoster,
}: FooterProps) {
  const rosterRef = useRef<HTMLInputElement>(null);
  return (
    <footer className="site-footer" id="guide">
      <div className="guide-grid">
        <article>
          <span className="guide-icon">
            <ScanLine size={20} />
          </span>
          <h3>1. 上載答題紙</h3>
          <p>支援 JPG、PNG、WEBP 及多頁 PDF。把第一張設為答案卷，系統會以它作滿分標準。</p>
        </article>
        <article>
          <span className="guide-icon">
            <MousePointerClick size={20} />
          </span>
          <h3>2. 自動辨識</h3>
          <p>系統會找出三個答題框、逐格量度填畫深度，並自動判斷本次測驗的題數。</p>
        </article>
        <article>
          <span className="guide-icon">
            <Table2 size={20} />
          </span>
          <h3>3. 覆核與匯出</h3>
          <p>以標記圖快速覆核每張卷，修正姓名或個別答案，再匯出 Excel、CSV 或 JSON 備份。</p>
        </article>
      </div>
      <div className="footer-bottom">
        <div className="footer-brand">
          <strong>QTSMC</strong>
          <span>答題紙批改 · 為老師而設</span>
        </div>
        <div className="footer-privacy">
          <Lock size={14} />
          所有掃描影像及成績只會留在你的瀏覽器（IndexedDB），不會傳送到任何伺服器。
        </div>
        <div className="footer-actions">
          <button
            className="text-btn"
            onClick={() => rosterRef.current?.click()}
            title="讀取 Student_namelist 工作表；名單只儲存在本機"
          >
            <Users size={12} /> 更新名單
          </button>
          {customRoster && (
            <button
              className="text-btn"
              onClick={onResetRoster}
              title="清除本機名單，重新讀取學校 Google Sheet"
            >
              使用線上名單
            </button>
          )}
          <input
            ref={rosterRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportRoster(file);
              event.target.value = '';
            }}
          />
          <button className="text-btn" onClick={onDeleteTask}>
            刪除目前任務
          </button>
          <span>© {new Date().getFullYear()} QTSMC · v{__APP_VERSION__}</span>
        </div>
      </div>
    </footer>
  );
}
