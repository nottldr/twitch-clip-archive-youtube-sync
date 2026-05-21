import { useEffect, useRef } from "react";

interface Options {
  /** IDs of the currently-visible rows, in order. */
  rowIds: readonly string[];
  /** The currently-active row id (open in the drawer), or null. */
  activeId: string | null;
  /** Move the active row. Null clears focus. */
  onChange: (next: string | null) => void;
}

/**
 * `j` / `k` row navigation that follows the drawer. When the drawer is open,
 * `j` moves to the next row (cycling to start at the end) and `k` to the
 * previous (cycling to end at the start). `Escape` closes the drawer when
 * one is open. Skips when focus is inside an editable element so it doesn't
 * eat typing in the search input.
 *
 * Uses the ref-of-latest-state pattern so the window listener attaches once,
 * not on every re-render. (`rowIds` is a fresh array reference every render
 * because it's derived from `data?.clips.map(...)`, so naive deps would
 * thrash the listener.)
 */
export function useRowKeyboardNav({ rowIds, activeId, onChange }: Options) {
  const stateRef = useRef({ rowIds, activeId, onChange });
  stateRef.current = { rowIds, activeId, onChange };

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target;
      const inField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if (inField) return;

      const state = stateRef.current;
      if (state.rowIds.length === 0) return;

      if (e.key === "j" || e.key === "k") {
        if (!state.activeId) return;
        const idx = state.rowIds.indexOf(state.activeId);
        if (idx === -1) return;
        const len = state.rowIds.length;
        const nextIdx = e.key === "j" ? (idx + 1) % len : (idx - 1 + len) % len;
        e.preventDefault();
        state.onChange(state.rowIds[nextIdx]);
      } else if (e.key === "Escape" && state.activeId) {
        e.preventDefault();
        state.onChange(null);
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);
}
