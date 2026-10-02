import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoteReminder } from "./NoteReminder";
import type { ChecklistReminder } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
const reminder: ChecklistReminder = { scheduledFor: "2099-09-10T15:00:00Z", state: "scheduled", lastError: null };
const onSet = vi.fn<(_: string) => Promise<void>>();
const onClear = vi.fn<() => Promise<void>>();
const onOpenSettings = vi.fn<() => Promise<void>>();
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const popover = () => document.querySelector<HTMLDivElement>(".note-reminder__popover");
const byText = (text: string) => [...popover()!.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
const click = async (element: HTMLElement) => act(async () => element.click());
async function render(value: ChecklistReminder | null = reminder, compact = true) {
  await act(async () => root.render(<NoteReminder compact={compact} reminder={value} onSet={onSet} onClear={onClear} onOpenSettings={onOpenSettings} />));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSet.mockReset().mockResolvedValue(undefined);
  onClear.mockReset().mockResolvedValue(undefined);
  onOpenSettings.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it("shows the schedule in a compact pill and returns keyboard focus after Escape", async () => {
  await render();
  const trigger = button("Edit note reminder");
  expect(trigger.textContent).toContain("Sep 10");
  expect(popover()).toBeNull();
  await click(trigger);
  const input = popover()!.querySelector("input")!;
  expect(document.activeElement).toBe(input);
  const cancel = byText("cancel");
  const save = byText("update reminder");
  await act(async () => {
    save.focus();
    save.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  });
  expect(document.activeElement).toBe(input);
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  });
  expect(document.activeElement).toBe(save);
  await act(async () => cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => vi.advanceTimersByTime(20));
  expect(popover()).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("dismisses outside without stealing focus from the clicked control", async () => {
  await render();
  const outside = document.createElement("button");
  container.append(outside);
  await click(button("Edit note reminder"));
  await act(async () => {
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    outside.focus();
  });
  await act(async () => vi.advanceTimersByTime(20));
  expect(popover()).toBeNull();
  expect(document.activeElement).toBe(outside);
});

it("keeps failed saves and attempted values retryable after dismissing", async () => {
  onSet.mockRejectedValueOnce(new Error("Disk is full"));
  await render(null);
  await click(button("Set note reminder"));
  const attempted = popover()!.querySelector("input")!.value;
  await click(byText("set reminder"));
  expect(popover()!.textContent).toContain("Disk is full");
  await click(byText("cancel"));
  expect(button("Set note reminder").textContent).toContain("needs attention");
  await click(button("Set note reminder"));
  expect(popover()!.querySelector("input")!.value).toBe(attempted);
  expect(popover()!.querySelector('[role="alert"]')!.textContent).toBe("Disk is full");
  await click(byText("set reminder"));
  expect(onSet).toHaveBeenCalledTimes(2);
  expect(onSet.mock.calls[0][0]).toBe(onSet.mock.calls[1][0]);
  expect(popover()).toBeNull();
});

it("keeps pending actions visible and prevents outside dismissal until settled", async () => {
  let reject!: (error: Error) => void;
  onClear.mockReturnValue(new Promise((_, rejectPromise) => { reject = rejectPromise; }));
  await render();
  const outside = document.createElement("button");
  const outsideClick = vi.fn();
  outside.onclick = outsideClick;
  container.append(outside);
  await click(button("Edit note reminder"));
  await click(button("Clear note reminder"));
  await act(async () => {
    popover()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    outside.click();
  });
  expect(popover()).not.toBeNull();
  expect(outsideClick).not.toHaveBeenCalled();
  expect(byText("saving…").disabled).toBe(true);
  await act(async () => reject(new Error("Could not clear reminder")));
  expect(popover()!.textContent).toContain("Could not clear reminder");
  expect(button("Clear note reminder").disabled).toBe(false);
});

it("exposes notification settings failure and scheduling retry in the popover", async () => {
  onOpenSettings.mockRejectedValueOnce(new Error("Settings unavailable"));
  await render({ ...reminder, state: "permission-denied" });
  expect(button("Edit note reminder").textContent).toContain("notifications off");
  await click(button("Edit note reminder"));
  await click(byText("open settings"));
  expect(popover()!.textContent).toContain("Settings unavailable");
  await click(byText("open settings"));
  expect(popover()!.querySelector('[role="alert"]')).toBeNull();
  await render({ ...reminder, state: "scheduling-failed", lastError: "macOS unavailable" });
  expect(popover()!.textContent).toContain("macOS unavailable");
  await click(byText("retry"));
  expect(onSet).toHaveBeenCalledWith(new Date(reminder.scheduledFor).toISOString());
});

it("retains the full reminder layout when compact is omitted", async () => {
  await render({ ...reminder, state: "permission-denied" }, false);
  expect(container.querySelector(".note-reminder")).not.toBeNull();
  expect(container.textContent).toContain("notifications off");
  expect(container.textContent).toContain("open settings");
  expect(button("Clear note reminder")).not.toBeNull();
  await click(button("Edit note reminder"));
  expect(container.querySelector('input[aria-label="Note reminder date and time"]')).not.toBeNull();
  expect(popover()).toBeNull();
});
