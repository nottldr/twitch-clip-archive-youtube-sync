import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiPost } from "#web/lib/api.js";
import { useToast } from "#web/lib/toast.js";
import {
  AnyResponseSchema,
  BulkActionResponseSchema,
  MirrorPublishResponseSchema,
  OkResponseSchema,
  ResetCountResponseSchema,
} from "#web/lib/types.js";

/**
 * Centralized mutation hooks. Every page that wants to retry, force-upload,
 * ignore, or bulk-act on clips goes through here — keeps the invalidation
 * and toast story consistent and shrinks each caller from ~20 lines to one.
 *
 * Convention: each hook takes no required arguments and returns the TanStack
 * mutation object. Pass per-call data via `mutation.mutate({...})`.
 */

type BulkAction = "retry" | "reset" | "ignore";

function bulkActionVerb(action: BulkAction): string {
  switch (action) {
    case "retry":
      return "Retried";
    case "reset":
      return "Reset";
    case "ignore":
      return "Ignored";
  }
}

function invalidateClipScopedKeys(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["clips"] });
  void queryClient.invalidateQueries({ queryKey: ["stats"] });
  void queryClient.invalidateQueries({ queryKey: ["activity"] });
}

export function useRetryClip() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: (clipId: string) =>
      apiPost(`/api/clips/${clipId}/retry`, undefined, OkResponseSchema),
    onSuccess: () => {
      notify("success", "Retry queued");
      invalidateClipScopedKeys(queryClient);
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Retry failed");
    },
  });
}

/**
 * Force a clip to upload right now, bypassing canUpload (quota / paused /
 * awaitingAuth). Backed by the machine's TRIGGER_CLIP event.
 */
export function useForceUploadClip() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: (clipId: string) =>
      apiPost(`/api/engine/trigger/${clipId}`, undefined, OkResponseSchema),
    onSuccess: () => {
      notify("info", "Force upload triggered");
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Force upload failed");
    },
  });
}

export function useMarkIgnored() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: (clipId: string) =>
      apiPost("/api/clips/bulk", { action: "ignore", clipIds: [clipId] }, BulkActionResponseSchema),
    onSuccess: () => {
      notify("success", "Clip marked ignored");
      invalidateClipScopedKeys(queryClient);
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Mark-ignored failed");
    },
  });
}

export function useBulkClipAction() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: (input: { action: BulkAction; clipIds: string[] }) =>
      apiPost("/api/clips/bulk", input, BulkActionResponseSchema),
    onSuccess: (result, input) => {
      const noun = result.affected === 1 ? "clip" : "clips";
      notify(
        "success",
        `${bulkActionVerb(input.action)} ${result.affected.toLocaleString()} ${noun}`,
      );
      invalidateClipScopedKeys(queryClient);
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Bulk action failed");
    },
  });
}

export function usePauseEngine() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: () => apiPost("/api/engine/pause", undefined, AnyResponseSchema),
    onSuccess: () => {
      notify("success", "Engine paused");
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Failed to pause");
    },
  });
}

export function useResumeEngine() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: () => apiPost("/api/engine/resume", undefined, AnyResponseSchema),
    onSuccess: () => {
      notify("success", "Engine resumed");
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Failed to resume");
    },
  });
}

/**
 * Generic admin action — used by the Diagnostics page for the grid of
 * one-click POST buttons. Doesn't validate the response shape (each
 * endpoint returns something slightly different); the page just shows the
 * raw result in its "Last result" pre.
 */
export function useAdminAction() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: async (input: { url: string; label: string }) => {
      const result = await apiPost(input.url, undefined, AnyResponseSchema);
      return { label: input.label, result };
    },
    onSuccess: (data) => {
      notify("success", data.label);
      void queryClient.invalidateQueries();
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Action failed");
    },
  });
}

/**
 * The two engine reset endpoints return `{ reset: N }` rather than `{ ok }`.
 * Exposed separately so Diagnostics can display the affected count if it
 * wants — currently just routes through useAdminAction for the UI.
 */
export function useResetFailed() {
  return useMutation({
    mutationFn: () => apiPost("/api/engine/reset-failed", undefined, ResetCountResponseSchema),
  });
}

export function useResetAll() {
  return useMutation({
    mutationFn: () => apiPost("/api/engine/reset-all", undefined, ResetCountResponseSchema),
  });
}

export function usePublishMirror() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  return useMutation({
    mutationFn: () => apiPost("/api/mirror/publish", undefined, MirrorPublishResponseSchema),
    onSuccess: (result) => {
      if (result.ok) {
        notify("success", `Mirror published (${String(result.clipCount)} clips)`);
      } else {
        notify("error", result.error ?? "Mirror publish failed");
      }
      void queryClient.invalidateQueries({ queryKey: ["mirror"] });
    },
    onError: (err) => {
      notify("error", err instanceof Error ? err.message : "Mirror publish failed");
    },
  });
}
