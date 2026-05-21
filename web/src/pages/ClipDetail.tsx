import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { ClipDetailContent } from "#web/components/ClipDetailContent.js";
import { PageHeader } from "#web/components/ui/PageHeader.js";
import { Skeleton } from "#web/components/ui/Skeleton.js";
import { fetchJson } from "#web/lib/api.js";
import { ClipDetailSchema } from "#web/lib/types.js";

export function ClipDetail() {
  const { clipId } = useParams<{ clipId: string }>();

  const { data, isLoading, refetch } = useQuery({
    enabled: !!clipId,
    queryKey: ["clips", clipId],
    queryFn: () => fetchJson(`/api/clips/${clipId}`, ClipDetailSchema),
  });

  if (!clipId) {
    return <div className="p-4 text-sm text-red-500">Missing clip id in URL.</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={data?.clip.title ?? clipId}
        subtitle={
          <Link to="/queue" className="text-blue-600 hover:underline dark:text-blue-300">
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
          <ClipDetailContent
            clipId={clipId}
            data={data}
            onRefetch={() => {
              void refetch();
            }}
            enableLoadMoreAttempts
          />
        </div>
      )}
    </div>
  );
}
