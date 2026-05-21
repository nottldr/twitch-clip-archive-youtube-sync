import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors anywhere in the tree below it and shows a recovery
 * panel instead of white-screening. Has to be a class component — React still
 * has no hook equivalent for componentDidCatch. Place it just inside the
 * router so a bad page doesn't kill the nav (or wrap individual pages too if
 * you want finer granularity).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- intentionally surface render-time crashes during dev
    console.error("ErrorBoundary caught:", error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl rounded-lg border border-red-300 bg-red-50 p-6 text-sm shadow-sm dark:border-red-700 dark:bg-red-900/30">
          <h2 className="font-semibold text-red-800 dark:text-red-100">Something went wrong</h2>
          <p className="mt-2 text-red-700 dark:text-red-200">
            A page-level error stopped this view from rendering. The rest of the app should still
            work — try going back, or reload.
          </p>
          <pre className="mt-3 max-h-48 overflow-auto rounded bg-white/60 p-3 font-mono text-xs text-red-900 dark:bg-black/30 dark:text-red-100">
            {this.state.error.name}: {this.state.error.message}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
              }}
              className="rounded border border-red-400 px-3 py-1 text-red-700 hover:bg-red-100 dark:border-red-600 dark:text-red-100 dark:hover:bg-red-900/60"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
              className="rounded border border-red-400 bg-red-500 px-3 py-1 font-medium text-white hover:bg-red-600"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
