import { describe, expect, it } from "vitest";
import { taskProgress, updateCompletionHistory } from "./taskProgress";
import type { Thought } from "./types";

const thought: Thought = {
  id: "list", body: "Task", kind: "checklist", createdAt: "2026-09-01T12:00:00Z",
  archived: false, source: "mac-library", tags: [],
  checklistItems: [{ id: "one", text: "Task", completed: true, reminder: null }],
};

describe("task completion history", () => {
  it("counts older checked items without inventing dates", () => {
    const stats = taskProgress([thought]);
    expect(stats).toMatchObject({ total: 1, undated: 1, today: 0, week: 0, streak: 0 });
    expect(updateCompletionHistory(thought, [{ ...thought.checklistItems[0], text: "Renamed" }]))
      .toEqual([{ itemId: "one", completedAt: null }]);
  });

  it("preserves history through edits and deletion, reverses undo, and dates rechecking once", () => {
    const now = "2026-09-06T12:00:00Z";
    const checked = updateCompletionHistory({ ...thought, taskCompletions: [] }, thought.checklistItems, now);
    expect(checked).toEqual([{ itemId: "one", completedAt: now }]);
    expect(updateCompletionHistory({ ...thought, taskCompletions: checked }, [])).toEqual(checked);
    expect(updateCompletionHistory({ ...thought, taskCompletions: checked }, thought.checklistItems)).toEqual(checked);
    const undone = updateCompletionHistory({ ...thought, taskCompletions: checked }, [{ ...thought.checklistItems[0], completed: false }]);
    expect(undone).toEqual([]);
    expect(updateCompletionHistory({ ...thought, taskCompletions: undone }, thought.checklistItems, now)).toEqual(checked);
  });

  it("uses local calendar days and includes archived and removed tasks", () => {
    const now = new Date(2026, 8, 6, 12);
    const dateAt = (offset: number) => new Date(2026, 8, 6 + offset, 11).toISOString();
    const history = [0, 0, -1, -2, -6, -7].map((offset, index) => ({ itemId: String(index), completedAt: dateAt(offset) }));
    const stats = taskProgress([{ ...thought, archived: true, checklistItems: [], taskCompletions: history }], now);
    expect(stats).toMatchObject({ total: 6, today: 2, week: 5, streak: 3, milestone: 5, nextMilestone: 10 });
    expect(stats.days.map((day) => day.count)).toEqual([1, 0, 0, 0, 1, 1, 2]);
    expect(taskProgress([{ ...thought, taskCompletions: history }], new Date(2026, 8, 7, 0, 1)))
      .toMatchObject({ today: 0, streak: 3, week: 4 });
    expect(taskProgress([{ ...thought, taskCompletions: history }], new Date(2026, 8, 8, 0, 1)).streak).toBe(0);
  });

  it("handles a DST week, empty data, invalid dates, and milestone boundaries", () => {
    const now = new Date(2026, 2, 10, 12);
    const history = [0, -1, -2].map((offset, index) => ({ itemId: String(index), completedAt: new Date(2026, 2, 10 + offset, 1).toISOString() }));
    expect(taskProgress([{ ...thought, taskCompletions: history }], now).streak).toBe(3);
    expect(taskProgress([])).toMatchObject({ total: 0, today: 0, week: 0, streak: 0, milestone: 0, nextMilestone: 1 });
    expect(taskProgress([{ ...thought, taskCompletions: [{ itemId: "bad", completedAt: "invalid" }] }]))
      .toMatchObject({ total: 1, undated: 1, milestone: 1, nextMilestone: 5 });
  });

  it("shows today's saved completions newest first without inventing dates or deleted task text", () => {
    const now = new Date(2026, 8, 17, 14);
    const early = new Date(2026, 8, 17, 8).toISOString();
    const late = new Date(2026, 8, 17, 12).toISOString();
    const history = [
      { itemId: "one", completedAt: early },
      { itemId: "removed", completedAt: late },
      { itemId: "removed", completedAt: late },
      { itemId: "earlier", completedAt: new Date(2026, 8, 16, 18).toISOString() },
      { itemId: "future", completedAt: new Date(2026, 8, 17, 15).toISOString() },
      { itemId: "legacy", completedAt: null },
      { itemId: "invalid", completedAt: "invalid" },
    ];
    const stats = taskProgress([{ ...thought, archived: true, taskCompletions: history }], now);
    expect(stats.today).toBe(2);
    expect(stats.todayCompletions).toEqual([
      { thoughtId: "list", itemId: "removed", text: "Completed task", completedAt: late },
      { thoughtId: "list", itemId: "one", text: "Task", completedAt: early },
    ]);
    expect(taskProgress([{ ...thought, taskCompletions: history }], new Date(2026, 8, 18)).todayCompletions).toEqual([]);
  });
});
