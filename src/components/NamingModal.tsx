import { useEffect, useMemo, useState } from 'react';
import { PencilLine, X } from 'lucide-react';
import type { NamingEntry } from '../types';

interface NamingModalProps {
  students: { id: string; name: string; className: string; seatNo: string }[];
  onApply: (entries: NamingEntry[]) => void;
  onClose: () => void;
}

export default function NamingModal({ students, onApply, onClose }: NamingModalProps) {
  const initial = students
    .map((student) =>
      student.seatNo ? `${student.seatNo}\t${student.name}` : student.name,
    )
    .join('\n');
  const [text, setText] = useState(initial);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries = useMemo<NamingEntry[]>(() => {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const matched = line.match(/^(\d{4})[\s,，:：\t]+(.+)$/);
        if (matched) {
          return { seatNo: matched[1], name: matched[2].trim() };
        }
        return { name: line };
      });
  }, [text]);

  const numbered = entries.filter((entry) => entry.seatNo).length;
  const plain = entries.length - numbered;

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
            可直接貼上試算表的「學號 + 姓名」兩欄（例如 <code>4103 陳文麗</code>），
            系統會按學號配對；如只貼姓名，則按目前答題紙排序套用。
            目前共 <strong>{students.length}</strong> 張。
          </p>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(22, Math.max(8, students.length + 2))}
            spellCheck={false}
            placeholder={'4103 陳文麗\n4112 李樂臻\n4126 胡景堯'}
          />
          <div className="naming-count">
            <span>
              {entries.length} 行 · {numbered} 個學號 · {plain} 個純姓名
            </span>
            <span>{students.length} 張答題紙</span>
          </div>
        </div>
        <div className="key-editor-footer">
          <div className="key-footer-note">
            學號取自答題紙左上角的 Level / Class / Class No 格。
          </div>
          <div className="key-footer-actions">
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" onClick={() => onApply(entries)}>
              套用名單
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
