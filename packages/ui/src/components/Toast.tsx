import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../cn';

type ToastKind = 'success' | 'error';

interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Short-lived confirmations and failures, announced politely to screen readers. */
export function ToastProvider({ children, durationMs = 4000 }: { children: ReactNode; durationMs?: number }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, kind, text }]);
      setTimeout(() => {
        dismiss(id);
      }, durationMs);
    },
    [dismiss, durationMs],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => {
        push('success', text);
      },
      error: (text) => {
        push('error', text);
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1',
              toast.kind === 'success'
                ? 'bg-white text-slate-800 ring-emerald-200'
                : 'bg-white text-slate-800 ring-red-200',
            )}
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <XCircle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            )}
            <span className="flex-1">{toast.text}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-slate-400 hover:text-slate-600"
              onClick={() => {
                dismiss(toast.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return context;
}
