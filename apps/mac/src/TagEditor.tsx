import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { normalizeTag, normalizeTags, suggestCanonicalTags } from "./domain";
import { colorForTag, TAG_COLOR_LABELS, TagColorDot, tagColorClass } from "./TagColor";
import { TAG_COLORS, type TagColor, type TagDefinition } from "./types";

interface TagComboboxProps {
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  availableTags: string[];
  tagDefinitions?: TagDefinition[];
  excludedTags?: string[];
  maxRows: number;
  allowCreate: boolean;
  placeholder: string;
  onCommit: (tag: string) => void | Promise<void>;
  onEscape?: () => void;
  onEmptyBackspace?: () => void;
  onSaveDraft?: (tag: string | null) => boolean | Promise<boolean>;
  onError?: (message: string | null) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  disabled?: boolean;
  showInlineError?: boolean;
  errorDescriptionId?: string;
}

interface TagOption {
  kind: "existing" | "create";
  tag: string;
}

export function TagCombobox({
  id,
  label,
  value,
  onValueChange,
  availableTags,
  tagDefinitions = [],
  excludedTags = [],
  maxRows,
  allowCreate,
  placeholder,
  onCommit,
  onEscape,
  onEmptyBackspace,
  onSaveDraft,
  onError,
  inputRef: providedInputRef,
  autoFocus = false,
  disabled = false,
  showInlineError = true,
  errorDescriptionId,
}: TagComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `tag-input-${generatedId}`;
  const listboxId = `${inputId}-options`;
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = providedInputRef ?? internalInputRef;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const canonicalAvailable = useMemo(() => normalizeTags(availableTags), [availableTags]);
  const excluded = useMemo(() => new Set(normalizeTags(excludedTags)), [excludedTags]);
  const draftState = useMemo(() => {
    if (!value) return { tag: null, error: null };
    try {
      return { tag: normalizeTag(value), error: null };
    } catch (cause) {
      return {
        tag: null,
        error: cause instanceof Error ? cause.message : "That tag is not valid.",
      };
    }
  }, [value]);
  const exactMatch = draftState.tag ? canonicalAvailable.includes(draftState.tag) : false;
  const canCreate = Boolean(allowCreate && draftState.tag && !exactMatch);
  const existingLimit = Math.max(0, maxRows - (canCreate ? 1 : 0));
  const options = useMemo<TagOption[]>(() => {
    const existing: TagOption[] = suggestCanonicalTags(canonicalAvailable, value, existingLimit)
      .filter((tag) => !excluded.has(tag))
      .map((tag) => ({ kind: "existing" as const, tag }));
    if (canCreate && draftState.tag) {
      existing.push({ kind: "create", tag: draftState.tag });
    }
    return existing.slice(0, maxRows);
  }, [canCreate, canonicalAvailable, draftState.tag, excluded, existingLimit, maxRows, value]);
  const menuOpen = open && options.length > 0;
  const displayedError = localError ?? draftState.error;

  useEffect(() => {
    setActiveIndex(0);
  }, [value, options.length]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, inputRef]);

  async function commit(tag: string) {
    setPending(true);
    setLocalError(null);
    try {
      await onCommit(tag);
      onValueChange("");
      onError?.(null);
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not update tags.";
      setLocalError(message);
      onError?.(message);
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setPending(false);
    }
  }

  async function saveWithDraft() {
    if (!onSaveDraft) return;
    if (draftState.error) {
      setLocalError(draftState.error);
      onError?.(draftState.error);
      return;
    }
    setPending(true);
    try {
      const saved = await onSaveDraft(draftState.tag);
      if (saved) {
        onValueChange("");
        setLocalError(null);
        onError?.(null);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save that thought.";
      setLocalError(message);
      onError?.(message);
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && onSaveDraft) {
      event.preventDefault();
      void saveWithDraft();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (menuOpen) {
        setOpen(false);
      } else {
        onEscape?.();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = menuOpen ? options[activeIndex] : null;
      if (selected) {
        void commit(selected.tag);
      } else if (draftState.tag && (allowCreate || exactMatch)) {
        void commit(draftState.tag);
      } else if (draftState.tag) {
        const message = "Choose an existing tag.";
        setLocalError(message);
        onError?.(message);
      } else if (draftState.error) {
        setLocalError(draftState.error);
        onError?.(draftState.error);
      }
      return;
    }
    if (event.key === "Backspace" && !value) {
      event.preventDefault();
      setOpen(false);
      onEmptyBackspace?.();
    }
  }

  return (
    <div className="tag-combobox" aria-busy={pending || disabled}>
      <label className="visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <div className="tag-combobox__field">
        <span aria-hidden="true">#</span>
        <input
          id={inputId}
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={menuOpen}
          aria-activedescendant={menuOpen ? `${listboxId}-${activeIndex}` : undefined}
          aria-invalid={Boolean(displayedError)}
          aria-describedby={
            displayedError ? (errorDescriptionId ?? `${inputId}-error`) : undefined
          }
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          disabled={pending || disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            onValueChange(event.target.value);
            setLocalError(null);
            onError?.(null);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {menuOpen && (
        <div className="tag-options" id={listboxId} role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={`${option.kind}-${option.tag}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "tag-option tag-option--active" : "tag-option"}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => void commit(option.tag)}
            >
              <TagColorDot color={colorForTag(tagDefinitions, option.tag)} />
              <span>{option.kind === "create" ? "create" : "#"}</span>
              <strong>{option.tag}</strong>
            </button>
          ))}
        </div>
      )}
      {displayedError && showInlineError && (
        <span className="tag-editor__error" id={`${inputId}-error`} role="alert">
          {displayedError}
        </span>
      )}
    </div>
  );
}

interface TagEditorProps {
  id: string;
  label: string;
  tags: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  availableTags: string[];
  tagDefinitions?: TagDefinition[];
  maxRows: number;
  showInput: boolean;
  placeholder: string;
  onAdd: (tag: string) => void | Promise<void>;
  onRemove: (tag: string) => void | Promise<void>;
  onColorChange?: (tag: string, color: TagColor | null) => void | Promise<void>;
  onExit?: () => void;
  onSaveDraft?: (tag: string | null) => boolean | Promise<boolean>;
  onError?: (message: string | null) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  className?: string;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  showInlineError?: boolean;
  errorDescriptionId?: string;
  showAvailableTags?: boolean;
}

export function TagEditor({
  id,
  label,
  tags,
  draft,
  onDraftChange,
  availableTags,
  tagDefinitions = [],
  maxRows,
  showInput,
  placeholder,
  onAdd,
  onRemove,
  onColorChange,
  onExit,
  onSaveDraft,
  onError,
  inputRef,
  autoFocus,
  className = "",
  fallbackFocusRef,
  showInlineError = true,
  errorDescriptionId,
  showAvailableTags = false,
}: TagEditorProps) {
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const colorRefs = useRef(new Map<string, HTMLButtonElement>());
  const availableRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pendingAction, setPendingAction] = useState<{
    kind: "adding" | "removing" | "coloring";
    tag: string;
  } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [editingColorTag, setEditingColorTag] = useState<string | null>(null);
  const mergedAvailableTags = useMemo(
    () => normalizeTags([...availableTags, ...tags]),
    [availableTags, tags],
  );
  const selectableAvailableTags = useMemo(() => {
    if (!showAvailableTags) return [];
    const attached = new Set(normalizeTags(tags));
    return normalizeTags(availableTags).filter((tag) => !attached.has(tag));
  }, [availableTags, showAvailableTags, tags]);

  async function add(tag: string) {
    setPendingAction({ kind: "adding", tag });
    setRemoveError(null);
    try {
      await onAdd(tag);
      onError?.(null);
    } finally {
      setPendingAction(null);
    }
  }

  async function remove(tag: string) {
    setPendingAction({ kind: "removing", tag });
    setRemoveError(null);
    try {
      await onRemove(tag);
      if (editingColorTag === tag) setEditingColorTag(null);
      onError?.(null);
      requestAnimationFrame(() => (inputRef?.current ?? fallbackFocusRef?.current)?.focus());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not remove that tag.";
      setRemoveError(message);
      onError?.(message);
      requestAnimationFrame(() => removeRefs.current.get(tag)?.focus());
    } finally {
      setPendingAction(null);
    }
  }

  async function addAvailable(tag: string) {
    try {
      await add(tag);
      requestAnimationFrame(() =>
        (colorRefs.current.get(tag) ?? removeRefs.current.get(tag) ?? inputRef?.current)?.focus(),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not add that tag.";
      setRemoveError(message);
      onError?.(message);
      requestAnimationFrame(() => availableRefs.current.get(tag)?.focus());
    }
  }

  async function changeColor(tag: string, color: TagColor | null) {
    if (!onColorChange) return;
    setPendingAction({ kind: "coloring", tag });
    setRemoveError(null);
    try {
      await onColorChange(tag, color);
      setEditingColorTag(null);
      onError?.(null);
      requestAnimationFrame(() => colorRefs.current.get(tag)?.focus());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not update that tag color.";
      setRemoveError(message);
      onError?.(message);
      requestAnimationFrame(() => colorRefs.current.get(tag)?.focus());
    } finally {
      setPendingAction(null);
    }
  }

  if (!showInput && tags.length === 0) return null;

  return (
    <div
      className={`tag-editor${className ? ` ${className}` : ""}`}
      aria-busy={Boolean(pendingAction)}
    >
      {tags.length > 0 && (
        <div className="tag-editor__chips" aria-label="Attached tags">
          {tags.map((tag) => (
            <span
              className={`tag-chip tag-chip--removable ${tagColorClass(
                colorForTag(tagDefinitions, tag),
              )}`}
              key={tag}
              title={onColorChange ? `Right-click to change color for #${tag}` : undefined}
              onContextMenu={onColorChange ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!pendingAction) setEditingColorTag(tag);
              } : undefined}
            >
              {onColorChange && (
                <button
                  ref={(node) => {
                    if (node) colorRefs.current.set(tag, node);
                    else colorRefs.current.delete(tag);
                  }}
                  className="tag-chip__color-button"
                  type="button"
                  aria-label={`Set color for tag ${tag}`}
                  title={`Change color for #${tag}`}
                  aria-expanded={editingColorTag === tag}
                  disabled={Boolean(pendingAction)}
                  onClick={() => setEditingColorTag((current) => (current === tag ? null : tag))}
                >
                  <TagColorDot color={colorForTag(tagDefinitions, tag)} />
                </button>
              )}
              <span className="tag-chip__label">#{tag}</span>
              <button
                ref={(node) => {
                  if (node) removeRefs.current.set(tag, node);
                  else removeRefs.current.delete(tag);
                }}
                type="button"
                aria-label={`Remove tag ${tag}`}
                disabled={Boolean(pendingAction)}
                onClick={() => void remove(tag)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {editingColorTag && onColorChange && (
        <TagColorPicker
          tag={editingColorTag}
          color={colorForTag(tagDefinitions, editingColorTag)}
          disabled={Boolean(pendingAction)}
          onChoose={(color) => void changeColor(editingColorTag, color)}
          onClose={() => {
            setEditingColorTag(null);
            requestAnimationFrame(() => colorRefs.current.get(editingColorTag)?.focus());
          }}
        />
      )}
      {selectableAvailableTags.length > 0 && (
        <div className="tag-editor__available">
          <span className="tag-editor__available-label">available</span>
          <div className="tag-editor__available-tags" role="group" aria-label="Available tags">
            {selectableAvailableTags.map((tag) => (
              <button
                ref={(node) => {
                  if (node) availableRefs.current.set(tag, node);
                  else availableRefs.current.delete(tag);
                }}
                className={`tag-available-tag ${tagColorClass(colorForTag(tagDefinitions, tag))}`}
                key={tag}
                type="button"
                aria-label={`Add tag ${tag}`}
                disabled={Boolean(pendingAction)}
                onClick={() => void addAvailable(tag)}
              >
                <TagColorDot color={colorForTag(tagDefinitions, tag)} />
                <span>#{tag}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {showInput && (
        <TagCombobox
          id={id}
          label={label}
          value={draft}
          onValueChange={onDraftChange}
          availableTags={mergedAvailableTags}
          tagDefinitions={tagDefinitions}
          excludedTags={tags}
          maxRows={maxRows}
          allowCreate
          placeholder={placeholder}
          onCommit={add}
          onEscape={onExit}
          onEmptyBackspace={() => removeRefs.current.get(tags.at(-1) ?? "")?.focus()}
          onSaveDraft={onSaveDraft}
          onError={onError}
          inputRef={inputRef}
          autoFocus={autoFocus}
          disabled={Boolean(pendingAction)}
          showInlineError={showInlineError}
          errorDescriptionId={errorDescriptionId}
        />
      )}
      {pendingAction && (
        <span className="tag-editor__pending" role="status">
          {pendingAction.kind === "coloring" ? "saving color for" : pendingAction.kind} #
          {pendingAction.tag}…
        </span>
      )}
      {removeError && showInlineError && (
        <span className="tag-editor__error" role="alert">
          {removeError}
        </span>
      )}
    </div>
  );
}

interface TagColorPickerProps {
  tag: string;
  color: TagColor | null;
  disabled: boolean;
  onChoose: (color: TagColor | null) => void;
  onClose: () => void;
}

export function TagColorPicker({ tag, color, disabled, onChoose, onClose }: TagColorPickerProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.focus();
  }, [tag]);

  return (
    <div
      className="tag-color-picker"
      role="group"
      aria-label={`Color for tag ${tag}`}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {TAG_COLORS.map((option) => (
        <button
          ref={color === option ? selectedRef : undefined}
          className={`tag-color-picker__swatch ${tagColorClass(option)}`}
          key={option}
          type="button"
          aria-label={`Set ${TAG_COLOR_LABELS[option]} color for tag ${tag}`}
          aria-pressed={color === option}
          disabled={disabled}
          onClick={() => onChoose(option)}
        >
          <TagColorDot color={option} />
          <span>{TAG_COLOR_LABELS[option]}</span>
        </button>
      ))}
      <button
        ref={color === null ? selectedRef : undefined}
        className="tag-color-picker__neutral"
        type="button"
        aria-label={`Remove color from tag ${tag}`}
        aria-pressed={color === null}
        disabled={disabled}
        onClick={() => onChoose(null)}
      >
        remove color
      </button>
    </div>
  );
}
