import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { z } from "zod/v4";

import { RootLayout } from "#web/components/RootLayout.js";
import { Activity } from "#web/pages/Activity.js";
import { ClipDetail } from "#web/pages/ClipDetail.js";
import { Dashboard } from "#web/pages/Dashboard.js";
import { Diagnostics } from "#web/pages/Diagnostics.js";
import { Queue } from "#web/pages/Queue.js";

const SortBySchema = z.enum(["created_at", "title", "sync_status", "retry_count"]);
const SortOrderSchema = z.enum(["asc", "desc"]);
const LogTypeSchema = z.enum(["state_change", "upload", "error"]);
const TimeRangeSchema = z.enum(["all", "1h", "24h", "7d"]);
const ClipStatusSchema = z.enum([
  "pending",
  "uploading",
  "uploaded",
  "failed",
  "skipped",
  "ignored",
]);

/**
 * Search-param shape for `/queue`. Defaults match the user's "everything visible,
 * oldest first" expectation.
 */
const queueSearchSchema = z.object({
  page: z.number().int().min(1).default(1),
  search: z.string().default(""),
  status: z.array(ClipStatusSchema).optional(),
  sortBy: SortBySchema.default("created_at"),
  sortOrder: SortOrderSchema.default("asc"),
});

export type QueueSearch = z.infer<typeof queueSearchSchema>;

const activitySearchSchema = z.object({
  clipId: z.string().default(""),
  type: z.array(LogTypeSchema).optional(),
  errorCode: z.string().default(""),
  range: TimeRangeSchema.default("all"),
});

export type ActivitySearch = z.infer<typeof activitySearchSchema>;

/**
 * Derived defaults for nav-bar `<Link>` clicks. TanStack Router's `<Link>` to a
 * route with required search params needs a fully-populated search object —
 * passing `{}` errors at compile time because Zod's `.default()` makes the
 * parsed-output fields non-optional. Deriving from the schema means we have
 * one source of truth.
 */
export const queueDefaults: QueueSearch = queueSearchSchema.parse({});
export const activityDefaults: ActivitySearch = activitySearchSchema.parse({});

/**
 * Wrap a Zod schema so a malformed URL (e.g. `?page=abc`) falls back to the
 * schema's defaults rather than failing the route load. The plain `.parse`
 * path throws; TanStack Router treats that as a navigation failure, which is
 * not what we want — we'd rather show the page with sane defaults and let
 * the user re-filter.
 */
function lenient<S extends z.ZodType>(schema: S) {
  return (input: unknown): z.infer<S> => {
    const result = schema.safeParse(input);
    return result.success ? result.data : schema.parse({});
  };
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

const queueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/queue",
  validateSearch: lenient(queueSearchSchema),
  component: Queue,
});

const clipDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clips/$clipId",
  component: ClipDetail,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  validateSearch: lenient(activitySearchSchema),
  component: Activity,
});

const diagnosticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/diagnostics",
  component: Diagnostics,
});

// Legacy-path redirects keep old bookmarks working after the IA restructure.
function redirectRoute(from: string, to: "/queue" | "/activity" | "/diagnostics") {
  return createRoute({
    getParentRoute: () => rootRoute,
    path: from,
    beforeLoad: () => {
      throw redirect({ to });
    },
    component: () => null,
  });
}

const clipsLegacyRoute = redirectRoute("/clips", "/queue");
const logsLegacyRoute = redirectRoute("/logs", "/activity");
const debugLegacyRoute = redirectRoute("/debug", "/diagnostics");

const routeTree = rootRoute.addChildren([
  indexRoute,
  queueRoute,
  clipDetailRoute,
  activityRoute,
  diagnosticsRoute,
  clipsLegacyRoute,
  logsLegacyRoute,
  debugLegacyRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// TanStack Router type-augmentation: makes Link / useNavigate / useSearch
// inference work without the caller specifying `<typeof router>` each time.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Re-export typed route handles so consumers can write
// `useSearch({ from: queueRoutePath })` without stringly-typed paths.
export const routePaths = {
  index: indexRoute.fullPath,
  queue: queueRoute.fullPath,
  clipDetail: clipDetailRoute.fullPath,
  activity: activityRoute.fullPath,
  diagnostics: diagnosticsRoute.fullPath,
} as const;
