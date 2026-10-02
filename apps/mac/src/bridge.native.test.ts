import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  disable: vi.fn(),
  enable: vi.fn(),
  isEnabled: vi.fn(),
}));

import {
  addThoughtTag,
  addThoughtAttachments,
  chooseAttachmentFiles,
  openAttachment,
  readAttachmentData,
  removeThoughtAttachment,
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
  listenForReminderOpened,
  listenForShortcutButtonVisibility,
  listTagDefinitions,
  listTags,
  openNotificationSettings,
  removeThoughtTag,
  replaceChecklistItems,
  resizeCapture,
  setTagColor,
  setLightMode,
  setFontSize,
  type FontSize,
  setThoughtPinned,
  setThoughtCompleted,
  setShortcutButtonVisible,
  setChecklistReminder,
  takePendingReminderTarget,
  updateThoughtBody,
  updateRichDocument,
} from "./bridge";
import type { Thought } from "./types";

const thought: Thought = {
  id: "native-id",
  body: "native body",
  createdAt: "2026-09-01T12:00:00.000Z",
  archived: false,
  source: "mac-capture",
  tags: ["work"],
  kind: "text",
  checklistItems: [],
};

describe("native bridge commands", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    native.invoke.mockReset();
    native.listen.mockReset();
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("sends rich JSON and image bytes in one native save command", async () => {
    const document = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }] }] };
    const attachments = [{ id: crypto.randomUUID(), name: "image.png", data: btoa("image") }];
    native.invoke.mockResolvedValue({ ...thought, richDocument: document });
    expect((await updateRichDocument(thought.id, document, attachments)).richDocument).toEqual(document);
    expect(native.invoke).toHaveBeenCalledWith("update_rich_document", { id: thought.id, document, attachments });
  });

  it("persists note completion through the native bridge", async () => {
    native.invoke.mockResolvedValue({ ...thought, completed: true, reminder: null });
    expect(await setThoughtCompleted(thought.id, true)).toMatchObject({ completed: true, reminder: null });
    expect(native.invoke).toHaveBeenCalledWith("set_thought_completed", { id: thought.id, completed: true });
  });

  it("forwards note reminder scheduling and clearing through native commands", async () => {
    native.invoke.mockResolvedValue(thought);
    await setThoughtReminder(thought.id, "2099-02-03T10:15:00-06:00");
    expect(native.invoke).toHaveBeenLastCalledWith("set_thought_reminder", { thoughtId: thought.id, scheduledFor: "2099-02-03T16:15:00.000Z" });
    await clearThoughtReminder(thought.id);
    expect(native.invoke).toHaveBeenLastCalledWith("clear_thought_reminder", { thoughtId: thought.id });
    native.invoke.mockRejectedValueOnce("Storage is locked");
    await expect(setThoughtReminder(thought.id, "2099-02-03T16:15:00Z")).rejects.toThrow("Storage is locked");
  });

  it("sends image order with atomic native capture and document edits", async () => {
    const file = { id: crypto.randomUUID(), name: "image.png", data: btoa("image") };
    const document = [{ id: "image", type: "image" as const, attachmentId: file.id }];
    native.invoke.mockResolvedValue({ ...thought, document });
    await captureThought("", "mac-capture", [], [], [file], document);
    expect(native.invoke).toHaveBeenLastCalledWith("capture_thought", { body: "image.png", source: "mac-capture", tags: [], attachments: [file], document });
    await updateThoughtBody(thought.id, "", document, [file]);
    expect(native.invoke).toHaveBeenLastCalledWith("update_thought_body", { id: thought.id, body: "", document, attachments: [file] });
  });

  it("persists the requested pin state through the native bridge", async () => {
    native.invoke.mockResolvedValueOnce({ ...thought, pinned: true });
    await expect(setThoughtPinned(thought.id, true)).resolves.toMatchObject({ pinned: true });
    expect(native.invoke).toHaveBeenCalledWith("set_thought_pinned", { id: thought.id, pinned: true });
    native.invoke.mockRejectedValueOnce(new Error("Write failed"));
    await expect(setThoughtPinned(thought.id, false)).rejects.toThrow("Write failed");
  });

  it("forwards file selection, atomic capture, attachment changes, reads, and opening by id", async () => {
    const file = { id: crypto.randomUUID(), name: "photo.png", data: btoa("image") };
    native.invoke.mockResolvedValue(thought);
    await chooseAttachmentFiles();
    await captureThought("", "mac-capture", [], [], [file]);
    await addThoughtAttachments(thought.id, [file]);
    await readAttachmentData(file.id);
    await openAttachment({ id: file.id, name: file.name, mimeType: "image/png", size: 5 });
    await removeThoughtAttachment(thought.id, file.id);
    expect(native.invoke.mock.calls).toEqual([
      ["choose_attachment_files"],
      ["capture_thought", { body: "photo.png", source: "mac-capture", tags: [], attachments: [file] }],
      ["add_thought_attachments", { id: thought.id, attachments: [file] }],
      ["read_attachment_data", { id: file.id }],
      ["open_attachment", { id: file.id }],
      ["remove_thought_attachment", { thoughtId: thought.id, attachmentId: file.id }],
    ]);
  });

  it("sends the canonical tagged-capture and vocabulary command payloads", async () => {
    native.invoke.mockResolvedValueOnce(thought).mockResolvedValueOnce(["work"]);

    await expect(captureThought(" native body ", "mac-capture", [" Work "])).resolves.toEqual(
      thought,
    );
    await expect(listTags()).resolves.toEqual(["work"]);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "capture_thought", {
      body: "native body",
      source: "mac-capture",
      tags: ["work"],
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "list_tags");
  });

  it("forwards explicit capture colors and canonical tag-definition commands", async () => {
    const definition = { name: "work", color: "moss" as const };
    native.invoke
      .mockResolvedValueOnce(thought)
      .mockResolvedValueOnce([definition])
      .mockResolvedValueOnce(definition);

    await captureThought(" native body ", "mac-capture", [" Work "], [
      { name: " WORK ", color: "moss" },
    ]);
    await expect(listTagDefinitions()).resolves.toEqual([definition]);
    await expect(setTagColor(" WORK ", "moss")).resolves.toEqual(definition);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "capture_thought", {
      body: "native body",
      source: "mac-capture",
      tags: ["work"],
      tagDefinitions: [definition],
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "list_tag_definitions");
    expect(native.invoke).toHaveBeenNthCalledWith(3, "set_tag_color", {
      name: "work",
      color: "moss",
    });
  });

  it("forwards checklist capture and ordered replacement through native commands", async () => {
    const checklist = {
      ...thought,
      body: "One\nTwo",
      kind: "checklist" as const,
      checklistItems: [
        { id: "one", text: "One", completed: false, reminder: null },
        { id: "two", text: "Two", completed: false, reminder: null },
      ],
    };
    native.invoke.mockResolvedValueOnce(checklist).mockResolvedValueOnce({
      ...checklist,
      body: "Two\nOne",
      checklistItems: [checklist.checklistItems[1], checklist.checklistItems[0]],
    });

    await captureChecklist(["One", "Two"], "mac-capture", ["Work"]);
    await replaceChecklistItems("native-id", [
      { id: "two", text: "Two", completed: false, reminder: null },
      { id: "one", text: "One", completed: false, reminder: null },
    ]);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "capture_checklist", {
      items: [
        { id: expect.any(String), text: "One", completed: false, reminder: null },
        { id: expect.any(String), text: "Two", completed: false, reminder: null },
      ],
      source: "mac-capture",
      tags: ["work"],
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "replace_checklist_items", {
      id: "native-id",
      items: [
        { id: "two", text: "Two", completed: false, reminder: null },
        { id: "one", text: "One", completed: false, reminder: null },
      ],
    });
  });

  it("forwards reminder lifecycle commands and notification-open events", async () => {
    const checklist = {
      ...thought,
      kind: "checklist" as const,
      checklistItems: [
        { id: "item-id", text: "Call Sam", completed: false, reminder: null },
      ],
    };
    native.invoke
      .mockResolvedValueOnce(checklist)
      .mockResolvedValueOnce(checklist)
      .mockResolvedValueOnce({ thoughtId: "native-id", itemId: "item-id" })
      .mockResolvedValueOnce(undefined);
    native.listen.mockResolvedValueOnce(() => undefined);

    await setChecklistReminder("native-id", "item-id", "2099-02-03T10:15:00-06:00");
    await clearChecklistReminder("native-id", "item-id");
    await expect(takePendingReminderTarget()).resolves.toEqual({
      thoughtId: "native-id",
      itemId: "item-id",
    });
    await openNotificationSettings();
    const callback = vi.fn();
    await listenForReminderOpened(callback);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "set_checklist_reminder", {
      thoughtId: "native-id",
      itemId: "item-id",
      scheduledFor: "2099-02-03T16:15:00.000Z",
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "clear_checklist_reminder", {
      thoughtId: "native-id",
      itemId: "item-id",
    });
    expect(native.invoke).toHaveBeenNthCalledWith(3, "take_pending_reminder_target");
    expect(native.invoke).toHaveBeenNthCalledWith(4, "open_notification_settings");
    expect(native.listen).toHaveBeenCalledWith("reminder-opened", expect.any(Function));
  });

  it("keeps a string rejection and the add command payload specific", async () => {
    native.invoke.mockRejectedValueOnce("Brain Cache storage error: database is locked");

    await expect(addThoughtTag("native-id", " Work ")).rejects.toThrow(
      "Brain Cache storage error: database is locked",
    );
    expect(native.invoke).toHaveBeenCalledWith("add_thought_tag", {
      id: "native-id",
      tag: "work",
    });
  });

  it("keeps a string rejection and the remove command payload specific", async () => {
    native.invoke.mockRejectedValueOnce("That thought is no longer in the cache.");

    await expect(removeThoughtTag("native-id", " Work ")).rejects.toThrow(
      "That thought is no longer in the cache.",
    );
    expect(native.invoke).toHaveBeenCalledWith("remove_thought_tag", {
      id: "native-id",
      tag: "work",
    });
  });

  it("normalizes and forwards a body update without changing its command boundary", async () => {
    native.invoke.mockResolvedValueOnce({ ...thought, body: "revised\nbody" });

    await expect(updateThoughtBody("native-id", "  revised\r\nbody  ")).resolves.toMatchObject({
      id: "native-id",
      body: "revised\nbody",
    });
    expect(native.invoke).toHaveBeenCalledWith("update_thought_body", {
      id: "native-id",
      body: "revised\nbody",
    });
  });

  it("forwards adaptive capture sizing without mixing it into persistence", async () => {
    native.invoke.mockResolvedValueOnce({
      appliedHeight: 214,
      maxHeight: 580,
      constrained: false,
    });

    await expect(resizeCapture(214, 150)).resolves.toEqual({
      appliedHeight: 214,
      maxHeight: 580,
      constrained: false,
    });
    expect(native.invoke).toHaveBeenCalledWith("resize_capture", {
      height: 214,
      durationMs: 150,
    });
  });

  it("forwards shortcut preference commands and native recovery listeners", async () => {
    native.invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    native.listen.mockResolvedValue(() => undefined);

    await expect(getShortcutButtonVisible()).resolves.toBe(false);
    await expect(setShortcutButtonVisible(true)).resolves.toBe(true);
    await listenForCaptureCommand(() => undefined);
    await listenForShortcutButtonVisibility(() => undefined);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "get_shortcut_button_visible");
    expect(native.invoke).toHaveBeenNthCalledWith(2, "set_shortcut_button_visible", {
      visible: true,
    });
    expect(native.listen).toHaveBeenNthCalledWith(1, "capture-command", expect.any(Function));
    expect(native.listen).toHaveBeenNthCalledWith(
      2,
      "shortcut-button-visibility",
      expect.any(Function),
    );
  });

  it("forwards appearance commands and delivers native appearance events", async () => {
    const callback = vi.fn();
    const unlisten = vi.fn();
    native.invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    native.listen.mockResolvedValue(unlisten);

    await expect(getLightMode()).resolves.toBe(false);
    await expect(setLightMode(true)).resolves.toBe(true);
    const stop = await listenForLightMode(callback);

    expect(native.invoke).toHaveBeenNthCalledWith(1, "get_light_mode");
    expect(native.invoke).toHaveBeenNthCalledWith(2, "set_light_mode", { enabled: true });
    expect(native.listen).toHaveBeenCalledWith("light-mode-changed", expect.any(Function));
    native.listen.mock.calls[0][1]({ payload: true });
    expect(callback).toHaveBeenCalledWith(true);
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("reports native appearance write failures without changing preview storage", async () => {
    native.invoke.mockRejectedValueOnce("Could not save appearance");
    const write = vi.spyOn(Storage.prototype, "setItem");
    try {
      await expect(setLightMode(true)).rejects.toThrow("Could not save appearance");
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("forwards font size commands and valid native font size events", async () => {
    const callback = vi.fn();
    const unlisten = vi.fn();
    native.invoke.mockResolvedValueOnce("default").mockResolvedValueOnce("extra-large");
    native.listen.mockResolvedValue(unlisten);

    await expect(getFontSize()).resolves.toBe("default");
    await expect(setFontSize("extra-large")).resolves.toBe("extra-large");
    const stop = await listenForFontSize(callback);
    expect(native.invoke).toHaveBeenNthCalledWith(1, "get_font_size");
    expect(native.invoke).toHaveBeenNthCalledWith(2, "set_font_size", { size: "extra-large" });
    expect(native.listen).toHaveBeenCalledWith("font-size-changed", expect.any(Function));
    native.listen.mock.calls[0][1]({ payload: "large" });
    native.listen.mock.calls[0][1]({ payload: "giant" });
    expect(callback).toHaveBeenCalledExactlyOnceWith("large");
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("rejects invalid font sizes before native calls and reports native save failures", async () => {
    await expect(setFontSize("giant" as FontSize)).rejects.toThrow("supported font size");
    expect(native.invoke).not.toHaveBeenCalled();
    native.invoke.mockRejectedValueOnce("Could not save font size");
    const write = vi.spyOn(Storage.prototype, "setItem");
    try {
      await expect(setFontSize("large")).rejects.toThrow("Could not save font size");
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});
