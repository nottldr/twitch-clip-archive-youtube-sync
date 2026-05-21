import { useCallback, useMemo, useState } from "react";

export interface RowSelection {
  selected: Set<string>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  setMany: (ids: readonly string[], next: boolean) => void;
  selectAllOnPage: (ids: readonly string[]) => void;
  clear: () => void;
  size: number;
}

/**
 * Page-scoped row-selection state for tables. The bulk action bar reads
 * `selected` to display count + drive mutations; the table reads `isSelected`
 * per row. Selection is intentionally ephemeral (not URL-synced) — moving
 * pages or changing filters should clear the user's mental context, not carry
 * a hidden selection across.
 */
export function useRowSelection(): RowSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: readonly string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAllOnPage = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        // Toggling when fully selected = deselect the page.
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  return useMemo(
    () => ({
      selected,
      isSelected: (id: string) => selected.has(id),
      toggle,
      setMany,
      selectAllOnPage,
      clear,
      size: selected.size,
    }),
    [selected, toggle, setMany, selectAllOnPage, clear],
  );
}
