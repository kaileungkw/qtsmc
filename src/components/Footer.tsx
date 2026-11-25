import { Lock, MousePointerClick, ScanLine, Table2 } from 'lucide-react';
import type { TaskKind } from '../types';

interface FooterProps {
  onDeleteTask: () => void;
  kind?: TaskKind;
}

export default function Footer({ onDeleteTask, kind }: FooterProps) {
  const survey = kind === 'survey';
  return (
    <footer className="site-footer" id="guide">
      <div className="guide-grid">
        <article>
          <span className="guide-icon">
            <ScanLine size={20} />
          </span>
          <h3>{survey ? '1. 上載表格及掃描' : '1. 上載答題紙'}</h3>
          <p>
            {survey
              ? '先上載空白表格 PDF，再加入已填寫的掃描；A3 會自動分左右兩頁，整班可一次過處理。'
              : '支援 JPG、PNG、WEBP 及多頁 PDF。把第一張設為答案卷，系統會以它作滿分標準。'}
          </p>
        </article>
        <article>
          <span className="guide-icon">
            <MousePointerClick size={20} />
          </span>
          <h3>2. 自動辨識</h3>
          <p>
            {survey
              ? '科目名稱由空白表格的文字層讀取，再逐格讀出排序；系統會按考生號碼頁自動分份。'
              : '系統會找出三個答題框、逐格量度填畫深度，並自動判斷本次測驗的題數。'}
          </p>
        </article>
        <article>
          <span className="guide-icon">
            <Table2 size={20} />
          </span>
          <h3>3. 覆核與匯出</h3>
          <p>
            {survey
              ? '以標記圖核對考生號碼及排序，修正個別項目，再匯出 Excel、CSV 及原掃描 PDF。'
              : '以標記圖快速覆核每張卷，修正姓名或個別答案，再匯出 Excel、CSV 或 JSON 備份。'}
          </p>
        </article>
      </div>
      <div className="footer-bottom">
        <div className="footer-brand">
          <strong>QTSMC</strong>
          <span>{survey ? '選科表辨識' : '答題紙批改'} · 為老師而設</span>
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
