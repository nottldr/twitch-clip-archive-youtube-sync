import { Link } from "@tanstack/react-router";

import { ClipDetailContent } from "#web/components/ClipDetailContent.js";
import { useClipDetail } from "#web/lib/queries.js";

interface Props {
  clipId: string | null;
  onClose: () => void;
}

export function ClipDetailDrawer({ clipId, onClose }: Props) {
  const { data, isLoading } = useClipDetail(clipId);

  if (!clipId) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white shadow-xl sm:max-w-lg dark:bg-gray-800"
        role="dialog"
        aria-label="Clip details"
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 border-b bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="min-w-0 truncate font-semibold text-gray-800 dark:text-gray-100">
            {data?.clip.title ?? clipId}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              to="/clips/$clipId"
              params={{ clipId }}
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/40"
              title="Open in a full-page view"
            >
              Open full page ↗
            </Link>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              aria-label="Close detail drawer"
            >
              ✕
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-4 text-gray-400">Loading…</div>
        ) : !data ? (
          <div className="p-4 text-red-500">Clip not found</div>
        ) : (
          <div className="p-4">
            <ClipDetailContent clipId={clipId} data={data} />
          </div>
        )}
      </aside>
    </>
  );
}
