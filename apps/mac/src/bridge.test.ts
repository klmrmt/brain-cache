import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addThoughtTag,
  addThoughtAttachments,
  removeThoughtAttachment,
  readAttachmentData,
  clearChecklistReminder,
  setThoughtReminder,
  clearThoughtReminder,
  captureChecklist,
  captureThought,
  getLightMode,
  getFontSize,
  getShortcutButtonVisible,
  listenForCaptureCommand,
  listenForLightMode,
  listenForFontSize,
  listenForShortcutButtonVisibility,
  listTagDefinitions,
  listTags,
  listThoughts,
  removeThoughtTag,
  replaceChecklistItems,
  resizeCapture,
  setChecklistReminder,
  setTagColor,
  setLightMode,
  setFontSize,
  type FontSize,
  setShortcutButtonVisible,
  setThoughtArchived,
  setThoughtCompleted,
  setThoughtPinned,
  updateThoughtBody,
  updateRichDocument,
} from "./bridge";

import { richDocumentForThought, paragraph, type RichDocument } from "./richDocument";

const browserStoreKey = "brain-cache.preview.thoughts";
const browserTagDefinitionStoreKey = "brain-cache.preview.tag-definitions";

describe("browser fallback bridge", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists rich documents, task reminders, completion history and formatting across conversions", async () => {
    const note = await captureChecklist(["First"], "mac-library", ["work"]);
    const task = note.checklistItems[0];
    await setThoughtPinned(note.id, true);
    await setChecklistReminder(note.id, task.id, "2099-02-03T16:00:00Z");
    const doc = richDocumentForThought(note);
    doc.content.unshift({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plan", marks: [{ type: "bold" }] }] });
    const saved = await updateRichDocument(note.id, doc);
    expect(saved).toMatchObject({ body: "Plan\nFirst", pinned: true, tags: ["work"], checklistItems: [{ id: task.id, reminder: { state: "scheduled" } }] });
    const checked = await replaceChecklistItems(note.id, saved.checklistItems.map(item => ({ ...item, completed: true })));
    expect(checked.richDocument?.content[0]).toEqual(doc.content[0]);
    expect(checked.checklistItems[0].reminder).toBeNull();
    const converted = await updateRichDocument(note.id, { type: "doc", content: [paragraph("Finished project")] });
    expect(converted.kind).toBe("text");
    expect(converted.taskCompletions).toHaveLength(1);
    expect((await listThoughts())[0].richDocument).toEqual(converted.richDocument);
    expect((await listThoughts())[0].taskCompletions).toHaveLength(1);
    await expect(updateThoughtBody(note.id, "Overwrite")).rejects.toThrow("formatting");
  });

  it("saves image bytes atomically with rich content and rejects foreign references without changing storage", async () => {
    const note = await captureThought("Before", "mac-library");
    const file = { id: crypto.randomUUID(), name: "image.png", data: btoa("image") };
    const doc: RichDocument = { type: "doc", content: [paragraph("Before"), { type: "cacheImage", attrs: { attachmentId: file.id } }, paragraph("After")] };
    await updateRichDocument(note.id, doc, [file]);
    expect(await readAttachmentData(file.id)).toBe(file.data);
    expect((await listThoughts())[0].richDocument).toEqual(doc);
    await expect(removeThoughtAttachment(note.id, file.id)).rejects.toThrow("Remove this image from the document");
    const other = await captureThought("Other", "mac-library");
    const before = localStorage.getItem(browserStoreKey);
    await expect(updateRichDocument(other.id, doc)).rejects.toThrow("missing");
    expect(localStorage.getItem(browserStoreKey)).toBe(before);
    await updateRichDocument(note.id, { type: "doc", content: [paragraph("After removal")] });
    // Bytes remain available for editor Undo until explicitly removed from the shelf.
    expect(await readAttachmentData(file.id)).toBe(file.data);
    await removeThoughtAttachment(note.id, file.id);
    await expect(readAttachmentData(file.id)).rejects.toThrow();
  });

  it("persists completion, cancels reminders, and keeps deletion reversible", async () => {
    const note = await captureThought("Follow up", "mac-library", ["work"]);
    await setThoughtReminder(note.id, "2099-02-03T16:00:00Z");
    expect(await setThoughtCompleted(note.id, true)).toMatchObject({ completed: true, reminder: null, tags: ["work"] });
    expect((await listThoughts())[0].completed).toBe(true);
    await expect(setThoughtReminder(note.id, "2099-02-03T16:00:00Z")).rejects.toThrow("Reopen");
    await setThoughtArchived(note.id, true);
    await expect(setThoughtCompleted(note.id, false)).rejects.toThrow("Restore");
    expect(await setThoughtArchived(note.id, false)).toMatchObject({ completed: true, reminder: null });
    expect(await setThoughtCompleted(note.id, false)).toMatchObject({ completed: false, reminder: null });
  });

  it("completes remaining checklist items without changing earlier completion dates, and reopens on new work", async () => {
    const note = await captureChecklist(["One", "Two"], "mac-library");
    const checked = await replaceChecklistItems(note.id, note.checklistItems.map((item, i) => ({ ...item, completed: i === 0 })));
    await setThoughtReminder(note.id, "2099-02-03T16:00:00Z");
    await setChecklistReminder(note.id, note.checklistItems[1].id, "2099-02-03T16:00:00Z");
    const completed = await setThoughtCompleted(note.id, true);
    expect(completed.checklistItems.every((item) => item.completed && !item.reminder)).toBe(true);
    expect(completed.taskCompletions).toHaveLength(2);
    expect(completed.taskCompletions).toEqual(expect.arrayContaining(checked.taskCompletions!));
    expect(completed.reminder).toBeNull();
    expect((await setThoughtCompleted(note.id, true)).taskCompletions).toEqual(completed.taskCompletions);
    const reopened = await replaceChecklistItems(note.id, completed.checklistItems.map((item, i) => ({ ...item, completed: i === 0 })));
    expect(reopened.completed).toBe(false);
    expect(reopened.taskCompletions).toEqual(checked.taskCompletions);
  });

  it("leaves completion and reminders unchanged when persistence fails", async () => {
    const note = await captureThought("Follow up", "mac-library");
    await setThoughtReminder(note.id, "2099-02-03T16:00:00Z");
    const before = localStorage.getItem(browserStoreKey);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      await expect(setThoughtCompleted(note.id, true)).rejects.toThrow("Storage full");
      expect(localStorage.getItem(browserStoreKey)).toBe(before);
    } finally { write.mockRestore(); }
  });

  it("persists note reminders across edits, reschedules, clears, and archive", async () => {
    const note = await captureThought("Call Sam", "mac-library");
    const scheduled = await setThoughtReminder(note.id, "2099-02-03T10:15:00-06:00");
    expect(scheduled.reminder).toEqual({ scheduledFor: "2099-02-03T16:15:00.000Z", state: "scheduled", lastError: null });
    expect((await listThoughts())[0].reminder).toEqual(scheduled.reminder);
    expect((await updateThoughtBody(note.id, "Call Sam about the trip")).reminder).toEqual(scheduled.reminder);
    const updated = await setThoughtReminder(note.id, "2099-02-04T16:15:00Z");
    expect(updated.reminder?.scheduledFor).toBe("2099-02-04T16:15:00.000Z");
    expect((await clearThoughtReminder(note.id)).reminder).toBeNull();
    await setThoughtReminder(note.id, "2099-02-04T16:15:00Z");
    expect((await setThoughtArchived(note.id, true)).reminder).toBeNull();
    await expect(setThoughtReminder(note.id, "2099-02-04T16:15:00Z")).rejects.toThrow("Restore");
    expect((await setThoughtArchived(note.id, false)).reminder).toBeNull();
  });

  it("rejects invalid reminders and preserves the previous time on storage failure", async () => {
    const note = await captureThought("Call Sam", "mac-library");
    await expect(setThoughtReminder(note.id, "yesterday")).rejects.toThrow("valid");
    await expect(setThoughtReminder(note.id, "2020-01-01T00:00:00Z")).rejects.toThrow("future");
    await expect(setThoughtReminder("missing", "2099-02-04T16:15:00Z")).rejects.toThrow("no longer");
    await setThoughtReminder(note.id, "2099-02-04T16:15:00Z");
    const before = localStorage.getItem(browserStoreKey);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    await expect(setThoughtReminder(note.id, "2099-02-05T16:15:00Z")).rejects.toThrow();
    expect(localStorage.getItem(browserStoreKey)).toBe(before);
    write.mockRestore();
  });

  it("persists ordered documents and atomically rejects missing images", async () => {
    const file = { id: crypto.randomUUID(), name: "screenshot.png", data: btoa("image") };
    const blocks = [
      { id: "before", type: "text" as const, text: "Before" },
      { id: "image", type: "image" as const, attachmentId: file.id },
      { id: "after", type: "text" as const, text: "After" },
    ];
    const thought = await captureThought("ignored", "mac-capture", [], [], [file], blocks);
    expect(thought.body).toBe("Before\nAfter");
    expect((await listThoughts())[0].document).toEqual(blocks);
    const before = localStorage.getItem(browserStoreKey);
    await expect(updateThoughtBody(thought.id, "", [...blocks, { id: "missing", type: "image", attachmentId: "missing" }])).rejects.toThrow("missing");
    expect(localStorage.getItem(browserStoreKey)).toBe(before);
    await expect(updateThoughtBody(thought.id, "flattened")).rejects.toThrow("layout");
    const edited = blocks.map((block) => block.type === "text" && block.id === "after" ? { ...block, text: "Edited after" } : block);
    await updateThoughtBody(thought.id, "", edited);
    expect((await listThoughts())[0].document).toEqual(edited);
    await updateThoughtBody(thought.id, "", edited.filter((block) => block.type !== "image"));
    await expect(readAttachmentData(file.id)).rejects.toThrow("no longer");
  });

  it("persists task history, preserves removed completions, and reverses unchecking", async () => {
    const thought = await captureChecklist(["One", "Two"], "mac-library");
    const items = thought.checklistItems.map((item, index) => ({ ...item, completed: index === 0 }));
    const checked = await replaceChecklistItems(thought.id, items);
    expect(checked.taskCompletions).toHaveLength(1);
    expect(checked.taskCompletions?.[0].completedAt).toMatch(/Z$/);
    expect((await listThoughts())[0].taskCompletions).toEqual(checked.taskCompletions);
    const before = localStorage.getItem(browserStoreKey);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      await expect(replaceChecklistItems(thought.id, thought.checklistItems)).rejects.toThrow("Storage full");
      expect(localStorage.getItem(browserStoreKey)).toBe(before);
    } finally { write.mockRestore(); }
    expect((await replaceChecklistItems(thought.id, thought.checklistItems)).taskCompletions).toEqual([]);
    const again = await replaceChecklistItems(thought.id, items);
    await replaceChecklistItems(thought.id, [items[1]]);
    await setThoughtArchived(thought.id, true);
    expect((await listThoughts())[0].taskCompletions).toEqual(again.taskCompletions);
  });

  it("keeps legacy completed task dates unknown through edits and reload", async () => {
    const thought = await captureChecklist(["Old task"], "mac-library");
    thought.checklistItems[0].completed = true;
    localStorage.setItem(browserStoreKey, JSON.stringify([thought]));
    const edited = await replaceChecklistItems(thought.id, [{ ...thought.checklistItems[0], text: "Renamed" }]);
    expect(edited.taskCompletions).toEqual([{ itemId: thought.checklistItems[0].id, completedAt: null }]);
    expect((await listThoughts())[0].taskCompletions).toEqual(edited.taskCompletions);
  });

  it("saves file-only capture atomically and preserves bytes through later edits", async () => {
    const file = { id: crypto.randomUUID(), name: "photo.png", data: btoa("image bytes") };
    const thought = await captureThought("", "mac-capture", ["photos"], [], [file]);
    expect(thought.body).toBe("photo.png");
    expect(thought.attachments?.[0]).toMatchObject({ name: "photo.png", size: 11 });
    expect(JSON.stringify(await listThoughts())).not.toContain(file.data);
    await updateThoughtBody(thought.id, "A photo from today");
    await addThoughtTag(thought.id, "work");
    await setThoughtArchived(thought.id, true);
    await expect(readAttachmentData(file.id)).resolves.toBe(file.data);
    const other = await captureThought("Other", "mac-library");
    await expect(removeThoughtAttachment(other.id, file.id)).rejects.toThrow("no longer");
    await removeThoughtAttachment(thought.id, file.id);
    await expect(readAttachmentData(file.id)).rejects.toThrow("no longer");
  });

  it("adds files to checklists without replacing body or tags and rolls back on storage failure", async () => {
    const thought = await captureChecklist(["Read report"], "mac-library", ["work"]);
    const file = { id: crypto.randomUUID(), name: "report.pdf", data: btoa("pdf bytes") };
    const before = localStorage.getItem(browserStoreKey);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    await expect(addThoughtAttachments(thought.id, [file])).rejects.toThrow("Storage full");
    expect(localStorage.getItem(browserStoreKey)).toBe(before);
    write.mockRestore();
    const updated = await addThoughtAttachments(thought.id, [file]);
    expect(updated.body).toBe(thought.body);
    expect(updated.tags).toEqual(["work"]);
    await replaceChecklistItems(thought.id, thought.checklistItems.map((item) => ({ ...item, text: "Read revised report" })));
    await expect(readAttachmentData(file.id)).resolves.toBe(file.data);
  });

  it("persists a captured thought before returning it", async () => {
    const captured = await captureThought("  a durable thought  ", "mac-capture", [
      " Work ",
      "WORK",
    ]);

    expect(captured.body).toBe("a durable thought");
    expect(captured.tags).toEqual(["work"]);
    await expect(listThoughts()).resolves.toEqual([captured]);
  });

  it("persists pins across reload, edits, and archive without replacing attached bytes", async () => {
    const file = { id: crypto.randomUUID(), name: "photo.png", data: btoa("image bytes") };
    const thought = await captureThought("Original body", "mac-capture", ["work"], [], [file]);
    const pinned = await setThoughtPinned(thought.id, true);
    expect(pinned).toEqual({ ...thought, pinned: true });
    expect((await listThoughts())[0].pinned).toBe(true);
    await updateThoughtBody(thought.id, "Edited body");
    await setThoughtArchived(thought.id, true);
    expect((await listThoughts())[0]).toMatchObject({ pinned: true, archived: true, body: "Edited body" });
    await setThoughtArchived(thought.id, false);
    const unpinned = await setThoughtPinned(thought.id, false);
    expect(unpinned).toMatchObject({ pinned: false, createdAt: thought.createdAt, tags: ["work"] });
    await expect(readAttachmentData(file.id)).resolves.toBe(file.data);
    await expect(setThoughtPinned("missing", true)).rejects.toThrow("no longer");
  });

  it("leaves pins unchanged when a local write fails", async () => {
    const thought = await captureChecklist(["One task"], "mac-capture");
    const before = localStorage.getItem(browserStoreKey);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
    try {
      await expect(setThoughtPinned(thought.id, true)).rejects.toThrow("Storage full");
      expect(localStorage.getItem(browserStoreKey)).toBe(before);
    } finally {
      write.mockRestore();
    }
    expect((await setThoughtPinned(thought.id, true)).checklistItems).toEqual(thought.checklistItems);
  });

  it("keeps the ordinary untagged capture path optional", async () => {
    const captured = await captureThought("no organizing step", "mac-capture");

    expect(captured.tags).toEqual([]);
  });

  it("persists ordered checklist items and keeps body as a readable projection", async () => {
    const captured = await captureChecklist(
      [" Buy milk ", "Call Sam", "Ship build"],
      "mac-capture",
      ["Home"],
      [{ name: "home", color: "clay" }],
    );

    expect(captured).toMatchObject({
      body: "Buy milk\nCall Sam\nShip build",
      kind: "checklist",
      tags: ["home"],
      checklistItems: [
        { text: "Buy milk", completed: false },
        { text: "Call Sam", completed: false },
        { text: "Ship build", completed: false },
      ],
    });
    expect(new Set(captured.checklistItems.map((item) => item.id)).size).toBe(3);
    await expect(listThoughts()).resolves.toEqual([captured]);
    await expect(listTagDefinitions()).resolves.toEqual([{ name: "home", color: "clay" }]);
  });

  it("replaces checklist items atomically while preserving thought identity and metadata", async () => {
    const captured = await captureChecklist(["One", "Two", "Three"], "mac-library");
    const [one, two, three] = captured.checklistItems;
    const updated = await replaceChecklistItems(captured.id, [
      { ...two, text: "Second", completed: true },
      three,
      one,
    ]);

    expect(updated.body).toBe("Second\nThree\nOne");
    expect(updated.checklistItems.map(({ id, text, completed }) => ({ id, text, completed }))).toEqual([
      { id: two.id, text: "Second", completed: true },
      { id: three.id, text: "Three", completed: false },
      { id: one.id, text: "One", completed: false },
    ]);
    expect(updated.createdAt).toBe(captured.createdAt);
    expect(updated.source).toBe(captured.source);
    await expect(listThoughts()).resolves.toEqual([updated]);
    await expect(replaceChecklistItems(captured.id, [])).rejects.toThrow("at least one item");

    const textThought = await captureThought("plain", "mac-library");
    await expect(
      replaceChecklistItems(textThought.id, [
        { id: crypto.randomUUID(), text: "No", completed: false, reminder: null },
      ]),
    ).rejects.toThrow("not a checklist");
  });

  it("stores one absolute reminder per active item and clears it on completion", async () => {
    const captured = await captureChecklist(["Call Sam"], "mac-library");
    const item = captured.checklistItems[0];
    const scheduled = await setChecklistReminder(
      captured.id,
      item.id,
      "2099-02-03T10:15:00-06:00",
    );

    expect(scheduled.checklistItems[0].reminder).toEqual({
      scheduledFor: "2099-02-03T16:15:00.000Z",
      state: "scheduled",
      lastError: null,
    });
    const completed = await replaceChecklistItems(captured.id, [
      { ...scheduled.checklistItems[0], completed: true },
    ]);
    expect(completed.checklistItems[0].reminder).toBeNull();
  });

  it("validates and explicitly clears browser-preview reminder intent", async () => {
    const captured = await captureChecklist(["Pack bags"], "mac-library");
    const item = captured.checklistItems[0];
    await expect(
      setChecklistReminder(captured.id, item.id, "2020-01-01T00:00:00Z"),
    ).rejects.toThrow("future");
    await setChecklistReminder(captured.id, item.id, "2099-02-03T16:15:00Z");
    const cleared = await clearChecklistReminder(captured.id, item.id);
    expect(cleared.checklistItems[0].reminder).toBeNull();
    await expect(clearChecklistReminder(captured.id, item.id)).rejects.toThrow(
      "no reminder",
    );
  });

  it("rejects invalid reminder targets and clears reminders when a checklist is archived", async () => {
    const active = await captureChecklist(["Active item"], "mac-library");
    const activeItem = active.checklistItems[0];
    const future = "2099-02-03T16:15:00Z";

    await expect(setChecklistReminder(active.id, activeItem.id, "not-a-date")).rejects.toThrow(
      "valid reminder date",
    );
    await expect(setChecklistReminder("missing", activeItem.id, future)).rejects.toThrow(
      "no longer in the cache",
    );
    await expect(setChecklistReminder(active.id, "missing", future)).rejects.toThrow(
      "active, incomplete checklist items",
    );

    const completed = await replaceChecklistItems(active.id, [{ ...activeItem, completed: true }]);
    await expect(
      setChecklistReminder(completed.id, completed.checklistItems[0].id, future),
    ).rejects.toThrow("active, incomplete checklist items");

    const archivable = await captureChecklist(["Archive item"], "mac-library");
    const archiveItem = archivable.checklistItems[0];
    await setChecklistReminder(archivable.id, archiveItem.id, future);
    const archived = await setThoughtArchived(archivable.id, true);
    expect(archived.checklistItems[0].reminder).toBeNull();
    await expect(setChecklistReminder(archived.id, archiveItem.id, future)).rejects.toThrow(
      "active, incomplete checklist items",
    );

    const text = await captureThought("Plain thought", "mac-library");
    await expect(setChecklistReminder(text.id, archiveItem.id, future)).rejects.toThrow(
      "not a checklist",
    );
  });

  it("treats capture resizing as a browser-safe no-op", async () => {
    await expect(resizeCapture(154, 150)).resolves.toEqual({
      appliedHeight: 154,
      maxHeight: 154,
      constrained: false,
    });
    await expect(listThoughts()).resolves.toEqual([]);
  });

  it("persists shortcut-button visibility and delivers local recovery events", async () => {
    const visibility: boolean[] = [];
    const commands: string[] = [];
    const stopVisibility = await listenForShortcutButtonVisibility((visible) =>
      visibility.push(visible),
    );
    const stopCommands = await listenForCaptureCommand((command) => commands.push(command));

    await expect(getShortcutButtonVisible()).resolves.toBe(true);
    await expect(setShortcutButtonVisible(false)).resolves.toBe(false);
    await expect(getShortcutButtonVisible()).resolves.toBe(false);
    window.dispatchEvent(
      new CustomEvent("brain-cache:capture-command", { detail: "open-shortcuts" }),
    );

    expect(visibility).toEqual([false]);
    expect(commands).toEqual(["open-shortcuts"]);
    stopVisibility();
    stopCommands();
  });

  it("defaults to dark and notifies local listeners only after saving appearance", async () => {
    const notifications: Array<{ enabled: boolean; persisted: string | null }> = [];
    const stop = await listenForLightMode((enabled) => notifications.push({
      enabled,
      persisted: localStorage.getItem("brain-cache.preview.light-mode"),
    }));

    await expect(getLightMode()).resolves.toBe(false);
    await expect(setLightMode(true)).resolves.toBe(true);
    await expect(getLightMode()).resolves.toBe(true);
    await expect(setLightMode(false)).resolves.toBe(false);
    expect(notifications).toEqual([
      { enabled: true, persisted: "true" },
      { enabled: false, persisted: "false" },
    ]);
    stop();
    await setLightMode(true);
    expect(notifications).toHaveLength(2);
  });

  it("syncs appearance storage changes and clearing across tabs, then cleans up", async () => {
    const callback = vi.fn();
    const stop = await listenForLightMode(callback);
    const key = "brain-cache.preview.light-mode";

    localStorage.setItem(key, "true");
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: "true", storageArea: localStorage }));
    expect(callback).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: sessionStorage }));
    expect(callback).toHaveBeenCalledTimes(1);

    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(callback).toHaveBeenLastCalledWith(false);
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("retains the saved appearance and emits nothing when storage rejects a change", async () => {
    await setLightMode(true);
    const callback = vi.fn();
    const stop = await listenForLightMode(callback);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is full");
    });

    try {
      await expect(setLightMode(false)).rejects.toThrow("Storage is full");
      await expect(getLightMode()).resolves.toBe(true);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      stop();
    }
  });

  it("persists font size before notifying local listeners and cleans up", async () => {
    const notifications: Array<{ size: FontSize; persisted: string | null }> = [];
    const stop = await listenForFontSize((size) => notifications.push({
      size,
      persisted: localStorage.getItem("brain-cache.preview.font-size"),
    }));
    await expect(getFontSize()).resolves.toBe("default");
    for (const size of ["large", "extra-large", "default"] as const) {
      await expect(setFontSize(size)).resolves.toBe(size);
      await expect(getFontSize()).resolves.toBe(size);
    }
    expect(notifications).toEqual([
      { size: "large", persisted: "large" },
      { size: "extra-large", persisted: "extra-large" },
      { size: "default", persisted: "default" },
    ]);
    stop();
    await setFontSize("large");
    expect(notifications).toHaveLength(3);
  });

  it("syncs font size across tabs and resets cleared or unsupported stored sizes", async () => {
    const callback = vi.fn();
    const stop = await listenForFontSize(callback);
    const key = "brain-cache.preview.font-size";
    localStorage.setItem(key, "extra-large");
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
    expect(callback).toHaveBeenLastCalledWith("extra-large");
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: sessionStorage }));
    window.dispatchEvent(new CustomEvent("brain-cache:font-size-changed", { detail: "giant" }));
    expect(callback).toHaveBeenCalledTimes(1);

    localStorage.setItem(key, "giant");
    await expect(getFontSize()).resolves.toBe("default");
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
    expect(callback).toHaveBeenLastCalledWith("default");
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(callback).toHaveBeenLastCalledWith("default");
    stop();
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("keeps font size unchanged without events after an invalid input or failed save", async () => {
    await setFontSize("large");
    const callback = vi.fn();
    const stop = await listenForFontSize(callback);
    await expect(setFontSize("giant" as FontSize)).rejects.toThrow("supported font size");
    await expect(getFontSize()).resolves.toBe("large");
    expect(callback).not.toHaveBeenCalled();
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage is full");
    });
    try {
      await expect(setFontSize("extra-large")).rejects.toThrow("Storage is full");
      await expect(getFontSize()).resolves.toBe("large");
      expect(callback).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      stop();
    }
  });

  it("archives an existing thought", async () => {
    const captured = await captureThought("move this to cold storage", "mac-library");
    const archived = await setThoughtArchived(captured.id, true);

    expect(archived.archived).toBe(true);
    await expect(listThoughts()).resolves.toEqual([archived]);
  });

  it("updates a body without changing identity, metadata, archive state, or tags", async () => {
    const captured = await captureThought("original", "mac-library", ["work"]);
    const updated = await updateThoughtBody(captured.id, "  revised\r\nwith detail  ");

    expect(updated).toEqual({ ...captured, body: "revised\nwith detail" });
    await expect(listThoughts()).resolves.toEqual([updated]);
    await expect(updateThoughtBody(captured.id, " \n ")).rejects.toThrow(
      "Give Blob something to remember.",
    );
    await expect(updateThoughtBody("missing", "valid")).rejects.toThrow(
      "That thought is no longer in the cache.",
    );
  });

  it("rejects an empty capture", async () => {
    await expect(captureThought("   \n  ", "mac-capture")).rejects.toThrow(
      "Give Blob something to remember.",
    );
  });

  it("adds, reuses, and removes a canonical tag without changing thought fields", async () => {
    const captured = await captureThought("keep the original fields", "mac-library", ["work"]);
    const duplicate = await addThoughtTag(captured.id, " WORK ");
    const added = await addThoughtTag(captured.id, "Design");
    const removed = await removeThoughtTag(captured.id, "work");

    expect(duplicate).toEqual(captured);
    expect(added.tags).toEqual(["design", "work"]);
    expect(removed).toEqual({ ...captured, tags: ["design"] });
    expect(removed.body).toBe(captured.body);
    expect(removed.createdAt).toBe(captured.createdAt);
    await expect(listThoughts()).resolves.toEqual([removed]);
  });

  it("suggests vocabulary from active and archived assignments and drops orphans", async () => {
    const active = await captureThought("active", "mac-library", ["work"]);
    const archived = await captureThought("archived", "mac-library", ["history"]);
    await setThoughtArchived(archived.id, true);

    await expect(listTags()).resolves.toEqual(["history", "work"]);
    await removeThoughtTag(active.id, "work");
    await expect(listTags()).resolves.toEqual(["history"]);
  });

  it("persists optional canonical tag colors and removes orphan definitions", async () => {
    const active = await captureThought("active", "mac-library", ["work"], [
      { name: "WORK", color: "moss" },
    ]);
    const archived = await captureThought("archived", "mac-library", ["history"]);
    await setThoughtArchived(archived.id, true);

    await expect(listTagDefinitions()).resolves.toEqual([
      { name: "history", color: null },
      { name: "work", color: "moss" },
    ]);
    await expect(setTagColor(" work ", "rose")).resolves.toEqual({
      name: "work",
      color: "rose",
    });
    await expect(listTagDefinitions()).resolves.toContainEqual({ name: "work", color: "rose" });

    await removeThoughtTag(active.id, "work");
    await expect(listTagDefinitions()).resolves.toEqual([{ name: "history", color: null }]);
    await expect(setTagColor("work", "clay")).rejects.toThrow(
      "That tag is no longer assigned in the cache.",
    );
  });

  it("keeps valid assigned tags neutral when preview color metadata is malformed", async () => {
    await captureThought("active", "mac-library", ["work"]);
    localStorage.setItem(
      browserTagDefinitionStoreKey,
      JSON.stringify([{ name: " WORK ", color: "signal" }, { name: "work", color: 4 }]),
    );

    await expect(listTagDefinitions()).resolves.toEqual([{ name: "work", color: null }]);
    expect(JSON.parse(localStorage.getItem(browserTagDefinitionStoreKey) ?? "[]")).toEqual([
      { name: "work", color: null },
    ]);
  });

  it("rejects colors outside the palette and colors for unattached capture tags", async () => {
    await expect(
      captureThought("active", "mac-library", ["work"], [
        { name: "design", color: "moss" },
      ]),
    ).rejects.toThrow("attached to this thought");
    await expect(
      captureThought("active", "mac-library", ["work"], [
        { name: "work", color: "signal" as never },
      ]),
    ).rejects.toThrow("Brain Cache tag palette");
  });

  it("preserves a shared relationship until its final browser assignment is removed", async () => {
    const first = await captureThought("first", "mac-library", ["shared"]);
    const second = await captureThought("second", "mac-capture", ["shared"]);

    const firstWithoutTag = await removeThoughtTag(first.id, "shared");
    expect(firstWithoutTag).toEqual({ ...first, tags: [] });
    await expect(listTags()).resolves.toEqual(["shared"]);
    await expect(listThoughts()).resolves.toContainEqual(second);

    const secondWithoutTag = await removeThoughtTag(second.id, "shared");
    expect(secondWithoutTag).toEqual({ ...second, tags: [] });
    await expect(listTags()).resolves.toEqual([]);
  });

  it("hydrates and persists legacy preview records with empty tags", async () => {
    const legacy = {
      id: "legacy",
      body: "saved by the current release",
      createdAt: "2026-08-31T12:34:56.000Z",
      archived: true,
      source: "mac-capture",
    };
    localStorage.setItem(browserStoreKey, JSON.stringify([legacy]));

    await expect(listThoughts()).resolves.toEqual([
      { ...legacy, tags: [], kind: "text", checklistItems: [] },
    ]);
    expect(JSON.parse(localStorage.getItem(browserStoreKey) ?? "[]")).toEqual([
      { ...legacy, tags: [], kind: "text", checklistItems: [] },
    ]);
  });

  it("keeps a valid thought readable while discarding malformed preview tags", async () => {
    const record = {
      id: "mixed-tags",
      body: "durable body",
      createdAt: "2026-08-31T12:34:56.000Z",
      archived: false,
      source: "mac-library",
      tags: ["Work", "bad\nvalue", "x".repeat(33), 4],
    };
    localStorage.setItem(browserStoreKey, JSON.stringify([record]));

    await expect(listThoughts()).resolves.toMatchObject([{ id: "mixed-tags", tags: ["work"] }]);
  });

  it("hydrates valid reminders, derives overdue state, and drops malformed reminder metadata", async () => {
    const record = {
      id: "reminder-hydration",
      body: "Past reminder\nInvalid reminder",
      createdAt: "2026-08-31T12:34:56.000Z",
      archived: false,
      source: "mac-library",
      tags: [],
      kind: "checklist",
      checklistItems: [
        {
          id: "past",
          text: "Past reminder",
          completed: false,
          reminder: {
            scheduledFor: "2020-01-01T10:30:00-06:00",
            state: "scheduled",
            lastError: null,
          },
        },
        {
          id: "invalid",
          text: "Invalid reminder",
          completed: false,
          reminder: {
            scheduledFor: "not-a-date",
            state: "scheduled",
            lastError: null,
          },
        },
      ],
    };
    localStorage.setItem(browserStoreKey, JSON.stringify([record]));

    const [hydrated] = await listThoughts();
    expect(hydrated.checklistItems[0].reminder).toEqual({
      scheduledFor: "2020-01-01T16:30:00.000Z",
      state: "overdue",
      lastError: null,
    });
    expect(hydrated.checklistItems[1].reminder).toBeNull();
    expect(JSON.parse(localStorage.getItem(browserStoreKey) ?? "[]")).toEqual([hydrated]);
  });

  it("requires a literal string source when hydrating preview records", async () => {
    const malformed = {
      id: "array-source",
      body: "must not be coerced into a source",
      createdAt: "2026-08-31T12:34:56.000Z",
      archived: false,
      source: ["mac-library"],
      tags: [],
    };
    localStorage.setItem(browserStoreKey, JSON.stringify([malformed]));

    await expect(listThoughts()).resolves.toEqual([]);
    expect(localStorage.getItem(browserStoreKey)).toBe("[]");
  });

  it("does not create a tag when a mutation target is missing", async () => {
    await expect(addThoughtTag("missing", "work")).rejects.toThrow(
      "That thought is no longer in the cache.",
    );
    await expect(listTags()).resolves.toEqual([]);
  });
});
