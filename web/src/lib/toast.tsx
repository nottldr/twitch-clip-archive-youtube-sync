import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface ToastContextValue {
  notify: (kind: Toast["kind"], message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ notify: () => {} });

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((kind: Toast["kind"], message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="pointer-events-none fixed top-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            onDismiss={() => {
              setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
          />
        ))}
      </div>
    </ToastContext>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setEntered(true);
    }, 10);
    return () => {
      clearTimeout(t);
    };
  }, []);

  const colour =
    toast.kind === "success"
      ? "bg-green-600 text-white"
      : toast.kind === "error"
        ? "bg-red-600 text-white"
        : "bg-gray-800 text-white";

  return (
    <button
      onClick={onDismiss}
      className={`pointer-events-auto max-w-sm rounded px-3 py-2 text-sm shadow-lg transition-all ${colour} ${
        entered ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      }`}
    >
      {toast.message}
    </button>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
