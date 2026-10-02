import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ActivityPage } from "./ActivityPage";
import { taskProgress } from "./taskProgress";
import type { Thought } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("starts with three recent finishes, expands the remaining history, and hides it again", async () => {
  const now = new Date(2026, 8, 17, 15);
  const thought: Thought = {
    id: "list", body: "Tasks", kind: "checklist", archived: false, source: "mac-library", tags: [], createdAt: now.toISOString(),
    checklistItems: Array.from({ length: 5 }, (_, index) => ({ id: String(index), text: `Task ${index}`, completed: true, reminder: null })),
    taskCompletions: Array.from({ length: 5 }, (_, index) => ({ itemId: String(index), completedAt: new Date(2026, 8, 17, 9 + index).toISOString() })),
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ActivityPage progress={taskProgress([thought], now)} returnLabel="All thoughts" onBack={vi.fn()} onCapture={vi.fn()} error={null} onRetry={vi.fn()} />));
    const toggle = container.querySelector<HTMLButtonElement>(".activity-page__more")!;
    const tasks = () => Array.from(container.querySelectorAll(".activity-page__task"), (element) => element.textContent);
    expect(tasks()).toEqual(["Task 4", "Task 3", "Task 2"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".task-activity__chart")).toBeNull();
    await act(async () => toggle.click());
    expect(tasks()).toEqual(["Task 4", "Task 3", "Task 2", "Task 1", "Task 0"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".task-activity__chart li")).toHaveLength(7);
    await act(async () => toggle.click());
    expect(tasks()).toHaveLength(3);
    expect(container.querySelector(".task-activity__chart")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
