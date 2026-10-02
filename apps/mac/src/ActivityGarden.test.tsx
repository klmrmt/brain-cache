import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ActivityGarden } from "./ActivityGarden";
import { taskProgress } from "./taskProgress";
import type { Thought } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("grows at milestones, reverses an unchecked completion, and keeps a mature garden beyond the final stage", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (total: number) => act(async () => root.render(<ActivityGarden total={total} />));
  try {
    await render(0);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Five seeds ready to grow");
    expect(container.textContent).toContain("One finish starts it");
    for (const [total, plants] of [[1, 1], [5, 2], [10, 3], [25, 5], [50, 5]] as const) {
      await render(total);
      expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(`${plants} ${plants === 1 ? "plant" : "plants"} growing`);
      expect(container.textContent).toContain(`${total} ${total === 1 ? "finish" : "finishes"}`);
    }
    await render(24);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("3 plants growing");
    for (const total of [100, 1001]) {
      await render(total);
      expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("5 plants in full bloom");
      expect(container.textContent).toContain(`${total.toLocaleString()} finishes`);
      expect(container.querySelector("progress")).toBeNull();
    }
  } finally { await act(async () => root.unmount()); }
});

it("keeps garden growth through days away, archived notes, and earlier undated completions", () => {
  const thought: Thought = {
    id: "garden", body: "Done", kind: "checklist", archived: true, source: "mac-library", tags: [],
    createdAt: "2026-09-01T12:00:00Z", checklistItems: [],
    taskCompletions: [{ itemId: "one", completedAt: "2026-09-01T12:00:00Z" }, { itemId: "two", completedAt: null }],
  };
  const before = taskProgress([thought], new Date("2026-09-01T18:00:00Z"));
  const later = taskProgress([thought], new Date("2026-10-01T18:00:00Z"));
  expect(before.total).toBe(2);
  expect(later.total).toBe(before.total);
  expect(later.streak).toBe(0);
});
