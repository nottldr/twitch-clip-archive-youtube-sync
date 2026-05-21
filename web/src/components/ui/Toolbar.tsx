import type { ReactNode } from "react";

interface Props {
  /** Left-aligned content: typically a search input or filter group. */
  start?: ReactNode;
  /** Right-aligned content: typically action buttons (Export, Copy links). */
  end?: ReactNode;
}

/**
 * Page-level action row. Sits beneath the PageHeader and above a table or
 * list. Designed for filter inputs on the left and action buttons on the
 * right; stacks vertically on narrow viewports.
 */
export function Toolbar({ start, end }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {start && <div className="flex flex-wrap items-center gap-2">{start}</div>}
      {end && <div className="flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}
