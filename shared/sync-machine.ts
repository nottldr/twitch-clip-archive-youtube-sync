import type { EngineSnapshot } from "./schemas.js";

import { produce } from "immer";
import { assign, fromCallback, fromPromise, setup } from "xstate";

// The machine context matches the EngineSnapshot.context shape from schemas.ts,
// plus debug flags that aren't exposed in the API snapshot.
export type SyncContext = EngineSnapshot["context"] & {
  debugForceFailNextUpload: boolean;
  debugForceQuotaExhausted: boolean;
  debugForceUploadLimit: boolean;
  /**
   * One-shot flag set by the quota probe (and force-upload paths) that
   * lets the next deciding pass bypass `canUpload`. Cleared automatically
   * when an upload concludes or the machine enters a waiting substate.
   */
  forceNextUpload: boolean;
};

export const initialContext: SyncContext = {
  clipId: null,
  clipTitle: null,
  uploadStartedAt: null,
  bytesTransferred: null,
  totalBytes: null,
  waitResumeAt: null,
  lastError: null,
  lastImportAt: null,
  clipsImported: null,
  lastQuotaDiscoveryAt: null,
  quotaLimit: null,
  userPaused: false,
  debugForceFailNextUpload: false,
  debugForceQuotaExhausted: false,
  debugForceUploadLimit: false,
  forceNextUpload: false,
};

export type SyncEvent =
  | { type: "START" }
  | { type: "STOP" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "AUTH_COMPLETE" }
  | { type: "AUTH_LOST" }
  | { type: "TRIGGER_CLIP"; clipId: string }
  | { type: "IMPORT_NOW" }
  | { type: "DISCOVER_NOW" }
  | { type: "CLIPS_CHANGED" }
  | { type: "QUOTA_RESET" }
  | { type: "UPLOAD_PROGRESS"; bytesTransferred: number; totalBytes: number }
  | { type: "UPLOAD_COMPLETE"; youtubeId: string; durationMs: number }
  | { type: "UPLOAD_FAILED"; error: string; code: string }
  | { type: "ARCHIVE_TICK" }
  | { type: "QUOTA_TICK" }
  | { type: "DEBUG_SET_FORCE_FAIL"; value: boolean }
  | { type: "DEBUG_SET_FORCE_QUOTA"; value: boolean }
  | { type: "DEBUG_SET_FORCE_UPLOAD_LIMIT"; value: boolean }
  | { type: "DEBUG_CLEAR_ALL" };

export interface UploadResult {
  youtubeId: string;
  durationMs: number;
}

export interface SyncMachineDeps {
  // Guards
  isAuthenticated: () => boolean;
  canUpload: () => boolean;
  msUntilQuotaReset: () => number;

  // Config
  uploadIntervalMs: number;
  archivePollIntervalMs: number;
  /** How long the machine sits in `waiting.quotaExhausted` before probing YouTube again. */
  quotaProbeIntervalMs: number;
  initialUserPaused?: boolean;

  // Actors (async operations)
  importArchive: () => Promise<number>;
  discoverQuota: () => Promise<number | null>;
  selectNextClip: () => Promise<{ clipId: string; clipTitle: string } | null>;
  performUpload: (
    clipId: string,
    onProgress: (bytesTransferred: number, totalBytes: number) => void,
  ) => Promise<UploadResult>;

  // Side effects (invoked as XState actions on transitions)
  onClipUploading: (clipId: string) => void;
  onClipUploaded: (clipId: string, youtubeId: string) => void;
  onClipFailed: (clipId: string, error: string, code: string) => void;
  onQuotaRecorded: () => void;
  onQuotaLimitExceeded: () => void;
}

export function createSyncMachine(deps: SyncMachineDeps) {
  // Reusable context updater: clear upload fields (also consumes any one-shot
  // force-upload flag since the upload has now concluded).
  const clearUpload = (draft: SyncContext) => {
    draft.clipId = null;
    draft.clipTitle = null;
    draft.uploadStartedAt = null;
    draft.bytesTransferred = null;
    draft.totalBytes = null;
    draft.forceNextUpload = false;
  };

  return setup({
    types: {
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      context: {} as SyncContext,
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      events: {} as SyncEvent,
    },
    guards: {
      isAuthenticated: () => deps.isAuthenticated(),
      notAuthenticated: () => !deps.isAuthenticated(),
      // forceNextUpload overrides everything (manual trigger / quota probe);
      // debugForceQuotaExhausted simulates a quota-exhausted state for testing;
      // otherwise we trust the scheduler's local accounting.
      canUpload: ({ context }) => {
        if (context.forceNextUpload) return true;
        if (context.debugForceQuotaExhausted) return false;
        return deps.canUpload();
      },
      cantUpload: ({ context }) => {
        if (context.forceNextUpload) return false;
        if (context.debugForceQuotaExhausted) return true;
        return !deps.canUpload();
      },
      isUserPaused: ({ context }) => context.userPaused,
      isQuotaError: ({ event }) =>
        event.type === "UPLOAD_FAILED" && event.code === "QUOTA_EXCEEDED",
      isUploadLimitError: ({ event }) =>
        event.type === "UPLOAD_FAILED" && event.code === "UPLOAD_LIMIT_EXCEEDED",
      isAuthError: ({ event }) => event.type === "UPLOAD_FAILED" && event.code === "UNAUTHORIZED",
    },
    delays: {
      uploadCooldown: () => deps.uploadIntervalMs,
      // Time spent in quotaExhausted before probing YouTube directly. Capped at
      // msUntilQuotaReset so a probe runs immediately after the daily reset
      // even if the configured probe interval is longer.
      quotaProbe: () => Math.min(deps.quotaProbeIntervalMs, deps.msUntilQuotaReset()),
      uploadLimitRetry: 60 * 60 * 1000,
      noClipsRetry: 30_000,
      errorRetry: 60_000,
    },
    actors: {
      importArchive: fromPromise(async () => deps.importArchive()),
      discoverQuota: fromPromise(async () => deps.discoverQuota()),
      selectNextClip: fromPromise(async () => deps.selectNextClip()),
      performUpload: fromCallback(
        ({
          sendBack,
          input,
        }: {
          sendBack: (event: SyncEvent) => void;
          input: { clipId: string };
        }) => {
          const promise = deps.performUpload(input.clipId, (bytesTransferred, totalBytes) => {
            sendBack({ type: "UPLOAD_PROGRESS", bytesTransferred, totalBytes });
          });

          void promise.then(
            (result) => {
              sendBack({
                type: "UPLOAD_COMPLETE",
                youtubeId: result.youtubeId,
                durationMs: result.durationMs,
              });
            },
            (error: unknown) => {
              const errObj = error instanceof Object ? error : {};
              const msg = "error" in errObj ? String(errObj.error) : "Unknown error";
              const code = "code" in errObj ? String(errObj.code) : "UNKNOWN";
              sendBack({ type: "UPLOAD_FAILED", error: msg, code });
            },
          );
        },
      ),
      archiveTimer: fromCallback(({ sendBack }) => {
        const id = setInterval(() => {
          sendBack({ type: "ARCHIVE_TICK" });
        }, deps.archivePollIntervalMs);
        return () => {
          clearInterval(id);
        };
      }),
      quotaTimer: fromCallback(({ sendBack }) => {
        const id = setInterval(
          () => {
            sendBack({ type: "QUOTA_TICK" });
          },
          24 * 60 * 60 * 1000,
        );
        return () => {
          clearInterval(id);
        };
      }),
    },
  }).createMachine({
    id: "sync",
    initial: "stopped",
    context: { ...initialContext, userPaused: deps.initialUserPaused ?? false },
    on: {
      STOP: { target: ".stopped" },
      DEBUG_SET_FORCE_FAIL: {
        actions: assign(({ context, event }) =>
          produce(context, (draft) => {
            draft.debugForceFailNextUpload = event.value;
          }),
        ),
      },
      DEBUG_SET_FORCE_QUOTA: {
        actions: assign(({ context, event }) =>
          produce(context, (draft) => {
            draft.debugForceQuotaExhausted = event.value;
          }),
        ),
      },
      DEBUG_SET_FORCE_UPLOAD_LIMIT: {
        actions: assign(({ context, event }) =>
          produce(context, (draft) => {
            draft.debugForceUploadLimit = event.value;
          }),
        ),
      },
      DEBUG_CLEAR_ALL: {
        actions: assign(({ context }) =>
          produce(context, (draft) => {
            draft.debugForceFailNextUpload = false;
            draft.debugForceQuotaExhausted = false;
            draft.debugForceUploadLimit = false;
          }),
        ),
      },
    },
    states: {
      stopped: {
        on: { START: "starting" },
      },

      starting: {
        initial: "importingArchive",
        states: {
          importingArchive: {
            invoke: {
              src: "importArchive",
              onDone: {
                target: "discoveringQuota",
                actions: assign(({ context, event }) =>
                  produce(context, (draft) => {
                    draft.clipsImported = event.output;
                    draft.lastImportAt = new Date().toISOString();
                  }),
                ),
              },
              onError: "discoveringQuota",
            },
          },
          discoveringQuota: {
            invoke: {
              src: "discoverQuota",
              onDone: {
                target: "settling",
                actions: assign(({ context, event }) =>
                  produce(context, (draft) => {
                    if (event.output !== null) {
                      draft.quotaLimit = event.output;
                    }
                    draft.lastQuotaDiscoveryAt = new Date().toISOString();
                  }),
                ),
              },
              onError: "settling",
            },
          },
          settling: {
            always: [
              { guard: "isUserPaused", target: "#sync.active.blocked.userPaused" },
              { guard: "isAuthenticated", target: "#sync.active" },
              { target: "#sync.active.blocked.awaitingAuth" },
            ],
          },
        },
      },

      active: {
        initial: "deciding",
        invoke: [{ src: "archiveTimer" }, { src: "quotaTimer" }],
        on: {
          PAUSE: {
            target: ".blocked.userPaused",
            actions: assign(({ context }) =>
              produce(context, (draft) => {
                draft.userPaused = true;
              }),
            ),
          },
          AUTH_LOST: ".blocked.awaitingAuth",
          ARCHIVE_TICK: ".reimporting",
          QUOTA_TICK: ".rediscovering",
          IMPORT_NOW: ".reimporting",
          DISCOVER_NOW: ".rediscovering",
          CLIPS_CHANGED: ".deciding",
          QUOTA_RESET: ".deciding",
          /**
           * Force-upload from anywhere in `active.*` (cooldown, quotaExhausted,
           * awaitingAuth, userPaused, etc.). Skips `selectNextClip` by setting
           * the clipId directly. Bypasses canUpload because we target `uploading`
           * directly rather than going through `deciding`'s guards. After the
           * upload concludes, the UPLOAD_COMPLETE / UPLOAD_FAILED handlers route
           * back via cooldown (or back to userPaused if the user paused
           * separately — see the isUserPaused guard).
           */
          TRIGGER_CLIP: {
            target: ".uploading",
            actions: assign(({ context, event }) =>
              produce(context, (draft) => {
                draft.clipId = event.clipId;
                draft.clipTitle = event.clipId;
                draft.uploadStartedAt = new Date().toISOString();
                draft.bytesTransferred = 0;
                draft.totalBytes = null;
              }),
            ),
          },
        },
        states: {
          blocked: {
            initial: "awaitingAuth",
            states: {
              awaitingAuth: {
                on: { AUTH_COMPLETE: "#sync.active.rediscovering" },
              },
              userPaused: {
                on: {
                  RESUME: {
                    target: "#sync.active.deciding",
                    actions: assign(({ context }) =>
                      produce(context, (draft) => {
                        draft.userPaused = false;
                      }),
                    ),
                  },
                  // TRIGGER_CLIP is handled at the active-state level — it
                  // applies to every active.* substate including this one.
                },
              },
            },
          },

          deciding: {
            entry: assign(({ context }) =>
              produce(context, (draft) => {
                draft.waitResumeAt = null;
                draft.lastError = null;
              }),
            ),
            always: [
              { guard: "isUserPaused", target: "blocked.userPaused" },
              { guard: "notAuthenticated", target: "blocked.awaitingAuth" },
              { guard: "cantUpload", target: "waiting.quotaExhausted" },
            ],
            invoke: {
              src: "selectNextClip",
              onDone: [
                {
                  guard: ({ event }) => event.output === null,
                  target: "waiting.noClips",
                },
                {
                  target: "uploading",
                  actions: [
                    // Update context with selected clip
                    assign(({ context, event }) =>
                      produce(context, (draft) => {
                        const clip = event.output;
                        if (clip && typeof clip === "object" && "clipId" in clip) {
                          draft.clipId = clip.clipId;
                          draft.clipTitle = clip.clipTitle;
                        }
                        draft.uploadStartedAt = new Date().toISOString();
                        draft.bytesTransferred = 0;
                        draft.totalBytes = null;
                      }),
                    ),
                    // Side effect: mark clip as uploading in DB
                    ({ context }) => {
                      if (context.clipId) {
                        deps.onClipUploading(context.clipId);
                      }
                    },
                  ],
                },
              ],
              onError: {
                target: "waiting.error",
                actions: assign(({ context, event }) =>
                  produce(context, (draft) => {
                    draft.lastError = String(event.error);
                  }),
                ),
              },
            },
          },

          uploading: {
            invoke: {
              src: "performUpload",
              input: ({ context }) => ({ clipId: context.clipId ?? "" }),
            },
            on: {
              // Override parent PAUSE: don't interrupt the upload, just set the flag.
              // The upload finishes naturally, then we check userPaused on completion.
              PAUSE: {
                actions: assign(({ context }) =>
                  produce(context, (draft) => {
                    draft.userPaused = true;
                  }),
                ),
              },
              UPLOAD_PROGRESS: {
                actions: assign(({ context, event }) =>
                  produce(context, (draft) => {
                    draft.bytesTransferred = event.bytesTransferred;
                    draft.totalBytes = event.totalBytes;
                  }),
                ),
              },
              UPLOAD_COMPLETE: [
                {
                  guard: "isUserPaused",
                  target: "blocked.userPaused",
                  actions: [
                    ({ context, event }) => {
                      if (context.clipId) {
                        deps.onClipUploaded(context.clipId, event.youtubeId);
                      }
                      deps.onQuotaRecorded();
                    },
                    assign(({ context }) => produce(context, clearUpload)),
                  ],
                },
                {
                  target: "waiting.cooldown",
                  actions: [
                    ({ context, event }) => {
                      if (context.clipId) {
                        deps.onClipUploaded(context.clipId, event.youtubeId);
                      }
                      deps.onQuotaRecorded();
                    },
                    assign(({ context }) => produce(context, clearUpload)),
                  ],
                },
              ],
              UPLOAD_FAILED: [
                {
                  guard: "isQuotaError",
                  target: "waiting.quotaExhausted",
                  actions: [
                    () => {
                      deps.onQuotaLimitExceeded();
                    },
                    assign(({ context, event }) =>
                      produce(context, (draft) => {
                        draft.lastError = event.error;
                        clearUpload(draft);
                      }),
                    ),
                  ],
                },
                {
                  guard: "isUploadLimitError",
                  target: "waiting.uploadLimit",
                  actions: [
                    () => {
                      deps.onQuotaLimitExceeded();
                    },
                    assign(({ context, event }) =>
                      produce(context, (draft) => {
                        draft.lastError = event.error;
                        clearUpload(draft);
                      }),
                    ),
                  ],
                },
                {
                  guard: "isAuthError",
                  target: "blocked.awaitingAuth",
                  actions: assign(({ context, event }) =>
                    produce(context, (draft) => {
                      draft.lastError = event.error;
                      clearUpload(draft);
                    }),
                  ),
                },
                {
                  // All other errors
                  target: "waiting.error",
                  actions: [
                    ({ context, event }) => {
                      if (context.clipId) {
                        deps.onClipFailed(context.clipId, event.error, event.code);
                      }
                    },
                    assign(({ context, event }) =>
                      produce(context, (draft) => {
                        draft.lastError = event.error;
                        clearUpload(draft);
                      }),
                    ),
                  ],
                },
              ],
            },
          },

          reimporting: {
            invoke: {
              src: "importArchive",
              onDone: {
                target: "deciding",
                actions: assign(({ context, event }) =>
                  produce(context, (draft) => {
                    draft.clipsImported = event.output;
                    draft.lastImportAt = new Date().toISOString();
                  }),
                ),
              },
              onError: "deciding",
            },
          },

          rediscovering: {
            invoke: {
              src: "discoverQuota",
              onDone: {
                target: "deciding",
                actions: assign(({ context, event }) =>
                  produce(context, (draft) => {
                    if (event.output !== null) {
                      draft.quotaLimit = event.output;
                    }
                    draft.lastQuotaDiscoveryAt = new Date().toISOString();
                  }),
                ),
              },
              onError: "deciding",
            },
          },

          waiting: {
            initial: "cooldown",
            states: {
              // Each substate sets context.waitResumeAt to the wall-clock time
              // at which its `after` will fire, so the UI can render a real
              // countdown across every wait state (was always null pre-3.3).
              // Entry also clears `forceNextUpload` so a probe/trigger that
              // ended in a wait doesn't leave the flag stuck.
              quotaExhausted: {
                entry: assign(({ context }) =>
                  produce(context, (draft) => {
                    const ms = Math.min(deps.quotaProbeIntervalMs, deps.msUntilQuotaReset());
                    draft.waitResumeAt = new Date(Date.now() + ms).toISOString();
                    draft.forceNextUpload = false;
                  }),
                ),
                after: { quotaProbe: "#sync.active.waiting.quotaProbing" },
              },
              /**
               * Active probe: set forceNextUpload=true and re-enter the
               * decision flow. The next upload bypasses canUpload, asks YouTube
               * directly, and either succeeds (machine resumes normally) or
               * fails with QUOTA_EXCEEDED and lands back in quotaExhausted for
               * another probe interval.
               *
               * Per-job concern: only one probe runs at a time because the
               * machine has only one `deciding`→`uploading` path.
               */
              quotaProbing: {
                entry: assign(({ context }) =>
                  produce(context, (draft) => {
                    draft.waitResumeAt = null;
                    draft.forceNextUpload = true;
                  }),
                ),
                always: "#sync.active.deciding",
              },
              uploadLimit: {
                entry: assign(({ context }) =>
                  produce(context, (draft) => {
                    draft.waitResumeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                    draft.forceNextUpload = false;
                  }),
                ),
                after: { uploadLimitRetry: "#sync.active.deciding" },
              },
              cooldown: {
                entry: assign(({ context }) =>
                  produce(context, (draft) => {
                    draft.waitResumeAt = new Date(Date.now() + deps.uploadIntervalMs).toISOString();
                    draft.forceNextUpload = false;
                  }),
                ),
                after: { uploadCooldown: "#sync.active.deciding" },
              },
              noClips: {
                entry: assign(({ context }) =>
                  produce(context, (draft) => {
                    draft.waitResumeAt = new Date(Date.now() + 30_000).toISOString();
                    draft.forceNextUpload = false;
                  }),
                ),
                after: { noClipsRetry: "#sync.active.deciding" },
              },
              error: {
                entry: assign(({ context }) =>
                  produce(context, (draft) => {
                    draft.waitResumeAt = new Date(Date.now() + 60_000).toISOString();
                    draft.forceNextUpload = false;
                  }),
                ),
                after: { errorRetry: "#sync.active.deciding" },
              },
            },
          },
        },
      },
    },
  });
}

export type SyncMachine = ReturnType<typeof createSyncMachine>;
