import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TaskCompletionFeedback, useTaskProgress } from "./TaskActivity";
import { taskProgress } from "./taskProgress";
import type { Thought } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const thought: Thought = { id: "one", kind: "checklist", body: "Task", checklistItems: [], source: "mac-library", archived: false, tags: [], createdAt: "2026-09-06T12:00:00Z" };
afterEach(() => vi.useRealTimers());

it("refreshes local daily counts and streaks at midnight while the dashboard remains open", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 6, 23, 59, 59));
  const thoughts = [{ ...thought, taskCompletions: [{ itemId: "done", completedAt: new Date().toISOString() }] }];
  function Probe() { const progress = useTaskProgress(thoughts); return <span>{progress.today}/{progress.streak}</span>; }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe("1/1");
    await act(async () => vi.advanceTimersByTime(1100));
    expect(container.textContent).toBe("0/1");
    vi.setSystemTime(new Date(2026, 8, 9, 12));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toBe("0/0");
  } finally { await act(async () => root.unmount()); }
  expect(vi.getTimerCount()).toBe(0);
});

it("celebrates a saved milestone once, leaves edits quiet, expires feedback, and clears undo", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  const progress = (count: number) => taskProgress([{ ...thought, taskCompletions: Array.from({ length: count }, (_, index) => ({ itemId: String(index), completedAt: new Date().toISOString() })) }]);
  const render = async (count: number) => act(async () => root.render(<TaskCompletionFeedback progress={progress(count)} ready />));
  try {
    await render(4);
    expect(container.textContent).toBe("");
    await render(5);
    expect(container.textContent).toContain("5 tasks completed. Milestone reached!");
    await act(async () => vi.advanceTimersByTime(2000));
    await render(5);
    await act(async () => vi.advanceTimersByTime(1601));
    expect(container.textContent).toBe("");
    await render(6);
    expect(container.textContent).toContain("+1 task completed");
    await render(5);
    expect(container.textContent).toBe("");
  } finally { await act(async () => root.unmount()); }
});
