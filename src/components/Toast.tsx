import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  message: string;
  kind: ToastKind;
  onClose: () => void;
}

export default function Toast({ message, kind, onClose }: ToastProps) {
  const Icon =
    kind === 'success'
      ? CheckCircle2
      : kind === 'error'
        ? XCircle
        : kind === 'warning'
          ? AlertTriangle
          : Info;
  return (
    <div className={`toast ${kind}`} role="status" aria-live="polite">
      <Icon size={18} />
      <span>{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="關閉通知">
        <X size={15} />
      </button>
    </div>
  );
}
