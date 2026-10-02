import "./ThoughtDetail.css";
import { RichTextEditor, RichDocumentContent, type RichEditorHandle } from "./RichTextEditor";
import { richDocumentForThought, projectRichDocument, richImageIds, richText, type RichDocument } from "./richDocument";
import { NoteReminder } from "./NoteReminder";
import { reminderStatus } from "./reminderTime";
import { DocumentContent } from "./DocumentEditor";
import { completeImageInsertion, documentBody, inlineImageIds, isDocument, reserveImageInsertion } from "./document";
import type { DocumentBlock } from "./types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { AttachmentArea, AttachmentPreview, type AttachmentAreaHandle } from "./AttachmentArea";
import { clipboardAttachmentFiles, draftMetadata, fileSize } from "./attachments";
import { MasonryGrid } from "./MasonryGrid";
import { Blob } from "./Blob";
import {
  addThoughtTag,
  addThoughtAttachments,
  removeThoughtAttachment,
  clearChecklistReminder,
  clearThoughtReminder,
  setThoughtReminder,
  listenForCreatedThought,
  listenForReminderOpened,
  listenForRemindersReconciled,
  listTagDefinitions,
  listThoughts,
  openNotificationSettings,
  removeThoughtTag,
  replaceChecklistItems,
  setChecklistReminder,
  setTagColor,
  setThoughtArchived,
  setThoughtCompleted,
  setThoughtPinned,
  showCapture,
  takePendingReminderTarget,
  updateThoughtBody,
  updateRichDocument,
} from "./bridge";
import type { ReminderTarget } from "./bridge";
import {
  assignedTags,
  filterThoughts,
  firstLine,
  formatThoughtTime,
  localDayKey,
  recentTags,
  removeTagQueryFragment,
  suggestCanonicalTags,
  tagQueryFragment,
} from "./domain";
import { useLocalAutosave } from "./useLocalAutosave";
import { TagCombobox, TagEditor } from "./TagEditor";
import { ChecklistProgress } from "./ChecklistProgress";
import { TaskActivity, TaskCompletionFeedback, useTaskProgress } from "./TaskActivity";
import { ActivityPage } from "./ActivityPage";
import { colorForTag, TagColorDot, tagColorClass, thoughtOutlineClass } from "./TagColor";
import { TagColors } from "./TagColors";
import { SettingsPanel } from "./SettingsPanel";
import type {
  AttachmentDraft,
  ChecklistItem,
  LibraryFilter,
  TagColor,
  TagDefinition,
  Thought,
} from "./types";

const filters: Array<{ id: LibraryFilter; label: string; glyph: string }> = [
  { id: "all", label: "All thoughts", glyph: "⌁" },
  { id: "today", label: "Today", glyph: "◌" },
  { id: "completed", label: "Completed", glyph: "✓" },
  { id: "archive", label: "Trash", glyph: "⌫" },
];

const pointerFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden']):not([hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DetailMode = "focus" | "canvas";

interface ReturnContext {
  scrollTop: number;
  thoughtId: string;
}

interface GridArchiveUndo {
  thoughtId: string;
  restoreArchived: boolean;
  completedArchived: boolean;
}

interface GridArchiveError {
  thoughtId: string;
  targetArchived: boolean;
  phase: "change" | "undo";
  message: string;
}

interface TagRailHandle {
  focusTag: (tag: string | null) => void;
}

const gridArchiveUndoDuration = 8_000;
const sidebarCollapsedKey = "brain-cache.sidebar-collapsed";

export function LibraryApp() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(sidebarCollapsedKey) === "true";
    } catch {
      return false;
    }
  });
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [activityView, setActivityView] = useState(false);
  const activityNavRef = useRef<HTMLButtonElement>(null);
  const activityReturnScrollRef = useRef(0);
  const activityButtonRef = useRef<HTMLButtonElement>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [checklistMutationId, setChecklistMutationId] = useState<string | null>(null);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [completionPendingId, setCompletionPendingId] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<{ thoughtId: string; message: string } | null>(null);
  const completionActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [gridArchivePendingId, setGridArchivePendingId] = useState<string | null>(null);
  const [gridArchiveUndo, setGridArchiveUndo] = useState<GridArchiveUndo | null>(null);
  const [gridArchiveError, setGridArchiveError] = useState<GridArchiveError | null>(null);
  const [pinPendingIds, setPinPendingIds] = useState<Set<string>>(new Set());
  const [pinError, setPinError] = useState<{ thoughtId: string; pinned: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const progress = useTaskProgress(thoughts);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const libraryLayoutRef = useRef<HTMLDivElement>(null);
  const thoughtsPaneRef = useRef<HTMLElement>(null);
  const richEditorRef = useRef<RichEditorHandle>(null);
  const saveBeforeLeaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const gridArchiveActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const pinButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pinPendingRef = useRef(new Set<string>());
  const emptyStateHeadingRef = useRef<HTMLHeadingElement>(null);
  const gridArchiveUndoButtonRef = useRef<HTMLButtonElement>(null);
  const gridArchivePendingRef = useRef<string | null>(null);
  const returnContextRef = useRef<ReturnContext | null>(null);
  const tagRailRef = useRef<TagRailHandle>(null);

  async function refresh() {
    try {
      const nextThoughts = await listThoughts();
      setThoughts(nextThoughts);
      setTagDefinitions(
        reconcileTagDefinitions(
          await listTagDefinitions().catch(() => []),
          assignedTags(nextThoughts),
        ),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Brain Cache could not open its local store.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    let removeListener: () => void = () => undefined;
    void listenForCreatedThought(async (thought) => {
      setActivityOpen(false);
      setActivityView(false);
      setThoughts((current) => [thought, ...current.filter((item) => item.id !== thought.id)]);
      if (await saveBeforeLeaveRef.current?.() !== false) {
        setSelectedId(thought.id);
        setFilter("all");
      }
      void listTagDefinitions()
        .then(setTagDefinitions)
        .catch(() => setTagDefinitions((current) => mergeTagDefinitions(current, thought.tags)));
    }).then((unlisten) => {
      removeListener = unlisten;
    });
    return () => removeListener();
  }, []);

  useEffect(() => {
    let disposed = false;
    let removeListener: () => void = () => undefined;
    let removeReconciledListener: () => void = () => undefined;
    void listenForReminderOpened((target) => {
      if (disposed) return;
      void takePendingReminderTarget()
        .then((pending) => openReminderTarget(pending ?? target))
        .catch(() => openReminderTarget(target));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else removeListener = unlisten;
    });
    void listenForRemindersReconciled(() => {
      if (!disposed) void refresh();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else removeReconciledListener = unlisten;
    });
    void takePendingReminderTarget()
      .then((target) => {
        if (!disposed && target) void openReminderTarget(target);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      removeListener();
      removeReconciledListener();
    };
  }, []);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (activityOpen || settingsOpen) return;
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!activityView) {
          searchRef.current?.focus();
          return;
        }
        setActivityView(false);
        requestAnimationFrame(() => {
          if (activityView && thoughtsPaneRef.current) thoughtsPaneRef.current.scrollTop = activityReturnScrollRef.current;
          searchRef.current?.focus();
        });
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [activityOpen, settingsOpen, activityView]);

  const allTags = useMemo(() => assignedTags(thoughts), [thoughts]);
  const visibleThoughts = useMemo(
    () => filterThoughts(thoughts, filter, query, activeTag),
    [activeTag, filter, query, thoughts],
  );

  useEffect(() => {
    if (detailMode) return;
    if (!selectedId || visibleThoughts.some((thought) => thought.id === selectedId)) return;
    setSelectedId(null);
  }, [detailMode, selectedId, visibleThoughts]);

  useEffect(() => {
    const layout = libraryLayoutRef.current;
    const pane = thoughtsPaneRef.current;
    if (detailMode === "focus" || activityOpen || settingsOpen) layout?.setAttribute("inert", "");
    else layout?.removeAttribute("inert");
    if (detailMode === "canvas") pane?.setAttribute("inert", "");
    else pane?.removeAttribute("inert");
    return () => {
      layout?.removeAttribute("inert");
      pane?.removeAttribute("inert");
    };
  }, [detailMode, activityOpen, settingsOpen]);

  useEffect(() => {
    if (
      !gridArchiveUndo ||
      gridArchivePendingId === gridArchiveUndo.thoughtId ||
      (gridArchiveError?.phase === "undo" &&
        gridArchiveError.thoughtId === gridArchiveUndo.thoughtId)
    ) {
      return;
    }
    const timeout = window.setTimeout(() => setGridArchiveUndo(null), gridArchiveUndoDuration);
    return () => window.clearTimeout(timeout);
  }, [gridArchiveError, gridArchivePendingId, gridArchiveUndo]);

  const selected = thoughts.find((thought) => thought.id === selectedId) ?? null;
  const todayCount = thoughts.filter(
    (thought) =>
      !thought.archived && !thought.completed && localDayKey(new Date(thought.createdAt)) === localDayKey(new Date()),
  ).length;
  const currentFilterLabel = filters.find((item) => item.id === filter)?.label ?? "All thoughts";

  function selectTag(tag: string | null, focusRail = false) {
    setActiveTag(tag);
    if (focusRail) requestAnimationFrame(() => tagRailRef.current?.focusTag(tag));
  }

  function acceptUpdatedThought(updated: Thought, changes: Partial<Thought> | ((current: Thought) => Partial<Thought>) = updated) {
    setThoughts((current) => {
      const next = current.map((item) => (item.id === updated.id ? { ...item, ...(typeof changes === "function" ? changes(item) : changes) } : item));
      setTagDefinitions((definitions) =>
        reconcileTagDefinitions(definitions, assignedTags(next)),
      );
      return next;
    });
  }

  async function addTagToThought(thought: Thought, tag: string) {
    const updated = await addThoughtTag(thought.id, tag);
    acceptUpdatedThought(updated, { tags: updated.tags });
  }

  async function removeTagFromThought(thought: Thought, tag: string) {
    const updated = await removeThoughtTag(thought.id, tag);
    acceptUpdatedThought(updated, { tags: updated.tags });
  }

  async function changeTagColor(tag: string, color: TagColor | null) {
    const updated = await setTagColor(tag, color);
    setTagDefinitions((current) =>
      reconcileTagDefinitions(
        [...current.filter((definition) => definition.name !== updated.name), updated],
        allTags,
      ),
    );
  }

  async function saveRichDocument(thought: Thought, document: RichDocument, files: AttachmentDraft[]) {
    const updated = await updateRichDocument(thought.id, document, files);
    acceptUpdatedThought(updated, { body: updated.body, kind: updated.kind, richDocument: updated.richDocument,
      document: updated.document, checklistItems: updated.checklistItems, completed: updated.completed,
      taskCompletions: updated.taskCompletions, attachments: updated.attachments, reminder: updated.reminder });
  }

  async function saveChecklistItems(thought: Thought, items: ChecklistItem[]) {
    if (gridArchivePendingRef.current === thought.id) return;
    setChecklistMutationId(thought.id);
    setChecklistError(null);
    try {
      const updated = await replaceChecklistItems(thought.id, items);
      acceptUpdatedThought(updated, { body: updated.body, checklistItems: updated.checklistItems, taskCompletions: updated.taskCompletions, completed: updated.completed, richDocument: updated.richDocument });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not update that checklist.";
      setChecklistError(message);
      throw new Error(message);
    } finally {
      setChecklistMutationId(null);
    }
  }

  async function saveChecklistReminder(
    thought: Thought,
    itemId: string,
    scheduledFor: string,
  ) {
    const updated = await setChecklistReminder(thought.id, itemId, scheduledFor);
    acceptUpdatedThought(updated, (current) => ({ checklistItems: current.checklistItems.map((item) =>
      item.id === itemId ? { ...item, reminder: current.archived || current.completed || item.completed ? null
        : updated.checklistItems.find((saved) => saved.id === itemId)?.reminder ?? null } : item,
    ) }));
  }

  async function removeChecklistReminder(thought: Thought, itemId: string) {
    const updated = await clearChecklistReminder(thought.id, itemId);
    acceptUpdatedThought(updated, (current) => ({ checklistItems: current.checklistItems.map((item) =>
      item.id === itemId ? { ...item, reminder: null } : item,
    ) }));
  }

  async function openReminderTarget(target: ReminderTarget) {
    if (await saveBeforeLeaveRef.current?.() === false) return;
    try {
      const nextThoughts = await listThoughts();
      const thought = nextThoughts.find((candidate) => candidate.id === target.thoughtId);
      const item = thought?.checklistItems.find((candidate) => candidate.id === target.itemId);
      if (!thought || (target.itemId && !item)) {
        throw new Error("That reminder's note or checklist item is no longer in the cache.");
      }
      setThoughts(nextThoughts);
      setFilter(thought.archived ? "archive" : thought.completed ? "completed" : "all");
      setActiveTag(null);
      setSelectedId(thought.id);
      setDetailError(null);
      setChecklistError(null);
      setActivityOpen(false);
      setSettingsOpen(false);
      setActivityView(false);
      setDetailMode("focus");
      requestAnimationFrame(() => richEditorRef.current?.focus(target.itemId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that reminder.");
    }
  }

  async function openThought(thought: Thought) {
    if (await saveBeforeLeaveRef.current?.() === false) return;
    returnContextRef.current = {
      scrollTop: thoughtsPaneRef.current?.scrollTop ?? 0,
      thoughtId: thought.id,
    };
    setSelectedId(thought.id);
    setDetailError(null);
    setChecklistError(null);
    setDetailMode("focus");
    requestAnimationFrame(() =>
      richEditorRef.current?.focus(),
    );
  }

  function restoreLibrary(focusId = returnContextRef.current?.thoughtId ?? null) {
    const scrollTop = returnContextRef.current?.scrollTop ?? 0;
    const visibleFocusId =
      focusId && visibleThoughts.some((thought) => thought.id === focusId) ? focusId : null;
    setSelectedId(visibleFocusId);
    setDetailMode(null);
    requestAnimationFrame(() => {
      if (thoughtsPaneRef.current) thoughtsPaneRef.current.scrollTop = scrollTop;
      const target = visibleFocusId ? cardRefs.current.get(visibleFocusId) : null;
      (target ?? searchRef.current)?.focus();
    });
  }

  async function saveBody(thought: Thought, body: string, document?: DocumentBlock[], files: AttachmentDraft[] = []) {
    const updated = document ? await updateThoughtBody(thought.id, body, document, files) : await updateThoughtBody(thought.id, body);
    const nextImages = inlineImageIds(document);
    const added = new Set(files.map((file) => file.id));
    acceptUpdatedThought(updated, (current) => ({ body: updated.body,
      ...(document ? { document: updated.document, attachments: [
        ...(current.attachments ?? []).filter((file) => (!inlineImageIds(current.document).has(file.id) || nextImages.has(file.id)) && !added.has(file.id)),
        ...(updated.attachments ?? []).filter((file) => added.has(file.id)),
      ] } : {}),
    }));
  }

  async function changePin(thought: Thought, pinned = !thought.pinned) {
    if (pinPendingRef.current.has(thought.id)) return;
    pinPendingRef.current.add(thought.id);
    setPinPendingIds(new Set(pinPendingRef.current));
    setPinError(null);
    try {
      const updated = await setThoughtPinned(thought.id, pinned);
      const button = pinButtonRefs.current.get(thought.id);
      const hadFocus = document.activeElement === button;
      acceptUpdatedThought(updated, { pinned: updated.pinned });
      if (hadFocus) requestAnimationFrame(() => {
        if (document.activeElement === document.body || document.activeElement === button) {
          button?.focus();
        }
      });
    } catch (cause) {
      setPinError({
        thoughtId: thought.id,
        pinned,
        message: cause instanceof Error ? cause.message : "Could not save the pin change.",
      });
    } finally {
      pinPendingRef.current.delete(thought.id);
      setPinPendingIds(new Set(pinPendingRef.current));
    }
  }

  async function changeCompletion(thought: Thought) {
    if (gridArchivePendingRef.current || checklistMutationId === thought.id || thought.archived) return;
    const scrollTop = thoughtsPaneRef.current?.scrollTop ?? 0;
    const beforeIndex = visibleThoughts.findIndex((item) => item.id === thought.id);
    gridArchivePendingRef.current = thought.id;
    setCompletionPendingId(thought.id);
    setCompletionError(null);
    setDetailError(null);
    try {
      const updated = await setThoughtCompleted(thought.id, !thought.completed);
      acceptUpdatedThought(updated, {
        completed: updated.completed, checklistItems: updated.checklistItems,
        taskCompletions: updated.taskCompletions, reminder: updated.reminder, richDocument: updated.richDocument,
      });
      if (detailMode) restoreLibrary();
      focusGridAfterRemoval(beforeIndex, scrollTop);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save that completion. Try again.";
      setCompletionError({ thoughtId: thought.id, message });
      setDetailError(message);
      if (!detailMode) requestAnimationFrame(() => completionActionRefs.current.get(thought.id)?.focus());
    } finally {
      gridArchivePendingRef.current = null;
      setCompletionPendingId(null);
    }
  }

  async function toggleArchive(thought: Thought) {
    if (gridArchivePendingRef.current) return;
    gridArchivePendingRef.current = thought.id;
    setGridArchivePendingId(thought.id);
    setDetailError(null);
    try {
      const updated = await setThoughtArchived(thought.id, !thought.archived);
      const nextThoughts = thoughts.map((item) => (item.id === updated.id ? updated : item));
      const beforeIndex = visibleThoughts.findIndex((item) => item.id === thought.id);
      const remaining = filterThoughts(nextThoughts, filter, query, activeTag);
      const nextFocus = remaining[Math.min(Math.max(0, beforeIndex), remaining.length - 1)]?.id ?? null;
      setThoughts((current) => current.map((item) => item.id === updated.id
        ? { ...item, archived: updated.archived, reminder: updated.reminder, checklistItems: updated.checklistItems }
        : item));
      setGridArchiveUndo({ thoughtId: thought.id, restoreArchived: thought.archived, completedArchived: updated.archived });
      setSelectedId(nextFocus);
      restoreLibrary(nextFocus);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "Could not update that thought.");
    } finally {
      gridArchivePendingRef.current = null;
      setGridArchivePendingId(null);
    }
  }

  function focusGridAfterRemoval(beforeIndex: number, scrollTop: number) {
    requestAnimationFrame(() => {
      if (thoughtsPaneRef.current) thoughtsPaneRef.current.scrollTop = scrollTop;
      const remainingCards = Array.from(
        thoughtsPaneRef.current?.querySelectorAll<HTMLButtonElement>(
          ".thought-card__open-overlay",
        ) ?? [],
      );
      const target =
        remainingCards[Math.min(Math.max(0, beforeIndex), remainingCards.length - 1)] ?? null;
      setSelectedId(target?.dataset.thoughtId ?? null);
      (target ?? emptyStateHeadingRef.current ?? searchRef.current)?.focus();
    });
  }

  function focusGridAfterUndo(thoughtId: string, scrollTop: number) {
    requestAnimationFrame(() => {
      if (thoughtsPaneRef.current) thoughtsPaneRef.current.scrollTop = scrollTop;
      const returned = cardRefs.current.get(thoughtId);
      setSelectedId(returned ? thoughtId : null);
      (returned ?? searchRef.current)?.focus();
    });
  }

  function focusGridArchiveAction(thoughtId: string, scrollTop: number) {
    requestAnimationFrame(() => {
      if (thoughtsPaneRef.current) thoughtsPaneRef.current.scrollTop = scrollTop;
      gridArchiveActionRefs.current.get(thoughtId)?.focus();
    });
  }

  async function changeGridArchive(thought: Thought, targetArchived = !thought.archived) {
    if (
      gridArchivePendingRef.current ||
      checklistMutationId === thought.id ||
      thought.archived === targetArchived
    ) {
      return;
    }
    const scrollTop = thoughtsPaneRef.current?.scrollTop ?? 0;
    const beforeIndex = visibleThoughts.findIndex((item) => item.id === thought.id);
    gridArchivePendingRef.current = thought.id;
    setGridArchivePendingId(thought.id);
    setGridArchiveError(null);
    try {
      const updated = await setThoughtArchived(thought.id, targetArchived);
      setThoughts((current) =>
        current.map((item) => item.id === updated.id
          ? { ...item, archived: updated.archived, reminder: updated.reminder, checklistItems: updated.checklistItems }
          : item),
      );
      setGridArchiveUndo({
        thoughtId: thought.id,
        restoreArchived: thought.archived,
        completedArchived: updated.archived,
      });
      focusGridAfterRemoval(beforeIndex, scrollTop);
    } catch (cause) {
      setGridArchiveError({
        thoughtId: thought.id,
        targetArchived,
        phase: "change",
        message: cause instanceof Error ? cause.message : "Could not update that thought.",
      });
      focusGridArchiveAction(thought.id, scrollTop);
    } finally {
      gridArchivePendingRef.current = null;
      setGridArchivePendingId(null);
    }
  }

  async function undoGridArchive() {
    if (!gridArchiveUndo || gridArchivePendingRef.current) return;
    const scrollTop = thoughtsPaneRef.current?.scrollTop ?? 0;
    gridArchivePendingRef.current = gridArchiveUndo.thoughtId;
    setGridArchivePendingId(gridArchiveUndo.thoughtId);
    setGridArchiveError(null);
    try {
      const updated = await setThoughtArchived(
        gridArchiveUndo.thoughtId,
        gridArchiveUndo.restoreArchived,
      );
      setThoughts((current) =>
        current.map((item) => item.id === updated.id
          ? { ...item, archived: updated.archived, reminder: updated.reminder, checklistItems: updated.checklistItems }
          : item),
      );
      setGridArchiveUndo(null);
      focusGridAfterUndo(updated.id, scrollTop);
    } catch (cause) {
      setGridArchiveError({
        thoughtId: gridArchiveUndo.thoughtId,
        targetArchived: gridArchiveUndo.restoreArchived,
        phase: "undo",
        message: cause instanceof Error ? cause.message : "Could not undo that change.",
      });
      requestAnimationFrame(() => gridArchiveUndoButtonRef.current?.focus());
    } finally {
      gridArchivePendingRef.current = null;
      setGridArchivePendingId(null);
    }
  }

  function retryGridArchive() {
    if (!gridArchiveError) return;
    if (gridArchiveError.phase === "undo") {
      void undoGridArchive();
      return;
    }
    const thought = thoughts.find((candidate) => candidate.id === gridArchiveError.thoughtId);
    if (thought) void changeGridArchive(thought, gridArchiveError.targetArchived);
    else void refresh();
  }

  const readSidebarVisible = useCallback(async () => !sidebarCollapsed, [sidebarCollapsed]);
  const changeSidebarVisible = useCallback(async (visible: boolean) => {
    localStorage.setItem(sidebarCollapsedKey, String(!visible));
    setSidebarCollapsed(!visible);
  }, []);

  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus({ preventScroll: true }));
  }

  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(sidebarCollapsedKey, String(collapsed));
    } catch {
      // Keep the layout usable even if the optional preference cannot be stored.
    }
  }

  function openActivityView() {
    if (activityView) return;
    activityReturnScrollRef.current = thoughtsPaneRef.current?.scrollTop ?? 0;
    setActivityView(true);
  }

  function closeActivityView() {
    setActivityView(false);
    requestAnimationFrame(() => {
      if (thoughtsPaneRef.current) thoughtsPaneRef.current.scrollTop = activityReturnScrollRef.current;
      (sidebarCollapsed ? activityButtonRef.current : activityNavRef.current)?.focus({ preventScroll: true });
    });
  }

  return (
    <main className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar__traffic-space" data-tauri-drag-region>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="library-sidebar"
            disabled={detailMode === "focus" || activityOpen || settingsOpen}
            onClick={toggleSidebar}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
        </div>
        <div className="wordmark" data-tauri-drag-region>
          <span className="wordmark__mark">bc</span>
          brain cache
        </div>
        <div className="titlebar__state" data-tauri-drag-region>
          {sidebarCollapsed && (
            <button
              ref={settingsButtonRef}
              className="sidebar-toggle titlebar__settings"
              type="button"
              aria-label="Settings"
              title="Settings"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              aria-controls="settings-panel"
              disabled={detailMode !== null || activityOpen || settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </button>
          )}
          <i /> local
        </div>
      </header>

      <div
        ref={libraryLayoutRef}
        className={`library-layout${detailMode ? ` library-layout--detail-${detailMode}` : ""}`}
      >
        <aside className="sidebar" id="library-sidebar" hidden={sidebarCollapsed}>
          <div>
            <p className="eyebrow sidebar__label">cache</p>
            <nav aria-label="Thought filters">
              {filters.map((item) => {
                const count =
                  item.id === "archive"
                    ? thoughts.filter((thought) => thought.archived).length
                    : item.id === "completed"
                      ? thoughts.filter((thought) => !thought.archived && thought.completed).length
                    : item.id === "today"
                      ? todayCount
                      : thoughts.filter((thought) => !thought.archived && !thought.completed).length;
                return (
                  <button
                    className={`nav-item${!activityView && filter === item.id ? " nav-item--active" : ""}`}
                    type="button"
                    key={item.id}
                    aria-current={!activityView && filter === item.id ? "page" : undefined}
                    disabled={detailMode !== null}
                    onClick={() => {
                      if (activityView && filter === item.id) {
                        closeActivityView();
                        return;
                      }
                      setActivityView(false);
                      setFilter(item.id);
                      setSelectedId(null);
                    }}
                  >
                    <span className="nav-item__glyph">{item.glyph}</span>
                    <span>{item.label}</span>
                    <span className="nav-item__count">{count}</span>
                  </button>
                );
              })}
            </nav>
            <nav className="activity-nav" aria-label="Progress">
              <button
                ref={activityNavRef}
                className={`nav-item${activityView ? " nav-item--active" : ""}`}
                type="button"
                aria-label="Open Activity"
                aria-current={activityView ? "page" : undefined}
                disabled={detailMode !== null || loading || Boolean(error)}
                onClick={openActivityView}
              >
                <svg className="nav-item__glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21v-9M12 15C5 15 3 10 3 5c6 0 9 3 9 10ZM12 12c0-6 3-9 9-9 0 6-3 9-9 9ZM7 21h10" /></svg>
                <span>Activity</span>
              </button>
            </nav>
          </div>

          <div className="sidebar__bottom">
            <button
              className="capture-launch"
              type="button"
              disabled={detailMode !== null}
              onClick={() => void showCapture()}
            >
              <Blob compact />
              <span>
                <strong>Wake Blob</strong>
                <small>⌥ Space</small>
              </span>
            </button>
            {!sidebarCollapsed && (
              <button
                ref={settingsButtonRef}
                className="nav-item"
                type="button"
                aria-label="Settings"
                title="Settings"
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                aria-controls="settings-panel"
                disabled={detailMode !== null}
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon />
                <span>Settings</span>
              </button>
            )}
          </div>
        </aside>

        <section ref={thoughtsPaneRef} className="thoughts-pane" hidden={activityView}>
          <div className="thoughts-toolbar">
            <div>
              <p className="eyebrow">{filter === "archive" ? "trash" : "working memory"}</p>
              <h1>{currentFilterLabel}</h1>
            </div>
            <div className="thoughts-toolbar__actions">
              <button
                ref={activityButtonRef}
                className="activity-button"
                type="button"
                aria-label="Open activity summary"
                aria-haspopup="dialog"
                aria-expanded={activityOpen}
                aria-controls="task-activity-panel"
                disabled={loading || Boolean(error)}
                onClick={() => setActivityOpen(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 19v-5m7 5V5m7 14V9" /></svg>
                Activity
              </button>
              <button className="new-thought-button" type="button" onClick={() => void showCapture()}>
                <span>+</span> new thought
              </button>
            </div>
          </div>

          <div className={`search-row${allTags.length > 0 ? " search-row--rail" : ""}`}>
            <LibrarySearch
              inputRef={searchRef}
              query={query}
              availableTags={allTags}
              tagDefinitions={tagDefinitions}
              onQueryChange={setQuery}
              onSelectTag={(tag) => selectTag(tag, true)}
            />
            {allTags.length === 0 && (
              <TagFilterControl
                activeTag={activeTag}
                availableTags={allTags}
                tagDefinitions={tagDefinitions}
                onSelect={(tag) => selectTag(tag)}
                onClear={() => selectTag(null)}
              />
            )}
          </div>

          {allTags.length > 0 && (
            <div className="library-tag-controls">
              <TagRail
                ref={tagRailRef}
                thoughts={thoughts}
                activeTag={activeTag}
                availableTags={allTags}
                tagDefinitions={tagDefinitions}
                onSelect={(tag) => selectTag(tag)}
              />
              <TagColors tags={allTags} definitions={tagDefinitions} activeTag={activeTag} onChange={changeTagColor} />
            </div>
          )}

          <p className="results-announcement" aria-live="polite">
            {activeTag
              ? `${visibleThoughts.length} ${visibleThoughts.length === 1 ? "thought" : "thoughts"} tagged #${activeTag} in ${currentFilterLabel}`
              : `${visibleThoughts.length} ${visibleThoughts.length === 1 ? "thought" : "thoughts"} in ${currentFilterLabel}`}
          </p>
          {checklistError && (
            <p className="checklist-mutation-error" role="alert">
              {checklistError}
            </p>
          )}

          {(gridArchiveError || gridArchiveUndo) && (
            <div className="grid-archive-feedback-stack">
              {gridArchiveError && (
                <div className="grid-archive-feedback grid-archive-feedback--error" role="alert">
                  <span>{gridArchiveError.message}</span>
                  <button type="button" onClick={retryGridArchive}>
                    retry
                  </button>
                </div>
              )}
              {gridArchiveUndo && (
                <div className="grid-archive-feedback" role="status" aria-live="polite">
                  <span>
                    {gridArchiveUndo.completedArchived
                      ? "Thought moved to Trash."
                      : "Thought restored locally."}
                  </span>
                  <button
                    ref={gridArchiveUndoButtonRef}
                    type="button"
                    aria-disabled={gridArchivePendingId === gridArchiveUndo.thoughtId}
                    onClick={() => void undoGridArchive()}
                  >
                    {gridArchivePendingId === gridArchiveUndo.thoughtId ? "undoing…" : "undo"}
                  </button>
                </div>
              )}
            </div>
          )}

          {error ? (
            <div className="notice notice--error">
              <strong>Local store unavailable</strong>
              <span>{error}</span>
              <button type="button" onClick={() => void refresh()}>
                retry
              </button>
            </div>
          ) : loading ? (
            <div className="loading-state">opening local cache…</div>
          ) : visibleThoughts.length === 0 ? (
            <div className="empty-state">
              <Blob />
              <p className="eyebrow">nothing stuck here</p>
              <h2 ref={emptyStateHeadingRef} tabIndex={-1}>
                {activeTag
                  ? `No ${currentFilterLabel.toLowerCase()} tagged #${activeTag}.`
                  : query
                    ? "No thought matches that search."
                    : "Your head has room."}
              </h2>
              <p>
                {activeTag
                  ? query
                    ? "Clear the tag or change the search to widen these results."
                    : "Clear the tag to return to the same library view."
                  : query
                    ? "Try a different phrase or tag name."
                    : "Press ⌥ Space from anywhere and give Blob the next thing you don't want to lose."}
              </p>
              {activeTag ? (
                <button className="primary-button" type="button" onClick={() => selectTag(null)}>
                  clear #{activeTag}
                </button>
              ) : (
                !query && (
                  <button className="primary-button" type="button" onClick={() => void showCapture()}>
                    capture a thought
                  </button>
                )
              )}
            </div>
          ) : (
            <MasonryGrid>
              {visibleThoughts.map((thought) => (
                <article
                  key={thought.id}
                  className={`thought-card ${thoughtOutlineClass(thought, tagDefinitions)}${selectedId === thought.id ? " thought-card--selected" : ""}${thought.pinned ? " thought-card--pinned" : ""}`}
                  aria-busy={gridArchivePendingId === thought.id || completionPendingId === thought.id || pinPendingIds.has(thought.id)}
                >
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) cardRefs.current.set(thought.id, node);
                      else cardRefs.current.delete(thought.id);
                    }}
                    aria-label={`Open ${thought.kind === "checklist" ? "checklist" : "thought"}: ${firstLine(thought.body)}`}
                    className="thought-card__open-overlay"
                    data-thought-id={thought.id}
                    onClick={() => openThought(thought)}
                  />
                  {thought.pinned && <span className="thought-card__pinned-label">pinned</span>}
                  <div className="thought-card__meta">
                    <span>{formatThoughtTime(thought.createdAt)}</span>
                    <span className="thought-card__meta-actions">
                      {thought.kind === "checklist" ? (
                        <ChecklistProgress items={thought.checklistItems} />
                      ) : <i>{thought.source.replace("mac-", "")}</i>}
                      <button
                        ref={(node) => {
                          if (node) pinButtonRefs.current.set(thought.id, node);
                          else pinButtonRefs.current.delete(thought.id);
                        }}
                        type="button"
                        className="thought-card__pin"
                        aria-label={`${thought.pinned ? "Unpin" : "Pin"} ${thought.kind === "checklist" ? "checklist" : "thought"}: ${firstLine(thought.body)}`}
                        title={thought.pinned ? "Unpin" : "Pin to top"}
                        aria-pressed={Boolean(thought.pinned)}
                        aria-disabled={pinPendingIds.has(thought.id)}
                        onClick={() => void changePin(thought)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                          <path d="M8 3h8M9 3v6l-4 5v2h14v-2l-4-5V3M12 16v5" />
                        </svg>
                      </button>
                    </span>
                  </div>
                  {pinError?.thoughtId === thought.id && (
                    <span className="thought-card__pin-error" role="alert">
                      {pinError.message}
                      <button type="button" onClick={() => void changePin(thought, pinError.pinned)}>retry pin</button>
                    </span>
                  )}
                  {thought.tags.length > 0 && (
                    <CardTags tags={thought.tags} tagDefinitions={tagDefinitions} />
                  )}
                  {thought.richDocument ? <RichDocumentContent document={thought.richDocument} files={thought.attachments ?? []}
                    disabled={checklistMutationId === thought.id || gridArchivePendingId === thought.id || completionPendingId === thought.id}
                    onToggle={(id) => void saveChecklistItems(thought, thought.checklistItems.map((item) => item.id === id ? { ...item, completed: !item.completed } : item)).catch(() => undefined)}
                  /> : thought.kind === "checklist" ? (
                    <ChecklistCard
                      thought={thought}
                      pending={
                        checklistMutationId === thought.id || gridArchivePendingId === thought.id || completionPendingId === thought.id
                      }
                      onToggle={(item) =>
                        saveChecklistItems(
                          thought,
                          thought.checklistItems.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, completed: !candidate.completed }
                              : candidate,
                          ),
                        )
                      }
                    />
                  ) : (
                    thought.document ? <DocumentContent blocks={thought.document} files={thought.attachments ?? []} /> : <span className="thought-card__body">{thought.body}</span>
                  )}
                  {thought.attachments?.some((file) => !inlineImageIds(thought.document).has(file.id) && !richImageIds(thought.richDocument).has(file.id)) && (
                    <div className="thought-card__attachments" aria-label="Attached files and images">
                      {thought.attachments!.filter((file) => !inlineImageIds(thought.document).has(file.id) && !richImageIds(thought.richDocument).has(file.id)).map((file) => file.mimeType.startsWith("image/") ? (
                        <AttachmentPreview key={file.id} file={file} card />
                      ) : (
                        <span className="thought-card__file" key={file.id}>
                          <span>{file.name}</span><small>{fileSize(file.size)}</small>
                        </span>
                      ))}
                    </div>
                  )}
                  {thought.reminder && <span className={`thought-card__reminder thought-card__reminder--${thought.reminder.state}`}>
                    {reminderStatus(thought.reminder)}
                  </span>}
                  {completionError?.thoughtId === thought.id && <span className="thought-card__completion-error" role="alert">
                    {completionError.message}
                  </span>}
                  <span className="thought-card__footer">
                    <span className="thought-card__open">{thought.completed ? "completed ✓" : "open ↗"}</span>
                    <span className="thought-card__actions">
                    {!thought.archived && <button type="button" className="thought-card__complete"
                      ref={(node) => { if (node) completionActionRefs.current.set(thought.id, node); else completionActionRefs.current.delete(thought.id); }}
                      aria-label={`${thought.completed ? "Reopen" : "Complete"} ${thought.kind === "checklist" ? "checklist" : "thought"}: ${firstLine(thought.body)}`}
                      aria-disabled={gridArchivePendingId === thought.id || completionPendingId === thought.id || checklistMutationId === thought.id}
                      onClick={() => void changeCompletion(thought)}>
                      {completionPendingId === thought.id ? "saving…" : thought.completed ? "reopen" : "✓ complete"}
                    </button>}
                    <button
                      ref={(node) => {
                        if (node) gridArchiveActionRefs.current.set(thought.id, node);
                        else gridArchiveActionRefs.current.delete(thought.id);
                      }}
                      type="button"
                      className="thought-card__archive"
                      data-action={thought.archived ? "restore" : "delete"}
                      title={thought.archived ? "Restore" : "Delete"}
                      aria-label={`${thought.archived ? "Restore" : "Delete"} ${
                        thought.kind === "checklist" ? "checklist" : "thought"
                      }: ${firstLine(thought.body)}`}
                      aria-disabled={
                        gridArchivePendingId === thought.id || completionPendingId === thought.id || checklistMutationId === thought.id
                      }
                      onClick={() => void changeGridArchive(thought)}
                    >
                      {gridArchivePendingId === thought.id
                        ? thought.archived
                          ? "restoring…"
                          : "deleting…"
                        : thought.archived
                          ? "restore ←"
                          : <TrashIcon />}
                    </button>
                    </span>
                  </span>
                </article>
              ))}
            </MasonryGrid>
          )}
        </section>
        {activityView && <ActivityPage
          progress={progress}
          returnLabel={currentFilterLabel}
          onBack={closeActivityView}
          onCapture={() => void showCapture()}
          error={error}
          onRetry={() => void refresh()}
        />}
      </div>

      {detailMode && selected && (
        <ThoughtDetail
          key={selected.id}
          mode={detailMode}
          thought={selected}
          availableTags={allTags}
          tagDefinitions={tagDefinitions}
          saveBeforeLeaveRef={saveBeforeLeaveRef}
          error={detailError ?? (pinError?.thoughtId === selected.id ? pinError.message : null)}
          richEditorRef={richEditorRef}
          onSaveRichDocument={(doc, files) => saveRichDocument(selected, doc, files)}
          onSaveBody={(body, document, files) => saveBody(selected, body, document, files)}
          onAddAttachments={async (files) => {
            const updated = await addThoughtAttachments(selected.id, files);
            const added = new Set(files.map((file) => file.id));
            acceptUpdatedThought(updated, (current) => ({ attachments: [
              ...(current.attachments ?? []).filter((file) => !added.has(file.id)),
              ...(updated.attachments ?? []).filter((file) => added.has(file.id)),
            ] }));
          }}
          onRemoveAttachment={async (id) => {
            const updated = await removeThoughtAttachment(selected.id, id);
            acceptUpdatedThought(updated, (current) => ({ attachments: (current.attachments ?? []).filter((file) => file.id !== id) }));
          }}
          onSetNoteReminder={async (date) => {
            const updated = await setThoughtReminder(selected.id, date);
            acceptUpdatedThought(updated, (current) => ({ reminder: current.archived || current.completed ? null : updated.reminder }));
          }}
          onClearNoteReminder={async () => {
            const updated = await clearThoughtReminder(selected.id);
            acceptUpdatedThought(updated, (current) => ({ reminder: current.archived || current.completed ? null : updated.reminder }));
          }}
          onChecklistChange={(items) => saveChecklistItems(selected, items)}
          onSetReminder={(itemId, scheduledFor) =>
            saveChecklistReminder(selected, itemId, scheduledFor)
          }
          onClearReminder={(itemId) => removeChecklistReminder(selected, itemId)}
          onOpenNotificationSettings={openNotificationSettings}
          onAddTag={(tag) => addTagToThought(selected, tag)}
          onRemoveTag={(tag) => removeTagFromThought(selected, tag)}
          onColorChange={changeTagColor}
          onArchive={() => toggleArchive(selected)}
          onComplete={() => changeCompletion(selected)}
          onPin={() => changePin(selected)}
          pinPending={pinPendingIds.has(selected.id)}
          actionPending={completionPendingId === selected.id || gridArchivePendingId === selected.id}
          onClose={() => restoreLibrary()}
          onExpand={() => setDetailMode("canvas")}
        />
      )}
      {activityOpen && <TaskActivity progress={progress} onClose={() => {
        setActivityOpen(false);
        requestAnimationFrame(() => activityButtonRef.current?.focus({ preventScroll: true }));
      }} />}
      {settingsOpen && <SettingsPanel readSidebarVisible={readSidebarVisible} onSidebarVisibleChange={changeSidebarVisible} onClose={closeSettings} />}
      <TaskCompletionFeedback progress={progress} ready={!loading && !error} />
    </main>
  );
}

function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9.5 3-.6 2.4-2 .9-2.2-.7-2.5 4.3 1.7 1.7v2.2l-1.7 1.7 2.5 4.3 2.2-.7 2 .9.6 2.4h5l.6-2.4 2-.9 2.2.7 2.5-4.3-1.7-1.7v-2.2l1.7-1.7-2.5-4.3-2.2.7-2-.9-.6-2.4z" /><circle cx="12" cy="12" r="3" /></svg>;
}

function reconcileTagDefinitions(
  current: readonly TagDefinition[],
  names: readonly string[],
): TagDefinition[] {
  const colors = new Map(current.map((definition) => [definition.name, definition.color]));
  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "en")).map((name) => ({
    name,
    color: colors.get(name) ?? null,
  }));
}

function mergeTagDefinitions(
  current: readonly TagDefinition[],
  names: readonly string[],
): TagDefinition[] {
  return reconcileTagDefinitions(current, [
    ...current.map((definition) => definition.name),
    ...names,
  ]);
}

function ChecklistCard({
  thought,
  pending,
  onToggle,
}: {
  thought: Thought;
  pending: boolean;
  onToggle: (item: ChecklistItem) => Promise<void>;
}) {
  const completed = thought.checklistItems.filter((item) => item.completed).length;
  return (
    <div className="checklist-card" aria-label={`${completed} of ${thought.checklistItems.length} complete`}>
      <ul>
        {thought.checklistItems.map((item) => (
          <li className={item.completed ? "is-complete" : ""} key={item.id}>
            <label>
              <input
                type="checkbox"
                aria-label={`Mark ${item.text} ${item.completed ? "incomplete" : "complete"}`}
                checked={item.completed}
                disabled={pending}
                onChange={() => void onToggle(item).catch(() => undefined)}
              />
              <span>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardTags({
  tags,
  tagDefinitions,
}: {
  tags: string[];
  tagDefinitions: TagDefinition[];
}) {
  const visible = tags.slice(0, 3);
  const hiddenCount = tags.length - visible.length;
  return (
    <span className="thought-card__tags" aria-label={`Tags: ${tags.join(", ")}`}>
      {visible.map((tag) => (
        <span
          className={`tag-chip tag-chip--card ${tagColorClass(
            colorForTag(tagDefinitions, tag),
          )}`}
          key={tag}
        >
          <TagColorDot color={colorForTag(tagDefinitions, tag)} />
          #{tag}
        </span>
      ))}
      {hiddenCount > 0 && <span className="tag-chip tag-chip--card">+{hiddenCount}</span>}
    </span>
  );
}

function TrashIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
  </svg>;
}

interface CardDraft {
  richDocument?: RichDocument;
  body: string;
  document?: DocumentBlock[];
  items: ChecklistItem[];
  newItem: ChecklistItem;
}

function blankChecklistItem(): ChecklistItem {
  return { id: crypto.randomUUID(), text: "", completed: false, reminder: null };
}

function isRichDocumentShape(value: unknown): boolean {
  function node(value: unknown, depth: number): boolean {
    if (!value || typeof value !== "object" || depth > 32 || !("type" in value) || typeof value.type !== "string") return false;
    return !("content" in value) || (Array.isArray(value.content) && value.content.every(child => node(child, depth + 1)));
  }
  return Boolean(value && typeof value === "object" && "type" in value && value.type === "doc" && "content" in value && Array.isArray(value.content) && node(value, 0));
}

function isCardDraft(value: unknown): value is CardDraft {
  const isItem = (item: unknown): item is ChecklistItem => Boolean(item && typeof item === "object"
    && "id" in item && typeof item.id === "string"
    && "text" in item && typeof item.text === "string"
    && "completed" in item && typeof item.completed === "boolean");
  return Boolean(value && typeof value === "object" && "body" in value
    && typeof value.body === "string" && (!("richDocument" in value) || value.richDocument === undefined || isRichDocumentShape(value.richDocument)) && (!("document" in value) || value.document === undefined || isDocument(value.document)) && "items" in value && Array.isArray(value.items)
    && value.items.every(isItem) && "newItem" in value && isItem(value.newItem));
}

interface ThoughtDetailProps {
  mode: DetailMode;
  thought: Thought;
  availableTags: string[];
  tagDefinitions: TagDefinition[];
  saveBeforeLeaveRef: RefObject<(() => Promise<boolean>) | null>;
  error: string | null;
  richEditorRef: RefObject<RichEditorHandle | null>;
  onSaveRichDocument: (document: RichDocument, files: AttachmentDraft[]) => Promise<void>;
  onSaveBody: (body: string, document?: DocumentBlock[], files?: AttachmentDraft[]) => Promise<void>;
  onAddAttachments: (files: AttachmentDraft[]) => Promise<void>;
  onRemoveAttachment: (id: string) => Promise<void>;
  onChecklistChange: (items: ChecklistItem[]) => Promise<void>;
  onSetNoteReminder: (scheduledFor: string) => Promise<void>;
  onClearNoteReminder: () => Promise<void>;
  onSetReminder: (itemId: string, scheduledFor: string) => Promise<void>;
  onClearReminder: (itemId: string) => Promise<void>;
  onOpenNotificationSettings: () => Promise<void>;
  onAddTag: (tag: string) => Promise<void>;
  onRemoveTag: (tag: string) => Promise<void>;
  onColorChange: (tag: string, color: TagColor | null) => Promise<void>;
  onArchive: () => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  onPin: () => Promise<void>;
  pinPending: boolean;
  actionPending: boolean;
  onClose: () => void;
  onExpand: () => void;
}

function ThoughtDetail({
  mode,
  thought,
  availableTags,
  tagDefinitions,
  saveBeforeLeaveRef,
  error,
  richEditorRef,
  onSaveRichDocument,
  onSaveBody,
  onAddAttachments,
  onRemoveAttachment,
  onChecklistChange,
  onSetReminder,
  onClearReminder,
  onSetNoteReminder,
  onClearNoteReminder,
  onOpenNotificationSettings,
  onAddTag,
  onRemoveTag,
  onColorChange,
  onArchive,
  onComplete,
  onPin,
  pinPending,
  actionPending,
  onClose,
  onExpand,
}: ThoughtDetailProps) {
  const detailRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState<"note" | "details">("note");
  const editorRef = useRef<RichEditorHandle>(null);
  const noteTabRef = useRef<HTMLButtonElement>(null);
  const detailsTabRef = useRef<HTMLButtonElement>(null);
  const noteTabId = `note-tab-${thought.id}`;
  const detailsTabId = `details-tab-${thought.id}`;
  useImperativeHandle(richEditorRef, () => ({
    focus(itemId) {
      if (activeTab === "note") editorRef.current?.focus(itemId);
      else {
        setActiveTab("note");
        requestAnimationFrame(() => editorRef.current?.focus(itemId));
      }
    },
    pasteFiles(files) { editorRef.current?.pasteFiles(files); },
    insertImages(files) {
      if (!editorRef.current) throw new Error("The note editor is not ready. Please retry.");
      editorRef.current.insertImages(files);
    },
  }));
  const attachmentAreaRef = useRef<AttachmentAreaHandle>(null);
  const leavingRef = useRef(false);
  const pendingImages = useRef(new Map<string, AttachmentDraft>());
  const savedFileIds = useRef(new Set((thought.attachments ?? []).map((file) => file.id)));
  const latestThought = useRef(thought);
  latestThought.current = thought;
  const initialDraft = useMemo<CardDraft>(() => ({
    richDocument: richDocumentForThought(thought),
    body: thought.body, document: thought.document, items: thought.checklistItems, newItem: blankChecklistItem(),
  }), [thought.id]);
  function withCurrentReminders(items: ChecklistItem[]) {
    const reminders = new Map(thought.checklistItems.map((item) => [item.id, item.reminder]));
    return items.map((item) => ({ ...item, reminder: item.completed ? null
      : reminders.has(item.id) ? (reminders.get(item.id) ?? null) : item.reminder }));
  }
  const autosave = useLocalAutosave(
    `brain-cache.card-draft.v1.${thought.id}`,
    initialDraft,
    isCardDraft,
    async (draft) => {
      if (draft.richDocument) {
        const pending = [...pendingImages.current.values()];
        await onSaveRichDocument(draft.richDocument, pending);
        for (const file of pending) { pendingImages.current.delete(file.id); savedFileIds.current.add(file.id); }
      } else if (thought.kind === "text") {
        const pending = [...pendingImages.current.values()];
        await onSaveBody(draft.body, draft.document, pending);
        for (const file of pending) { pendingImages.current.delete(file.id); savedFileIds.current.add(file.id); }
      }
      else await onChecklistChange(withCurrentReminders([
        ...draft.items, ...(draft.newItem.text.trim() ? [draft.newItem] : []),
      ]));
    },
  );
  function pasteFiles(files: File[]) { richEditorRef.current?.pasteFiles(files); }

  const richDraft = autosave.value.richDocument ?? richDocumentForThought({ ...thought,
    body: autosave.value.body, document: autosave.value.document,
    checklistItems: [...autosave.value.items, ...(autosave.value.newItem.text.trim() ? [autosave.value.newItem] : [])] });
  let draftItems = thought.checklistItems;
  try {
    draftItems = projectRichDocument(richDraft, [...(thought.attachments ?? []), ...[...pendingImages.current.values()].map(draftMetadata)]).items
      .map((item) => ({ ...item, reminder: item.completed ? null : thought.checklistItems.find((saved) => saved.id === item.id)?.reminder ?? null }));
  } catch { /* Autosave shows validation errors without discarding the writing draft. */ }

  async function savePreparedFiles(prepared: AttachmentDraft[], insert: (files: AttachmentDraft[]) => void) {
    for (const file of prepared) {
      if (!savedFileIds.current.has(file.id) && !latestThought.current.attachments?.some((saved) => saved.id === file.id)) pendingImages.current.set(file.id, file);
    }
    const revealNote = activeTab !== "note" && prepared.some((file) => draftMetadata(file).mimeType.startsWith("image/"));
    if (revealNote) setActiveTab("note");
    insert(prepared);
    if (revealNote) requestAnimationFrame(() => editorRef.current?.focus());
    // Save all selected bytes together; only image blocks are inserted into the note.
    const current = autosave.current();
    autosave.change({ ...current, richDocument: current.richDocument ?? richDraft });
    if (!await autosave.flush()) throw new Error("Could not save the files locally. Retry to keep them in the note.");
  }

  async function flushCard() {
    if (!await autosave.flush()) return false;
    if (await attachmentAreaRef.current?.flush() === false) return false;
    return autosave.flush();
  }
  useImperativeHandle(saveBeforeLeaveRef, () => flushCard);

  async function leave(action: () => void | Promise<void>) {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try { if (await flushCard()) await action(); }
    finally { leavingRef.current = false; }
  }

  async function afterSaving(action: () => Promise<void>) {
    if (!await autosave.flush()) throw new Error("Finish saving the note before changing its reminder.");
    await action();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void leave(onClose);
      return;
    }
    if (event.key !== "Tab" || mode !== "focus") return;
    const focusable = Array.from(
      detailRef.current?.querySelectorAll<HTMLElement>(pointerFocusableSelector) ?? [],
    ).filter((element) => !element.hasAttribute("disabled")
      && element.getAttribute("tabindex") !== "-1" && !element.closest("[hidden], [inert]"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className={`thought-detail-layer thought-detail-layer--${mode}`}
      onMouseDown={(event) => {
        if (mode === "focus" && event.target === event.currentTarget) void leave(onClose);
      }}
      onKeyDown={handleKeyDown}
    >
      <article
        ref={detailRef}
        className={`thought-detail thought-detail--familiar thought-detail--${mode} ${thoughtOutlineClass(thought, tagDefinitions)}`}
        role="dialog"
        aria-modal={mode === "focus" ? true : undefined}
        aria-labelledby="thought-detail-title"
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void attachmentAreaRef.current?.addFiles(Array.from(event.dataTransfer.files)); }}
        onPaste={(event) => {
          const files = clipboardAttachmentFiles(event.clipboardData);
          if (files.length) { event.preventDefault(); pasteFiles(files); }
        }}
      >
        <header className="thought-detail__heading">
          <h2 className="eyebrow" id="thought-detail-title">{mode === "focus" ? "focus lens" : "canvas drill-in"}</h2>
          <div className="thought-detail__actions">
            {thought.pinned && <span className="thought-detail__pin-label">pinned</span>}
            <button type="button" className="thought-detail__icon-button thought-detail__pin"
              aria-label={thought.pinned ? "Unpin note" : "Pin note"} title={thought.pinned ? "Unpin note" : "Pin note"}
              aria-pressed={Boolean(thought.pinned)} disabled={pinPending || actionPending} onClick={() => void onPin()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3h8M9 3v6l-4 5v2h14v-2l-4-5V3M12 16v5" />
              </svg>
            </button>
            {!thought.archived && <button className="thought-detail__complete" type="button" disabled={actionPending} onClick={() => void leave(onComplete)}>
              {actionPending ? "saving…" : thought.completed ? "reopen" : "✓ complete"}
            </button>}
            <button className={thought.archived ? undefined : "thought-detail__icon-button thought-detail__delete"} type="button"
              aria-label={thought.archived ? "Restore" : "Delete"} title={thought.archived ? "Restore" : "Delete"}
              disabled={actionPending} onClick={() => void leave(onArchive)}>
              {thought.archived ? "restore" : <TrashIcon />}
            </button>
            {mode === "focus" && (
              <button className="thought-detail__icon-button" type="button" aria-label="Expand" title="Expand" onClick={onExpand}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="M14 4h6v6M20 4l-7 7M4 14v6h6M4 20l7-7" />
                </svg>
              </button>
            )}
            <button className={mode === "focus" ? "thought-detail__icon-button" : undefined} type="button" aria-label={mode === "focus" ? "Close Focus Lens" : "Back to grid"} title={mode === "focus" ? "Close" : undefined} onClick={() => void leave(onClose)}>
              {mode === "focus" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              ) : "back ←"}
            </button>
          </div>
        </header>
        <div className="thought-detail__meta-row" inert={actionPending}>
          <DetailTags thought={thought} availableTags={availableTags} tagDefinitions={tagDefinitions}
            onAdd={onAddTag} onRemove={onRemoveTag} onColorChange={onColorChange} onExit={() => void leave(onClose)} />
          {!thought.archived && !thought.completed && <NoteReminder compact reminder={thought.reminder ?? null}
            onSet={(date) => afterSaving(() => onSetNoteReminder(date))}
            onClear={() => afterSaving(onClearNoteReminder)} onOpenSettings={onOpenNotificationSettings} />}
        </div>
        <div className="thought-detail__tabs" role="tablist" aria-label="Note views" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "note" : event.key === "End" ? "details" : activeTab === "note" ? "details" : "note";
          setActiveTab(next);
          (next === "note" ? noteTabRef : detailsTabRef).current?.focus();
        }}>
          <button ref={noteTabRef} id={noteTabId} type="button" role="tab" aria-selected={activeTab === "note"}
            aria-controls={`${noteTabId}-panel`} tabIndex={activeTab === "note" ? 0 : -1} onClick={() => setActiveTab("note")}>Note</button>
          <button ref={detailsTabRef} id={detailsTabId} type="button" role="tab" aria-selected={activeTab === "details"}
            aria-controls={`${detailsTabId}-panel`} tabIndex={activeTab === "details" ? 0 : -1} onClick={() => setActiveTab("details")}>Details</button>
        </div>
        <div className="thought-detail__scroll" inert={actionPending}>
          <section className="thought-detail__note-panel" role="tabpanel" id={`${noteTabId}-panel`} aria-labelledby={noteTabId} hidden={activeTab !== "note"}>
            <RichTextEditor ref={editorRef} document={richDraft} items={draftItems} showProgress={false}
              files={thought.attachments ?? []} drafts={[...pendingImages.current.values()]} disabled={actionPending}
              onChange={(document) => autosave.change({ ...autosave.current(), richDocument: document, body: richText(document) })}
              onAddFiles={(files, insert) => attachmentAreaRef.current?.addFiles(files, (prepared) => savePreparedFiles(prepared, insert)) ?? Promise.resolve(false)}
              onSetReminder={(id, date) => afterSaving(() => onSetReminder(id, date))}
              onClearReminder={(id) => afterSaving(() => onClearReminder(id))}
              onOpenSettings={onOpenNotificationSettings} />
          </section>
          <section className="thought-detail__details-panel" role="tabpanel" id={`${detailsTabId}-panel`} aria-labelledby={detailsTabId} hidden={activeTab !== "details"}>
            <div className="thought-detail__details-grid">
              <section className="thought-detail__detail-section" aria-labelledby={`details-tags-${thought.id}`}>
                <h3 id={`details-tags-${thought.id}`}>Tags</h3>
                <DetailTags idSuffix="details" thought={thought} availableTags={availableTags} tagDefinitions={tagDefinitions}
                  onAdd={onAddTag} onRemove={onRemoveTag} onColorChange={onColorChange} onExit={() => noteTabRef.current?.focus()} />
              </section>
              <section className="thought-detail__detail-section" aria-labelledby={`details-reminder-${thought.id}`}>
                <h3 id={`details-reminder-${thought.id}`}>Reminder</h3>
                {thought.archived || thought.completed
                  ? <p className="thought-detail__detail-hint">{thought.archived ? "Restore" : "Reopen"} this note to set a reminder.</p>
                  : <NoteReminder reminder={thought.reminder ?? null}
                    onSet={(date) => afterSaving(() => onSetNoteReminder(date))}
                    onClear={() => afterSaving(onClearNoteReminder)} onOpenSettings={onOpenNotificationSettings} />}
              </section>
              <section className="thought-detail__detail-section" aria-labelledby={`details-about-${thought.id}`}>
                <h3 id={`details-about-${thought.id}`}>About this note</h3>
                <dl className="metadata thought-detail__metadata">
                  <div><dt>captured</dt><dd>{formatThoughtTime(thought.createdAt)}</dd></div>
                  <div><dt>source</dt><dd>{thought.source === "mac-capture" ? "Quick capture" : thought.source === "mac-library" ? "Library" : thought.source}</dd></div>
                  <div><dt>state</dt><dd>{thought.archived ? "In Trash" : thought.completed ? "Completed" : "In progress"}</dd></div>
                </dl>
              </section>
            </div>
          </section>

          <div className="thought-detail__save-row">
            <span
              className={`thought-detail__status thought-detail__status--${error ? "error" : autosave.status}`}
              role={error || autosave.error ? "alert" : "status"}
            >
              {autosave.error ?? error ?? (autosave.status === "saving" ? "saving locally…" : "● saved locally")}
            </span>
            {autosave.error && (
              <button type="button" onClick={() => void autosave.flush().then((saved) => { if (saved) return attachmentAreaRef.current?.retry(); })}>retry saving</button>
            )}
            {draftItems.length > 0 && <ChecklistProgress items={draftItems} />}
          </div>

          <AttachmentArea ref={attachmentAreaRef} filesOnly files={thought.attachments ?? []} inlineIds={richImageIds(richDraft)}
            onAdd={async (files) => {
              if (files.some((file) => draftMetadata(file).mimeType.startsWith("image/"))) {
                if (!richEditorRef.current) throw new Error("The note editor is not ready. Please retry.");
                await savePreparedFiles(files, richEditorRef.current.insertImages);
              } else await onAddAttachments(files);
            }} onRemove={onRemoveAttachment} />


        </div>
      </article>
    </div>
  );
}

interface DetailTagsProps {
  idSuffix?: string;
  thought: Thought;
  availableTags: string[];
  tagDefinitions: TagDefinition[];
  onAdd: (tag: string) => Promise<void>;
  onRemove: (tag: string) => Promise<void>;
  onColorChange: (tag: string, color: TagColor | null) => Promise<void>;
  onExit: () => void;
}

function DetailTags({
  idSuffix,
  thought,
  availableTags,
  tagDefinitions,
  onAdd,
  onRemove,
  onColorChange,
  onExit,
}: DetailTagsProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="thought-detail__tags" aria-label="Thought tags">
      <TagEditor
        id={`thought-detail-tags-${thought.id}${idSuffix ? `-${idSuffix}` : ""}`}
        label={idSuffix ? "Add a tag in Details" : "Add a tag to this thought"}
        tags={thought.tags}
        draft={draft}
        onDraftChange={setDraft}
        availableTags={availableTags}
        tagDefinitions={tagDefinitions}
        maxRows={7}
        showInput
        placeholder="+ tag"
        onAdd={onAdd}
        onRemove={onRemove}
        onColorChange={onColorChange}
        onExit={onExit}
        inputRef={inputRef}
        className="thought-detail-tag-editor"
      />
    </section>
  );
}

interface LibrarySearchProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  availableTags: string[];
  tagDefinitions: TagDefinition[];
  onQueryChange: (query: string) => void;
  onSelectTag: (tag: string) => void;
}

function LibrarySearch({
  inputRef,
  query,
  availableTags,
  tagDefinitions,
  onQueryChange,
  onSelectTag,
}: LibrarySearchProps) {
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(query.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const fragment = useMemo(() => tagQueryFragment(query, caret), [caret, query]);
  const suggestions = useMemo(
    () =>
      fragment
        ? suggestCanonicalTags(availableTags, fragment.value, 7)
        : [],
    [availableTags, fragment],
  );
  const menuOpen = open && Boolean(fragment) && suggestions.length > 0;
  const highlightedIndex = Math.min(activeIndex, Math.max(0, suggestions.length - 1));
  const listboxId = "library-search-tag-suggestions";

  useEffect(() => setActiveIndex(0), [fragment?.value, suggestions.length]);

  function selectSuggestion(tag: string) {
    if (!fragment) return;
    onQueryChange(removeTagQueryFragment(query, fragment));
    setOpen(false);
    onSelectTag(tag);
  }

  function updateCaret(input: HTMLInputElement) {
    setCaret(input.selectionStart ?? input.value.length);
  }

  return (
    <div className="library-search">
      <label className="search-box">
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Search your cache"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={menuOpen}
          aria-activedescendant={menuOpen ? `${listboxId}-${highlightedIndex}` : undefined}
          value={query}
          onFocus={(event) => {
            updateCaret(event.currentTarget);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onClick={(event) => {
            updateCaret(event.currentTarget);
            setOpen(true);
          }}
          onSelect={(event) => updateCaret(event.currentTarget)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            updateCaret(event.currentTarget);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0) {
              event.preventDefault();
              setOpen(true);
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex(
                (current) => (current + direction + suggestions.length) % suggestions.length,
              );
            } else if (event.key === "Enter" && menuOpen) {
              event.preventDefault();
              selectSuggestion(suggestions[highlightedIndex]);
            } else if (event.key === "Escape" && menuOpen) {
              event.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="Search thoughts or #tags"
          autoComplete="off"
        />
        <kbd>⌘ K</kbd>
      </label>
      {menuOpen && (
        <div
          className="search-tag-suggestions tag-options"
          id={listboxId}
          role="listbox"
          aria-label="Tag suggestions"
        >
          {suggestions.map((tag, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={tag}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={highlightedIndex === index}
              className={highlightedIndex === index ? "tag-option tag-option--active" : "tag-option"}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectSuggestion(tag)}
            >
              <TagColorDot color={colorForTag(tagDefinitions, tag)} />
              <span>#</span>
              <strong>{tag}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface TagRailProps {
  thoughts: Thought[];
  activeTag: string | null;
  availableTags: string[];
  tagDefinitions: TagDefinition[];
  onSelect: (tag: string | null) => void;
}

const TagRail = forwardRef<TagRailHandle, TagRailProps>(function TagRail(
  { thoughts, activeTag, availableTags, tagDefinitions, onSelect },
  forwardedRef,
) {
  const recent = useMemo(() => recentTags(thoughts, 8), [thoughts]);
  const displayedTags = useMemo(
    () => (activeTag && !recent.includes(activeTag) ? [...recent, activeTag] : recent),
    [activeTag, recent],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDraft, setPickerDraft] = useState("");
  const [tabStopKey, setTabStopKey] = useState(activeTag ?? "");
  const shellRef = useRef<HTMLDivElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const optionKeys = ["", ...displayedTags];

  function focusTag(tag: string | null) {
    const key = tag ?? "";
    setTabStopKey(key);
    optionRefs.current.get(key)?.focus();
  }

  useImperativeHandle(forwardedRef, () => ({ focusTag }));

  useEffect(() => setTabStopKey(activeTag ?? ""), [activeTag]);

  function closePicker(returnFocus = false) {
    setPickerOpen(false);
    setPickerDraft("");
    if (returnFocus) requestAnimationFrame(() => moreRef.current?.focus());
  }

  useEffect(() => {
    if (!pickerOpen) return;
    function dismissOnOutsideInteraction(event: MouseEvent) {
      if (shellRef.current?.contains(event.target as Node)) return;
      const focusableTarget =
        event.target instanceof Element ? event.target.closest(pointerFocusableSelector) : null;
      closePicker();
      requestAnimationFrame(() => {
        const activeElement = document.activeElement;
        const focusFellToDocument =
          !activeElement ||
          activeElement === document.body ||
          activeElement === document.documentElement;
        if (!focusableTarget || focusFellToDocument) moreRef.current?.focus();
      });
    }
    document.addEventListener("mousedown", dismissOnOutsideInteraction);
    return () => document.removeEventListener("mousedown", dismissOnOutsideInteraction);
  }, [pickerOpen]);

  function moveFocus(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex = (index + direction + optionKeys.length) % optionKeys.length;
    const nextKey = optionKeys[nextIndex];
    setTabStopKey(nextKey);
    optionRefs.current.get(nextKey)?.focus();
  }

  function handleOptionKey(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    tag: string | null,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(tag);
      return;
    }
    moveFocus(event, index);
  }

  function activate(tag: string | null) {
    const nextTag = tag && tag === activeTag ? null : tag;
    onSelect(nextTag);
    requestAnimationFrame(() => focusTag(nextTag));
  }

  return (
    <div ref={shellRef} className="tag-rail-shell">
      <div className="tag-rail-scroll">
        <div className="tag-rail" role="radiogroup" aria-label="Tag filters">
          <button
            ref={(node) => {
              if (node) optionRefs.current.set("", node);
              else optionRefs.current.delete("");
            }}
            className={`tag-rail__option${activeTag === null ? " tag-rail__option--active" : ""}`}
            type="button"
            role="radio"
            aria-checked={activeTag === null}
            tabIndex={tabStopKey === "" ? 0 : -1}
            onFocus={() => setTabStopKey("")}
            onKeyDown={(event) => handleOptionKey(event, 0, null)}
            onClick={() => activate(null)}
          >
            All
          </button>
          {displayedTags.map((tag, index) => {
            const selected = activeTag === tag;
            return (
              <button
                ref={(node) => {
                  if (node) optionRefs.current.set(tag, node);
                  else optionRefs.current.delete(tag);
                }}
                key={tag}
                className={`tag-rail__option ${tagColorClass(colorForTag(tagDefinitions, tag))}${selected ? " tag-rail__option--active" : ""}`}
                type="button"
                role="radio"
                aria-label={`Filter by tag ${tag}`}
                aria-checked={selected}
                tabIndex={tabStopKey === tag ? 0 : -1}
                onFocus={() => setTabStopKey(tag)}
                onKeyDown={(event) => handleOptionKey(event, index + 1, tag)}
                onClick={() => activate(tag)}
              >
                <TagColorDot color={colorForTag(tagDefinitions, tag)} />#{tag}
              </button>
            );
          })}
        </div>
        <button
          ref={moreRef}
          className="tag-rail__more"
          type="button"
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          onClick={() => {
            if (pickerOpen) closePicker(true);
            else {
              setPickerOpen(true);
              requestAnimationFrame(() => pickerInputRef.current?.focus());
            }
          }}
        >
          More…
        </button>
      </div>
      {pickerOpen && (
        <div className="tag-rail__popover" role="dialog" aria-label="All tag filters">
          <TagCombobox
            id="library-tag-picker"
            label="Choose a tag filter"
            value={pickerDraft}
            onValueChange={setPickerDraft}
            availableTags={availableTags}
            tagDefinitions={tagDefinitions}
            maxRows={7}
            allowCreate={false}
            placeholder="find a tag"
            onCommit={(tag) => {
              onSelect(tag);
              closePicker();
              requestAnimationFrame(() => focusTag(tag));
            }}
            onEscape={() => closePicker(true)}
            inputRef={pickerInputRef}
            autoFocus
          />
        </div>
      )}
    </div>
  );
});

interface TagFilterControlProps {
  activeTag: string | null;
  availableTags: string[];
  tagDefinitions: TagDefinition[];
  onSelect: (tag: string) => void;
  onClear: () => void;
}

function TagFilterControl({
  activeTag,
  availableTags,
  tagDefinitions,
  onSelect,
  onClear,
}: TagFilterControlProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);

  function close(returnFocus = false) {
    setOpen(false);
    setDraft("");
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    function dismissOnOutsideInteraction(event: MouseEvent) {
      if (controlRef.current?.contains(event.target as Node)) return;
      const focusableTarget =
        event.target instanceof Element ? event.target.closest(pointerFocusableSelector) : null;
      close();
      requestAnimationFrame(() => {
        const activeElement = document.activeElement;
        const focusFellToDocument =
          !activeElement ||
          activeElement === document.body ||
          activeElement === document.documentElement;
        if (!focusableTarget || focusFellToDocument) triggerRef.current?.focus();
      });
    }
    document.addEventListener("mousedown", dismissOnOutsideInteraction);
    return () => document.removeEventListener("mousedown", dismissOnOutsideInteraction);
  }, [open]);

  return (
    <div ref={controlRef} className={`tag-filter${activeTag ? " tag-filter--active" : ""}`}>
      <button
        ref={triggerRef}
        className="tag-filter__trigger"
        type="button"
        aria-expanded={open}
        aria-label={activeTag ? `Change tag filter, currently ${activeTag}` : "Filter by tag"}
        onClick={() => {
          const next = !open;
          if (next) {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          } else {
            close(true);
          }
        }}
      >
        {activeTag && <TagColorDot color={colorForTag(tagDefinitions, activeTag)} />}
        #{activeTag ? ` ${activeTag}` : " tag"}
      </button>
      {activeTag && (
        <button
          className="tag-filter__clear"
          type="button"
          aria-label="Clear tag filter"
          onClick={() => {
            onClear();
            close(true);
          }}
        >
          ×
        </button>
      )}
      {open && (
        <div className="tag-filter__popover">
          <TagCombobox
            id="library-tag-filter"
            label="Choose a tag filter"
            value={draft}
            onValueChange={setDraft}
            availableTags={availableTags}
            tagDefinitions={tagDefinitions}
            maxRows={7}
            allowCreate={false}
            placeholder="find a tag"
            onCommit={(tag) => {
              onSelect(tag);
              close(true);
            }}
            onEscape={() => close(true)}
            inputRef={inputRef}
            autoFocus
          />
          {availableTags.length === 0 && (
            <p className="tag-filter__empty">Tags appear here after they are attached.</p>
          )}
        </div>
      )}
    </div>
  );
}
