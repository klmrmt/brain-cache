import { localDayKey } from "./domain";
import type { ChecklistItem, TaskCompletion, Thought } from "./types";

type ChecklistHistory = Pick<Thought, "checklistItems" | "taskCompletions">;

export function completionHistory(thought: ChecklistHistory): TaskCompletion[] {
  // Existing checked items count toward the total without inventing completion dates.
  return thought.taskCompletions ?? thought.checklistItems
    .filter((item) => item.completed && item.text.trim())
    .map((item) => ({ itemId: item.id, completedAt: null }));
}

export function updateCompletionHistory(
  thought: ChecklistHistory,
  items: readonly ChecklistItem[],
  completedAt = new Date().toISOString(),
): TaskCompletion[] {
  const history = new Map(completionHistory(thought).map((entry) => [entry.itemId, entry]));
  for (const item of items) {
    if (!item.completed) history.delete(item.id);
    else if (!history.has(item.id)) history.set(item.id, { itemId: item.id, completedAt });
  }
  // Deleted completed items remain part of the history; edits never create another completion.
  return [...history.values()].sort((left, right) => left.itemId.localeCompare(right.itemId));
}

export function taskProgress(thoughts: readonly Thought[], now = new Date()) {
  const counts = new Map<string, number>();
  const todayKey = localDayKey(now);
  const todayCompletions: Array<{ thoughtId: string; itemId: string; text: string; completedAt: string }> = [];
  let total = 0;
  let undated = 0;
  for (const thought of thoughts) {
    if (thought.kind !== "checklist" && !thought.taskCompletions?.length) continue;
    const entries = new Map(completionHistory(thought).map((entry) => [entry.itemId, entry]));
    const itemTexts = new Map(thought.checklistItems.map((item) => [item.id, item.text.trim()]));
    for (const entry of entries.values()) {
      total += 1;
      const date = entry.completedAt ? new Date(entry.completedAt) : null;
      if (!date || Number.isNaN(date.getTime())) { undated += 1; continue; }
      if (date.getTime() > now.getTime()) continue;
      const day = localDayKey(date);
      counts.set(day, (counts.get(day) ?? 0) + 1);
      if (day === todayKey) todayCompletions.push({
        thoughtId: thought.id,
        itemId: entry.itemId,
        text: itemTexts.get(entry.itemId) || "Completed task",
        completedAt: date.toISOString(),
      });
    }
  }
  const dateAt = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = dateAt(index - 6);
    const key = localDayKey(date);
    return { key, date, count: counts.get(key) ?? 0 };
  });
  const today = days[6].count;
  let offset = today > 0 ? 0 : -1;
  let streak = 0;
  while ((counts.get(localDayKey(dateAt(offset))) ?? 0) > 0) { streak += 1; offset -= 1; }
  const milestones = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
  const nextMilestone = milestones.find((value) => value > total) ?? (Math.floor(total / 1000) + 1) * 1000;
  const milestone = total >= 1000 ? Math.floor(total / 1000) * 1000
    : [...milestones].reverse().find((value) => value <= total) ?? 0;
  todayCompletions.sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  return { total, undated, today, todayCompletions, week: days.reduce((sum, day) => sum + day.count, 0), streak, days, nextMilestone, milestone };
}
