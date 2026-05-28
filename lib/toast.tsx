'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  toast: (message: string, type?: ToastType, duration?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(
    (message: string, type: ToastType = 'success', duration = 3500) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    [],
  );

  // Bridge to legacy window.toast() calls so ported code keeps working.
  useEffect(() => {
    (window as unknown as { toast: typeof toast }).toast = toast;
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Live region for screen reader announcements. Errors are 'assertive'
          (interrupt-now), everything else is 'polite' so non-critical info
          waits its turn. aria-atomic re-reads the whole message each update
          rather than just the diff. */}
      <div
        className="gf-toast-container"
        id="gf-toasts"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`gf-toast gf-toast-${t.type} show`}
            role={t.type === 'error' ? 'alert' : 'status'}
          >
            <span aria-hidden="true">{ICONS[t.type]}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx.toast;
}
