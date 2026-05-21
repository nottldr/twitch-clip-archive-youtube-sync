import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight confirm prompt for destructive ops (reset-all, clear logs).
 * Not a generic modal system — intentionally constrained to a yes/no flow.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-white p-5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
        {body && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{body}</p>}
        <div className="mt-4 flex justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border px-3 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? "rounded border border-red-500 bg-red-500 px-3 py-1 font-medium text-white hover:bg-red-600"
                : "rounded border border-blue-500 bg-blue-500 px-3 py-1 font-medium text-white hover:bg-blue-600"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
