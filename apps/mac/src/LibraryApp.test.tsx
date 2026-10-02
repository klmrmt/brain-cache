import type { Editor } from "@tiptap/react";
import { projectRichDocument, richDocumentForThought, paragraph, richText, updateRichTasks, type RichDocument } from "./richDocument";
import { draftMetadata } from "./attachments";
import { act } from "react";
import { updateCompletionHistory } from "./taskProgress";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reminderIsoFromLocalValue } from "./ChecklistEditor";
import { LibraryApp } from "./LibraryApp";
import { addTag, removeTag } from "./domain";
import type { AttachmentDraft, ChecklistItem, Thought } from "./types";

const bridge = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  chooseAttachmentFiles: vi.fn(),
  readAttachmentData: vi.fn(),
  openAttachment: vi.fn(),
  addThoughtAttachments: vi.fn(),
  removeThoughtAttachment: vi.fn(),
  addThoughtTag: vi.fn(),
  clearChecklistReminder: vi.fn(),
  setThoughtReminder: vi.fn(),
  clearThoughtReminder: vi.fn(),
  getLaunchAtLogin: vi.fn(),
  getFontSize: vi.fn(),
  setFontSize: vi.fn(),
  listenForFontSize: vi.fn(),
  getLightMode: vi.fn(),
  setLightMode: vi.fn(),
  listenForLightMode: vi.fn(),
  getShortcutButtonVisible: vi.fn(),
  setShortcutButtonVisible: vi.fn(),
  listenForShortcutButtonVisibility: vi.fn(),
  listenForCreatedThought: vi.fn(),
  listenForReminderOpened: vi.fn(),
  listenForRemindersReconciled: vi.fn(),
  listTagDefinitions: vi.fn(),
  listThoughts: vi.fn(),
  openNotificationSettings: vi.fn(),
  removeThoughtTag: vi.fn(),
  replaceChecklistItems: vi.fn(),
  setChecklistReminder: vi.fn(),
  setLaunchAtLogin: vi.fn(),
  setThoughtArchived: vi.fn(),
  setThoughtCompleted: vi.fn(),
  setThoughtPinned: vi.fn(),
  setTagColor: vi.fn(),
  showCapture: vi.fn(),
  takePendingReminderTarget: vi.fn(),
  updateThoughtBody: vi.fn(),
  updateRichDocument: vi.fn(),
}));

vi.mock("./bridge", () => bridge);

describe("library tagging and retrieval", () => {
  let container: HTMLDivElement;
  let root: Root;
  let records: Map<string, Thought>;
  let reminderOpened: ((target: { thoughtId: string; itemId: string | null }) => void) | undefined;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.fontSize = "default";
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 20);
    Range.prototype.getClientRects = () => [new DOMRect(0, 0, 10, 20)] as unknown as DOMRectList;
    HTMLElement.prototype.scrollIntoView = () => undefined;
    window.scrollBy = () => undefined;

    bridge.isTauriRuntime.mockReset().mockReturnValue(false);
    bridge.chooseAttachmentFiles.mockReset();
    bridge.addThoughtAttachments.mockReset();
    bridge.removeThoughtAttachment.mockReset();
    bridge.readAttachmentData.mockReset().mockResolvedValue(btoa("image"));
    bridge.openAttachment.mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T18:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const now = "2026-09-01T15:00:00.000Z";
    const fixtures: Thought[] = [
      {
        id: "work",
        body: "Alpha work thought",
        createdAt: now,
        archived: false,
        source: "mac-capture",
        tags: ["work"],
        kind: "text",
        checklistItems: [],
      },
      {
        id: "design",
        body: "Alpha design thought",
        createdAt: now,
        archived: false,
        source: "mac-library",
        tags: ["design"],
        kind: "text",
        checklistItems: [],
      },
      {
        id: "archived",
        body: "Alpha archived work",
        createdAt: now,
        archived: true,
        source: "mac-library",
        tags: ["work"],
        kind: "text",
        checklistItems: [],
      },
      {
        id: "checklist",
        body: "Buy milk\nCall Sam\nShip build\nReview notes",
        createdAt: "2026-08-29T15:00:00.000Z",
        archived: false,
        source: "mac-capture",
        tags: [],
        kind: "checklist",
        checklistItems: [
          { id: "item-one", text: "Buy milk", completed: false, reminder: null },
          { id: "item-two", text: "Call Sam", completed: true, reminder: null },
          { id: "item-three", text: "Ship build", completed: false, reminder: null },
          { id: "item-four", text: "Review notes", completed: false, reminder: null },
        ],
      },
    ];
    records = new Map(fixtures.map((thought) => [thought.id, thought]));
    bridge.listThoughts.mockReset().mockResolvedValue(fixtures);
    bridge.listTagDefinitions.mockReset().mockResolvedValue([
      { name: "design", color: "plum" },
      { name: "work", color: "moss" },
    ]);
    bridge.getLaunchAtLogin.mockReset().mockResolvedValue(false);
    bridge.getFontSize.mockReset().mockResolvedValue("default");
    bridge.setFontSize.mockReset().mockImplementation(async (size: string) => size);
    bridge.listenForFontSize.mockReset().mockResolvedValue(() => undefined);
    bridge.getLightMode.mockReset().mockResolvedValue(false);
    bridge.setLightMode.mockReset().mockImplementation(async (enabled: boolean) => enabled);
    bridge.listenForLightMode.mockReset().mockResolvedValue(() => undefined);
    bridge.getShortcutButtonVisible.mockReset().mockResolvedValue(true);
    bridge.setShortcutButtonVisible.mockReset().mockImplementation(async (visible: boolean) => visible);
    bridge.listenForShortcutButtonVisibility.mockReset().mockResolvedValue(() => undefined);
    bridge.listenForCreatedThought.mockReset().mockResolvedValue(() => undefined);
    reminderOpened = undefined;
    bridge.listenForReminderOpened.mockReset().mockImplementation(
      async (callback: (target: { thoughtId: string; itemId: string | null }) => void) => {
        reminderOpened = callback;
        return () => undefined;
      },
    );
    bridge.listenForRemindersReconciled.mockReset().mockResolvedValue(() => undefined);
    bridge.takePendingReminderTarget.mockReset().mockResolvedValue(null);
    bridge.openNotificationSettings.mockReset().mockResolvedValue(undefined);
    bridge.setLaunchAtLogin.mockReset().mockResolvedValue(undefined);
    bridge.showCapture.mockReset().mockResolvedValue(undefined);
    bridge.setThoughtArchived.mockReset().mockImplementation(async (id: string, archived: boolean) => {
      const thought = records.get(id)!;
      const updated = { ...thought, archived, reminder: archived ? null : thought.reminder };
      records.set(id, updated);
      return updated;
    });
    bridge.setThoughtCompleted.mockReset().mockImplementation(async (id: string, completed: boolean) => {
      const thought = records.get(id)!;
      const checklistItems = completed ? thought.checklistItems.map((item) => ({ ...item, completed: true, reminder: null })) : thought.checklistItems;
      const updated = { ...thought, completed, checklistItems, richDocument: thought.richDocument ? updateRichTasks(thought.richDocument, checklistItems) : undefined, reminder: completed ? null : thought.reminder,
        taskCompletions: updateCompletionHistory(thought, checklistItems) };
      records.set(id, updated);
      return updated;
    });
    bridge.updateRichDocument.mockReset().mockImplementation(saveRich);
    bridge.setThoughtPinned.mockReset().mockImplementation(async (id: string, pinned: boolean) => {
      const updated = { ...records.get(id)!, pinned };
      records.set(id, updated);
      return updated;
    });
    bridge.setTagColor.mockReset().mockImplementation(async (name: string, color: string | null) => ({
      name,
      color,
    }));
    bridge.addThoughtTag.mockReset().mockImplementation(async (id: string, tag: string) => {
      const thought = records.get(id)!;
      const updated = { ...thought, tags: addTag(thought.tags, tag) };
      records.set(id, updated);
      return updated;
    });
    bridge.removeThoughtTag.mockReset().mockImplementation(async (id: string, tag: string) => {
      const thought = records.get(id)!;
      const updated = { ...thought, tags: removeTag(thought.tags, tag) };
      records.set(id, updated);
      return updated;
    });
    bridge.replaceChecklistItems
      .mockReset()
      .mockImplementation(async (id: string, items: ChecklistItem[]) => {
      const thought = records.get(id)!;
      const updated = {
        ...thought,
        body: items.map((item) => item.text.trim()).join("\n"),
        taskCompletions: updateCompletionHistory(thought, items),
        checklistItems: items.map((item) => ({
          ...item,
          text: item.text.trim(),
        })),
      };
      records.set(id, updated);
      return updated;
      });
    bridge.setThoughtReminder.mockReset().mockImplementation(async (thoughtId: string, scheduledFor: string) => {
      const updated: Thought = { ...records.get(thoughtId)!, reminder: { scheduledFor, state: "scheduled", lastError: null } };
      records.set(thoughtId, updated);
      return updated;
    });
    bridge.clearThoughtReminder.mockReset().mockImplementation(async (thoughtId: string) => {
      const updated = { ...records.get(thoughtId)!, reminder: null };
      records.set(thoughtId, updated);
      return updated;
    });
    bridge.setChecklistReminder.mockReset().mockImplementation(
      async (thoughtId: string, itemId: string, scheduledFor: string) => {
        const thought = records.get(thoughtId)!;
        const updated = {
          ...thought,
          checklistItems: thought.checklistItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  reminder: { scheduledFor, state: "scheduled" as const, lastError: null },
                }
              : item,
          ),
        };
        records.set(thoughtId, updated);
        return updated;
      },
    );
    bridge.clearChecklistReminder.mockReset().mockImplementation(
      async (thoughtId: string, itemId: string) => {
        const thought = records.get(thoughtId)!;
        const updated = {
          ...thought,
          checklistItems: thought.checklistItems.map((item) =>
            item.id === itemId ? { ...item, reminder: null } : item,
          ),
        };
        records.set(thoughtId, updated);
        return updated;
      },
    );


    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<LibraryApp />);
      await Promise.resolve();
    });
    await flush();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete document.documentElement.dataset.theme;
    vi.useRealTimers();
  });

  it("completes a note only after persistence, moves it to Completed, and reopens it", async () => {
    const original = records.get("work")!;
    let finish!: (thought: Thought) => void;
    bridge.setThoughtCompleted.mockImplementationOnce(() => new Promise<Thought>((resolve) => { finish = resolve; }));
    const complete = buttonByLabel("Complete thought: Alpha work thought");
    await click(complete);
    expect(complete.getAttribute("aria-disabled")).toBe("true");
    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).not.toBeNull();
    await click(complete);
    await click(buttonByLabel("Delete thought: Alpha work thought"));
    expect(bridge.setThoughtCompleted).toHaveBeenCalledTimes(1);
    expect(bridge.setThoughtArchived).not.toHaveBeenCalled();
    await act(async () => {
      const updated = { ...original, completed: true };
      records.set("work", updated);
      finish(updated);
    });
    await nextFrame();
    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).toBeNull();
    await click(buttonByText("Completed"));
    await click(buttonByLabel("Reopen thought: Alpha work thought"));
    expect(bridge.setThoughtCompleted).toHaveBeenLastCalledWith("work", false);
    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).toBeNull();
    await click(buttonByText("All thoughts"));
    expect(buttonByLabelOrNull("Complete thought: Alpha work thought")).not.toBeNull();
  });

  it("keeps a failed completion available for retry without hiding the note", async () => {
    bridge.setThoughtCompleted.mockRejectedValueOnce(new Error("Storage unavailable. Try again."));
    const complete = buttonByLabel("Complete thought: Alpha work thought");
    await click(complete);
    await nextFrame();
    expect(container.querySelector('.thought-card__completion-error')?.textContent).toContain("Storage unavailable");
    expect(document.activeElement).toBe(complete);
    expect(records.get("work")?.completed).not.toBe(true);
    await click(complete);
    expect(records.get("work")?.completed).toBe(true);
  });

  it("keeps a late reminder response from undoing a checklist completion", async () => {
    const original = records.get("checklist")!;
    let finish!: (thought: Thought) => void;
    bridge.setChecklistReminder.mockImplementationOnce(() => new Promise<Thought>((resolve) => { finish = resolve; }));
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));
    await typeInto(inputByLabel("Item reminder date and time"), "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await click(detailButtonByText("✓ complete"));
    await flush();
    await act(async () => finish({ ...original, checklistItems: original.checklistItems.map((item, i) => i === 0
      ? { ...item, reminder: { scheduledFor: "2026-09-02T15:30:00Z", state: "scheduled", lastError: null } } : item) }));
    await click(buttonByText("Completed"));
    const card = buttonByLabel("Open checklist: Buy milk").closest('.thought-card')!;
    expect(card.querySelectorAll('input:checked')).toHaveLength(4);
    expect(card.textContent).not.toContain("reminds");
  });

  it("flushes detail edits before Complete and keeps its delete control icon-only", async () => {
    let finish!: () => void;
    bridge.updateRichDocument.mockImplementationOnce((_id: string, document: RichDocument) => new Promise<Thought>((resolve) => {
      const body = richText(document);
      finish = () => { const updated = { ...records.get("work")!, body }; records.set("work", updated); resolve(updated); };
    }));
    await openThought("Alpha work thought");
    expect(buttonByLabel("Delete").querySelector('svg')).not.toBeNull();
    expect(buttonByLabel("Delete").textContent).toBe("");
    await typeDocument(documentElement(), "Saved before completing");
    await click(detailButtonByText("✓ complete"));
    expect(bridge.setThoughtCompleted).not.toHaveBeenCalled();
    await act(async () => finish());
    await flush();
    await nextFrame();
    expect(records.get("work")).toMatchObject({ body: "Saved before completing", completed: true });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click(buttonByText("Completed"));
    await click(buttonByLabel("Delete thought: Saved before completing"));
    await click(buttonByText("Trash"));
    expect(buttonByLabelOrNull("Restore thought: Saved before completing")).not.toBeNull();
    expect(buttonByLabelOrNull("Reopen thought: Saved before completing")).toBeNull();
    await click(buttonByLabel("Restore thought: Saved before completing"));
    await click(buttonByText("Completed"));
    expect(buttonByLabelOrNull("Reopen thought: Saved before completing")).not.toBeNull();
  });

  it("collapses the sidebar, keeps its toggle reachable, and remembers the choice after reopening", async () => {
    const sidebar = container.querySelector<HTMLElement>("#library-sidebar")!;
    const toggle = buttonByLabel("Collapse sidebar");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe(sidebar.id);
    expect(sidebar.hidden).toBe(false);

    await act(async () => toggle.focus());
    await click(toggle);
    expect(sidebar.hidden).toBe(true);
    expect(buttonByLabel("Expand sidebar")).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(container.querySelector(".app-shell--sidebar-collapsed")).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<LibraryApp />));
    await flush();
    expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(true);
    await click(buttonByLabel("Expand sidebar"));
    expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(false);
    expect(localStorage.getItem("brain-cache.sidebar-collapsed")).toBe("false");
  });

  it("preserves search, filters, and the expanded card while toggling the sidebar", async () => {
    await click(buttonByText("Today"));
    await click(buttonByLabel("Filter by tag work"));
    await typeInto(inputByLabel("Search your cache"), "Alpha");
    await click(buttonByLabel("Collapse sidebar"));
    await openThought("Alpha work thought");
    expect(buttonByLabel("Expand sidebar").disabled).toBe(true);

    await click(buttonByLabel("Expand"));
    const body = documentElement();
    await typeDocument(body, "Alpha updated while expanded");
    await click(buttonByLabel("Expand sidebar"));
    expect(documentElement()).toBe(body);
    expect(richText(body.editor.getJSON() as RichDocument)).toBe("Alpha updated while expanded");
    await click(buttonByLabel("Collapse sidebar"));
    await click(buttonByLabel("Back to grid"));
    await nextFrame();

    expect(records.get("work")?.body).toBe("Alpha updated while expanded");
    expect(inputByLabel("Search your cache").value).toBe("Alpha");
    expect(Array.from(container.querySelectorAll("#library-sidebar button")).find((button) => button.textContent?.includes("Today"))?.className).toContain("nav-item--active");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(container.querySelectorAll(".thought-card")).toHaveLength(1);
    expect(document.activeElement).toBe(buttonByLabel("Open thought: Alpha updated while expanded"));
    expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(true);
  });

  it("keeps sidebar toggling usable if its preference storage is unavailable", async () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    try {
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<LibraryApp />));
      await flush();
      await click(buttonByLabel("Collapse sidebar"));
      expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(true);
      await click(buttonByLabel("Expand sidebar"));
      expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(false);
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it("moves a pinned checklist to the top only after saving, then restores its order on unpin", async () => {
    let finish!: (thought: Thought) => void;
    bridge.setThoughtPinned.mockImplementationOnce(() => new Promise<Thought>((resolve) => { finish = resolve; }));
    const order = () => Array.from(container.querySelectorAll<HTMLElement>(".thought-card__open-overlay")).map((button) => button.dataset.thoughtId);
    const pin = buttonByLabel("Pin checklist: Buy milk");
    await act(async () => pin.focus());
    await click(pin);
    await click(pin);
    expect(bridge.setThoughtPinned).toHaveBeenCalledTimes(1);
    expect(order()).toEqual(["work", "design", "checklist"]);
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(pin.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      const updated = { ...records.get("checklist")!, pinned: true };
      records.set("checklist", updated);
      finish(updated);
    });
    await nextFrame();
    expect(order()).toEqual(["checklist", "work", "design"]);
    expect(document.activeElement).toBe(buttonByLabel("Unpin checklist: Buy milk"));
    expect(container.querySelector(".thought-card__pinned-label")?.textContent).toBe("pinned");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click(buttonByLabel("Unpin checklist: Buy milk"));
    await flush();
    expect(order()).toEqual(["work", "design", "checklist"]);
    expect(container.querySelector(".thought-card--pinned")).toBeNull();
  });

  it("keeps a failed pin unchanged and offers a working retry", async () => {
    bridge.setThoughtPinned.mockRejectedValueOnce(new Error("Pin could not be saved."));
    await click(buttonByLabel("Pin thought: Alpha design thought"));
    await flush();
    expect(container.querySelector(".thought-card--pinned")).toBeNull();
    expect(container.querySelector('.thought-card__pin-error[role="alert"]')?.textContent).toContain("Pin could not be saved.");
    await click(buttonByText("retry pin"));
    await flush();
    expect(container.querySelector(".thought-card__open-overlay")?.getAttribute("data-thought-id")).toBe("design");
    expect(container.querySelector(".thought-card__pin-error")).toBeNull();
  });

  it("preserves edits made while a pin response is delayed", async () => {
    const earlier = records.get("work")!;
    let finish!: (thought: Thought) => void;
    bridge.setThoughtPinned.mockImplementationOnce(() => new Promise<Thought>((resolve) => { finish = resolve; }));
    await click(buttonByLabel("Pin thought: Alpha work thought"));
    await openThought("Alpha work thought");
    await typeDocument(documentElement(), "Newer body edit");
    await flush();
    await act(async () => finish({ ...earlier, pinned: true }));
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();
    expect(buttonByLabel("Unpin thought: Newer body edit")).not.toBeNull();
  });

  it("keeps an unpin when an earlier archive response arrives later", async () => {
    await click(buttonByLabel("Pin thought: Alpha work thought"));
    const earlier = records.get("work")!;
    let finish!: (thought: Thought) => void;
    bridge.setThoughtArchived.mockImplementationOnce(() => new Promise<Thought>((resolve) => { finish = resolve; }));
    await click(buttonByLabel("Delete thought: Alpha work thought"));
    await click(buttonByLabel("Unpin thought: Alpha work thought"));
    await act(async () => finish({ ...earlier, archived: true }));
    await click(buttonByText("Trash"));
    await flush();
    expect(buttonByLabel("Pin thought: Alpha work thought").getAttribute("aria-pressed")).toBe("false");
  });

  it("adds and removes Focus Lens tags only after the persisted response", async () => {
    await openThought("Alpha work thought");
    const editor = detailTagInput();
    await typeInto(editor, "NewTag");
    await press(editor, { key: "Enter" });
    await flush();
    await nextFrame();

    expect(bridge.addThoughtTag).toHaveBeenCalledWith("work", "newtag");
    expect(container.querySelector(".thought-detail__tags")?.textContent).toContain("#newtag");

    const removeWork = buttonByLabel("Remove tag work");
    await click(removeWork);
    await flush();

    expect(bridge.removeThoughtTag).toHaveBeenCalledWith("work", "work");
    expect(container.querySelector(".thought-detail__tags")?.textContent).toContain("#newtag");
    expect(buttonByLabelOrNull("Remove tag work")).toBeNull();
  });

  it("places tags above card content and in both detail metadata rows without repeating a title", async () => {
    const card = buttonByLabel("Open thought: Alpha work thought").closest(".thought-card")!;
    const tags = card.querySelector(".thought-card__tags")!;
    const body = card.querySelector(".thought-card__body")!;
    expect(tags.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.querySelector("strong")).toBeNull();
    expect(card.textContent?.match(/Alpha work thought/g)).toHaveLength(1);

    await openThought("Alpha work thought");
    const heading = container.querySelector(".thought-detail__heading")!;
    const metadata = container.querySelector(".thought-detail__meta-row")!;
    expect(metadata.querySelector('[aria-label="Thought tags"]')).not.toBeNull();
    expect(metadata.textContent).toContain("#work");
    expect(metadata.compareDocumentPosition(documentElement()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.textContent).not.toContain("Alpha work thought");
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe("thought-detail-title");

    await click(buttonByLabel("Expand"));
    expect(container.querySelector('.thought-detail--canvas .thought-detail__meta-row [aria-label="Thought tags"]')).not.toBeNull();
    await click(buttonByLabel("Back to grid"));
    await click(buttonByLabel("Open checklist: Buy milk"));
    expect(container.querySelector('.thought-detail__meta-row input[aria-label="Add a tag to this thought"]')).not.toBeNull();
  });

  it("tracks the entire checklist and new draft rows through completion, adding, removal, and expansion", async () => {
    const card = buttonByLabel("Open checklist: Buy milk").closest(".thought-card")!;
    const cardProgress = () => card.querySelector("progress")!;
    expect(cardProgress().value).toBe(1);
    expect(cardProgress().max).toBe(4);
    expect(card.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
    expect(card.textContent).toContain("Review notes");
    expect(card.querySelector(".thought-card__meta progress")).not.toBeNull();
    expect(buttonByLabel("Open thought: Alpha work thought").closest(".thought-card")?.querySelector("progress")).toBeNull();
    await click(inputByLabel("Mark Buy milk complete"));
    await click(inputByLabel("Mark Ship build complete"));
    expect(cardProgress().value).toBe(3);

    await click(buttonByLabel("Open checklist: Buy milk"));
    const detailProgress = () => container.querySelector<HTMLProgressElement>('.thought-detail progress')!;
    await click(container.querySelector<HTMLInputElement>('.thought-detail [aria-label="Mark Review notes complete"]')!);
    expect(detailProgress().value).toBe(4);
    expect(detailProgress().max).toBe(4);
    await addTask("Book dentist");
    expect(detailProgress().max).toBe(5);
    expect(detailProgress().getAttribute("aria-valuetext")).toBe("4 of 5 items complete");
    await press(documentElement(), { key: "Enter" });
    expect(detailProgress().max).toBe(5);
    await removeTask(4);
    expect(detailProgress().max).toBe(4);
    await click(container.querySelector<HTMLInputElement>('.thought-detail [aria-label="Mark Review notes incomplete"]')!);
    expect(detailProgress().value).toBe(3);
    await click(buttonByLabel("Expand"));
    expect(detailProgress().value).toBe(3);
    expect(detailProgress().max).toBe(4);
    await click(buttonByLabel("Back to grid"));
    expect(cardProgress().getAttribute("aria-valuetext")).toBe("3 of 4 items complete");
  });

  it("shows unassigned tags in the compact Focus Lens picker and attaches a chosen option", async () => {
    await openThought("Alpha work thought");
    await act(async () => detailTagInput().focus());
    expect(tagOption("work")).toBeNull();
    const addDesign = tagOption("design")!;
    expect(addDesign.querySelector(".tag-color-dot")?.className).toContain("tag-color--plum");

    await click(addDesign);
    await flush();
    await nextFrame();

    expect(bridge.addThoughtTag).toHaveBeenCalledWith("work", "design");
    expect(tagOption("design")).toBeNull();
    expect(buttonByLabel("Remove tag design")).not.toBeNull();
    expect(detailTagInput()).toBe(document.activeElement);
  });

  it("shows and attaches the same existing tags in Canvas Drill-In", async () => {
    await openThought("Alpha work thought");
    await click(buttonByLabel("Expand"));
    await nextFrame();

    expect(container.querySelector(".thought-detail--canvas")).not.toBeNull();
    await act(async () => detailTagInput().focus());
    expect(tagOption("work")).toBeNull();
    await click(tagOption("design")!);
    await flush();
    await nextFrame();

    expect(bridge.addThoughtTag).toHaveBeenCalledWith("work", "design");
    expect(tagOption("design")).toBeNull();
    expect(buttonByLabel("Remove tag design")).not.toBeNull();
    expect(detailTagInput()).toBe(document.activeElement);
  });

  it("keeps the compact tag picker available and focused when persistence fails", async () => {
    bridge.addThoughtTag.mockRejectedValueOnce(new Error("The tag stayed local."));
    await openThought("Alpha work thought");

    await act(async () => detailTagInput().focus());
    await click(tagOption("design")!);
    await flush();
    await nextFrame();

    expect(detailTagInput()).toBe(document.activeElement);
    expect(tagOption("design")).not.toBeNull();
    expect(container.querySelector('.thought-detail__tags [role="alert"]')?.textContent).toBe(
      "The tag stayed local.",
    );
    expect(buttonByLabelOrNull("Remove tag design")).toBeNull();
    await click(tagOption("design")!);
    await nextFrame();
    expect(buttonByLabel("Remove tag design")).not.toBeNull();
    expect(container.querySelector('.thought-detail__tags [role="alert"]')).toBeNull();
  });

  it("renders one canonical color across cards, detail, suggestions, and the active filter", async () => {
    const workCard = buttonByLabel("Open thought: Alpha work thought");
    expect(workCard.closest(".thought-card")?.querySelector(".tag-chip--card")?.className).toContain(
      "tag-color--moss",
    );

    await openThought("Alpha work thought");
    const colorButton = buttonByLabel("Set color for tag work");
    expect(colorButton.closest(".tag-chip")?.className).toContain("tag-color--moss");
    await click(colorButton);
    expect(document.activeElement).toBe(buttonByLabel("Set Moss color for tag work"));
    expect(
      Array.from(container.querySelectorAll('.tag-color-picker [aria-label^="Set "]')).map(
        (button) => button.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Set Graphite color for tag work",
      "Set Clay color for tag work",
      "Set Moss color for tag work",
      "Set Sky color for tag work",
      "Set Plum color for tag work",
      "Set Rose color for tag work",
    ]);
    await click(buttonByLabel("Set Rose color for tag work"));
    await flush();
    await nextFrame();

    expect(bridge.setTagColor).toHaveBeenCalledWith("work", "rose");
    expect(buttonByLabel("Set color for tag work").closest(".tag-chip")?.className).toContain(
      "tag-color--rose",
    );
    expect(workCard.closest(".thought-card")?.querySelector(".tag-chip--card")?.className).toContain(
      "tag-color--rose",
    );

    await click(buttonByLabel("Expand"));
    await nextFrame();
    expect(
      container.querySelector(".thought-detail--canvas .tag-color--rose"),
    ).not.toBeNull();
    await click(buttonByLabel("Back to grid"));
    await nextFrame();
    await click(buttonByText("More…"));
    const filterInput = inputByLabel("Choose a tag filter");
    await typeInto(filterInput, "work");
    expect(container.querySelector('.tag-option [class*="tag-color--rose"]')).not.toBeNull();
    await press(filterInput, { key: "Enter" });
    await nextFrame();
    expect(
      buttonByLabel("Filter by tag work").querySelector(".tag-color--rose"),
    ).not.toBeNull();
  });

  it.each(["Focus Lens", "Canvas Drill-In"])("opens tag colors from a right-click in %s without removing the tag", async (mode) => {
    await openThought("Alpha work thought");
    if (mode === "Canvas Drill-In") {
      await click(buttonByLabel("Expand"));
      await nextFrame();
    }
    const chip = buttonByLabel("Set color for tag work").closest(".tag-chip")!;
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    await act(async () => { chip.querySelector(".tag-chip__label")!.dispatchEvent(contextMenu); });
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttonByLabel("Set Moss color for tag work"));
    expect(bridge.removeThoughtTag).not.toHaveBeenCalled();
    expect(bridge.setTagColor).not.toHaveBeenCalled();

    await press(document.activeElement as HTMLElement, { key: "Escape" });
    await nextFrame();
    expect(container.querySelector('.tag-color-picker')).toBeNull();
    expect(container.querySelector('.thought-detail')).not.toBeNull();
    expect(document.activeElement).toBe(buttonByLabel("Set color for tag work"));

    // The chip's remove affordance also receives a secondary click without deleting anything.
    await act(async () => { buttonByLabel("Remove tag work").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); });
    await click(buttonByLabel("Set Rose color for tag work"));
    await flush();
    expect(bridge.setTagColor).toHaveBeenCalledWith("work", "rose");
    expect(bridge.removeThoughtTag).not.toHaveBeenCalled();
    expect(chip.className).toContain("tag-color--rose");
    expect(records.get("work")?.tags).toEqual(["work"]);
  });

  it("keeps the color picker recoverable after failure and can return a tag to neutral", async () => {
    bridge.setTagColor.mockRejectedValueOnce(new Error("Color stayed unchanged."));
    await openThought("Alpha work thought");
    await click(buttonByLabel("Set color for tag work"));
    await click(buttonByLabel("Set Clay color for tag work"));
    await flush();
    await nextFrame();

    expect(container.querySelector('.thought-detail__tags [role="alert"]')?.textContent).toContain(
      "Color stayed unchanged.",
    );
    expect(buttonByLabel("Set color for tag work").closest(".tag-chip")?.className).toContain(
      "tag-color--moss",
    );
    expect(document.activeElement).toBe(buttonByLabel("Set color for tag work"));

    await click(buttonByLabel("Remove color from tag work"));
    await flush();
    await nextFrame();
    expect(bridge.setTagColor).toHaveBeenLastCalledWith("work", null);
    expect(buttonByLabel("Set color for tag work").closest(".tag-chip")?.className).toContain(
      "tag-color--graphite",
    );
  });

  it("changes a shared tag color from the dashboard without changing its active filter", async () => {
    await click(buttonByLabel("Filter by tag work"));
    await nextFrame();
    await click(buttonByText("Tag colors"));
    await nextFrame();
    const selector = container.querySelector('select[aria-label="Tag to recolor"]') as HTMLSelectElement;
    expect(selector.value).toBe("work");
    expect(document.activeElement).toBe(selector);
    await click(buttonByLabel("Set Rose color for tag work"));
    await flush();
    await nextFrame();
    expect(bridge.setTagColor).toHaveBeenCalledWith("work", "rose");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(buttonByLabel("Filter by tag work").className).toContain("tag-color--rose");
    expect(container.querySelector('.thought-card .tag-color--rose')).not.toBeNull();
    expect(container.querySelector('.tag-colors__status')?.textContent).toBe("Color saved locally");
    expect(document.activeElement).toBe(selector);
    await press(selector, { key: "Escape" });
    await nextFrame();
    expect(container.querySelector('.tag-colors__popover')).toBeNull();
    expect(document.activeElement).toBe(buttonByText("Tag colors"));
    await openThought("Alpha work thought");
    expect(buttonByLabel("Set color for tag work").closest('.tag-chip')?.className).toContain("tag-color--rose");
  });

  it("waits for color persistence and keeps failures recoverable in the dashboard picker", async () => {
    await click(buttonByText("Tag colors"));
    await nextFrame();
    const selector = container.querySelector('select[aria-label="Tag to recolor"]') as HTMLSelectElement;
    await act(async () => { selector.value = "work"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
    let finish!: (definition: { name: string; color: string | null }) => void;
    bridge.setTagColor.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await click(buttonByLabel("Set Sky color for tag work"));
    expect(selector.disabled).toBe(true);
    expect(buttonByLabel("Filter by tag work").className).toContain("tag-color--moss");
    expect(container.querySelector('.tag-colors__status')?.textContent).toBe("Saving color…");
    await act(async () => finish({ name: "work", color: "sky" }));
    await nextFrame();
    expect(buttonByLabel("Filter by tag work").className).toContain("tag-color--sky");
    bridge.setTagColor.mockRejectedValueOnce(new Error("Local store unavailable."));
    await click(buttonByLabel("Set Clay color for tag work"));
    await flush();
    await nextFrame();
    expect(container.querySelector('.tag-colors__error')?.textContent).toContain("Local store unavailable");
    expect(buttonByLabel("Filter by tag work").className).toContain("tag-color--sky");
    expect(selector.disabled).toBe(false);
    await click(buttonByLabel("Remove color from tag work"));
    await flush();
    expect(bridge.setTagColor).toHaveBeenLastCalledWith("work", null);
    expect(buttonByLabel("Filter by tag work").className).toContain("tag-color--graphite");
    expect(container.querySelector('.tag-colors__error')).toBeNull();
  });

  it("persists a card checkbox before reflecting its completed state", async () => {
    const original = records.get("checklist")!;
    let resolveWrite!: (thought: Thought) => void;
    bridge.replaceChecklistItems.mockReset().mockImplementationOnce(
      () =>
        new Promise<Thought>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const checkbox = inputByLabel("Mark Buy milk complete");
    await click(checkbox);

    expect(bridge.replaceChecklistItems).toHaveBeenCalledWith("checklist", [
      { id: "item-one", text: "Buy milk", completed: true, reminder: null },
      ...original.checklistItems.slice(1),
    ]);
    expect(inputByLabel("Mark Buy milk complete").checked).toBe(false);
    expect(inputByLabel("Mark Buy milk complete").disabled).toBe(true);
    expect(container.querySelector(".task-activity")).toBeNull();
    expect(container.querySelector(".task-completion-feedback")?.textContent).toBe("");
    expect(container.querySelector("progress")?.value).toBe(1);

    resolveWrite({
      ...original,
      checklistItems: [
        { ...original.checklistItems[0], completed: true },
        ...original.checklistItems.slice(1),
      ],
    });
    await flush();

    expect(inputByLabel("Mark Buy milk incomplete").checked).toBe(true);
    expect(container.querySelector("progress")?.value).toBe(2);
    expect(records.get("checklist")?.createdAt).toBe(original.createdAt);
  });

  it("keeps a card checkbox unchanged and exposes a recoverable error when persistence fails", async () => {
    bridge.replaceChecklistItems.mockReset().mockRejectedValueOnce(new Error("Checklist stayed unchanged."));

    await click(inputByLabel("Mark Buy milk complete"));
    await flush();

    expect(inputByLabel("Mark Buy milk complete").checked).toBe(false);
    expect(inputByLabel("Mark Buy milk complete").disabled).toBe(false);
    expect(container.querySelector("progress")?.value).toBe(1);
    expect(container.querySelector(".task-activity")).toBeNull();
    expect(container.querySelector(".task-completion-feedback")?.textContent).toBe("");
    expect(container.querySelector(".checklist-mutation-error")?.textContent).toContain(
      "Checklist stayed unchanged.",
    );
  });

  it("opens Settings with the sidebar hidden, traps focus, and restores the dashboard", async () => {
    await typeInto(inputByLabel("Search your cache"), "Alpha");
    await click(buttonByLabel("Filter by tag work"));
    await nextFrame();
    await click(buttonByLabel("Collapse sidebar"));
    const pane = container.querySelector<HTMLElement>(".thoughts-pane")!;
    pane.scrollTop = 180;
    const opener = buttonByLabel("Settings");
    await click(opener);
    const dialog = container.querySelector<HTMLElement>("#settings-panel")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(true);
    const close = buttonByLabel("Close settings");
    expect(document.activeElement).toBe(close);
    await press(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(inputByLabel("Shortcut button"));
    await press(document.activeElement as HTMLElement, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    await press(close, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(close);
    await press(close, { key: "Escape" });
    await nextFrame();
    expect(container.querySelector("#settings-panel")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(pane.scrollTop).toBe(180);
    expect(inputByLabel("Search your cache").value).toBe("Alpha");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(false);
  });

  it("saves sidebar visibility from Settings and retains an accessible entry after closing", async () => {
    await press(inputByLabel("Search your cache"), { key: ",", metaKey: true });
    await press(inputByLabel("Search your cache"), { key: ",", ctrlKey: true });
    expect(container.querySelector("#settings-panel")).toBeNull();
    await click(buttonByLabel("Settings"));
    expect(inputByLabel("Show sidebar").checked).toBe(true);
    await click(inputByLabel("Show sidebar"));
    expect(localStorage.getItem("brain-cache.sidebar-collapsed")).toBe("true");
    expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(true);
    await click(buttonByLabel("Close settings"));
    await nextFrame();
    expect(document.activeElement).toBe(buttonByLabel("Settings"));
    await click(buttonByLabel("Settings"));
    expect(inputByLabel("Show sidebar").checked).toBe(false);
    await click(inputByLabel("Show sidebar"));
    await act(async () => container.querySelector(".settings-layer")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    await nextFrame();
    expect(document.activeElement).toBe(buttonByLabel("Settings"));
    expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(false);
  });

  it("keeps Settings available when the library cannot load and isolates preference read failures", async () => {
    bridge.getLaunchAtLogin.mockRejectedValueOnce(new Error("Login preferences unavailable."));
    bridge.listThoughts.mockRejectedValueOnce(new Error("Library unavailable."));
    await act(async () => { root.unmount(); root = createRoot(container); root.render(<LibraryApp />); });
    await flush();
    await click(buttonByLabel("Settings"));
    expect(inputByLabel("Launch at login").disabled).toBe(true);
    expect(inputByLabel("Shortcut button").disabled).toBe(false);
    expect(container.querySelector("#settings-panel")?.textContent).toContain("Login preferences unavailable.");
    await click(buttonByLabel("Retry launch at login"));
    expect(inputByLabel("Launch at login").disabled).toBe(false);
    expect(inputByLabel("Launch at login").checked).toBe(false);
  });

  it("waits for login persistence, prevents duplicate writes, and retries a failed change", async () => {
    let reject!: (error: Error) => void;
    bridge.setLaunchAtLogin.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    await click(buttonByLabel("Settings"));
    const toggle = inputByLabel("Launch at login");
    await click(toggle);
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(buttonByLabel("Close settings").disabled).toBe(true);
    await click(toggle);
    await press(toggle, { key: "Escape" });
    expect(container.querySelector("#settings-panel")).not.toBeNull();
    expect(bridge.setLaunchAtLogin).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("macOS rejected the change.")));
    expect(toggle.checked).toBe(false);
    expect(container.querySelector("#settings-panel")?.textContent).toContain("macOS rejected the change.");
    await click(buttonByLabel("Retry launch at login"));
    expect(bridge.setLaunchAtLogin).toHaveBeenLastCalledWith(true);
    expect(toggle.checked).toBe(true);
    expect(buttonByLabel("Close settings").disabled).toBe(false);
  });

  it("saves shortcut visibility and follows changes from capture or the View menu", async () => {
    let notify!: (value: boolean) => void;
    const stop = vi.fn();
    bridge.listenForShortcutButtonVisibility.mockImplementationOnce(async (callback) => { notify = callback; return stop; });
    await click(buttonByLabel("Settings"));
    const toggle = inputByLabel("Shortcut button");
    expect(toggle.checked).toBe(true);
    bridge.setShortcutButtonVisible.mockRejectedValueOnce(new Error("Preference storage unavailable."));
    await click(toggle);
    expect(toggle.checked).toBe(true);
    await click(buttonByLabel("Retry shortcut button"));
    expect(bridge.setShortcutButtonVisible).toHaveBeenLastCalledWith(false);
    expect(toggle.checked).toBe(false);
    await act(async () => notify(true));
    expect(toggle.checked).toBe(true);
    await click(buttonByLabel("Close settings"));
    expect(stop).toHaveBeenCalledTimes(1);
    bridge.getShortcutButtonVisible.mockResolvedValue(false);
    await click(buttonByLabel("Settings"));
    expect(inputByLabel("Shortcut button").checked).toBe(false);
  });

  it("keeps the sidebar unchanged when Settings cannot save its preference", async () => {
    await click(buttonByLabel("Settings"));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full."); });
    try {
      await click(inputByLabel("Show sidebar"));
      expect(inputByLabel("Show sidebar").checked).toBe(true);
      expect(container.querySelector<HTMLElement>("#library-sidebar")?.hidden).toBe(false);
      expect(buttonByLabel("Retry show sidebar")).not.toBeNull();
    } finally { setItem.mockRestore(); }
    await click(buttonByLabel("Retry show sidebar"));
    expect(inputByLabel("Show sidebar").checked).toBe(false);
    expect(localStorage.getItem("brain-cache.sidebar-collapsed")).toBe("true");
  });

  it("applies light mode only after saving and keeps a failed appearance change retryable", async () => {
    await click(buttonByLabel("Settings"));
    const toggle = inputByLabel("Light mode");
    let finish!: (enabled: boolean) => void;
    bridge.setLightMode.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await click(toggle);
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => finish(true));
    expect(toggle.checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    bridge.setLightMode.mockRejectedValueOnce(new Error("Could not save appearance."));
    await click(toggle);
    expect(toggle.checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(container.querySelector("#settings-panel")?.textContent).toContain("Could not save appearance.");
    await click(buttonByLabel("Retry light mode"));
    expect(bridge.setLightMode).toHaveBeenLastCalledWith(false);
    expect(toggle.checked).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("restores saved light mode in Settings and retries a failed appearance read independently", async () => {
    bridge.getLightMode.mockRejectedValueOnce(new Error("Appearance unavailable."));
    await click(buttonByLabel("Settings"));
    expect(inputByLabel("Light mode").disabled).toBe(true);
    expect(inputByLabel("Launch at login").disabled).toBe(false);
    bridge.getLightMode.mockResolvedValue(true);
    await click(buttonByLabel("Retry light mode"));
    expect(inputByLabel("Light mode").checked).toBe(true);
    await click(buttonByLabel("Close settings"));
    await click(buttonByLabel("Settings"));
    expect(inputByLabel("Light mode").checked).toBe(true);
  });

  it("saves font size before applying it and keeps failed changes retryable", async () => {
    await click(buttonByLabel("Settings"));
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Font size"]')!;
    expect(select.value).toBe("default");
    let finish!: (size: string) => void;
    bridge.setFontSize.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    await act(async () => { select.value = "large"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(bridge.setFontSize).toHaveBeenCalledWith("large");
    expect(select.value).toBe("default");
    expect(select.disabled).toBe(true);
    expect(buttonByLabel("Close settings").disabled).toBe(true);
    expect(document.documentElement.dataset.fontSize).toBe("default");
    await act(async () => finish("large"));
    expect(select.value).toBe("large");
    expect(document.documentElement.dataset.fontSize).toBe("large");
    bridge.setFontSize.mockRejectedValueOnce(new Error("Could not save font size."));
    await act(async () => { select.value = "extra-large"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(select.value).toBe("large");
    expect(document.documentElement.dataset.fontSize).toBe("large");
    await click(buttonByLabel("Retry font size"));
    expect(select.value).toBe("extra-large");
    expect(document.documentElement.dataset.fontSize).toBe("extra-large");
    select.focus();
    await press(select, { key: "Tab" });
    expect(document.activeElement).toBe(select); // A normal Tab is not intercepted inside the modal.
    bridge.getFontSize.mockResolvedValue("extra-large");
    await click(buttonByLabel("Close settings"));
    await click(buttonByLabel("Settings"));
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Font size"]')!.value).toBe("extra-large");
  });

  it("isolates font-size read failures and follows externally saved sizes", async () => {
    let notify!: (size: string) => void;
    bridge.listenForFontSize.mockImplementationOnce(async (callback) => { notify = callback; return () => undefined; });
    bridge.getFontSize.mockRejectedValueOnce(new Error("Font size unavailable."));
    await click(buttonByLabel("Settings"));
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Font size"]')!;
    expect(select.disabled).toBe(true);
    expect(inputByLabel("Light mode").disabled).toBe(false);
    bridge.getFontSize.mockResolvedValue("large");
    await click(buttonByLabel("Retry font size"));
    expect(select.value).toBe("large");
    await act(async () => notify("extra-large"));
    expect(select.value).toBe("extra-large");
  });

  it("opens the garden from sidebar Activity and preserves the library when returning", async () => {
    await typeInto(inputByLabel("Search your cache"), "Alpha");
    await click(buttonByLabel("Filter by tag work"));
    const pane = container.querySelector(".thoughts-pane") as HTMLElement;
    pane.scrollTop = 230;
    await click(buttonByLabel("Open thought: Alpha work thought"));
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();
    const selected = container.querySelector(".thought-card--selected");
    expect(selected).not.toBeNull();

    await click(buttonByLabel("Open Activity"));
    expect(pane.hidden).toBe(true);
    expect(container.querySelector('.activity-garden [role="img"]')?.getAttribute("aria-label")).toBe("1 plant growing");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(false);
    expect(buttonByLabel("Open Activity").getAttribute("aria-current")).toBe("page");
    expect(container.querySelectorAll('.nav-item[aria-current="page"]')).toHaveLength(1);
    expect(document.activeElement).toBe(container.querySelector("#activity-page-title"));
    expect(container.querySelectorAll(".task-activity__chart li")).toHaveLength(0);
    expect(buttonByText("More activity").getAttribute("aria-expanded")).toBe("false");
    await click(buttonByText("More activity"));
    expect(container.querySelectorAll(".task-activity__chart li")).toHaveLength(7);
    expect(container.querySelector(".task-activity__stats")?.textContent).toContain("Total1");

    await click(buttonByLabel("Collapse sidebar"));
    expect(container.querySelector(".activity-page")).not.toBeNull();
    await click(buttonByLabel("Back to All thoughts"));
    await nextFrame();
    expect(container.querySelector(".activity-page")).toBeNull();
    expect(pane.hidden).toBe(false);
    expect(pane.scrollTop).toBe(230);
    expect(inputByLabel("Search your cache").value).toBe("Alpha");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector(".thought-card--selected")).toBe(selected);
    expect(document.activeElement).toBe(buttonByLabel("Open activity summary"));
  });

  it("preserves Activity while changing appearance in Settings with the sidebar hidden", async () => {
    await click(buttonByLabel("Open Activity"));
    await click(buttonByText("More activity"));
    await click(buttonByLabel("Collapse sidebar"));
    await click(buttonByLabel("Settings"));
    const close = buttonByLabel("Close settings");
    await press(close, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(close);
    expect(container.querySelector(".activity-page")).not.toBeNull();
    await click(inputByLabel("Light mode"));
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Font size"]')!;
    await act(async () => { select.value = "extra-large"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.fontSize).toBe("extra-large");
    await click(close);
    await nextFrame();
    expect(document.activeElement).toBe(buttonByLabel("Settings"));
    expect(buttonByText("More activity").getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(false);
    await press(document.activeElement as HTMLElement, { key: "k", metaKey: true });
    await nextFrame();
    expect(container.querySelector(".activity-page")).toBeNull();
    expect(document.activeElement).toBe(inputByLabel("Search your cache"));
  });

  it("leaves Activity through navigation, search, capture, and reminder entry points", async () => {
    await click(buttonByLabel("Open Activity"));
    await click(buttonByText("Today"));
    expect(container.querySelector(".activity-page")).toBeNull();
    expect(container.querySelector(".thoughts-toolbar h1")?.textContent).toBe("Today");

    await click(buttonByLabel("Open Activity"));
    await press(document.activeElement as HTMLElement, { key: "k", metaKey: true });
    await nextFrame();
    expect(container.querySelector(".activity-page")).toBeNull();
    expect(document.activeElement).toBe(inputByLabel("Search your cache"));

    await click(buttonByLabel("Open Activity"));
    await click(buttonByText("new thought"));
    expect(bridge.showCapture).toHaveBeenCalled();
    await act(async () => bridge.listenForCreatedThought.mock.calls[0][0](records.get("work")));
    expect(container.querySelector(".activity-page")).toBeNull();

    await click(buttonByLabel("Open Activity"));
    await act(async () => { reminderOpened?.({ thoughtId: "work", itemId: null }); });
    await flush();
    expect(container.querySelector(".activity-page")).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("opens activity in a separate keyboard-accessible panel and restores the dashboard", async () => {
    expect(container.querySelector(".task-activity")).toBeNull();
    await typeInto(inputByLabel("Search your cache"), "Alpha");
    await click(buttonByLabel("Filter by tag work"));
    await nextFrame();
    await click(buttonByLabel("Collapse sidebar"));
    const pane = container.querySelector(".thoughts-pane") as HTMLElement;
    pane.scrollTop = 230;
    const opener = buttonByLabel("Open activity summary");
    await click(opener);
    expect(container.querySelector('.thoughts-pane .task-activity')).toBeNull();
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(true);
    const close = buttonByLabel("Close activity");
    expect(document.activeElement).toBe(close);
    await press(close, { key: "Tab" });
    expect(document.activeElement).toBe(container.querySelector(".task-activity__body"));
    await press(document.activeElement as HTMLElement, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(container.querySelector(".task-activity__body"));
    await press(document.activeElement as HTMLElement, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    await press(close, { key: "Escape" });
    await nextFrame();
    expect(container.querySelector(".task-activity")).toBeNull();
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(inputByLabel("Search your cache").value).toBe("Alpha");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(pane.scrollTop).toBe(230);
    expect(buttonByLabel("Expand sidebar")).not.toBeNull();
    await click(opener);
    await act(async () => container.querySelector(".activity-layer")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    await nextFrame();
    expect(container.querySelector(".task-activity")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("shows global task counts in activity, rewards confirmed completions, and reverses undo", async () => {
    const counts = () => Array.from(container.querySelectorAll(".task-activity__stats dd"), (node) => node.textContent);
    expect(container.querySelector(".task-activity")).toBeNull();
    expect(container.querySelector(".task-completion-feedback")?.textContent).toBe("");
    await click(buttonByLabel("Open activity summary"));
    expect(counts()).toEqual(["0", "0", "1", "0"]);
    expect(container.querySelector(".task-activity__details")?.textContent).toContain("1 earlier completion");
    expect(container.querySelectorAll(".task-activity__chart li")).toHaveLength(7);
    await click(buttonByLabel("Close activity"));
    await nextFrame();
    await click(inputByLabel("Mark Buy milk complete"));
    await flush();
    expect(container.querySelector(".task-completion-feedback")?.textContent).toContain("+1 task completed");
    await typeInto(inputByLabel("Search your cache"), "no matching thoughts");
    await click(buttonByLabel("Open activity summary"));
    expect(counts()).toEqual(["1", "1", "2", "1"]);
    await click(buttonByLabel("Close activity"));
    await nextFrame();
    await typeInto(inputByLabel("Search your cache"), "");
    await click(inputByLabel("Mark Buy milk incomplete"));
    await flush();
    await click(buttonByLabel("Open activity summary"));
    expect(counts()).toEqual(["0", "0", "1", "0"]);
    expect(container.querySelector(".task-completion-feedback")?.textContent).toBe("");
  });

  it("retains completion counts across archive and reopening without a new celebration", async () => {
    await click(inputByLabel("Mark Buy milk complete"));
    await flush();
    await click(buttonByLabel("Delete checklist: Buy milk"));
    await flush();
    await click(buttonByLabel("Open activity summary"));
    expect(Array.from(container.querySelectorAll(".task-activity__stats dd"), (node) => node.textContent)).toEqual(["1", "1", "2", "1"]);
    await act(async () => root.unmount());
    root = createRoot(container);
    bridge.listThoughts.mockResolvedValue([...records.values()]);
    await act(async () => root.render(<LibraryApp />));
    await flush();
    expect(container.querySelector(".task-activity")).toBeNull();
    await click(buttonByLabel("Open activity summary"));
    expect(Array.from(container.querySelectorAll(".task-activity__stats dd"), (node) => node.textContent)).toEqual(["1", "1", "2", "1"]);
    expect(container.querySelector(".task-completion-feedback")?.textContent).toBe("");
  });

  it("keeps Open, Archive, tags, and checklist controls as distinct keyboard targets", async () => {
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await act(async () => detailTagInput().focus());
    await click(tagOption("work")!);
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    const open = buttonByLabel("Open checklist: Buy milk");
    const archive = buttonByLabel("Delete checklist: Buy milk");
    const checkbox = inputByLabel("Mark Buy milk complete");
    const card = open.closest(".thought-card") as HTMLElement;

    expect(archive.closest(".thought-card")).toBe(card);
    expect(open.contains(archive)).toBe(false);
    expect(archive.contains(open)).toBe(false);
    expect(card.querySelector(".tag-chip--card")?.textContent).toContain("#work");
    expect([open.tabIndex, archive.tabIndex, checkbox.tabIndex]).toEqual([0, 0, 0]);

    await act(async () => open.focus());
    expect(card.matches(":focus-within")).toBe(true);
    await act(async () => archive.focus());
    expect(document.activeElement).toBe(archive);
    await act(async () => checkbox.focus());
    expect(document.activeElement).toBe(checkbox);
  });

  it("keeps a grid card visible until archive persistence succeeds, then focuses its successor", async () => {
    const original = records.get("work")!;
    let settle!: (thought: Thought) => void;
    bridge.setThoughtArchived.mockReset().mockImplementationOnce(
      () =>
        new Promise<Thought>((resolve) => {
          settle = resolve;
        }),
    );
    const pane = container.querySelector(".thoughts-pane") as HTMLElement;
    pane.scrollTop = 137;
    const archive = buttonByLabel("Delete thought: Alpha work thought");
    await act(async () => archive.focus());

    await click(archive);

    expect(bridge.setThoughtArchived).toHaveBeenCalledWith("work", true);
    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).not.toBeNull();
    expect(archive.getAttribute("aria-disabled")).toBe("true");
    expect(archive.closest(".thought-card")?.getAttribute("aria-busy")).toBe("true");
    await click(archive);
    expect(bridge.setThoughtArchived).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle({ ...original, archived: true });
      await Promise.resolve();
    });
    await nextFrame();

    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).toBeNull();
    expect(document.activeElement).toBe(buttonByLabel("Open thought: Alpha design thought"));
    expect(pane.scrollTop).toBe(137);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Thought moved to Trash.",
    );
  });

  it("preserves a concurrent update on another card when a delayed archive resolves", async () => {
    const original = records.get("work")!;
    let settle!: (thought: Thought) => void;
    bridge.setThoughtArchived.mockReset().mockImplementationOnce(
      () =>
        new Promise<Thought>((resolve) => {
          settle = resolve;
        }),
    );

    await click(buttonByLabel("Delete thought: Alpha work thought"));
    await click(inputByLabel("Mark Buy milk complete"));
    await flush();

    expect(inputByLabel("Mark Buy milk incomplete").checked).toBe(true);

    await act(async () => {
      settle({ ...original, archived: true });
      await Promise.resolve();
    });
    await nextFrame();

    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).toBeNull();
    expect(inputByLabel("Mark Buy milk incomplete").checked).toBe(true);
  });

  it("preserves query, tag, scroll, and empty-result focus through archive and Undo", async () => {
    const search = inputByLabel("Search your cache");
    await typeInto(search, "Alpha");
    await click(buttonByLabel("Filter by tag work"));
    const pane = container.querySelector(".thoughts-pane") as HTMLElement;
    pane.scrollTop = 184;

    await click(buttonByLabel("Delete thought: Alpha work thought"));
    await flush();
    await nextFrame();

    const emptyHeading = container.querySelector(".empty-state h2") as HTMLHeadingElement;
    expect(emptyHeading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(emptyHeading);
    expect(search.value).toBe("Alpha");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(pane.scrollTop).toBe(184);

    await click(buttonByText("undo"));
    await flush();
    await nextFrame();

    expect(bridge.setThoughtArchived).toHaveBeenNthCalledWith(1, "work", true);
    expect(bridge.setThoughtArchived).toHaveBeenNthCalledWith(2, "work", false);
    expect(search.value).toBe("Alpha");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(pane.scrollTop).toBe(184);
    expect(document.activeElement).toBe(buttonByLabel("Open thought: Alpha work thought"));
  });

  it("keeps a failed grid archive visible and focused with a working retry", async () => {
    bridge.setThoughtArchived.mockRejectedValueOnce(new Error("Archive stayed unchanged."));
    const archive = buttonByLabel("Delete thought: Alpha work thought");
    await act(async () => archive.focus());

    await click(archive);
    await flush();
    await nextFrame();

    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).not.toBeNull();
    expect(document.activeElement).toBe(archive);
    expect(container.querySelector('.grid-archive-feedback[role="alert"]')?.textContent).toContain(
      "Archive stayed unchanged.",
    );

    await click(buttonByText("retry"));
    await flush();
    await nextFrame();

    expect(bridge.setThoughtArchived).toHaveBeenCalledTimes(2);
    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).toBeNull();
    expect(container.querySelector('.grid-archive-feedback[role="alert"]')).toBeNull();
  });

  it("restores directly from Archive and keeps Undo recoverable after a failed reversal", async () => {
    await click(buttonByText("Trash"));
    const restore = buttonByLabel("Restore thought: Alpha archived work");
    await act(async () => restore.focus());
    await click(restore);
    await flush();
    await nextFrame();

    expect(bridge.setThoughtArchived).toHaveBeenCalledWith("archived", false);
    expect(buttonByLabelOrNull("Open thought: Alpha archived work")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector(".empty-state h2"));

    bridge.setThoughtArchived.mockRejectedValueOnce(new Error("Undo stayed unchanged."));
    const undo = buttonByText("undo");
    await act(async () => undo.focus());
    await click(undo);
    await flush();
    await nextFrame();

    expect(buttonByText("undo")).toBe(document.activeElement);
    expect(container.querySelector('.grid-archive-feedback[role="alert"]')?.textContent).toContain(
      "Undo stayed unchanged.",
    );
    await click(buttonByText("retry"));
    await flush();
    await nextFrame();

    expect(bridge.setThoughtArchived).toHaveBeenLastCalledWith("archived", true);
    expect(document.activeElement).toBe(buttonByLabel("Open thought: Alpha archived work"));
  });

  it("focuses the previous card when archiving the final card in the grid", async () => {
    await click(buttonByLabel("Delete checklist: Buy milk"));
    await flush();
    await nextFrame();

    expect(document.activeElement).toBe(buttonByLabel("Open thought: Alpha design thought"));
  });

  it("adds, renames, reorders, and removes checklist items in the same document", async () => {
    const createdAt = records.get("checklist")!.createdAt;
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    expect(document.activeElement).toBe(documentElement());
    await editTask(0, "Buy oat milk");
    await addTask("Pack bags");
    expect(richText(taskNodes()[4])).toBe("Pack bags");
    const doc = documentElement().editor.getJSON();
    const tasks = doc.content![0].content!;
    tasks.splice(3, 0, tasks.pop()!);
    await act(async () => { documentElement().editor.commands.setContent(doc); });
    expect(richText(taskNodes()[3])).toBe("Pack bags");
    await removeTask(4);
    await flush();
    expect(records.get("checklist")?.checklistItems.map(item => item.text)).toEqual(["Buy oat milk", "Call Sam", "Ship build", "Pack bags"]);
    expect(records.get("checklist")?.createdAt).toBe(createdAt);
    await editTask(0, "Unsaved draft");
    await click(buttonByLabel("Expand"));
    await nextFrame();
    expect(richText(taskNodes()[0])).toBe("Unsaved draft");
    expect(document.activeElement).toBe(documentElement());
  });

  it("sets, edits, reopens and clears a note reminder in both detail modes", async () => {
    expect(bridge.setThoughtReminder).not.toHaveBeenCalled();
    await click(buttonByLabel("Open thought: Alpha work thought"));
    await nextFrame();
    await click(buttonByLabel("Set note reminder"));
    const dateInput = inputByLabel("Note reminder date and time");
    expect(dateInput.value).toMatch(/T\d{2}:00$/);
    await typeInto(dateInput, "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();
    expect(bridge.setThoughtReminder).toHaveBeenCalledWith("work", new Date(2026, 8, 2, 10, 30).toISOString());
    expect(container.querySelector(".thought-card__reminder")?.textContent).toContain("reminds");
    await nextFrame();
    expect(document.activeElement).toBe(buttonByLabel("Edit note reminder"));
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();
    await click(buttonByLabel("Open thought: Alpha work thought"));
    await nextFrame();
    await click(buttonByLabel("Expand"));
    await click(buttonByLabel("Edit note reminder"));
    expect(inputByLabel("Note reminder date and time").value).toBe("2026-09-02T10:30");
    await typeInto(inputByLabel("Note reminder date and time"), "2026-09-03T11:45");
    await click(buttonByText("update reminder"));
    await flush();
    expect(records.get("work")?.reminder?.scheduledFor).toBe(new Date(2026, 8, 3, 11, 45).toISOString());
    await click(buttonByLabel("Edit note reminder"));
    await click(buttonByLabel("Clear note reminder"));
    await flush();
    expect(bridge.clearThoughtReminder).toHaveBeenCalledWith("work");
    expect(container.querySelector(".thought-card__reminder")).toBeNull();
  });

  it("keeps note reminder errors recoverable and Escape only dismisses the editor", async () => {
    await click(buttonByLabel("Open thought: Alpha work thought"));
    await nextFrame();
    await click(buttonByLabel("Set note reminder"));
    await typeInto(inputByLabel("Note reminder date and time"), "2020-01-01T10:30");
    await click(buttonByText("set reminder"));
    expect(document.querySelector('.note-reminder__popover [role="alert"]')?.textContent).toContain("Choose a reminder time in the future");
    expect(bridge.setThoughtReminder).not.toHaveBeenCalled();
    await typeInto(inputByLabel("Note reminder date and time"), "2026-09-02T10:30");
    bridge.setThoughtReminder.mockRejectedValueOnce(new Error("Storage is locked"));
    await click(buttonByText("set reminder"));
    expect(document.querySelector('.note-reminder__popover [role="alert"]')?.textContent).toContain("Storage is locked");
    expect(inputByLabel("Note reminder date and time").value).toBe("2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();
    bridge.clearThoughtReminder.mockRejectedValueOnce(new Error("Could not cancel"));
    await click(buttonByLabel("Edit note reminder"));
    await click(buttonByLabel("Clear note reminder"));
    expect(document.querySelector('.note-reminder__popover [role="alert"]')?.textContent).toContain("Could not cancel");
    expect(buttonByLabelOrNull("Edit note reminder")).not.toBeNull();
    await press(inputByLabel("Note reminder date and time"), { key: "Escape" });
    expect(inputByLabelOrNull("Note reminder date and time")).toBeNull();
    expect(container.querySelector(".thought-detail")).not.toBeNull();
    expect(document.activeElement).toBe(buttonByLabel("Edit note reminder"));
  });

  it("opens a note notification and focuses its body", async () => {
    await act(async () => { reminderOpened?.({ thoughtId: "work", itemId: null }); });
    await nextFrame();
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("Alpha work thought");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Note document");
  });

  it("shows notification permission recovery and flushes note edits before scheduling", async () => {
    await click(buttonByLabel("Open thought: Alpha work thought"));
    await nextFrame();
    const body = documentElement();
    await typeDocument(body, "Updated note");
    bridge.setThoughtReminder.mockImplementationOnce(async (id: string, scheduledFor: string) => {
      expect(records.get(id)?.body).toBe("Updated note");
      return { ...records.get(id)!, reminder: { scheduledFor, state: "permission-denied", lastError: "Notifications off" } };
    });
    await click(buttonByLabel("Set note reminder"));
    await typeInto(inputByLabel("Note reminder date and time"), "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();
    expect(container.querySelector(".note-reminder-compact")?.textContent).toContain("notifications off");
    await click(buttonByLabel("Edit note reminder"));
    await click(buttonByText("open settings"));
    expect(bridge.openNotificationSettings).toHaveBeenCalledOnce();
  });

  it("schedules and clears an item reminder only inside checklist detail", async () => {
    expect(buttonByLabelOrNull("Set item reminder")).toBeNull();
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();

    await click(buttonByLabel("Set item reminder"));
    const dateInput = inputByLabel("Item reminder date and time");
    await typeInto(dateInput, "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();

    expect(bridge.setChecklistReminder).toHaveBeenCalledWith(
      "checklist",
      "item-one",
      new Date(2026, 8, 2, 10, 30).toISOString(),
    );
    expect(container.querySelector(".rich-editor__task-reminder .checklist-editor__reminder-state")?.textContent).toContain(
      "reminds",
    );
    await click(buttonByText("clear"));
    await flush();
    expect(bridge.clearChecklistReminder).toHaveBeenCalledWith("checklist", "item-one");
    expect(container.querySelector(".rich-editor__task-reminder .checklist-editor__reminder-state")).toBeNull();
  });

  it("defaults a new reminder to the next whole local hour and cancels without saving", async () => {
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));

    const dateInput = inputByLabel("Item reminder date and time");
    expect(dateInput.value).toMatch(/T\d{2}:00$/);
    expect(new Date(dateInput.value).getTime()).toBeGreaterThan(Date.now());
    await click(buttonByText("cancel"));

    expect(inputByLabelOrNull("Item reminder date and time")).toBeNull();
    expect(bridge.setChecklistReminder).not.toHaveBeenCalled();
  });

  it("shows permission recovery beside the affected reminder", async () => {
    bridge.setChecklistReminder.mockImplementationOnce(
      async (thoughtId: string, itemId: string, scheduledFor: string) => {
        const thought = records.get(thoughtId)!;
        const updated: Thought = {
          ...thought,
          checklistItems: thought.checklistItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  reminder: {
                    scheduledFor,
                    state: "permission-denied",
                    lastError: "Notifications are off for Brain Cache in macOS Settings.",
                  },
                }
              : item,
          ),
        };
        records.set(thoughtId, updated);
        return updated;
      },
    );
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));
    await typeInto(inputByLabel("Item reminder date and time"), "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();

    expect(container.querySelector(".rich-editor__task-reminder .checklist-editor__reminder-state")?.textContent).toContain(
      "notifications off",
    );
    await click(buttonByText("open settings"));
    expect(bridge.openNotificationSettings).toHaveBeenCalledOnce();
  });

  it("shows an actionable per-item error when macOS Settings cannot open", async () => {
    bridge.setChecklistReminder.mockImplementationOnce(
      async (thoughtId: string, itemId: string, scheduledFor: string) => {
        const thought = records.get(thoughtId)!;
        const updated: Thought = {
          ...thought,
          checklistItems: thought.checklistItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  reminder: {
                    scheduledFor,
                    state: "permission-denied",
                    lastError: "Notifications are off for Brain Cache in macOS Settings.",
                  },
                }
              : item,
          ),
        };
        records.set(thoughtId, updated);
        return updated;
      },
    );
    bridge.openNotificationSettings.mockRejectedValueOnce(
      new Error("macOS Notification Settings did not open."),
    );
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));
    await typeInto(inputByLabel("Item reminder date and time"), "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();

    await click(buttonByText("open settings"));
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "macOS Notification Settings did not open.",
    );
    expect(buttonByText("open settings").disabled).toBe(false);
  });

  it("renders pending, overdue, and scheduling-failed reminders with a retry path", async () => {
    const updateReminder = (
      thoughtId: string,
      itemId: string,
      scheduledFor: string,
      state: "pending" | "overdue" | "scheduling-failed",
      lastError: string | null = null,
    ) => {
      const thought = records.get(thoughtId)!;
      const updated: Thought = {
        ...thought,
        checklistItems: thought.checklistItems.map((item) =>
          item.id === itemId
            ? { ...item, reminder: { scheduledFor, state, lastError } }
            : item,
        ),
      };
      records.set(thoughtId, updated);
      return updated;
    };
    bridge.setChecklistReminder
      .mockImplementationOnce(async (thoughtId, itemId, scheduledFor) =>
        updateReminder(thoughtId, itemId, scheduledFor, "pending"),
      )
      .mockImplementationOnce(async (thoughtId, itemId, scheduledFor) =>
        updateReminder(thoughtId, itemId, scheduledFor, "overdue"),
      )
      .mockImplementationOnce(async (thoughtId, itemId, scheduledFor) =>
        updateReminder(
          thoughtId,
          itemId,
          scheduledFor,
          "scheduling-failed",
          "Notification service unavailable.",
        ),
      );

    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));
    await typeInto(inputByLabel("Item reminder date and time"), "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();
    expect(container.querySelector(".rich-editor__task-reminder .checklist-editor__reminder-state")?.textContent).toContain(
      "scheduling",
    );

    await click(buttonByLabel("Edit item reminder"));
    await click(buttonByText("update reminder"));
    await flush();
    expect(container.querySelector(".rich-editor__task-reminder .checklist-editor__reminder-state")?.textContent).toContain(
      "overdue since",
    );

    await click(buttonByLabel("Edit item reminder"));
    await click(buttonByText("update reminder"));
    await flush();
    expect(container.querySelector(".rich-editor__task-reminder .checklist-editor__reminder-state")?.textContent).toContain(
      "Notification service unavailable.",
    );
    await click(buttonByText("retry"));
    expect(inputByLabel("Item reminder date and time")).not.toBeNull();
  });

  it("keeps the reminder editor recoverable when scheduling fails", async () => {
    bridge.setChecklistReminder.mockRejectedValueOnce(new Error("Scheduling stayed local."));
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));
    const dateInput = inputByLabel("Item reminder date and time");
    await typeInto(dateInput, "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Scheduling stayed local.",
    );
    expect(inputByLabel("Item reminder date and time").value).toBe("2026-09-02T10:30");
    expect(buttonByText("set reminder").disabled).toBe(false);
  });

  it("keeps a reminder visible with a recoverable error when clearing fails", async () => {
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));
    await typeInto(inputByLabel("Item reminder date and time"), "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    await flush();
    bridge.clearChecklistReminder.mockRejectedValueOnce(new Error("Clear did not reach macOS."));

    await click(buttonByText("clear"));
    await flush();

    expect(container.querySelector(".rich-editor__task-reminder .checklist-editor__reminder-state")?.textContent).toContain(
      "reminds",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Clear did not reach macOS.",
    );
    expect(buttonByText("clear").disabled).toBe(false);
  });

  it("opens the delivered reminder's thought and focuses its exact checklist item", async () => {
    await act(async () => {
      reminderOpened?.({ thoughtId: "checklist", itemId: "item-three" });
      await Promise.resolve();
    });
    await flush();
    await vi.waitFor(async () => {
      await nextFrame();
      expect(container.querySelector(".thought-detail--focus")).not.toBeNull();
      expect(document.activeElement).toBe(documentElement());
      expect(documentElement().editor.state.selection.$from.node(2).attrs.id).toBe("item-three");
    });
  });

  it("retains the Focus Lens tag draft and exposes a recoverable alert after mutation failure", async () => {
    bridge.addThoughtTag.mockRejectedValueOnce(new Error("The local write failed."));
    await openThought("Alpha work thought");
    const editor = detailTagInput();
    await typeInto(editor, "retry-me");
    await press(editor, { key: "Enter" });
    await flush();
    await nextFrame();

    expect(detailTagInput().value).toBe("retry-me");
    expect(container.querySelector('.thought-detail__tags [role="alert"]')?.textContent).toContain(
      "The local write failed.",
    );
    expect(buttonByLabelOrNull("Remove tag retry-me")).toBeNull();
    expect(document.activeElement).toBe(detailTagInput());
  });

  it("renders a deterministic single-select rail with roving keyboard focus", async () => {
    const radios = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.tag-rail [role="radio"]'),
    );
    expect(radios.map((button) => button.textContent?.trim())).toEqual([
      "All",
      "#design",
      "#work",
    ]);
    expect(radios.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");

    await act(async () => radios[0].focus());
    await press(radios[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
    await press(radios[1], { key: "Enter" });
    await nextFrame();

    expect(buttonByLabel("Filter by tag design").getAttribute("aria-checked")).toBe("true");
    expect(container.querySelectorAll(".thought-card")).toHaveLength(1);
    await press(buttonByLabel("Filter by tag design"), { key: " " });
    await nextFrame();
    expect(container.querySelector('.tag-rail [aria-checked="true"]')?.textContent).toBe("All");
    expect(document.activeElement).toBe(radios[0]);
  });

  it("finds newly attached tags as you type without selecting a suggestion", async () => {
    await openThought("Alpha work thought");
    await typeInto(inputByLabel("Add a tag to this thought"), "planning");
    await press(inputByLabel("Add a tag to this thought"), { key: "Enter" });
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    const search = inputByLabel("Search your cache");
    await act(async () => search.focus());
    for (const query of ["PLAN", "#plan", "Alpha #plan"]) {
      await typeInto(search, query);
      expect(container.querySelectorAll(".thought-card")).toHaveLength(1);
      expect(container.querySelector(".thought-card")?.textContent).toContain("Alpha work thought");
      expect(container.querySelector('.tag-rail [aria-checked="true"]')?.textContent).toBe("All");
    }
    await press(search, { key: "Escape" });
    expect(container.querySelectorAll(".thought-card")).toHaveLength(1);
    await typeInto(search, "#missing");
    expect(container.querySelectorAll(".thought-card")).toHaveLength(0);
    await typeInto(search, "");
    expect(container.querySelectorAll(".thought-card")).toHaveLength(3);
  });

  it("turns only a selected search hashtag suggestion into the active tag", async () => {
    const search = inputByLabel("Search your cache");
    await act(async () => search.focus());
    await typeInto(search, "Alpha #WO");

    expect(container.querySelector('[aria-label="Tag suggestions"]')?.textContent).toContain(
      "work",
    );
    await press(search, { key: "Enter" });
    await nextFrame();

    expect(search.value).toBe("Alpha");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(buttonByLabel("Filter by tag work"));
    expect(container.querySelectorAll(".thought-card")).toHaveLength(1);

    await act(async () => search.focus());
    await typeInto(search, "C#");
    expect(container.querySelector('[aria-label="Tag suggestions"]')).toBeNull();
    expect(search.value).toBe("C#");

    await typeInto(search, "#missing");
    await press(search, { key: "Enter" });
    expect(search.value).toBe("#missing");
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("true");

    await typeInto(search, "notes #DES");
    await press(search, { key: "Enter" });
    await nextFrame();
    expect(search.value).toBe("notes");
    expect(buttonByLabel("Filter by tag design").getAttribute("aria-checked")).toBe("true");
  });

  it("keeps an active archived-only tag visible after its newest active thought is archived", async () => {
    await click(buttonByLabel("Filter by tag work"));
    await openThought("Alpha work thought");
    await click(buttonByLabel("Delete"));
    await flush();
    await nextFrame();

    const workFilter = buttonByLabel("Filter by tag work");
    expect(workFilter.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelectorAll(".thought-card")).toHaveLength(0);
  });

  it("omits the empty rail and restores the compact tag entry point", async () => {
    await openThought("Alpha work thought");
    await click(buttonByLabel("Remove tag work"));
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    await openThought("Alpha design thought");
    await click(buttonByLabel("Remove tag design"));
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    await click(buttonByText("Trash"));
    await openThought("Alpha archived work");
    await click(buttonByLabel("Remove tag work"));
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    expect(container.querySelector(".tag-rail-shell")).toBeNull();
    expect(buttonByLabel("Filter by tag")).not.toBeNull();
  });

  it("combines tag retrieval with the current nav and body query, then clears only the tag", async () => {
    await click(buttonByText("Today"));
    const search = inputByLabel("Search your cache");
    await typeInto(search, "Alpha");
    await click(buttonByText("More…"));
    const filterInput = inputByLabel("Choose a tag filter");
    await typeInto(filterInput, "wo");
    await press(filterInput, { key: "Enter" });
    await flush();
    await nextFrame();

    expect(container.querySelector(".results-announcement")?.textContent).toContain(
      "1 thought tagged #work in Today",
    );
    expect(container.querySelectorAll(".thought-card")).toHaveLength(1);
    expect(document.activeElement).toBe(buttonByLabel("Filter by tag work"));
    await openThought("Alpha work thought");
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("Alpha work thought");
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    await click(buttonByLabel("Filter by tag work"));
    expect(inputByLabel("Search your cache").value).toBe("Alpha");
    expect(buttonByText("Today").className).toContain("nav-item--active");
    expect(container.querySelectorAll(".thought-card")).toHaveLength(2);
  });

  it("opens the filtered result without a permanent inspector and implements the search shortcut", async () => {
    expect(container.querySelector(".inspector")).toBeNull();
    await click(buttonByText("More…"));
    const filterInput = inputByLabel("Choose a tag filter");
    await typeInto(filterInput, "des");
    await press(filterInput, { key: "Enter" });
    await flush();
    await openThought("Alpha design thought");
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("Alpha design thought");
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(inputByLabel("Search your cache"));
  });

  it("does not apply an unmatched draft when tag creation is disabled", async () => {
    await click(buttonByText("More…"));
    const filterInput = inputByLabel("Choose a tag filter");
    await typeInto(filterInput, "missing");

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await press(filterInput, { key: "Enter" });

    expect(container.querySelector('.tag-rail__popover [role="alert"]')?.textContent).toBe(
      "Choose an existing tag.",
    );
    expect(buttonByLabel("Filter by tag work").getAttribute("aria-checked")).toBe("false");
    expect(inputByLabel("Choose a tag filter").value).toBe("missing");
  });

  it("layers filter Escape and restores trigger focus", async () => {
    const trigger = buttonByText("More…");
    await click(trigger);
    const filterInput = inputByLabel("Choose a tag filter");
    await typeInto(filterInput, "wo");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    await press(filterInput, { key: "Escape" });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(inputByLabelOrNull("Choose a tag filter")).not.toBeNull();

    await press(filterInput, { key: "Escape" });
    await nextFrame();
    expect(inputByLabelOrNull("Choose a tag filter")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns filter focus after dismissal from a non-focusable outside heading", async () => {
    await click(buttonByText("More…"));
    const filterInput = inputByLabel("Choose a tag filter");
    await typeInto(filterInput, "work");
    await press(filterInput, { key: "Enter" });
    await nextFrame();

    const selectedTag = buttonByLabel("Filter by tag work");
    expect(document.activeElement).toBe(selectedTag);
    const trigger = buttonByText("More…");
    await click(trigger);
    expect(inputByLabelOrNull("Choose a tag filter")).not.toBeNull();
    await act(async () => {
      container
        .querySelector(".thoughts-toolbar h1")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await nextFrame();
    expect(inputByLabelOrNull("Choose a tag filter")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("preserves deliberate outside focus when a focusable control dismisses the filter", async () => {
    const trigger = buttonByText("More…");
    await click(trigger);
    expect(inputByLabelOrNull("Choose a tag filter")).not.toBeNull();

    const outsideButton = container.querySelector(".new-thought-button") as HTMLButtonElement;
    await act(async () => {
      outsideButton.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      outsideButton.focus();
    });
    await nextFrame();

    expect(inputByLabelOrNull("Choose a tag filter")).toBeNull();
    expect(document.activeElement).toBe(outsideButton);
  });

  it("preserves a Focus Lens tag and returns focus to its remove control after removal failure", async () => {
    bridge.removeThoughtTag.mockRejectedValueOnce(new Error("The tag stayed local."));
    await openThought("Alpha work thought");
    await click(buttonByLabel("Remove tag work"));
    await flush();
    await nextFrame();

    expect(bridge.removeThoughtTag).toHaveBeenCalledWith("work", "work");
    expect(container.querySelector(".thought-detail__tags")?.textContent).toContain("#work");
    expect(container.querySelector('.thought-detail__tags [role="alert"]')?.textContent).toBe(
      "The tag stayed local.",
    );
    expect(document.activeElement).toBe(buttonByLabel("Remove tag work"));
  });

  it("announces Focus Lens tag persistence while the transaction is pending", async () => {
    let settle: ((thought: Thought) => void) | undefined;
    bridge.addThoughtTag.mockImplementationOnce(
      () =>
        new Promise<Thought>((resolve) => {
          settle = resolve;
        }),
    );
    await openThought("Alpha work thought");
    const editor = detailTagInput();
    await typeInto(editor, "waiting");
    await press(editor, { key: "Enter" });

    expect(container.querySelector(".thought-detail-tag-editor")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('.thought-detail-tag-editor [role="status"]')?.textContent).toBe(
      "adding #waiting…",
    );

    const original = records.get("work")!;
    const updated = { ...original, tags: [...original.tags, "waiting"] };
    await act(async () => {
      settle?.(updated);
      await Promise.resolve();
    });
    expect(container.querySelector(".thought-detail__tags")?.textContent).toContain("#waiting");
  });

  it("opens a modal Focus Lens above the two-region library and focuses the editable body", async () => {
    expect(container.querySelector(".inspector")).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await openThought("Alpha work thought");

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain("thought-detail--focus");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(true);
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("Alpha work thought");
    expect(document.activeElement).toBe(documentElement());
    expect(buttonByLabel("Expand")).not.toBeNull();
  });

  it.each(["Focus Lens", "Canvas Drill-In"])("shows only non-image attachments in the Files section in %s", async (mode) => {
    const note = records.get("work")!;
    note.attachments = [
      { id: "inline", name: "inline.png", mimeType: "image/png", size: 5 },
      { id: "loose", name: "photo.jpg", mimeType: "image/jpeg", size: 5 },
      { id: "pdf", name: "report.pdf", mimeType: "application/pdf", size: 5 },
      { id: "text", name: "notes.txt", mimeType: "text/plain", size: 5 },
    ];
    note.richDocument = { type: "doc", content: [paragraph(note.body), { type: "cacheImage", attrs: { attachmentId: "inline" } }] };
    await openThought(note.body);
    if (mode === "Canvas Drill-In") await click(buttonByLabel("Expand"));
    const files = container.querySelector('.thought-detail .attachment-area')!;
    expect(files.querySelectorAll('.attachment-file')).toHaveLength(2);
    expect(files.textContent).toContain("report.pdf");
    expect(files.textContent).toContain("notes.txt");
    expect(files.textContent).not.toContain("inline.png");
    expect(files.textContent).not.toContain("photo.jpg");
    expect(files.querySelector('img')).toBeNull();
    expect(documentElement().querySelector('img')?.alt).toBe("inline.png");
    expect(records.get("work")?.attachments).toHaveLength(4);
    expect(bridge.removeThoughtAttachment).not.toHaveBeenCalled();
  });

  it.each(["Note", "Details"] as const)("adds images from %s into the visible Note editor and documents into Files, preserving both after reopening", async (tab) => {
    const image = { id: crypto.randomUUID(), name: "photo.png", data: btoa("image") };
    const pdf = { id: crypto.randomUUID(), name: "report.pdf", data: btoa("pdf") };
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.chooseAttachmentFiles.mockResolvedValue([image, pdf]);
    await openThought("Alpha work thought");
    const body = documentElement();
    await click(detailTab(tab));
    expect(detailTab(tab).getAttribute("aria-selected")).toBe("true");
    await click(buttonByText("add files"));
    await flush();
    await nextFrame();
    expect(detailTab("Note").getAttribute("aria-selected")).toBe("true");
    expect(documentElement()).toBe(body);
    expect(body.closest("[hidden]")).toBeNull();
    expect(document.activeElement).toBe(body);
    expect(records.get("work")?.attachments).toEqual([draftMetadata(image), draftMetadata(pdf)]);
    expect(body.querySelector('img')?.alt).toBe("photo.png");
    expect(records.get("work")?.richDocument?.content.filter((node) => node.type === "cacheImage")).toEqual([
      { type: "cacheImage", attrs: { attachmentId: image.id } },
    ]);
    const files = container.querySelector('.thought-detail .attachment-area')!;
    expect(files.querySelectorAll('.attachment-file')).toHaveLength(1);
    expect(files.querySelector('.attachment-list')?.textContent).toContain("report.pdf");
    expect(files.querySelector('.attachment-list')?.textContent).not.toContain("photo.png");
    expect(files.querySelector('img')).toBeNull();
    await click(buttonByLabel("Close Focus Lens"));
    await openThought("Alpha work thought");
    expect(documentElement().querySelector('img')?.alt).toBe("photo.png");
    expect(container.querySelectorAll('.attachment-file')).toHaveLength(1);
    expect(records.get("work")?.attachments).toEqual([draftMetadata(image), draftMetadata(pdf)]);
  });

  it("keeps Details selected when Add files contains only a document", async () => {
    const pdf = { id: crypto.randomUUID(), name: "report.pdf", data: btoa("pdf") };
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.chooseAttachmentFiles.mockResolvedValue([pdf]);
    bridge.addThoughtAttachments.mockImplementationOnce(async (id: string, drafts: AttachmentDraft[]) => {
      const updated = { ...records.get(id)!, attachments: drafts.map(draftMetadata) };
      records.set(id, updated);
      return updated;
    });
    await openThought("Alpha work thought");
    const body = documentElement();
    await click(detailTab("Details"));
    await click(buttonByText("add files"));
    await flush();
    expect(detailTab("Details").getAttribute("aria-selected")).toBe("true");
    expect(body.closest("[hidden]")).not.toBeNull();
    expect(body.querySelector("img")).toBeNull();
    expect(container.querySelector('.thought-detail .attachment-list')?.textContent).toContain("report.pdf");
    expect(records.get("work")?.attachments).toEqual([draftMetadata(pdf)]);
    expect(bridge.updateRichDocument).not.toHaveBeenCalled();
  });

  it("retries images selected through Add files without duplicate attachments or image rows in Files", async () => {
    const image = { id: crypto.randomUUID(), name: "photo.png", data: btoa("image") };
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.chooseAttachmentFiles.mockResolvedValue([image]);
    bridge.updateRichDocument.mockRejectedValue(new Error("Storage unavailable"));
    await openThought("Alpha work thought");
    await click(buttonByText("add files"));
    expect(container.textContent).toContain("Storage unavailable");
    expect(records.get("work")?.attachments ?? []).toHaveLength(0);
    bridge.updateRichDocument.mockImplementation(saveRich);
    await click(buttonByText("retry saving"));
    await flush();
    expect(records.get("work")?.attachments).toHaveLength(1);
    expect(documentElement().querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('.attachment-list')).toBeNull();
    await click(buttonByLabel("Close Focus Lens"));
    expect(container.querySelector('.thought-detail')).toBeNull();
  });

  it("waits for attached files before closing and preserves concurrent body edits", async () => {
    const file = { id: crypto.randomUUID(), name: "report.pdf", data: btoa("image") };
    const original = records.get("work")!;
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.chooseAttachmentFiles.mockResolvedValue([file]);
    let finish!: () => void;
    bridge.addThoughtAttachments.mockImplementationOnce(() => new Promise<Thought>((resolve) => {
      finish = () => resolve({ ...original, attachments: [{ id: file.id, name: file.name, mimeType: "application/pdf", size: 5 }] });
    }));
    await openThought(original.body);
    await click(buttonByText("add files"));
    await typeDocument(documentElement(), "Edited during upload");
    await click(buttonByLabel("Close Focus Lens"));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finish());
    await flush();
    await nextFrame();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await openThought("Edited during upload");
    expect(container.querySelector('.attachment-list')?.textContent).toContain("report.pdf");
    await click(buttonByText("report.pdf"));
    expect(bridge.openAttachment).toHaveBeenCalledWith(expect.objectContaining({ id: file.id }));
  });

  it("pastes an image at the caret, persists its order, and preserves it during later card edits", async () => {
    bridge.readAttachmentData.mockResolvedValue("AP8R");
    await openThought("Alpha work thought");
    const input = documentElement();
    await act(async () => { input.editor.commands.setTextSelection(7); });
    const file = new File([new Uint8Array([0, 255, 17])], "", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file], items: [], getData: () => "" } });
    await act(async () => {
      input.dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(bridge.updateRichDocument.mock.calls.filter((call) => call[2]?.length)).toHaveLength(1);
    expect(records.get("work")!.richDocument?.content.map((block) => block.type === "paragraph" ? richText(block) : block.type)).toEqual(["Alpha ", "cacheImage", "work thought"]);
    await click(buttonByLabel("Close Focus Lens"));
    const card = container.querySelector('.rich-document--card')!;
    expect([...card.children].map((node) => node.tagName)).toEqual(["P", "IMG", "P"]);
    expect(card.querySelector('img')?.getAttribute('src')).toBe("data:image/png;base64,AP8R");
    await openThought("Alpha");
    const editor = documentElement().editor;
    const afterPosition = editor.state.doc.content.size - "work thought".length - 1;
    await act(async () => { editor.commands.insertContentAt({ from: afterPosition, to: editor.state.doc.content.size - 1 }, "Edited after the screenshot"); });
    await click(buttonByLabel("Close Focus Lens"));
    expect(records.get("work")!.richDocument?.content.map((block) => block.type === "paragraph" ? richText(block) : block.type)).toEqual(["Alpha ", "cacheImage", "Edited after the screenshot"]);
    expect(records.get("work")!.attachments).toHaveLength(1);
  });

  it("retries a failed inline image save without duplicating files or trapping the card open", async () => {
    let failImages = true;
    bridge.updateRichDocument.mockImplementation(async (id, document, drafts = []) => {
      if (failImages && drafts.length) throw new Error("Storage unavailable");
      return saveRich(id, document, drafts);
    });
    await openThought("Alpha work thought");
    const file = new File(["image"], "screenshot.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file], items: [], getData: () => "" } });
    await act(async () => {
      documentElement().dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.querySelector('.rich-document__image img')).not.toBeNull();
    expect(records.get("work")!.attachments ?? []).toHaveLength(0);
    failImages = false;
    await click(buttonByText("retry saving"));
    await click(buttonByLabel("Close Focus Lens"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(records.get("work")!.attachments).toHaveLength(1);
    expect(records.get("work")!.richDocument?.content.filter((block) => block.type === "cacheImage")).toHaveLength(1);
  });

  it("keeps an image failure contained to its preview so the card can still be opened", async () => {
    records.get("work")!.attachments = [{ id: "missing-image", name: "reference.png", mimeType: "image/png", size: 3 }];
    bridge.readAttachmentData.mockRejectedValue(new Error("Image unavailable"));
    await openThought("Alpha work thought");
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    const card = buttonByLabel("Open thought: Alpha work thought").closest(".thought-card")!;
    expect(card.textContent).toContain("Preview unavailable · reference.png");
    expect(card.textContent).toContain("Alpha work thought");
    await openThought("Alpha work thought");
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("Alpha work thought");
  });

  it("waits until an image card approaches the viewport before reading its stored bytes", async () => {
    let notify!: (entries: Array<{ isIntersecting: boolean }>) => void;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof notify) { notify = callback; }
      observe() {}
      disconnect = disconnect;
    });
    try {
      const thought = { ...records.get("work")!, id: "offscreen", body: "An image below the fold",
        attachments: [{ id: "lazy-image", name: "reference.png", mimeType: "image/png", size: 3 }] };
      await act(async () => bridge.listenForCreatedThought.mock.calls[0][0](thought));
      expect(bridge.readAttachmentData).not.toHaveBeenCalled();
      await act(async () => notify([{ isIntersecting: false }]));
      expect(bridge.readAttachmentData).not.toHaveBeenCalled();
      await act(async () => notify([{ isIntersecting: true }]));
      expect(bridge.readAttachmentData).toHaveBeenCalledWith("lazy-image");
      expect(disconnect).toHaveBeenCalled();
      const card = buttonByLabel("Open thought: An image below the fold").closest(".thought-card")!;
      expect(card.querySelector("img")?.getAttribute("alt")).toBe("Preview of reference.png");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retries failed file additions without closing the card or discarding selected bytes", async () => {
    const file = { id: crypto.randomUUID(), name: "report.pdf", data: btoa("pdf") };
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.chooseAttachmentFiles.mockResolvedValue([file]);
    bridge.addThoughtAttachments.mockRejectedValueOnce(new Error("Disk full")).mockResolvedValueOnce({ ...records.get("work")!, attachments: [{ id: file.id, name: file.name, mimeType: "application/pdf", size: 3 }] });
    await openThought("Alpha work thought");
    await click(buttonByText("add files"));
    expect(container.querySelector('.attachment-error')?.textContent).toContain("Disk full");
    await click(buttonByLabel("Close Focus Lens"));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click(buttonByText("retry"));
    expect(bridge.addThoughtAttachments).toHaveBeenNthCalledWith(2, "work", [file]);
    expect(container.querySelector('.attachment-list')?.textContent).toContain("report.pdf");
    bridge.removeThoughtAttachment.mockRejectedValueOnce(new Error("Removal failed")).mockResolvedValueOnce({ ...records.get("work")!, attachments: [] });
    await click(buttonByLabel("Remove attachment report.pdf"));
    expect(container.querySelector('.attachment-list')?.textContent).toContain("report.pdf");
    await click(buttonByText("retry"));
    expect(container.querySelector('.attachment-list')).toBeNull();
  });

  it("autosaves body edits without a save button, changing identity, or moving the caret", async () => {
    const original = records.get("work")!;
    await openThought("Alpha work thought");
    const body = documentElement();
    await typeDocument(body, "  Revised work thought\r\nwith context  ");

    await flush();

    expect(bridge.updateRichDocument).toHaveBeenCalledWith(
      "work",
      { type: "doc", content: [paragraph("  Revised work thought"), paragraph("with context  ")] }, [],
    );
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("  Revised work thought\nwith context  ");
    expect(body.editor.state.selection.from).toBe(body.editor.state.doc.content.size - 1);
    expect(buttonByText("save changes")).toBeUndefined();
    expect(records.get("work")).toMatchObject({ ...original, body: "Revised work thought\nwith context", richDocument: body.editor.getJSON() });
    expect(container.querySelector(".thought-detail__status")?.textContent).toContain(
      "saved locally",
    );
  });

  it("retains a body draft and offers retry when its automatic local write fails", async () => {
    bridge.updateRichDocument.mockRejectedValueOnce(new Error("The body stayed unchanged."));
    await openThought("Alpha work thought");
    const body = documentElement();
    await typeDocument(body, "recover this draft");
    await flush();
    await nextFrame();

    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("recover this draft");
    expect(container.querySelector('.thought-detail [role="alert"]')?.textContent).toBe(
      "The body stayed unchanged.",
    );
    expect(document.activeElement).toBe(body);
    await click(buttonByText("retry saving"));
    await flush();
    expect(records.get("work")?.body).toBe("recover this draft");
    expect(container.querySelector('.thought-detail [role="alert"]')).toBeNull();
  });

  it.each(["Note", "Details"] as const)("serializes rapid edits and waits for the latest write before closing from %s", async (tab) => {
    const original = records.get("work")!;
    const writes: Array<{ body: string; finish: () => void }> = [];
    bridge.updateRichDocument.mockImplementation((_id: string, document: RichDocument) => new Promise<Thought>((resolve) => {
      const body = richText(document);
      writes.push({ body, finish: () => {
        const updated = { ...original, body };
        records.set("work", updated);
        resolve(updated);
      } });
    }));
    await openThought("Alpha work thought");
    const body = documentElement();
    await typeDocument(body, "First edit");
    await typeDocument(body, "Latest edit");
    await act(async () => { body.editor.commands.setTextSelection(3); });
    expect(writes.map((write) => write.body)).toEqual(["First edit"]);
    await click(detailTab(tab));
    await click(buttonByLabel("Close Focus Lens"));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => writes[0].finish());
    await flush();
    expect(writes.map((write) => write.body)).toEqual(["First edit", "Latest edit"]);
    expect(richText(body.editor.getJSON() as RichDocument)).toBe("Latest edit");
    expect(body.editor.state.selection.from).toBe(3);
    expect(container.querySelector('.thought-detail__status')?.textContent).toContain("saving locally");
    await act(async () => writes[1].finish());
    await flush();
    await nextFrame();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(records.get("work")?.body).toBe("Latest edit");
    await openThought("Alpha design thought");
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("Alpha design thought");
  });

  it("retains failed drafts across remounts and prevents closing until they save", async () => {
    bridge.updateRichDocument.mockRejectedValue(new Error("Disk is unavailable."));
    await openThought("Alpha work thought");
    await typeDocument(documentElement(), "durable recovery draft");
    await click(buttonByLabel("Close Focus Lens"));
    await flush();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(records.get("work")?.body).toBe("Alpha work thought");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<LibraryApp />));
    await flush();
    await openThought("Alpha work thought");
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("durable recovery draft");
    bridge.updateRichDocument.mockImplementation(async (id: string, document: RichDocument) => {
      const updated = { ...records.get(id)!, body: richText(document), richDocument: document };
      records.set(id, updated);
      return updated;
    });
    await click(buttonByText("retry saving"));
    await flush();
    expect(records.get("work")?.body).toBe("durable recovery draft");
    expect(localStorage.getItem("brain-cache.card-draft.v1.work")).toBeNull();
  });

  it("does not let a delayed tag response overwrite an autosaved body", async () => {
    const original = records.get("work")!;
    let finishTag!: (thought: Thought) => void;
    bridge.addThoughtTag.mockImplementationOnce(() => new Promise<Thought>((resolve) => { finishTag = resolve; }));
    await openThought("Alpha work thought");
    await act(async () => detailTagInput().focus());
    await click(tagOption("design")!);
    await typeDocument(documentElement(), "Revised while tagging");
    await act(async () => finishTag({ ...original, tags: ["work", "design"] }));
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();
    await openThought("Revised while tagging");
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("Revised while tagging");
    expect(container.querySelector('.thought-detail__tags')?.textContent).toContain("#design");
  });

  it("autosaves existing and new checklist text without Enter, blur, or an Add click", async () => {
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await editTask(0, "Buy oat milk");
    await addTask("Book dentist");
    await flush();
    expect(records.get("checklist")?.checklistItems[0].text).toBe("Buy oat milk");
    expect(records.get("checklist")?.checklistItems.at(-1)?.text).toBe("Book dentist");
    await click(buttonByLabel("Expand"));
    await nextFrame();
    expect(richText(taskNodes().at(-1)!)).toBe("Book dentist");
    await click(buttonByLabel("Back to grid"));
    await nextFrame();
    await click(buttonByLabel("Open checklist: Buy oat milk"));
    await nextFrame();
    expect(richText(taskNodes()[0])).toBe("Buy oat milk");

    expect(container.querySelectorAll('.rich-editor ul[data-type="taskList"] > li')).toHaveLength(5);
    expect(buttonByText("save changes")).toBeUndefined();
  });

  it("keeps checklist typing responsive and preserves edits to two items while a write is pending", async () => {
    const original = records.get("checklist")!;
    const writes: Array<{ items: ChecklistItem[]; finish: () => void }> = [];
    bridge.updateRichDocument.mockImplementation((_id: string, document: RichDocument) => new Promise<Thought>((resolve) => {
      const items = projectRichDocument(document).items;
      writes.push({ items, finish: () => {
        const updated = { ...original, checklistItems: items, body: items.map((item) => item.text).join("\n") };
        records.set("checklist", updated);
        resolve(updated);
      } });
    }));
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await editTask(0, "Buy oat milk");
    expect(documentElement().editor.isEditable).toBe(true);
    await editTask(1, "Call Alex");
    expect(writes).toHaveLength(1);
    await act(async () => writes[0].finish());
    await flush();
    expect(richText(taskNodes()[1])).toBe("Call Alex");
    expect(writes[1].items.slice(0, 2).map((item) => item.text)).toEqual(["Buy oat milk", "Call Alex"]);
    await act(async () => writes[1].finish());
    await flush();
    expect(records.get("checklist")?.checklistItems[1].text).toBe("Call Alex");
  });

  it("preserves reminder metadata when checklist autosaving resumes after scheduling", async () => {
    let finish!: () => void;
    bridge.setChecklistReminder.mockImplementationOnce((id: string, itemId: string, scheduledFor: string) => new Promise<Thought>((resolve) => {
      finish = () => {
        const thought = records.get(id)!;
        const updated = { ...thought, checklistItems: thought.checklistItems.map((item) => item.id === itemId
          ? { ...item, reminder: { scheduledFor, state: "scheduled" as const, lastError: null } } : item) };
        records.set(id, updated);
        resolve(updated);
      };
    }));
    await click(buttonByLabel("Open checklist: Buy milk"));
    await nextFrame();
    await click(buttonByLabel("Set item reminder"));
    await typeInto(inputByLabel("Item reminder date and time"), "2026-09-02T10:30");
    await click(buttonByText("set reminder"));
    expect(documentElement().editor.isEditable).toBe(false);
    await act(async () => finish());
    await flush();
    expect(documentElement().editor.isEditable).toBe(true);
    await editTask(0, "Buy oat milk");
    await addTask("Book dentist");
    await flush();
    expect(records.get("checklist")?.checklistItems[0]).toMatchObject({ text: "Buy oat milk", reminder: { state: "scheduled" } });
    expect(records.get("checklist")?.checklistItems.at(-1)?.text).toBe("Book dentist");
  });

  it("finishes autosaving before archive and preserves the edited body", async () => {
    const original = records.get("work")!;
    let finish!: () => void;
    bridge.updateRichDocument.mockImplementationOnce((_id: string, document: RichDocument) => new Promise<Thought>((resolve) => {
      const body = richText(document);
      finish = () => {
        const updated = { ...original, body };
        records.set("work", updated);
        resolve(updated);
      };
    }));
    await openThought("Alpha work thought");
    await typeDocument(documentElement(), "Keep this when archived");
    await click(buttonByLabel("Delete"));
    await click(buttonByLabel("Delete"));
    expect(bridge.setThoughtArchived).not.toHaveBeenCalled();
    await act(async () => finish());
    await flush();
    await nextFrame();
    expect(bridge.setThoughtArchived).toHaveBeenCalledTimes(1);
    expect(records.get("work")).toMatchObject({ body: "Keep this when archived", archived: true });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("expands the same draft into Canvas Drill-In and preserves editing focus", async () => {
    await openThought("Alpha work thought");
    const body = documentElement();
    await typeDocument(body, "unfinished canvas draft");
    body.focus();

    await click(buttonByLabel("Expand"));
    await nextFrame();

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain("thought-detail--canvas");
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(container.querySelector(".library-layout")?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".thoughts-pane")?.hasAttribute("inert")).toBe(true);
    expect(richText(documentElement().editor.getJSON() as RichDocument)).toBe("unfinished canvas draft");
    expect(document.activeElement).toBe(documentElement());
    expect(buttonByLabel("Back to grid")).not.toBeNull();
  });

  it("returns from Canvas Drill-In to the prior query, scroll position, card selection, and focus", async () => {
    await click(buttonByText("Today"));
    const search = inputByLabel("Search your cache");
    await typeInto(search, "Alpha");
    await click(buttonByText("More…"));
    const filterInput = inputByLabel("Choose a tag filter");
    await typeInto(filterInput, "des");
    await press(filterInput, { key: "Enter" });
    await nextFrame();
    const pane = container.querySelector(".thoughts-pane") as HTMLElement;
    pane.scrollTop = 184;

    await openThought("Alpha design thought");
    await click(buttonByLabel("Expand"));
    await nextFrame();
    await click(buttonByLabel("Back to grid"));
    await nextFrame();

    const returnedCard = buttonByLabel("Open thought: Alpha design thought");
    expect(inputByLabel("Search your cache").value).toBe("Alpha");
    expect(buttonByText("Today").className).toContain("nav-item--active");
    expect(buttonByLabel("Filter by tag design").getAttribute("aria-checked")).toBe("true");
    expect(pane.scrollTop).toBe(184);
    expect(returnedCard.closest(".thought-card")?.className).toContain("thought-card--selected");
    expect(document.activeElement).toBe(returnedCard);
  });

  it("archives from Focus Lens and returns focus to the correct remaining card", async () => {
    await openThought("Alpha work thought");
    await click(buttonByLabel("Delete"));
    await flush();
    await nextFrame();

    expect(bridge.setThoughtArchived).toHaveBeenCalledWith("work", true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(buttonByLabelOrNull("Open thought: Alpha work thought")).toBeNull();
    const remaining = buttonByLabel("Open thought: Alpha design thought");
    expect(remaining.closest(".thought-card")?.className).toContain("thought-card--selected");
    expect(document.activeElement).toBe(remaining);
  });

  it("keeps Canvas Drill-In open with an actionable alert when archive persistence fails", async () => {
    bridge.setThoughtArchived.mockRejectedValueOnce(new Error("Archive stayed unchanged."));
    await openThought("Alpha work thought");
    await click(buttonByLabel("Expand"));
    await nextFrame();
    await click(buttonByLabel("Delete"));
    await flush();

    expect(container.querySelector(".thought-detail--canvas")).not.toBeNull();
    expect(container.querySelector('.thought-detail [role="alert"]')?.textContent).toBe(
      "Archive stayed unchanged.",
    );
    expect(buttonByLabel("Open thought: Alpha work thought")).not.toBeNull();
  });

  it("falls back to search focus when an edit removes the selected card from the query", async () => {
    const search = inputByLabel("Search your cache");
    await typeInto(search, "Alpha work");
    await openThought("Alpha work thought");
    const body = documentElement();
    await typeDocument(body, "No longer matches");
    await press(body, { key: "Enter", metaKey: true });
    await flush();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();

    expect(container.querySelectorAll(".thought-card")).toHaveLength(0);
    expect(document.activeElement).toBe(search);
  });

  it("layers tag dismissal before Focus Lens dismissal and restores the opener", async () => {
    const opener = buttonByLabel("Open thought: Alpha work thought");
    await openThought("Alpha work thought");
    const tagInput = detailTagInput();
    await act(async () => tagInput.focus());
    await typeInto(tagInput, "des");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    await press(tagInput, { key: "Escape" });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await press(tagInput, { key: "Escape" });
    await nextFrame();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("formats text with the toolbar, undoes and redoes formatting, and reopens the saved document", async () => {
    await openThought("Alpha work thought");
    const editor = documentElement().editor;
    expect(bridge.updateRichDocument).not.toHaveBeenCalled();
    await act(async () => { editor.commands.selectAll(); });
    await click(buttonByLabel("Bold"));
    await click(buttonByLabel("Italic"));
    await click(buttonByLabel("Underline"));
    expect(documentElement().querySelector('strong em u, strong u em, em strong u, em u strong, u strong em, u em strong')?.textContent).toBe("Alpha work thought");
    await click(buttonByLabel("Undo typing"));
    expect(documentElement().querySelector('u')).toBeNull();
    await click(buttonByLabel("Redo typing"));
    expect(documentElement().querySelector('u')).not.toBeNull();
    const style = container.querySelector<HTMLSelectElement>('[aria-label="Paragraph style"]')!;
    await act(async () => { style.value = "1"; style.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(documentElement().querySelector('h1')?.textContent).toBe("Alpha work thought");
    await click(buttonByLabel("Close Focus Lens"));
    const card = buttonByLabel("Open thought: Alpha work thought").closest('.thought-card')!;
    expect(card.querySelector('h1 strong')).not.toBeNull();
    await openThought("Alpha work thought");
    expect(documentElement().querySelector('h1 u')).not.toBeNull();
  });

  it.each(["Focus Lens", "Canvas Drill-In"])("switches the accessible Note and Details tabs by keyboard in %s", async (mode) => {
    await openThought("Alpha work thought");
    if (mode === "Canvas Drill-In") await click(buttonByLabel("Expand"));
    const note = detailTab("Note"), details = detailTab("Details");
    const notePanel = document.getElementById(note.getAttribute("aria-controls")!)!;
    const detailsPanel = document.getElementById(details.getAttribute("aria-controls")!)!;
    expect(note.closest('[role="tablist"]')?.getAttribute("aria-label")).toBe("Note views");
    expect(notePanel.getAttribute("role")).toBe("tabpanel");
    expect(detailsPanel.getAttribute("role")).toBe("tabpanel");
    expect(notePanel.getAttribute("aria-labelledby")).toBe(note.id);
    expect(detailsPanel.getAttribute("aria-labelledby")).toBe(details.id);
    expect(note.getAttribute("aria-selected")).toBe("true");
    expect(note.tabIndex).toBe(0);
    expect(details.tabIndex).toBe(-1);
    expect(notePanel.hidden).toBe(false);
    expect(detailsPanel.hidden).toBe(true);
    await act(async () => note.focus());
    await press(note, { key: "ArrowRight" });
    expect(document.activeElement).toBe(details);
    expect(details.getAttribute("aria-selected")).toBe("true");
    expect(details.tabIndex).toBe(0);
    expect(note.tabIndex).toBe(-1);
    expect(notePanel.hidden).toBe(true);
    expect(detailsPanel.hidden).toBe(false);
    expect(buttonByLabelOrNull("Bold")).toBeNull();
    expect(inputByLabelOrNull("Add a tag in Details")).not.toBeNull();
    await press(details, { key: "ArrowRight" });
    expect(document.activeElement).toBe(note);
    expect(note.getAttribute("aria-selected")).toBe("true");
    await press(note, { key: "End" });
    expect(document.activeElement).toBe(details);
    await press(details, { key: "Home" });
    expect(document.activeElement).toBe(note);
    await press(note, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(details);
    expect(bridge.updateRichDocument).not.toHaveBeenCalled();
  });

  it("keeps the editor, selection, and undo history intact when switching Note and Details", async () => {
    await openThought("Alpha work thought");
    const body = documentElement(), editor = body.editor;
    await act(async () => { editor.chain().setTextSelection({ from: 1, to: 6 }).run(); });
    await click(buttonByLabel("Bold"));
    expect(body.querySelector("strong")?.textContent).toBe("Alpha");
    const selection = editor.state.selection.toJSON();
    const formatted = editor.getJSON();
    const writes = bridge.updateRichDocument.mock.calls.length;
    await click(detailTab("Details"));
    expect(documentElement()).toBe(body);
    expect(body.editor).toBe(editor);
    expect(editor.isDestroyed).toBe(false);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    await click(detailTab("Note"));
    expect(documentElement()).toBe(body);
    expect(editor.getJSON()).toEqual(formatted);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(bridge.updateRichDocument).toHaveBeenCalledTimes(writes);
    expect(buttonByLabel("Undo typing").disabled).toBe(false);
    await click(buttonByLabel("Undo typing"));
    expect(body.querySelector("strong")).toBeNull();
    await click(detailTab("Details"));
    await click(detailTab("Note"));
    expect(buttonByLabel("Redo typing").disabled).toBe(false);
    await click(buttonByLabel("Redo typing"));
    expect(editor.getJSON()).toEqual(formatted);
    await click(buttonByLabel("Close Focus Lens"));
    await openThought("Alpha work thought");
    expect(documentElement().querySelector("strong")?.textContent).toBe("Alpha");
  });

  it("keeps a failed draft recoverable when closing from Details", async () => {
    bridge.updateRichDocument.mockRejectedValue(new Error("The disk is unavailable."));
    await openThought("Alpha work thought");
    const body = documentElement();
    await typeDocument(body, "Keep this unsaved note");
    await click(detailTab("Details"));
    await click(buttonByLabel("Close Focus Lens"));
    await flush();
    expect(container.querySelector(".thought-detail")).not.toBeNull();
    expect(detailTab("Details").getAttribute("aria-selected")).toBe("true");
    expect(documentElement()).toBe(body);
    expect(richText(body.editor.getJSON() as RichDocument)).toBe("Keep this unsaved note");
    expect(records.get("work")?.body).toBe("Alpha work thought");
    const status = container.querySelector<HTMLElement>('.thought-detail__save-row [role="alert"]')!;
    expect(status.textContent).toBe("The disk is unavailable.");
    expect(status.closest("[hidden]")).toBeNull();
    expect(localStorage.getItem("brain-cache.card-draft.v1.work")).toContain("Keep this unsaved note");
    bridge.updateRichDocument.mockImplementation(saveRich);
    await click(buttonByText("retry saving"));
    expect(records.get("work")?.body).toBe("Keep this unsaved note");
    expect(localStorage.getItem("brain-cache.card-draft.v1.work")).toBeNull();
    await click(buttonByLabel("Close Focus Lens"));
    await nextFrame();
    expect(container.querySelector(".thought-detail")).toBeNull();
    expect(document.activeElement).toBe(buttonByLabel("Open thought: Keep this unsaved note"));
  });

  it("changes the detail outline to pinned yellow only after saving and restores the tag outline on unpin", async () => {
    let finish!: (thought: Thought) => void;
    bridge.setThoughtPinned.mockImplementationOnce(() => new Promise<Thought>((resolve) => { finish = resolve; }));
    await openThought("Alpha work thought");
    const detail = container.querySelector(".thought-detail")!;
    const body = documentElement();
    const pin = buttonByLabel("Pin note");
    expect(detail.className).toContain("thought-outline--tagged");
    expect(detail.className).toContain("tag-color--moss");
    await click(pin);
    expect(pin.disabled).toBe(true);
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(detail.className).not.toContain("thought-outline--pinned");
    expect(detail.className).toContain("tag-color--moss");
    expect(bridge.setThoughtPinned).toHaveBeenCalledExactlyOnceWith("work", true);
    await act(async () => {
      const updated = { ...records.get("work")!, pinned: true };
      records.set("work", updated);
      finish(updated);
    });
    expect(detail.className).toContain("thought-outline--pinned");
    expect(detail.className).not.toContain("thought-outline--tagged");
    expect(buttonByLabel("Unpin note").getAttribute("aria-pressed")).toBe("true");
    expect(documentElement()).toBe(body);
    await click(buttonByLabel("Unpin note"));
    expect(detail.className).not.toContain("thought-outline--pinned");
    expect(detail.className).toContain("tag-color--moss");
    expect(buttonByLabel("Pin note").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".thought-card--pinned")).toBeNull();
  });

  it("keeps the prior detail outline and a visible error when pinning fails, then allows retry", async () => {
    bridge.setThoughtPinned.mockRejectedValueOnce(new Error("Pin could not be saved."));
    await openThought("Alpha work thought");
    await click(detailTab("Details"));
    await click(buttonByLabel("Pin note"));
    const detail = container.querySelector(".thought-detail")!;
    expect(detail.className).toContain("tag-color--moss");
    expect(detail.className).not.toContain("thought-outline--pinned");
    expect(buttonByLabel("Pin note").disabled).toBe(false);
    expect(buttonByLabel("Pin note").getAttribute("aria-pressed")).toBe("false");
    const error = detail.querySelector<HTMLElement>('.thought-detail__save-row [role="alert"]')!;
    expect(error.textContent).toBe("Pin could not be saved.");
    expect(error.closest("[hidden]")).toBeNull();
    await click(buttonByLabel("Pin note"));
    expect(detail.className).toContain("thought-outline--pinned");
    expect(detail.querySelector('.thought-detail__save-row [role="alert"]')).toBeNull();
    expect(detailTab("Details").getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    { name: "note body", thoughtId: "work", itemId: null, opener: "Open thought: Alpha work thought" },
    { name: "checklist item", thoughtId: "checklist", itemId: "item-three", opener: "Open checklist: Buy milk" },
  ])("opens a reminder's $name from Details and focuses its target in Note", async ({ thoughtId, itemId, opener }) => {
    await click(buttonByLabel(opener));
    await nextFrame();
    const body = documentElement();
    await click(detailTab("Details"));
    expect(detailTab("Details").getAttribute("aria-selected")).toBe("true");
    await act(async () => { reminderOpened?.({ thoughtId, itemId }); });
    await nextFrame();
    await nextFrame();
    expect(detailTab("Note").getAttribute("aria-selected")).toBe("true");
    expect(documentElement()).toBe(body);
    expect(document.activeElement).toBe(body);
    expect(body.closest("[hidden]")).toBeNull();
    if (itemId) {
      expect(container.querySelector(".rich-editor__task-reminder")?.textContent).toContain("Selected item: Ship build");
      let selectedTaskId: string | undefined;
      const selection = body.editor.state.selection.$from;
      for (let depth = selection.depth; depth > 0; depth--) {
        if (selection.node(depth).type.name === "taskItem") selectedTaskId = selection.node(depth).attrs.id;
      }
      expect(selectedTaskId).toBe(itemId);
    }
  });

  it("mixes paragraphs with lists and uses Enter to create and leave checklist rows", async () => {
    await openThought("Alpha work thought");
    await typeDocument(documentElement(), "Project notes\nFirst task");
    const editor = documentElement().editor;
    await click(buttonByLabel("Checklist"));
    const firstId = (editor.getJSON() as RichDocument).content[1].content![0].attrs!.id;
    await press(documentElement(), { key: "Enter" });
    await act(async () => { editor.commands.insertContent("Second task"); });
    await press(documentElement(), { key: "Enter" });
    await press(documentElement(), { key: "Enter" });
    await act(async () => { editor.commands.insertContent("Closing paragraph"); });
    await flush();
    const saved = records.get("work")!;
    expect(saved.checklistItems.map(item => item.text)).toEqual(["First task", "Second task"]);
    expect(saved.checklistItems[0].id).toBe(firstId);
    expect(new Set(saved.checklistItems.map(item => item.id)).size).toBe(2);
    expect(saved.richDocument?.content.map(node => node.type)).toEqual(["paragraph", "taskList", "paragraph"]);
    expect(saved.body).toBe("Project notes\nFirst task\nSecond task\nClosing paragraph");
    await click(buttonByLabel("Bulleted list"));
    expect(editor.isActive('bulletList')).toBe(true);
    await click(buttonByLabel("Numbered list"));
    expect(editor.isActive('orderedList')).toBe(true);
    await click(buttonByLabel("Numbered list"));
    expect(editor.isActive('paragraph')).toBe(true);
  });

  async function openThought(body: string) {
    await click(buttonByLabel(`Open thought: ${body}`));
    await nextFrame();
  }

  function detailTagInput(): HTMLInputElement {
    return inputByLabel("Add a tag to this thought");
  }

  function inputByLabel(label: string): HTMLInputElement {
    return inputByLabelOrNull(label) as HTMLInputElement;
  }

  function documentElement(): HTMLElement & { editor: Editor } {
    return container.querySelector('.rich-editor .rich-document') as HTMLElement & { editor: Editor };
  }

  async function saveRich(id: string, document: RichDocument, drafts: AttachmentDraft[] = []) {
    const thought = records.get(id)!;
    const attachments = [...(thought.attachments ?? []), ...drafts.map(draftMetadata)];
    const projection = projectRichDocument(document, attachments);
    const items = projection.items.map((item) => ({ ...item, reminder: item.completed ? null : thought.checklistItems.find((old) => old.id === item.id)?.reminder ?? null }));
    const updated = { ...thought, body: projection.body, kind: projection.kind, richDocument: document, document: undefined,
      checklistItems: items, taskCompletions: updateCompletionHistory(thought, items), attachments };
    records.set(id, updated);
    return updated;
  }

  function taskNodes() { return documentElement().editor.getJSON().content![0].content!; }
  async function editTask(index: number, text: string) {
    const editor = documentElement().editor;
    let target = 0;
    let count = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "taskItem" && count++ === index) target = pos; });
    const task = editor.state.doc.nodeAt(target)!;
    await act(async () => { editor.chain().focus().insertContentAt({ from: target + 2, to: target + task.nodeSize - 2 }, text).run(); });
  }
  async function addTask(text: string) {
    const editor = documentElement().editor;
    await act(async () => { editor.chain().setTextSelection(editor.state.doc.content.size - 3).splitListItem('taskItem').insertContent(text).run(); });
  }
  async function removeTask(index: number) {
    const editor = documentElement().editor;
    let target = 0, count = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "taskItem" && count++ === index) target = pos; });
    await act(async () => { editor.commands.deleteRange({ from: target, to: target + editor.state.doc.nodeAt(target)!.nodeSize }); });
  }

  function inputByLabelOrNull(label: string): HTMLInputElement | null {
    return visibleElements<HTMLInputElement>(`input[aria-label="${label}"]`)[0] ?? null;
  }

  function buttonByLabel(label: string): HTMLButtonElement {
    return buttonByLabelOrNull(label) as HTMLButtonElement;
  }

  function buttonByLabelOrNull(label: string): HTMLButtonElement | null {
    return visibleElements<HTMLButtonElement>(`button[aria-label="${label}"]`)[0] ?? null;
  }

  function buttonByText(text: string): HTMLButtonElement {
    return visibleElements<HTMLButtonElement>("button").find(
      (button) => button.textContent?.trim().includes(text),
    ) as HTMLButtonElement;
  }

  function detailButtonByText(text: string): HTMLButtonElement {
    return visibleElements<HTMLButtonElement>(".thought-detail button").find(
      (button) => button.textContent?.trim().includes(text),
    ) as HTMLButtonElement;
  }

  function visibleElements<T extends HTMLElement>(selector: string): T[] {
    return Array.from(document.querySelectorAll<T>(selector)).filter((element) => !element.closest("[hidden]"));
  }

  function tagOption(name: string): HTMLButtonElement | null {
    return visibleElements<HTMLButtonElement>('.thought-detail__tags [role="option"]').find(
      (option) => option.querySelector("strong")?.textContent === name,
    ) ?? null;
  }

  function detailTab(name: "Note" | "Details"): HTMLButtonElement {
    return visibleElements<HTMLButtonElement>('.thought-detail [role="tab"]').find((tab) => tab.textContent === name)!;
  }

});

describe("reminder local-time conversion", () => {
  it("rejects malformed and past local reminder values", () => {
    expect(() => reminderIsoFromLocalValue("not-a-date")).toThrow("valid reminder date");
    expect(() => reminderIsoFromLocalValue("2020-01-01T10:30")).toThrow("future");
  });

  it("rejects a nonexistent daylight-saving wall time", () => {
    const environment = (
      globalThis as typeof globalThis & {
        process: { env: Record<string, string | undefined> };
      }
    ).process.env;
    const previousTimeZone = environment.TZ;
    environment.TZ = "America/Chicago";
    try {
      expect(() => reminderIsoFromLocalValue("2027-03-14T02:30")).toThrow(
        "local time does not exist",
      );
    } finally {
      if (previousTimeZone === undefined) delete environment.TZ;
      else environment.TZ = previousTimeZone;
    }
  });
});

async function typeInto(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typeDocument(element: HTMLElement & { editor: Editor }, value: string) {
  await act(async () => {
    element.editor.chain().focus().setContent({ type: "doc", content: value.replace(/\r\n/g, "\n").split("\n").map(paragraph) }).run();
    element.editor.commands.setTextSelection(element.editor.state.doc.content.size - 1);
    element.editor.view.focus();
  });
}

async function press(element: HTMLElement, init: KeyboardEventInit) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function nextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
