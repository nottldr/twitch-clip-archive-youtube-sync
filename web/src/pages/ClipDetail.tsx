import { Link, useParams } from "@tanstack/react-router";

import { ClipDetailContent } from "#web/components/ClipDetailContent.js";
import { PageHeader } from "#web/components/ui/PageHeader.js";
import { Skeleton } from "#web/components/ui/Skeleton.js";
import { useClipDetail } from "#web/lib/queries.js";
import { queueDefaults } from "#web/router.js";

export function ClipDetail() {
  const { clipId } = useParams({ from: "/clips/$clipId" });
  const { data, isLoading } = useClipDetail(clipId);

  return (
    <div className="space-y-4">
      <PageHeader
        title={data?.clip.title ?? clipId}
        subtitle={
          <Link
            to="/queue"
            search={queueDefaults}
            className="text-blue-600 hover:underline dark:text-blue-300"
          >
            ← Back to queue
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !data ? (
        <div className="rounded-lg border bg-white p-4 text-sm text-red-500 dark:border-gray-700 dark:bg-gray-800">
          Clip not found.
        </div>
      ) : (
        <div className="rounded-lg border bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <ClipDetailContent clipId={clipId} data={data} enableLoadMoreAttempts />
        </div>
      )}
    </div>
  );
}
