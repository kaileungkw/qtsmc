import { useEffect, useState } from 'react';
import { PencilLine, X } from 'lucide-react';

interface NamingModalProps {
  names: string[];
  onApply: (names: string[]) => void;
  onClose: () => void;
}

export default function NamingModal({ names, onApply, onClose }: NamingModalProps) {
  const [text, setText] = useState(names.join('\n'));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = text.split(/\r?\n/);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="批次命名">
      <div className="naming-modal">
        <div className="review-topbar">
          <div className="review-topbar-left">
            <span className="topbar-kicker">
              <PencilLine size={13} /> BULK NAMES
            </span>
            <strong>批次命名</strong>
          </div>
          <button className="icon-btn close" onClick={onClose} aria-label="關閉">
            <X size={18} />
          </button>
        </div>
        <div className="naming-body">
          <p>
            每行輸入一個姓名，會按目前答題紙的排序套用。留空的行會保留原名。
            目前共 <strong>{names.length}</strong> 張。
          </p>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(20, Math.max(8, names.length + 2))}
            spellCheck={false}
            placeholder={'陳大文\n李小明\n王美華'}
          />
          <div className="naming-count">
            <span>{parsed.filter((line) => line.trim()).length} 個姓名</span>
            <span>{names.length} 張答題紙</span>
          </div>
        </div>
        <div className="key-editor-footer">
          <div className="key-footer-note">姓名可以直接在成績表再修改。</div>
          <div className="key-footer-actions">
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" onClick={() => onApply(parsed)}>
              套用名單
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
