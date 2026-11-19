import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  sheetCount: number;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  processing: boolean;
}

export default function Header({
  sheetCount,
  saveState,
  processing,
}: HeaderProps) {
  return (
    <header className="site-header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span>Q</span>
          <i />
        </div>
        <div className="brand-text">
          <strong>QTSMC</strong>
          <span>答題紙批改</span>
        </div>
      </div>
      <div className="header-right">
        <div className="privacy-pill" title="所有影像只在你的瀏覽器中處理">
          <ShieldCheck size={15} />
          <span>本機處理 · 不上傳</span>
        </div>
        {sheetCount > 0 && (
          <div className={`save-pill ${saveState}`}>
            {processing || saveState === 'saving' ? (
              <Loader2 size={14} className="spin" />
            ) : saveState === 'error' ? (
              <span className="save-dot" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            <span>
              {processing
                ? '處理中'
                : saveState === 'saving'
                  ? '儲存中'
                  : saveState === 'error'
                    ? '未能自動儲存'
                    : '已自動儲存'}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
