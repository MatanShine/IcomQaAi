import { useEffect, useState } from 'react';

export interface Toast {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info';
}

interface ToastProps {
  toast: Toast;
  onClose: (id: string) => void;
}

export const ToastItem = ({ toast, onClose }: ToastProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    // Trigger slide-in animation
    setTimeout(() => setIsVisible(true), 10);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, 3000);

    return () => clearTimeout(timer);
  }, [toast.id]);

  const handleClose = () => {
    setIsRemoving(true);
    setTimeout(() => {
      onClose(toast.id);
    }, 300); // Wait for animation to complete
  };

  const bgColor =
    toast.type === 'error'
      ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700'
      : toast.type === 'info'
      ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700'
      : 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700';

  const textColor =
    toast.type === 'error'
      ? 'text-red-800 dark:text-red-300'
      : toast.type === 'info'
      ? 'text-blue-800 dark:text-blue-300'
      : 'text-green-800 dark:text-green-300';

  return (
    <div
      className={`${bgColor} ${textColor} border rounded-lg px-4 py-3 shadow-lg flex items-center justify-between gap-4 min-w-[300px] max-w-md transition-all duration-300 ease-in-out ${
        isVisible && !isRemoving
          ? 'translate-y-0 opacity-100'
          : isRemoving
          ? '-translate-y-full opacity-0'
          : '-translate-y-full opacity-0'
      }`}
    >
      <p className="text-sm font-medium">{toast.message}</p>
      <button
        onClick={handleClose}
        className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
}

export const ToastContainer = ({ toasts, onClose }: ToastContainerProps) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 overflow-hidden">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
};

