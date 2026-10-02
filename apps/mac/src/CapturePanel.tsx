import { DocumentEditor, focusDocumentText } from "./DocumentEditor";
import { completeImageInsertion, documentBody, inlineImageIds, reserveImageInsertion } from "./document";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AttachmentArea, type AttachmentAreaHandle } from "./AttachmentArea";
import { clipboardAttachmentFiles, draftMetadata } from "./attachments";
import { Blob } from "./Blob";
import {
  captureChecklist,
  captureThought,
  getShortcutButtonVisible,
  hideCapture,
  listenForCaptureCommand,
  listenForCaptureFocus,
  listenForShortcutButtonVisibility,
  listTagDefinitions,
  resizeCapture,
  setShortcutButtonVisible,
} from "./bridge";
import {
  addTag,
  checklistTextsFromDraft,
  continueTextList,
  normalizeTag,
  normalizeTags,
  removeTag,
  toggleTextList,
  type TextListKind,
  type TextSelectionEdit,
} from "./domain";
import { TagEditor } from "./TagEditor";
import type { AttachmentDraft, DocumentBlock, TagColor, TagDefinition } from "./types";

const CAPTURE_PANEL_RESTING_HEIGHT = 50;
const CAPTURE_WINDOW_VERTICAL_PADDING = 24;
const CAPTURE_TEXTAREA_RESTING_HEIGHT = 34;
const CAPTURE_RESIZE_DURATION = 150;
const CAPTURE_SHELF_MIN_HEIGHT = 38;

type CaptureCommand =
  | "numbered-list"
  | "bulleted-list"
  | "checklist"
  | "add-tags"
  | "open-shortcuts";

export function CapturePanel() {
  const [body, setBody] = useState("");
  const [documentBlocks, setDocumentBlocks] = useState<DocumentBlock[] | undefined>();
  const documentRef = useRef<DocumentBlock[] | undefined>(undefined);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const attachmentsRef = useRef<AttachmentDraft[]>([]);
  const attachmentAreaRef = useRef<AttachmentAreaHandle>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const savingRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorSource, setErrorSource] = useState<"capture" | "tag" | "shortcut" | null>(null);
  const [message, setMessage] = useState("local only · saved before sync");
  const [tags, setTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([]);
  const [pendingTagColors, setPendingTagColors] = useState<Map<string, TagColor | null>>(
    new Map(),
  );
  const [checklistMode, setChecklistMode] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [shortcutDrawerOpen, setShortcutDrawerOpen] = useState(false);
  const [shortcutKeyHeld, setShortcutKeyHeld] = useState(false);
  const shortcutDrawerVisible = shortcutDrawerOpen || shortcutKeyHeld;
  const [shortcutButtonVisible, setShortcutButtonVisibleState] = useState(true);
  const [tagDraft, setTagDraft] = useState("");
  const [suggestionWarning, setSuggestionWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const tagActionRef = useRef<HTMLButtonElement>(null);
  const shortcutButtonRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [sizeConstrained, setSizeConstrained] = useState(false);
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const effectiveTagDefinitions = useMemo(
    () => mergeTagDefinitions(tagDefinitions, tags, pendingTagColors),
    [pendingTagColors, tagDefinitions, tags],
  );

  useAdaptiveCaptureSizing({
    dockRef,
    panelRef,
    stackRef,
    textareaRef: inputRef,
    resizeEpoch,
    revision: [
      body,
      checklistMode,
      attachments.map((file) => file.id).join(","),
      attachmentBusy,
      tagging,
      shortcutDrawerVisible,
      shortcutButtonVisible,
      tags.join("\u0000"),
      tagDraft,
      status,
      message,
    ].join("\u0001"),
    onConstrainedChange: setSizeConstrained,
  });

  function clearScheduledHide() {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  useEffect(() => {
    const remeasureFontSize = () => setResizeEpoch((current) => current + 1);
    window.addEventListener("brain-cache:font-size-applied", remeasureFontSize);
    return () => window.removeEventListener("brain-cache:font-size-applied", remeasureFontSize);
  }, []);

  useEffect(() => {
    const holdShortcuts = (event: KeyboardEvent) => {
      if (event.key === "Meta") setShortcutKeyHeld(true);
    };
    const releaseShortcuts = (event: KeyboardEvent) => {
      if (event.key === "Meta") setShortcutKeyHeld(event.metaKey);
    };
    const clearHeldShortcuts = () => setShortcutKeyHeld(false);
    window.addEventListener("keydown", holdShortcuts, true);
    window.addEventListener("keyup", releaseShortcuts, true);
    window.addEventListener("blur", clearHeldShortcuts);
    return () => {
      window.removeEventListener("keydown", holdShortcuts, true);
      window.removeEventListener("keyup", releaseShortcuts, true);
      window.removeEventListener("blur", clearHeldShortcuts);
    };
  }, []);

  async function refreshTagSuggestions() {
    try {
      const definitions = await listTagDefinitions();
      setTagDefinitions(definitions);
      setAvailableTags(definitions.map((definition) => definition.name));
      setSuggestionWarning(null);
    } catch {
      setSuggestionWarning("tag suggestions unavailable · capture still works");
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
    void refreshTagSuggestions();
    void getShortcutButtonVisible()
      .then(setShortcutButtonVisibleState)
      .catch(() => undefined);
    let removeFocusListener: () => void = () => undefined;
    let removeCommandListener: () => void = () => undefined;
    let removeVisibilityListener: () => void = () => undefined;
    void listenForCaptureFocus(() => {
      clearScheduledHide();
      setStatus("idle");
      setErrorSource(null);
      setMessage("local only · saved before sync");
      setResizeEpoch((current) => current + 1);
      void refreshTagSuggestions();
      // Native focus can arrive after a click or menu command opens a shelf.
      // Keep that interaction intact instead of resetting it on activation.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const target = active instanceof HTMLElement && panelRef.current?.contains(active)
          ? active
          : inputRef.current;
        target?.focus({ preventScroll: true });
      });
    }).then((unlisten) => {
      removeFocusListener = unlisten;
    });
    void listenForCaptureCommand((command) => {
      if (isCaptureCommand(command)) handleCaptureCommand(command);
    }).then((unlisten) => {
      removeCommandListener = unlisten;
    });
    void listenForShortcutButtonVisibility((visible) => {
      setShortcutButtonVisibleState(visible);
      setStatus("idle");
      setErrorSource(null);
      setMessage("local only · saved before sync");
    }).then((unlisten) => {
      removeVisibilityListener = unlisten;
    });
    return () => {
      clearScheduledHide();
      removeFocusListener();
      removeCommandListener();
      removeVisibilityListener();
    };
  }, []);

  function resetCaptureStatus() {
    setStatus("idle");
    setErrorSource(null);
    setMessage("local only · saved before sync");
  }

  function enterTagMode() {
    setShortcutDrawerOpen(false);
    setTagging(true);
    requestAnimationFrame(() => tagInputRef.current?.focus());
  }

  function exitTagMode() {
    setTagging(false);
    if (errorSource === "tag") {
      setStatus("idle");
      setErrorSource(null);
      setMessage("local only · saved before sync");
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closeShortcutDrawer() {
    setShortcutDrawerOpen(false);
    setShortcutKeyHeld(false);
    requestAnimationFrame(() => (shortcutButtonRef.current ?? inputRef.current)?.focus());
  }

  function openShortcutDrawer() {
    setTagging(false);
    setShortcutDrawerOpen(true);
    resetCaptureStatus();
  }

  function toggleChecklistMode() {
    if (documentRef.current?.some((block) => block.type === "image")) {
      setStatus("error");
      setMessage("Use a new capture for a checklist. This thought keeps its images in place.");
      return;
    }
    setDocumentBlocks(undefined);
    documentRef.current = undefined;
    setChecklistMode((current) => !current);
    setTagging(false);
    setShortcutDrawerOpen(false);
    resetCaptureStatus();
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function applyTextEdit(edit: TextSelectionEdit) {
    const id = inputRef.current?.dataset.documentBlock;
    if (documentRef.current && id) changeDocument(documentRef.current.map((block) => block.id === id && block.type === "text" ? { ...block, text: edit.text } : block));
    else setBody(edit.text);
    setChecklistMode(false);
    setTagging(false);
    setShortcutDrawerOpen(false);
    resetCaptureStatus();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function applyTextList(kind: TextListKind) {
    const input = inputRef.current;
    if (!input) return;
    applyTextEdit(toggleTextList(input.value, input.selectionStart, input.selectionEnd, kind));
  }

  function handleCaptureCommand(command: CaptureCommand) {
    if (command === "numbered-list") applyTextList("numbered");
    else if (command === "bulleted-list") applyTextList("bulleted");
    else if (command === "checklist") toggleChecklistMode();
    else if (command === "add-tags") enterTagMode();
    else openShortcutDrawer();
  }

  async function hideShortcutButton() {
    try {
      const visible = await setShortcutButtonVisible(false);
      setShortcutButtonVisibleState(visible);
      setShortcutDrawerOpen(false);
      resetCaptureStatus();
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (cause) {
      setStatus("error");
      setErrorSource("shortcut");
      setMessage(
        cause instanceof Error ? cause.message : "Could not save the shortcut preference.",
      );
    }
  }

  async function save(draftTag: string | null = null): Promise<boolean> {
    if (status === "saving" || status === "saved" || attachmentBusy || savingRef.current) return false;
    savingRef.current = true;
    if (await attachmentAreaRef.current?.flush() === false) { savingRef.current = false; return false; }
    clearScheduledHide();
    const finalTags = draftTag ? addTag(tags, draftTag) : tags;
    const colorChanges = [...pendingTagColors]
      .filter(([name]) => finalTags.includes(name))
      .map(([name, color]) => ({ name, color }));
    setStatus("saving");
    setErrorSource(null);
    setMessage("writing to cache…");
    try {
      const files = attachmentsRef.current;
      const thought = files.length > 0
        ? checklistMode && body.trim()
          ? await captureChecklist(checklistTextsFromDraft(body), "mac-capture", finalTags, colorChanges, files)
          : documentRef.current
            ? await captureThought(body, "mac-capture", finalTags, colorChanges, files, documentRef.current)
            : await captureThought(body, "mac-capture", finalTags, colorChanges, files)
        : checklistMode
        ? await captureChecklist(
            checklistTextsFromDraft(body),
            "mac-capture",
            finalTags,
            colorChanges,
          )
        : colorChanges.length > 0
          ? await captureThought(body, "mac-capture", finalTags, colorChanges)
          : await captureThought(body, "mac-capture", finalTags);
      setBody("");
      documentRef.current = undefined;
      setDocumentBlocks(undefined);
      attachmentsRef.current = [];
      setAttachments([]);
      setTags([]);
      setTagDraft("");
      setTagging(false);
      setShortcutDrawerOpen(false);
      setChecklistMode(false);
      setPendingTagColors(new Map());
      setAvailableTags((current) => normalizeTags([...current, ...thought.tags]));
      setTagDefinitions((current) =>
        mergeTagDefinitions(
          current,
          thought.tags,
          new Map(colorChanges.map(({ name, color }) => [name, color])),
        ),
      );
      setStatus("saved");
      setMessage("saved locally");
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        void hideCapture();
      }, 360);
      return true;
    } catch (error) {
      setStatus("error");
      setErrorSource("capture");
      setMessage(error instanceof Error ? error.message : "Could not save that thought.");
      requestAnimationFrame(() =>
        (tagging ? tagInputRef.current : inputRef.current)?.focus(),
      );
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  async function saveVisibleDraft(): Promise<boolean> {
    if (!tagging || !tagDraft) return save();
    try {
      return save(normalizeTag(tagDraft));
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : "That tag is not valid.";
      setStatus("error");
      setErrorSource("tag");
      setMessage(error);
      requestAnimationFrame(() => tagInputRef.current?.focus());
      return false;
    }
  }

  function changeDocument(blocks: DocumentBlock[]) {
    const previous = inlineImageIds(documentRef.current);
    const next = inlineImageIds(blocks);
    attachmentsRef.current = attachmentsRef.current.filter((file) => !previous.has(file.id) || next.has(file.id));
    setAttachments(attachmentsRef.current);
    documentRef.current = blocks;
    setDocumentBlocks(blocks);
    setBody(documentBody(blocks));
    resetCaptureStatus();
  }

  function pasteFiles(files: File[]) {
    if (status === "saving" || status === "saved") return;
    if (checklistMode || !files.some((file) => file.type.startsWith("image/"))) {
      void attachmentAreaRef.current?.addFiles(files);
      return;
    }
    const input = inputRef.current;
    const blocks = documentRef.current ?? [{ id: "capture-text", type: "text" as const, text: body }];
    const insertion = reserveImageInsertion(blocks, input?.dataset.documentBlock ?? "capture-text", input?.selectionStart ?? body.length, input?.selectionEnd ?? body.length);
    changeDocument(insertion.blocks);
    focusDocumentText(insertion.afterId);
    void attachmentAreaRef.current?.addFiles(files, async (prepared) => {
      attachmentsRef.current = [...attachmentsRef.current, ...prepared];
      setAttachments(attachmentsRef.current);
      changeDocument(completeImageInsertion(documentRef.current ?? [], insertion.anchorId, prepared.map(draftMetadata)));
    });
  }

  function handleTextKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveVisibleDraft();
      return;
    }
    if (event.key === "Enter" && !checklistMode) {
      const edit = continueTextList(
        event.currentTarget.value,
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
      );
      if (edit) {
        event.preventDefault();
        applyTextEdit(edit);
      }
    }
  }

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    const modified = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      event.preventDefault();
      if (shortcutDrawerVisible) closeShortcutDrawer();
      else if (tagging) exitTagMode();
      else void hideCapture();
      return;
    }
    if (
      modified &&
      event.shiftKey &&
      (event.code === "Digit7" || event.key === "7" || event.key === "&")
    ) {
      event.preventDefault();
      applyTextList("numbered");
      return;
    }
    if (
      modified &&
      event.shiftKey &&
      (event.code === "Digit8" || event.key === "8" || event.key === "*")
    ) {
      event.preventDefault();
      applyTextList("bulleted");
      return;
    }
    if (
      modified &&
      event.shiftKey &&
      (event.code === "Digit9" || event.key === "9" || event.key === "(")
    ) {
      event.preventDefault();
      toggleChecklistMode();
      return;
    }
    if (modified && event.key.toLowerCase() === "t") {
      event.preventDefault();
      enterTagMode();
      return;
    }
    if (modified && event.shiftKey && (event.code === "Slash" || event.key === "?")) {
      event.preventDefault();
      openShortcutDrawer();
    }
  }

  return (
    <main className="capture-shell" onKeyDown={handlePanelKeyDown}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void attachmentAreaRef.current?.addFiles(Array.from(event.dataTransfer.files)); }}
      onPaste={(event) => {
        const files = clipboardAttachmentFiles(event.clipboardData);
        if (files.length) { event.preventDefault(); pasteFiles(files); }
      }}
    >
      <div
        ref={dockRef}
        className={`capture-dock${sizeConstrained ? " capture-dock--constrained" : ""}`}
      >
        <section
          ref={panelRef}
          className={`capture-panel capture-panel--${status}${tagging ? " capture-panel--tagging" : ""}`}
          aria-label="Quick capture"
          aria-busy={status === "saving"}
        >
          <div ref={stackRef} className="capture-panel__stack">
            <div className="capture-panel__main">
              <label className="visually-hidden" htmlFor="brain-dump">
                {checklistMode ? "Checklist items, one per line" : "Thought to cache"}
              </label>
              {documentBlocks ? <DocumentEditor blocks={documentBlocks} files={attachments.map(draftMetadata)} drafts={attachments}
                onChange={changeDocument} inputRef={inputRef} label="Thought to cache" compact
                disabled={status === "saving" || status === "saved"} onKeyDown={handleTextKeyDown} /> : <textarea
                id="brain-dump"
                ref={inputRef}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  if (status === "error" || status === "saved") {
                    setStatus("idle");
                    setErrorSource(null);
                    setMessage("local only · saved before sync");
                  }
                }}
                onKeyDown={handleTextKeyDown}
                placeholder={
                  checklistMode ? "Add checklist items, one per line" : "What's taking up space in your head?"
                }
                rows={1}
                spellCheck
                aria-describedby="capture-status"
                aria-keyshortcuts="Meta+Enter Meta+T Meta+Shift+7 Meta+Shift+8 Meta+Shift+9 Meta+Shift+/"
              />}
              {checklistMode && (
                <span className="capture-mode-badge" aria-label="Checklist mode">
                  checklist
                </span>
              )}
              {shortcutButtonVisible && (
                <button
                  ref={shortcutButtonRef}
                  className="capture-shortcut-trigger"
                  type="button"
                  aria-label="Keyboard shortcuts"
                  aria-keyshortcuts="Meta+Shift+/"
                  aria-expanded={shortcutDrawerVisible}
                  onClick={() =>
                    shortcutDrawerOpen ? closeShortcutDrawer() : openShortcutDrawer()
                  }
                >
                  ⌘
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={status === "saving" || status === "saved" || attachmentBusy}
                aria-label="Save thought"
                aria-keyshortcuts="Meta+Enter"
                onClick={() => void saveVisibleDraft()}
              >
                <kbd aria-hidden="true">⌘↵</kbd>
              </button>
            </div>
            {!tagging && tags.length === 0 && (
              <div className="capture-tag-prompt">
                <button
                  className="capture-tag-action"
                  type="button"
                  aria-label="Add tags"
                  aria-keyshortcuts="Meta+T"
                  onClick={enterTagMode}
                >
                  add tags <kbd aria-hidden="true">⌘T</kbd>
                </button>
                <span>Find it faster later</span>
              </div>
            )}
            {(tagging || tags.length > 0) && (
              <div className={`capture-tag-shelf capture-optional-shelf${tagging ? "" : " capture-tag-shelf--compact"}`}>
                <TagEditor
                  key={tagging ? "editing" : "attached"}
                  id="capture-tag-input"
                  label="Tags for this thought"
                  tags={tags}
                  draft={tagDraft}
                  onDraftChange={setTagDraft}
                  availableTags={availableTags}
                  tagDefinitions={effectiveTagDefinitions}
                  maxRows={3}
                  showInput={tagging}
                  placeholder="tag this thought"
                  onAdd={(tag) => setTags((current) => addTag(current, tag))}
                  onRemove={(tag) => {
                    setTags((current) => removeTag(current, tag));
                    setPendingTagColors((current) => {
                      const next = new Map(current);
                      next.delete(tag);
                      return next;
                    });
                  }}
                  onColorChange={(tag, color) =>
                    setPendingTagColors((current) => new Map(current).set(tag, color))
                  }
                  onExit={exitTagMode}
                  onSaveDraft={(draftTag) => save(draftTag)}
                  onError={(error) => {
                    if (error) {
                      setStatus("error");
                      setErrorSource("tag");
                      setMessage(error);
                    } else if (status === "error" && errorSource === "tag") {
                      setStatus("idle");
                      setErrorSource(null);
                      setMessage("local only · saved before sync");
                    }
                  }}
                  inputRef={tagInputRef}
                  fallbackFocusRef={tagging ? tagActionRef : inputRef}
                  autoFocus={tagging}
                  className="capture-tag-editor"
                  showInlineError={false}
                  errorDescriptionId="capture-status"
                />
                <button
                  ref={tagActionRef}
                  className="capture-tag-action"
                  type="button"
                  aria-label={tagging ? "Close tag shelf" : "Edit tags"}
                  aria-keyshortcuts={tagging ? "Escape" : "Meta+T"}
                  onClick={tagging ? exitTagMode : enterTagMode}
                >
                  {tagging ? "close" : "edit"} <kbd aria-hidden="true">{tagging ? "esc" : "⌘T"}</kbd>
                </button>
                {tagging && suggestionWarning && (
                  <span className="capture-tag-shelf__warning" aria-hidden="true">
                    {suggestionWarning}
                  </span>
                )}
              </div>
            )}
            <AttachmentArea
              ref={attachmentAreaRef}
              compact
              files={attachments.map(draftMetadata)}
              drafts={attachments}
              inlineIds={inlineImageIds(documentBlocks)}
              disabled={status === "saving" || status === "saved"}
              onBusyChange={setAttachmentBusy}
              onAdd={async (files) => {
                clearScheduledHide();
                attachmentsRef.current = [...attachmentsRef.current, ...files];
                setAttachments(attachmentsRef.current);
                setStatus("idle");
              }}
              onRemove={async (id) => {
                attachmentsRef.current = attachmentsRef.current.filter((file) => file.id !== id);
                setAttachments(attachmentsRef.current);
              }}
            />
            {shortcutDrawerVisible && (
              <ShortcutDrawer
                focusOnOpen={shortcutDrawerOpen}
                onCommand={handleCaptureCommand}
                onClose={closeShortcutDrawer}
                onHideButton={() => void hideShortcutButton()}
              />
            )}
            <span
              id="capture-status"
              className={`capture-status capture-status--${status}${status === "error" ? " capture-panel__feedback" : " visually-hidden"}`}
              role={status === "error" ? "alert" : "status"}
              aria-live={status === "error" ? undefined : "polite"}
              aria-atomic="true"
            >
              {status === "idle" && suggestionWarning ? suggestionWarning : message}
            </span>
          </div>
        </section>
        <div className="capture-panel__pet" aria-hidden="true">
          <Blob mood={status === "saved" ? "saved" : body ? "listening" : "idle"} compact />
        </div>
      </div>
    </main>
  );
}

function ShortcutDrawer({
  focusOnOpen,
  onCommand,
  onClose,
  onHideButton,
}: {
  focusOnOpen: boolean;
  onCommand: (command: CaptureCommand) => void;
  onClose: () => void;
  onHideButton: () => void;
}) {
  const firstCommandRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    // The native window is still expanding when this control mounts.
    if (focusOnOpen) firstCommandRef.current?.focus({ preventScroll: true });
  }, [focusOnOpen]);

  const commands: Array<{
    command: CaptureCommand;
    label: string;
    shortcut: string;
    ariaShortcut: string;
  }> = [
    {
      command: "numbered-list",
      label: "Numbered list",
      shortcut: "⌘⇧7",
      ariaShortcut: "Meta+Shift+7",
    },
    {
      command: "bulleted-list",
      label: "Bulleted list",
      shortcut: "⌘⇧8",
      ariaShortcut: "Meta+Shift+8",
    },
    {
      command: "checklist",
      label: "Checklist",
      shortcut: "⌘⇧9",
      ariaShortcut: "Meta+Shift+9",
    },
    {
      command: "add-tags",
      label: "Add tags",
      shortcut: "⌘T",
      ariaShortcut: "Meta+T",
    },
  ];

  return (
    <section
      className="capture-shortcut-drawer capture-optional-shelf"
      aria-label="Keyboard shortcuts"
    >
      <header>
        <span className="eyebrow">shortcuts</span>
        <button type="button" aria-label="Close shortcut drawer" onClick={onClose}>
          close <kbd aria-hidden="true">esc</kbd>
        </button>
      </header>
      <div className="capture-shortcut-drawer__grid">
        {commands.map((item, index) => (
          <button
            key={item.command}
            type="button"
            ref={index === 0 ? firstCommandRef : undefined}
            aria-label={`${item.label}, ${item.shortcut}`}
            aria-keyshortcuts={item.ariaShortcut}
            onClick={() => onCommand(item.command)}
          >
            <span>{item.label}</span>
            <kbd aria-hidden="true">{item.shortcut}</kbd>
          </button>
        ))}
        <span className="capture-shortcut-drawer__recovery">
          <span>Open shortcut drawer</span>
          <kbd aria-hidden="true">⌘?</kbd>
        </span>
      </div>
      <button
        className="capture-shortcut-drawer__hide"
        type="button"
        onClick={onHideButton}
      >
        hide the ⌘ button
      </button>
    </section>
  );
}

function isCaptureCommand(value: string): value is CaptureCommand {
  return [
    "numbered-list",
    "bulleted-list",
    "checklist",
    "add-tags",
    "open-shortcuts",
  ].includes(value);
}

function mergeTagDefinitions(
  current: readonly TagDefinition[],
  names: readonly string[],
  changes: ReadonlyMap<string, TagColor | null>,
): TagDefinition[] {
  const colors = new Map(current.map((definition) => [definition.name, definition.color]));
  for (const [name, color] of changes) colors.set(name, color);
  return normalizeTags([...colors.keys(), ...names]).map((name) => ({
    name,
    color: colors.get(name) ?? null,
  }));
}

interface AdaptiveCaptureSizingOptions {
  dockRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  stackRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  resizeEpoch: number;
  revision: string;
  onConstrainedChange: (constrained: boolean) => void;
}

interface AppliedCaptureLayout {
  requestKey: string;
  appliedPanelHeight: number;
  constrained: boolean;
}

function useAdaptiveCaptureSizing({
  dockRef,
  panelRef,
  stackRef,
  textareaRef,
  resizeEpoch,
  revision,
  onConstrainedChange,
}: AdaptiveCaptureSizingOptions) {
  const aliveRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const caretScrollTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const pendingWindowHeightRef = useRef<string | null>(null);
  const lastAppliedLayoutRef = useRef<AppliedCaptureLayout | null>(null);
  const lastAppliedPanelHeightRef = useRef(CAPTURE_PANEL_RESTING_HEIGHT);
  const [observedRevision, setObservedRevision] = useState(0);

  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      requestRef.current += 1;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (caretScrollTimerRef.current !== null) {
        window.clearTimeout(caretScrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList")) {
        setObservedRevision((current) => current + 1);
      }
    });
    observer.observe(stack, { childList: true, subtree: true });
    const imageLoaded = () => setObservedRevision((current) => current + 1);
    stack.addEventListener("load", imageLoaded, true);
    return () => { observer.disconnect(); stack.removeEventListener("load", imageLoaded, true); };
  }, [stackRef]);

  useLayoutEffect(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      if (!aliveRef.current) return;

      const dock = dockRef.current;
      const panel = panelRef.current;
      const stack = stackRef.current;
      const textarea = stack?.querySelector<HTMLElement>(".capture-document") ?? textareaRef.current;
      if (!dock || !panel || !stack || !textarea) return;
      const activeDock = dock;
      const activePanel = panel;
      const activeTextarea = textarea;
      const previousScrollTop = textarea.scrollTop;
      const restingTextareaHeight = Math.max(
        CAPTURE_TEXTAREA_RESTING_HEIGHT,
        Math.ceil(Number.parseFloat(window.getComputedStyle(textarea).minHeight) || 0),
      );

      const inlineTransition = textarea.style.transition;
      textarea.style.transition = "none";
      textarea.style.removeProperty("max-height");
      textarea.style.overflowY = "hidden";
      textarea.style.height = `${restingTextareaHeight}px`;
      const intrinsicTextareaHeight = Math.max(
        restingTextareaHeight,
        Math.ceil(textarea.scrollHeight || restingTextareaHeight),
      );
      textarea.style.height = `${intrinsicTextareaHeight}px`;
      void textarea.offsetHeight;
      if (inlineTransition) textarea.style.transition = inlineTransition;
      else textarea.style.removeProperty("transition");

      const shelves = Array.from(stack.querySelectorAll<HTMLElement>(".capture-optional-shelf"));
      for (const shelf of shelves) {
        shelf.style.removeProperty("max-height");
        shelf.style.overflowY = "visible";
      }

      const desiredPanelHeight = Math.max(
        CAPTURE_PANEL_RESTING_HEIGHT,
        Math.ceil(stack.scrollHeight || CAPTURE_PANEL_RESTING_HEIGHT),
      );
      const desiredWindowHeight = desiredPanelHeight + CAPTURE_WINDOW_VERTICAL_PADDING;
      const requestKey = `${resizeEpoch}:${desiredWindowHeight}`;
      const reduceMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

      panel.style.setProperty("--capture-panel-height", `${desiredPanelHeight}px`);
      dock.style.setProperty("--capture-panel-height", `${desiredPanelHeight}px`);

      function applyConstrainedLayout(
        appliedPanelHeight: number,
        constrained: boolean,
        request: number,
      ) {
        let overflow = Math.max(0, desiredPanelHeight - appliedPanelHeight);
        const reducibleTextareaHeight = Math.max(
          0,
          intrinsicTextareaHeight - restingTextareaHeight,
        );
        const textareaReduction = Math.min(overflow, reducibleTextareaHeight);
        const appliedTextareaHeight = intrinsicTextareaHeight - textareaReduction;
        overflow -= textareaReduction;

        activeTextarea.style.height = `${appliedTextareaHeight}px`;
        activeTextarea.style.maxHeight = `${appliedTextareaHeight}px`;
        activeTextarea.style.overflowY = textareaReduction > 0 ? "auto" : "hidden";
        activeTextarea.scrollTop = previousScrollTop;

        if (caretScrollTimerRef.current !== null) {
          window.clearTimeout(caretScrollTimerRef.current);
          caretScrollTimerRef.current = null;
        }
        if (textareaReduction > 0) {
          const keepTrailingCaretVisible = () => {
            if (
              !aliveRef.current ||
              request !== requestRef.current ||
              document.activeElement !== activeTextarea ||
              !(activeTextarea instanceof HTMLTextAreaElement) ||
              activeTextarea.selectionStart !== activeTextarea.selectionEnd ||
              activeTextarea.selectionEnd !== activeTextarea.value.length
            ) {
              return;
            }
            activeTextarea.scrollTop = Math.max(
              0,
              activeTextarea.scrollHeight - activeTextarea.clientHeight,
            );
          };
          keepTrailingCaretVisible();
          caretScrollTimerRef.current = window.setTimeout(() => {
            caretScrollTimerRef.current = null;
            keepTrailingCaretVisible();
          }, reduceMotion ? 0 : CAPTURE_RESIZE_DURATION);
        }

        for (const shelf of shelves) {
          if (overflow <= 0) break;
          const shelfHeight = Math.ceil(shelf.scrollHeight || CAPTURE_SHELF_MIN_HEIGHT);
          const appliedShelfHeight = Math.max(
            CAPTURE_SHELF_MIN_HEIGHT,
            shelfHeight - overflow,
          );
          overflow -= Math.max(0, shelfHeight - appliedShelfHeight);
          shelf.style.maxHeight = `${appliedShelfHeight}px`;
          shelf.style.overflowY = "auto";
        }

        activePanel.style.setProperty("--capture-panel-height", `${appliedPanelHeight}px`);
        activeDock.style.setProperty("--capture-panel-height", `${appliedPanelHeight}px`);
        onConstrainedChange(constrained);
      }

      const lastAppliedLayout = lastAppliedLayoutRef.current;
      const matchingAppliedLayout =
        lastAppliedLayout?.requestKey === requestKey
          ? lastAppliedLayout
          : null;
      if (pendingWindowHeightRef.current === requestKey) {
        if (matchingAppliedLayout) {
          applyConstrainedLayout(
            matchingAppliedLayout.appliedPanelHeight,
            matchingAppliedLayout.constrained,
            requestRef.current,
          );
        }
        return;
      }
      if (pendingWindowHeightRef.current === null && matchingAppliedLayout) {
        applyConstrainedLayout(
          matchingAppliedLayout.appliedPanelHeight,
          matchingAppliedLayout.constrained,
          requestRef.current,
        );
        return;
      }

      const request = ++requestRef.current;
      pendingWindowHeightRef.current = requestKey;

      void resizeCapture(
        desiredWindowHeight,
        reduceMotion ? 0 : CAPTURE_RESIZE_DURATION,
      )
        .then((result) => {
          if (!aliveRef.current || request !== requestRef.current) return;
          pendingWindowHeightRef.current = null;

          const appliedPanelHeight = Math.max(
            1,
            Math.min(desiredPanelHeight, result.appliedHeight - CAPTURE_WINDOW_VERTICAL_PADDING),
          );
          const constrained =
            result.constrained || result.maxHeight < desiredWindowHeight;
          lastAppliedPanelHeightRef.current = appliedPanelHeight;
          lastAppliedLayoutRef.current = {
            requestKey,
            appliedPanelHeight,
            constrained,
          };
          applyConstrainedLayout(appliedPanelHeight, constrained, request);
        })
        .catch(() => {
          if (!aliveRef.current || request !== requestRef.current) return;
          pendingWindowHeightRef.current = null;
          lastAppliedLayoutRef.current = null;
          applyConstrainedLayout(lastAppliedPanelHeightRef.current, true, request);
        });
    });

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (caretScrollTimerRef.current !== null) {
        window.clearTimeout(caretScrollTimerRef.current);
        caretScrollTimerRef.current = null;
      }
    };
  }, [
    dockRef,
    observedRevision,
    onConstrainedChange,
    panelRef,
    resizeEpoch,
    revision,
    stackRef,
    textareaRef,
  ]);
}
