import type { ChecklistItem } from "./types";

export function ChecklistProgress({
  items,
  newItem = "",
}: {
  items: readonly ChecklistItem[];
  newItem?: string;
}) {
  const nonemptyItems = items.filter((item) => item.text.trim());
  const total = nonemptyItems.length + (newItem.trim() ? 1 : 0);
  const completed = nonemptyItems.filter((item) => item.completed).length;
  return (
    <span className="checklist-progress">
      <progress
        aria-label="Checklist progress"
        aria-valuetext={`${completed} of ${total} items complete`}
        value={completed}
        max={Math.max(total, 1)}
      />
      <span aria-hidden="true">{completed}/{total}</span>
    </span>
  );
}
