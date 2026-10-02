import { openAttachment } from "./bridge";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { AttachmentPreview } from "./AttachmentArea";
import type { Attachment, AttachmentDraft, DocumentBlock } from "./types";

interface Props {
  blocks: DocumentBlock[];
  files: Attachment[];
  drafts?: AttachmentDraft[];
  onChange: (blocks: DocumentBlock[]) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  label: string;
  compact?: boolean;
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function focusDocumentText(id: string, cursor = 0) {
  requestAnimationFrame(() => {
    const input = [...document.querySelectorAll<HTMLTextAreaElement>("textarea[data-document-block]")].find((node) => node.dataset.documentBlock === id);
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
    input?.scrollIntoView?.({ block: "nearest" });
  });
}

export function DocumentEditor({ blocks, files, drafts, onChange, inputRef, label, compact, disabled, onKeyDown }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  useLayoutEffect(() => {
    // Remeasure before capture's next animation frame without changing the draft
    // or following the caret as an ordinary text edit would.
    const remeasureFontSize = () => resizeDocumentTextareas(root.current, compact);
    window.addEventListener("brain-cache:font-size-applied", remeasureFontSize);
    return () => window.removeEventListener("brain-cache:font-size-applied", remeasureFontSize);
  }, [compact]);
  useLayoutEffect(() => {
    resizeDocumentTextareas(root.current, compact);
    const active = document.activeElement;
    if (compact && active instanceof HTMLTextAreaElement && root.current?.contains(active)
      && active.selectionEnd === active.value.length && active === root.current.querySelector("textarea:last-child")) {
      root.current.scrollTop = root.current.scrollHeight;
    }
  }, [blocks, compact]);
  const firstText = blocks.find((block) => block.type === "text");
  return <div ref={root} className={`document-editor${compact ? " capture-document" : ""}`} role="group" aria-label={label}>
    {blocks.map((block, index) => {
      if (block.type === "text") return <textarea key={block.id}
        data-document-block={block.id}
        ref={(node) => { if (node && (!inputRef.current || block.id === firstText?.id && !root.current?.contains(inputRef.current))) inputRef.current = node; }}
        aria-label={index === 0 ? label : `${label}, text section ${index + 1}`}
        placeholder={blocks.length === 1 ? "What's taking up space in your head?" : "Continue writing…"}
        value={block.text} rows={1} spellCheck readOnly={disabled}
        onFocus={(event) => { inputRef.current = event.currentTarget; }}
        onChange={(event) => onChange(blocks.map((candidate) => candidate.id === block.id ? { ...block, text: event.target.value } : candidate))}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          const input = event.currentTarget;
          const adjacent = event.key === "ArrowUp" && input.selectionStart === 0 ? index - 2
            : event.key === "ArrowDown" && input.selectionEnd === input.value.length ? index + 2 : -1;
          const target = blocks[adjacent];
          if (target?.type === "text") {
            event.preventDefault();
            focusDocumentText(target.id, event.key === "ArrowUp" ? target.text.length : 0);
          }
        }} />;
      const file = files.find((candidate) => candidate.id === block.attachmentId);
      return <figure className="document-image" key={block.id}>
        {file ? <AttachmentPreview file={file} draft={drafts?.find((draft) => draft.id === file.id)} card /> : <span>Image unavailable</span>}
        {file && !drafts?.some((draft) => draft.id === file.id) && <button type="button" className="document-image__open" aria-label={`Open image ${file.name}`} title="Open image"
          onClick={() => { setOpenError(null); void openAttachment(file).catch((cause: unknown) => setOpenError(cause instanceof Error ? cause.message : "Could not open image.")); }}>↗</button>}
        <button type="button" className="document-image__remove" aria-label={`Remove inline image ${file?.name ?? "image"}`} title="Remove image from document" disabled={disabled}
          onClick={() => {
            onChange(blocks.filter((candidate) => candidate.id !== block.id));
            const text = blocks.slice(index + 1).find((candidate) => candidate.type === "text");
            if (text) focusDocumentText(text.id);
          }}>×</button>
      </figure>;
    })}
    {openError && <span role="alert" className="attachment-error">{openError}</span>}
  </div>;
}

function resizeDocumentTextareas(root: HTMLDivElement | null, compact?: boolean) {
  if (!root) return;
  const scrollTop = root.scrollTop;
  for (const input of root.querySelectorAll("textarea")) {
    const minimumHeight = Math.max(
      compact ? 34 : 40,
      Math.ceil(Number.parseFloat(window.getComputedStyle(input).minHeight) || 0),
    );
    input.style.height = "0px";
    input.style.height = `${Math.max(minimumHeight, input.scrollHeight)}px`;
  }
  root.scrollTop = scrollTop;
}

export function DocumentContent({ blocks, files }: { blocks: DocumentBlock[]; files: Attachment[] }) {
  return <div className="document-content">
    {blocks.map((block) => {
      if (block.type === "text") return block.text ? <span key={block.id} className="thought-card__body">{block.text}</span> : null;
      const file = files.find((candidate) => candidate.id === block.attachmentId);
      return file ? <AttachmentPreview key={block.id} file={file} card /> : null;
    })}
  </div>;
}
