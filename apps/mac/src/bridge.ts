import { projectRichDocument, richImageIds, updateRichTasks, type RichDocument } from "./richDocument";
import { documentBody, inlineImageIds, isDocument, validateDocument } from "./document";
import { draftMetadata, validateAttachments } from "./attachments";
import { updateCompletionHistory } from "./taskProgress";
import type { Attachment, AttachmentDraft, DocumentBlock } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  addTag,
  checklistBody,
  checklistTextsFromDraft,
  normalizeChecklistItems,
  normalizeTag,
  normalizeTagColor,
  normalizeTags,
  normalizeThoughtBody,
  removeTag,
} from "./domain";
import {
  THOUGHT_SOURCES,
  type ChecklistItem,
  type ChecklistReminder,
  type ReminderState,
  type TagColor,
  type TagDefinition,
  type Thought,
  type ThoughtSource,
} from "./types";

const browserStoreKey = "brain-cache.preview.thoughts";
const browserTagDefinitionStoreKey = "brain-cache.preview.tag-definitions";
const browserShortcutButtonVisibleKey = "brain-cache.preview.shortcut-button-visible";
const browserLightModeKey = "brain-cache.preview.light-mode";
const browserFontSizeKey = "brain-cache.preview.font-size";

export type FontSize = "default" | "large" | "extra-large";

function isFontSize(value: unknown): value is FontSize {
  return value === "default" || value === "large" || value === "extra-large";
}

function readBrowserFontSize(): FontSize {
  const saved = localStorage.getItem(browserFontSizeKey);
  return isFontSize(saved) ? saved : "default";
}

export interface CaptureResizeResult {
  appliedHeight: number;
  maxHeight: number;
  constrained: boolean;
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function listThoughts(): Promise<Thought[]> {
  if (isTauriRuntime()) return invokeNative<Thought[]>("list_thoughts");
  return readBrowserThoughts();
}

export async function listTags(): Promise<string[]> {
  if (isTauriRuntime()) return invokeNative<string[]>("list_tags");
  return normalizeTags(readBrowserThoughts().flatMap((thought) => thought.tags));
}

export async function listTagDefinitions(): Promise<TagDefinition[]> {
  if (isTauriRuntime()) return invokeNative<TagDefinition[]>("list_tag_definitions");
  const definitions = reconcileBrowserTagDefinitions(
    readBrowserThoughts(),
    readBrowserTagDefinitions(),
  );
  writeBrowserTagDefinitions(definitions);
  return definitions;
}

export async function captureThought(
  body: string,
  source: ThoughtSource,
  tags: string[] = [],
  tagDefinitions: TagDefinition[] = [],
  attachments: AttachmentDraft[] = [],
  document?: DocumentBlock[],
): Promise<Thought> {
  validateAttachments(attachments);
  if (document) validateDocument(document, attachments.map(draftMetadata));
  const normalizedBody = (document ? documentBody(document) : normalizeThoughtBody(body)) || attachments.map((file) => file.name).join("\n");
  const normalizedTags = normalizeTags(tags);
  const normalizedTagDefinitions = normalizeTagDefinitionChanges(
    tagDefinitions,
    normalizedTags,
  );
  if (!normalizedBody) throw new Error("Give Blob something to remember.");

  if (isTauriRuntime()) {
    const args: Record<string, unknown> = {
      body: normalizedBody,
      source,
      tags: normalizedTags,
    };
    if (normalizedTagDefinitions.length > 0) args.tagDefinitions = normalizedTagDefinitions;
    if (attachments.length > 0) args.attachments = attachments;
    if (document) args.document = document;
    return invokeNative<Thought>("capture_thought", args);
  }

  const thought: Thought = {
    id: crypto.randomUUID(),
    body: normalizedBody,
    createdAt: new Date().toISOString(),
    archived: false,
    source,
    tags: normalizedTags,
    kind: "text",
    checklistItems: [],
    ...(attachments.length ? { attachments: attachments.map(draftMetadata) } : {}),
    ...(document ? { document } : {}),
  };
  const nextThoughts = [thought, ...readBrowserThoughts()];
  writeBrowserThoughts(nextThoughts, attachments);
  writeBrowserTagDefinitions(
    reconcileBrowserTagDefinitions(
      nextThoughts,
      readBrowserTagDefinitions(),
      normalizedTagDefinitions,
    ),
  );
  window.dispatchEvent(new CustomEvent("brain-cache:thought-created", { detail: thought }));
  return thought;
}

export async function captureChecklist(
  itemTexts: string[],
  source: ThoughtSource,
  tags: string[] = [],
  tagDefinitions: TagDefinition[] = [],
  attachments: AttachmentDraft[] = [],
): Promise<Thought> {
  validateAttachments(attachments);
  const texts = checklistTextsFromDraft(itemTexts.join("\n"));
  const items = texts.map((text) => ({
    id: crypto.randomUUID(),
    text,
    completed: false,
    reminder: null,
  }));
  const normalizedTags = normalizeTags(tags);
  const normalizedTagDefinitions = normalizeTagDefinitionChanges(
    tagDefinitions,
    normalizedTags,
  );

  if (isTauriRuntime()) {
    const args: Record<string, unknown> = {
      items,
      source,
      tags: normalizedTags,
    };
    if (normalizedTagDefinitions.length > 0) args.tagDefinitions = normalizedTagDefinitions;
    if (attachments.length > 0) args.attachments = attachments;
    return invokeNative<Thought>("capture_checklist", args);
  }

  const thought: Thought = {
    id: crypto.randomUUID(),
    body: checklistBody(items),
    createdAt: new Date().toISOString(),
    archived: false,
    source,
    tags: normalizedTags,
    kind: "checklist",
    checklistItems: items,
    ...(attachments.length ? { attachments: attachments.map(draftMetadata) } : {}),
  };
  const nextThoughts = [thought, ...readBrowserThoughts()];
  writeBrowserThoughts(nextThoughts, attachments);
  writeBrowserTagDefinitions(
    reconcileBrowserTagDefinitions(
      nextThoughts,
      readBrowserTagDefinitions(),
      normalizedTagDefinitions,
    ),
  );
  window.dispatchEvent(new CustomEvent("brain-cache:thought-created", { detail: thought }));
  return thought;
}

export async function chooseAttachmentFiles(): Promise<AttachmentDraft[]> {
  return invokeNative<AttachmentDraft[]>("choose_attachment_files");
}

export async function addThoughtAttachments(id: string, attachments: AttachmentDraft[]): Promise<Thought> {
  validateAttachments(attachments);
  if (isTauriRuntime()) return invokeNative<Thought>("add_thought_attachments", { id, attachments });
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  validateAttachments(attachments, thought.attachments);
  const updated = { ...thought, attachments: [...(thought.attachments ?? []), ...attachments.map(draftMetadata)] };
  writeBrowserThoughts(thoughts.map((candidate) => candidate.id === id ? updated : candidate), attachments);
  return updated;
}

export async function removeThoughtAttachment(thoughtId: string, attachmentId: string): Promise<Thought> {
  if (isTauriRuntime()) return invokeNative<Thought>("remove_thought_attachment", { thoughtId, attachmentId });
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === thoughtId);
  if (!thought?.attachments?.some((file) => file.id === attachmentId)) throw new Error("That attachment is no longer on this thought.");
  if (richImageIds(thought.richDocument).has(attachmentId)) throw new Error("Remove this image from the document before deleting its file.");
  const updated = { ...thought, attachments: thought.attachments.filter((file) => file.id !== attachmentId),
    ...(thought.document ? { document: thought.document.filter((block) => block.type !== "image" || block.attachmentId !== attachmentId) } : {}) };
  writeBrowserThoughts(thoughts.map((candidate) => candidate.id === thoughtId ? updated : candidate));
  return updated;
}

export async function readAttachmentData(id: string): Promise<string> {
  if (isTauriRuntime()) return invokeNative<string>("read_attachment_data", { id });
  const data = browserAttachmentData().get(id);
  if (data === undefined) throw new Error("That attachment is no longer in the cache.");
  return data;
}

export async function openAttachment(file: Attachment): Promise<void> {
  if (isTauriRuntime()) return invokeNative<void>("open_attachment", { id: file.id });
  const data = await readAttachmentData(file.id);
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function addThoughtTag(id: string, tag: string): Promise<Thought> {
  const normalizedTag = normalizeTag(tag);
  if (isTauriRuntime()) {
    return invokeNative<Thought>("add_thought_tag", { id, tag: normalizedTag });
  }
  return mutateBrowserThoughtTags(id, (tags) => addTag(tags, normalizedTag));
}

export async function removeThoughtTag(id: string, tag: string): Promise<Thought> {
  const normalizedTag = normalizeTag(tag);
  if (isTauriRuntime()) {
    return invokeNative<Thought>("remove_thought_tag", { id, tag: normalizedTag });
  }
  return mutateBrowserThoughtTags(id, (tags) => removeTag(tags, normalizedTag));
}

export async function setTagColor(
  name: string,
  color: TagColor | null,
): Promise<TagDefinition> {
  const normalizedName = normalizeTag(name);
  const normalizedColor = normalizeTagColor(color);
  if (isTauriRuntime()) {
    return invokeNative<TagDefinition>("set_tag_color", {
      name: normalizedName,
      color: normalizedColor,
    });
  }

  const thoughts = readBrowserThoughts();
  if (!thoughts.some((thought) => thought.tags.includes(normalizedName))) {
    throw new Error("That tag is no longer assigned in the cache.");
  }
  const updated = { name: normalizedName, color: normalizedColor };
  writeBrowserTagDefinitions(
    reconcileBrowserTagDefinitions(thoughts, readBrowserTagDefinitions(), [updated]),
  );
  return updated;
}

export async function updateRichDocument(id: string, document: RichDocument, attachments: AttachmentDraft[] = []): Promise<Thought> {
  validateAttachments(attachments);
  if (isTauriRuntime()) return invokeNative<Thought>("update_rich_document", { id, document, attachments });
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  validateAttachments(attachments, thought.attachments);
  const files = [...(thought.attachments ?? []), ...attachments.map(draftMetadata)];
  const projection = projectRichDocument(document, files);
  const items = projection.items.map((item) => ({ ...item, reminder: item.completed || thought.archived ? null
    : thought.checklistItems.find((old) => old.id === item.id)?.reminder ?? null }));
  const updated: Thought = { ...thought, body: projection.body, kind: projection.kind, document: undefined,
    richDocument: document, checklistItems: items, taskCompletions: updateCompletionHistory(thought, items),
    completed: items.some((item) => !item.completed) ? false : thought.completed,
    ...(files.length ? { attachments: files } : {}),
  };
  writeBrowserThoughts(thoughts.map((candidate) => candidate.id === id ? updated : candidate), attachments);
  return updated;
}

export async function setThoughtCompleted(id: string, completed: boolean): Promise<Thought> {
  if (isTauriRuntime()) return invokeNative<Thought>("set_thought_completed", { id, completed });
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  if (thought.archived) throw new Error("Restore this thought before changing its completion.");
  const items = completed ? thought.checklistItems.map((item) => ({ ...item, completed: true, reminder: null })) : thought.checklistItems;
  const updated: Thought = {
    ...thought, completed, checklistItems: items,
    ...(thought.richDocument ? { richDocument: updateRichTasks(thought.richDocument, items) } : {}),
    reminder: completed ? null : thought.reminder,
    ...(completed && thought.kind === "checklist" ? { taskCompletions: updateCompletionHistory(thought, items) } : {}),
  };
  writeBrowserThoughts(thoughts.map((candidate) => candidate.id === id ? updated : candidate));
  return updated;
}

export async function setThoughtArchived(id: string, archived: boolean): Promise<Thought> {
  if (isTauriRuntime()) return invokeNative<Thought>("set_thought_archived", { id, archived });

  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  const updated = {
    ...thought,
    archived,
    reminder: archived ? null : thought.reminder,
    checklistItems:
      archived && thought.kind === "checklist"
        ? thought.checklistItems.map((item) => ({ ...item, reminder: null }))
        : thought.checklistItems,
  };
  writeBrowserThoughts(thoughts.map((candidate) => (candidate.id === id ? updated : candidate)));
  return updated;
}

export async function setThoughtPinned(id: string, pinned: boolean): Promise<Thought> {
  if (isTauriRuntime()) return invokeNative<Thought>("set_thought_pinned", { id, pinned });

  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  const updated = { ...thought, pinned };
  writeBrowserThoughts(thoughts.map((candidate) => candidate.id === id ? updated : candidate));
  return updated;
}

export async function updateThoughtBody(id: string, body: string, document?: DocumentBlock[], attachments: AttachmentDraft[] = []): Promise<Thought> {
  validateAttachments(attachments);
  const normalizedBody = document ? documentBody(document) : normalizeThoughtBody(body);
  if (!normalizedBody && !document?.some((block) => block.type === "image")) throw new Error("Give Blob something to remember.");
  if (isTauriRuntime()) {
    return invokeNative<Thought>("update_thought_body", { id, body: normalizedBody,
      ...(document ? { document } : {}), ...(attachments.length ? { attachments } : {}) });
  }
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  if (thought.kind !== "text") throw new Error("That thought is not a text document.");
  if (thought.richDocument) throw new Error("Use the document editor to keep this note’s formatting.");
  if (thought.document && !document) throw new Error("Keep the document layout when editing this thought.");
  validateAttachments(attachments, thought.attachments);
  let files = [...(thought.attachments ?? []), ...attachments.map(draftMetadata)];
  if (document) {
    validateDocument(document, files);
    const previousIds = inlineImageIds(thought.document);
    const nextIds = inlineImageIds(document);
    files = files.filter((file) => !previousIds.has(file.id) || nextIds.has(file.id));
  }
  const updated = { ...thought, body: normalizedBody || files.filter((file) => inlineImageIds(document).has(file.id)).map((file) => file.name).join("\n"),
    ...(document ? { document } : {}), ...(files.length || thought.attachments ? { attachments: files } : {}) };
  if (JSON.stringify(updated) !== JSON.stringify(thought)) {
    writeBrowserThoughts(thoughts.map((candidate) => candidate.id === id ? updated : candidate), attachments);
  }
  return updated;
}

export async function replaceChecklistItems(
  id: string,
  items: ChecklistItem[],
): Promise<Thought> {
  const normalizedItems = normalizeChecklistItems(items).map((item) =>
    item.completed ? { ...item, reminder: null } : item,
  );
  if (isTauriRuntime()) {
    return invokeNative<Thought>("replace_checklist_items", { id, items: normalizedItems });
  }

  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  if (thought.kind !== "checklist") throw new Error("That thought is not a checklist.");
  if (thought.richDocument && (thought.checklistItems.length !== normalizedItems.length || normalizedItems.some((item) =>
    !thought.checklistItems.some((old) => old.id === item.id && old.text === item.text)))) {
    throw new Error("Open the document editor to change this checklist's text or structure.");
  }
  const richDocument = thought.richDocument ? updateRichTasks(thought.richDocument, normalizedItems) : undefined;
  const updated = {
    ...thought,
    body: richDocument ? projectRichDocument(richDocument, thought.attachments).body : checklistBody(normalizedItems),
    ...(richDocument ? { richDocument } : {}),
    checklistItems: normalizedItems,
    taskCompletions: updateCompletionHistory(thought, normalizedItems),
    ...(thought.completed && normalizedItems.some((item) => !item.completed) ? { completed: false } : {}),
  };
  writeBrowserThoughts(thoughts.map((candidate) => (candidate.id === id ? updated : candidate)));
  return updated;
}

export async function setThoughtReminder(thoughtId: string, scheduledFor: string): Promise<Thought> {
  const scheduled = new Date(scheduledFor);
  if (Number.isNaN(scheduled.getTime())) throw new Error("Choose a valid reminder date and time.");
  if (scheduled.getTime() <= Date.now()) throw new Error("Choose a reminder time in the future.");
  const normalized = scheduled.toISOString();
  if (isTauriRuntime()) return invokeNative<Thought>("set_thought_reminder", { thoughtId, scheduledFor: normalized });
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === thoughtId);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  if (thought.archived) throw new Error("Restore this thought before setting a reminder.");
  if (thought.completed) throw new Error("Reopen this thought before setting a reminder.");
  const updated: Thought = { ...thought, reminder: { scheduledFor: normalized, state: "scheduled", lastError: null } };
  writeBrowserThoughts(thoughts.map((candidate) => candidate.id === thoughtId ? updated : candidate));
  return updated;
}

export async function clearThoughtReminder(thoughtId: string): Promise<Thought> {
  if (isTauriRuntime()) return invokeNative<Thought>("clear_thought_reminder", { thoughtId });
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === thoughtId);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  const updated = { ...thought, reminder: null };
  writeBrowserThoughts(thoughts.map((candidate) => candidate.id === thoughtId ? updated : candidate));
  return updated;
}

export async function setChecklistReminder(
  thoughtId: string,
  itemId: string,
  scheduledFor: string,
): Promise<Thought> {
  const scheduled = new Date(scheduledFor);
  if (Number.isNaN(scheduled.getTime())) throw new Error("Choose a valid reminder date and time.");
  if (scheduled.getTime() <= Date.now()) throw new Error("Choose a reminder time in the future.");
  const normalized = scheduled.toISOString();
  if (isTauriRuntime()) {
    return invokeNative<Thought>("set_checklist_reminder", {
      thoughtId,
      itemId,
      scheduledFor: normalized,
    });
  }

  return mutateBrowserChecklist(thoughtId, (thought) => {
    const item = thought.checklistItems.find((candidate) => candidate.id === itemId);
    if (thought.archived || thought.completed || !item || item.completed) {
      throw new Error("Reminders can only be set on active, incomplete checklist items.");
    }
    return {
      ...thought,
      checklistItems: thought.checklistItems.map((candidate) =>
        candidate.id === itemId
          ? {
              ...candidate,
              reminder: { scheduledFor: normalized, state: "scheduled", lastError: null },
            }
          : candidate,
      ),
    };
  });
}

export async function clearChecklistReminder(
  thoughtId: string,
  itemId: string,
): Promise<Thought> {
  if (isTauriRuntime()) {
    return invokeNative<Thought>("clear_checklist_reminder", { thoughtId, itemId });
  }
  return mutateBrowserChecklist(thoughtId, (thought) => {
    const item = thought.checklistItems.find((candidate) => candidate.id === itemId);
    if (!item?.reminder) throw new Error("That checklist item has no reminder to clear.");
    return {
      ...thought,
      checklistItems: thought.checklistItems.map((candidate) =>
        candidate.id === itemId ? { ...candidate, reminder: null } : candidate,
      ),
    };
  });
}

export interface ReminderTarget {
  thoughtId: string;
  itemId: string | null;
}

export async function takePendingReminderTarget(): Promise<ReminderTarget | null> {
  if (isTauriRuntime()) return invokeNative<ReminderTarget | null>("take_pending_reminder_target");
  return null;
}

export async function listenForReminderOpened(
  callback: (target: ReminderTarget) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<ReminderTarget>("reminder-opened", (event) => callback(event.payload));
  }
  const listener = (event: Event) => callback((event as CustomEvent<ReminderTarget>).detail);
  window.addEventListener("brain-cache:reminder-opened", listener);
  return () => window.removeEventListener("brain-cache:reminder-opened", listener);
}

export async function listenForRemindersReconciled(callback: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen("reminders-reconciled", callback);
}

export async function openNotificationSettings(): Promise<void> {
  if (isTauriRuntime()) await invokeNative("open_notification_settings");
}

export async function showCapture(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeNative("show_capture");
    return;
  }
  window.location.search = "?mode=capture";
}

export async function hideCapture(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeNative("hide_capture");
    return;
  }
  window.location.search = "";
}

export async function resizeCapture(
  height: number,
  durationMs: number,
): Promise<CaptureResizeResult> {
  if (isTauriRuntime()) {
    return invokeNative<CaptureResizeResult>("resize_capture", { height, durationMs });
  }

  return {
    appliedHeight: height,
    maxHeight: height,
    constrained: false,
  };
}

export async function listenForCreatedThought(
  callback: (thought: Thought) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<Thought>("thought-created", (event) => callback(event.payload));
  }

  const listener = (event: Event) => callback((event as CustomEvent<Thought>).detail);
  window.addEventListener("brain-cache:thought-created", listener);
  return () => window.removeEventListener("brain-cache:thought-created", listener);
}

export async function listenForCaptureFocus(callback: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen("capture-focus", callback);
}

export async function getShortcutButtonVisible(): Promise<boolean> {
  if (isTauriRuntime()) return invokeNative<boolean>("get_shortcut_button_visible");
  return localStorage.getItem(browserShortcutButtonVisibleKey) !== "false";
}

export async function setShortcutButtonVisible(visible: boolean): Promise<boolean> {
  if (isTauriRuntime()) {
    return invokeNative<boolean>("set_shortcut_button_visible", { visible });
  }
  localStorage.setItem(browserShortcutButtonVisibleKey, String(visible));
  window.dispatchEvent(
    new CustomEvent("brain-cache:shortcut-button-visibility", { detail: visible }),
  );
  return visible;
}

export async function listenForCaptureCommand(
  callback: (command: string) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<string>("capture-command", (event) => callback(event.payload));
  }
  const listener = (event: Event) => callback((event as CustomEvent<string>).detail);
  window.addEventListener("brain-cache:capture-command", listener);
  return () => window.removeEventListener("brain-cache:capture-command", listener);
}

export async function listenForShortcutButtonVisibility(
  callback: (visible: boolean) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<boolean>("shortcut-button-visibility", (event) => callback(event.payload));
  }
  const listener = (event: Event) => callback((event as CustomEvent<boolean>).detail);
  window.addEventListener("brain-cache:shortcut-button-visibility", listener);
  return () => window.removeEventListener("brain-cache:shortcut-button-visibility", listener);
}

export async function getLightMode(): Promise<boolean> {
  if (isTauriRuntime()) return invokeNative<boolean>("get_light_mode");
  return localStorage.getItem(browserLightModeKey) === "true";
}

export async function setLightMode(enabled: boolean): Promise<boolean> {
  if (isTauriRuntime()) return invokeNative<boolean>("set_light_mode", { enabled });
  localStorage.setItem(browserLightModeKey, String(enabled));
  const saved = localStorage.getItem(browserLightModeKey) === "true";
  window.dispatchEvent(new CustomEvent("brain-cache:light-mode-changed", { detail: saved }));
  return saved;
}

export async function listenForLightMode(
  callback: (enabled: boolean) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<boolean>("light-mode-changed", (event) => callback(event.payload));
  }
  const listener = (event: Event) => callback((event as CustomEvent<boolean>).detail);
  const storageListener = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === browserLightModeKey || event.key === null)) {
      callback(localStorage.getItem(browserLightModeKey) === "true");
    }
  };
  window.addEventListener("brain-cache:light-mode-changed", listener);
  window.addEventListener("storage", storageListener);
  return () => {
    window.removeEventListener("brain-cache:light-mode-changed", listener);
    window.removeEventListener("storage", storageListener);
  };
}

export async function getFontSize(): Promise<FontSize> {
  if (isTauriRuntime()) return invokeNative<FontSize>("get_font_size");
  return readBrowserFontSize();
}

export async function setFontSize(size: FontSize): Promise<FontSize> {
  if (!isFontSize(size)) throw new Error("Choose a supported font size.");
  if (isTauriRuntime()) return invokeNative<FontSize>("set_font_size", { size });
  localStorage.setItem(browserFontSizeKey, size);
  const saved = readBrowserFontSize();
  window.dispatchEvent(new CustomEvent("brain-cache:font-size-changed", { detail: saved }));
  return saved;
}

export async function listenForFontSize(
  callback: (size: FontSize) => void,
): Promise<UnlistenFn> {
  const notify = (value: unknown) => {
    if (isFontSize(value)) callback(value);
  };
  if (isTauriRuntime()) {
    return listen<FontSize>("font-size-changed", (event) => notify(event.payload));
  }
  const listener = (event: Event) => notify((event as CustomEvent<unknown>).detail);
  const storageListener = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === browserFontSizeKey || event.key === null)) {
      callback(readBrowserFontSize());
    }
  };
  window.addEventListener("brain-cache:font-size-changed", listener);
  window.addEventListener("storage", storageListener);
  return () => {
    window.removeEventListener("brain-cache:font-size-changed", listener);
    window.removeEventListener("storage", storageListener);
  };
}

export async function getLaunchAtLogin(): Promise<boolean> {
  if (!isTauriRuntime()) return localStorage.getItem("brain-cache.preview.autostart") === "true";
  return isEnabled();
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem("brain-cache.preview.autostart", String(enabled));
    return;
  }
  if (enabled) await enable();
  else await disable();
}

function readBrowserThoughts(): Thought[] {
  try {
    const serialized = localStorage.getItem(browserStoreKey) ?? "[]";
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    const thoughts = parsed.flatMap((value) => {
      const thought = hydrateBrowserThought(value);
      return thought ? [thought] : [];
    });
    // Preserve file bytes while normalizing legacy thought metadata.
    try { writeBrowserThoughts(thoughts); } catch { /* Reading must still work when preview storage is full. */ }
    return thoughts;
  } catch {
    return [];
  }
}

function browserAttachmentData(): Map<string, string> {
  const records = JSON.parse(localStorage.getItem(browserStoreKey) ?? "[]") as Array<{ attachments?: Array<Attachment & { data?: string }> }>;
  return new Map(Array.isArray(records) ? records.flatMap((record) => (record.attachments ?? []).flatMap((file) => typeof file.data === "string" ? [[file.id, file.data] as const] : [])) : []);
}

function writeBrowserThoughts(thoughts: Thought[], files: AttachmentDraft[] = []): void {
  let data: Map<string, string>;
  try { data = browserAttachmentData(); } catch { data = new Map(); }
  for (const file of files) data.set(file.id, file.data);
  localStorage.setItem(browserStoreKey, JSON.stringify(thoughts.map((thought) => ({
    ...thought,
    ...(thought.attachments?.length ? { attachments: thought.attachments.map((file) => ({ ...file, data: data.get(file.id) ?? "" })) } : {}),
  }))));
}

function mutateBrowserThoughtTags(
  id: string,
  mutation: (tags: readonly string[]) => string[],
): Thought {
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === id);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  const updated = { ...thought, tags: mutation(thought.tags) };
  if (updated.tags.join("\u0000") !== thought.tags.join("\u0000")) {
    const nextThoughts = thoughts.map((candidate) => (candidate.id === id ? updated : candidate));
    writeBrowserThoughts(nextThoughts);
    writeBrowserTagDefinitions(
      reconcileBrowserTagDefinitions(nextThoughts, readBrowserTagDefinitions()),
    );
  }
  return updated;
}

function mutateBrowserChecklist(
  thoughtId: string,
  mutation: (thought: Thought) => Thought,
): Thought {
  const thoughts = readBrowserThoughts();
  const thought = thoughts.find((candidate) => candidate.id === thoughtId);
  if (!thought) throw new Error("That thought is no longer in the cache.");
  if (thought.kind !== "checklist") throw new Error("That thought is not a checklist.");
  const updated = mutation(thought);
  writeBrowserThoughts(
    thoughts.map((candidate) => (candidate.id === thoughtId ? updated : candidate)),
  );
  return updated;
}

function normalizeTagDefinitionChanges(
  values: readonly TagDefinition[],
  allowedTags: readonly string[],
): TagDefinition[] {
  const allowed = new Set(allowedTags);
  const definitions = new Map<string, TagDefinition>();
  for (const value of values) {
    const name = normalizeTag(value.name);
    if (!allowed.has(name)) {
      throw new Error("Tag colors can only be saved for tags attached to this thought.");
    }
    definitions.set(name, { name, color: normalizeTagColor(value.color) });
  }
  return [...definitions.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function readBrowserTagDefinitions(): TagDefinition[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(browserTagDefinitionStoreKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const definitions = new Map<string, TagDefinition>();
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (typeof record.name !== "string") continue;
      try {
        const name = normalizeTag(record.name);
        const color =
          record.color === null || typeof record.color === "string"
            ? normalizeTagColor(record.color)
            : null;
        definitions.set(name, { name, color });
      } catch {
        // Invalid preview-only metadata must not make an assigned tag unreadable.
      }
    }
    return [...definitions.values()];
  } catch {
    return [];
  }
}

function writeBrowserTagDefinitions(definitions: readonly TagDefinition[]): void {
  localStorage.setItem(browserTagDefinitionStoreKey, JSON.stringify(definitions));
}

function reconcileBrowserTagDefinitions(
  thoughts: readonly Thought[],
  current: readonly TagDefinition[],
  changes: readonly TagDefinition[] = [],
): TagDefinition[] {
  const assigned = normalizeTags(thoughts.flatMap((thought) => thought.tags));
  const colors = new Map(current.map((definition) => [definition.name, definition.color]));
  for (const change of changes) colors.set(change.name, change.color);
  return assigned.map((name) => ({ name, color: colors.get(name) ?? null }));
}

function hydrateBrowserThought(value: unknown): Thought | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.body !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.archived !== "boolean" ||
    !isThoughtSource(record.source)
  ) {
    return null;
  }

  const tags: string[] = [];
  if (Array.isArray(record.tags)) {
    for (const value of record.tags) {
      if (typeof value !== "string") continue;
      try {
        tags.push(normalizeTag(value));
      } catch {
        // A malformed preview-only tag must not make the durable thought unreadable.
      }
    }
  }

  let kind: Thought["kind"] = record.kind === "checklist" ? "checklist" : "text";
  const checklistItems: ChecklistItem[] = [];
  const checklistIds = new Set<string>();
  if (kind === "checklist" && Array.isArray(record.checklistItems)) {
    for (const value of record.checklistItems) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        checklistIds.has(item.id) ||
        typeof item.text !== "string" ||
        typeof item.completed !== "boolean"
      ) {
        continue;
      }
      try {
        checklistItems.push({
          id: item.id,
          text: checklistTextsFromDraft(item.text)[0],
          completed: item.completed,
          reminder: hydrateBrowserReminder(item.reminder),
        });
        checklistIds.add(item.id);
      } catch {
        // A malformed preview-only checklist item must not hide the readable body fallback.
      }
    }
  }
  if (kind === "checklist" && checklistItems.length === 0) kind = "text";

  return {
    id: record.id,
    body: kind === "checklist" && !record.richDocument ? checklistBody(checklistItems) : record.body,
    ...(record.richDocument && typeof record.richDocument === "object" && "type" in record.richDocument && record.richDocument.type === "doc" ? { richDocument: record.richDocument as RichDocument } : {}),
    createdAt: record.createdAt,
    archived: record.archived,
    ...(record.reminder !== undefined ? { reminder: record.archived || record.completed ? null : hydrateBrowserReminder(record.reminder) } : {}),
    ...(typeof record.completed === "boolean" ? { completed: record.completed } : {}),
    ...(typeof record.pinned === "boolean" ? { pinned: record.pinned } : {}),
    source: record.source,
    tags: normalizeTags(tags),
    kind,
    checklistItems: kind === "checklist" ? checklistItems : [],
    ...(kind === "text" && isDocument(record.document) ? { document: record.document } : {}),
    ...(Array.isArray(record.taskCompletions) ? { taskCompletions: [...new Map(
      record.taskCompletions.filter((entry): entry is { itemId: string; completedAt: string | null } =>
        Boolean(entry && typeof entry.itemId === "string" && (entry.completedAt === null || typeof entry.completedAt === "string")),
      ).map(({ itemId, completedAt }) => [itemId, { itemId, completedAt:
        completedAt && !Number.isNaN(Date.parse(completedAt)) ? completedAt : null }]),
    ).values()] } : {}),
    ...(Array.isArray(record.attachments) && record.attachments.length ? { attachments: record.attachments.filter((file): file is Attachment => Boolean(file && typeof file.id === "string" && typeof file.name === "string" && typeof file.mimeType === "string" && Number.isSafeInteger(file.size) && file.size >= 0)).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })) } : {}),
  };
}

const reminderStates: readonly ReminderState[] = [
  "pending",
  "scheduled",
  "permission-denied",
  "scheduling-failed",
  "overdue",
];

function hydrateBrowserReminder(value: unknown): ChecklistReminder | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.scheduledFor !== "string" ||
    Number.isNaN(new Date(record.scheduledFor).getTime()) ||
    typeof record.state !== "string" ||
    !reminderStates.includes(record.state as ReminderState) ||
    !(record.lastError === null || typeof record.lastError === "string")
  ) {
    return null;
  }
  const state =
    record.state === "scheduled" && new Date(record.scheduledFor).getTime() <= Date.now()
      ? "overdue"
      : (record.state as ReminderState);
  return {
    scheduledFor: new Date(record.scheduledFor).toISOString(),
    state,
    lastError: record.lastError as string | null,
  };
}

function isThoughtSource(value: unknown): value is ThoughtSource {
  return (
    typeof value === "string" && (THOUGHT_SOURCES as readonly string[]).includes(value)
  );
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return args === undefined ? await invoke<T>(command) : await invoke<T>(command, args);
  } catch (cause) {
    if (cause instanceof Error) throw cause;
    if (typeof cause === "string") throw new Error(cause);
    if (cause && typeof cause === "object" && "message" in cause) {
      const message = (cause as { message?: unknown }).message;
      if (typeof message === "string") throw new Error(message);
    }
    throw new Error(`Brain Cache native command failed: ${command}`);
  }
}
