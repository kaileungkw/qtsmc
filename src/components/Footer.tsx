import { Lock, MousePointerClick, ScanLine, Table2 } from 'lucide-react';

interface FooterProps {
  onDeleteTask: () => void;
}

export default function Footer({ onDeleteTask }: FooterProps) {
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
          <button className="text-btn" onClick={onDeleteTask}>
            刪除目前任務
          </button>
          <span>© {new Date().getFullYear()} QTSMC · v{__APP_VERSION__}</span>
        </div>
      </div>
    </footer>
  );
}
