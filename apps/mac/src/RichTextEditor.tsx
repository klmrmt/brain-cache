import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorContent, Extension, Node, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import UniqueID from "@tiptap/extension-unique-id";
import { Plugin, TextSelection, type SelectionBookmark } from "@tiptap/pm/state";
import { readAttachmentData } from "./bridge";
import { AttachmentPreview } from "./AttachmentArea";
import { clipboardAttachmentFiles, draftMetadata } from "./attachments";
import { NoteReminder } from "./NoteReminder";
import { ChecklistProgress } from "./ChecklistProgress";
import { richText, type RichDocument, type RichNode } from "./richDocument";
import type { Attachment, AttachmentDraft, ChecklistItem } from "./types";
import "./RichTextEditor.css";

export interface RichEditorHandle {
  focus: (itemId?: string | null) => void;
  pasteFiles: (files: File[]) => void;
  insertImages: (drafts: AttachmentDraft[]) => void;
}
interface Props {
  document: RichDocument;
  files: Attachment[];
  drafts?: AttachmentDraft[];
  items: ChecklistItem[];
  disabled?: boolean;
  showProgress?: boolean;
  onChange: (document: RichDocument) => void;
  onAddFiles: (files: File[], insert: (drafts: AttachmentDraft[]) => void) => Promise<boolean>;
  onSetReminder: (id: string, date: string) => Promise<void>;
  onClearReminder: (id: string) => Promise<void>;
  onOpenSettings: () => Promise<void>;
}

export const RichTextEditor = forwardRef<RichEditorHandle, Props>(function RichTextEditor(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const bookmarks = useRef(new Map<string, SelectionBookmark>());
  const draftFiles = useRef(new Map<string, AttachmentDraft>());
  const [reminderBusy, setReminderBusy] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, codeBlock: false, trailingNode: false }),
      TaskList,
      TaskItem.configure({ nested: false, HTMLAttributes: { "data-type": "taskItem" }, a11y: { checkboxLabel: (node, checked) => `Mark ${node.textContent} ${checked ? "incomplete" : "complete"}` } }),
      UniqueID.configure({ types: ["taskItem"], attributeName: "id" }),
      Extension.create({
        name: "fileInsertionBookmarks",
        addProseMirrorPlugins() { return [new Plugin({ state: {
          init: () => null,
          apply: (transaction) => { for (const [id, bookmark] of bookmarks.current) bookmarks.current.set(id, bookmark.map(transaction.mapping)); return null; },
        } })]; },
      }),
      Node.create({
        name: "cacheImage", group: "block", atom: true, draggable: true,
        addAttributes() { return { attachmentId: { default: null } }; },
        parseHTML() { return [{ tag: "figure[data-cache-image]", getAttrs: (element) => {
          const id = (element as HTMLElement).dataset.cacheImage;
          return latest.current.files.some((file) => file.id === id) ? { attachmentId: id } : false;
        } }]; },
        renderHTML({ node }) { return ["figure", { "data-cache-image": node.attrs.attachmentId }]; },
        addNodeView() { return ({ node, getPos, editor }) => {
          const figure = document.createElement("figure");
          figure.className = "rich-document__image";
          figure.contentEditable = "false";
          const img = document.createElement("img");
          const id = String(node.attrs.attachmentId);
          const draft = draftFiles.current.get(id) ?? latest.current.drafts?.find((file) => file.id === id);
          const file = latest.current.files.find((file) => file.id === id) ?? (draft ? draftMetadata(draft) : undefined);
          img.alt = file?.name ?? "Attached image";
          const caption = document.createElement("span");
          caption.textContent = "Loading image…";
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "rich-document__remove-image";
          remove.setAttribute("aria-label", `Remove inline image ${file?.name ?? "image"}`);
          remove.title = "Remove from document";
          remove.textContent = "×";
          remove.addEventListener("click", () => { const pos = getPos(); if (typeof pos === "number" && editor.isEditable) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run(); });
          figure.append(img, caption, remove);
          let alive = true;
          void (draft ? Promise.resolve(draft.data) : readAttachmentData(id)).then((data) => {
            if (!alive) return;
            img.src = `data:${file?.mimeType ?? "image/png"};base64,${data}`;
            caption.remove();
          }).catch(() => { if (alive) caption.textContent = "Image unavailable"; });
          return { dom: figure, destroy: () => { alive = false; } };
        }; },
      }),
    ],
    content: props.document,
    editorProps: {
      attributes: { class: "rich-document", role: "textbox", "aria-label": "Note document", "aria-multiline": "true", spellcheck: "true" },
      handlePaste: (_view, event) => {
        const files = event.clipboardData ? clipboardAttachmentFiles(event.clipboardData) : [];
        if (!files.length) return false;
        event.preventDefault(); event.stopPropagation();
        pasteFiles(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault(); event.stopPropagation();
        const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (target) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(target.pos))));
        pasteFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange(editor.getJSON() as RichDocument),
  });

  const selected = useEditorState({ editor, selector: ({ editor }) => {
    if (!editor) return null;
    const selection = editor.state.selection;
    let taskId: string | null = null;
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      if (selection.$from.node(depth).type.name === "taskItem") { taskId = selection.$from.node(depth).attrs.id; break; }
    }
    return { bold: editor.isActive("bold"), italic: editor.isActive("italic"), underline: editor.isActive("underline"),
      bullet: editor.isActive("bulletList"), numbered: editor.isActive("orderedList"), tasks: editor.isActive("taskList"),
      heading: editor.isActive("heading") ? String(editor.getAttributes("heading").level) : "0",
      undo: editor.can().undo(), redo: editor.can().redo(), taskId };
  } });

  useEffect(() => { editor?.setEditable(!props.disabled && !reminderBusy, false); }, [editor, props.disabled, reminderBusy]);
  useImperativeHandle(ref, () => ({ focus: (itemId) => {
    if (!editor) return;
    let position: number | undefined;
    if (itemId) editor.state.doc.descendants((node, pos) => { if (node.type.name === "taskItem" && node.attrs.id === itemId) position = pos + 2; });
    if (position !== undefined) editor.commands.setTextSelection(position);
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.scrollIntoView());
  }, pasteFiles, insertImages }));

  function insertImages(drafts: AttachmentDraft[], bookmark?: SelectionBookmark) {
    if (!editor || !editor.isEditable) throw new Error("Finish the current action before adding images.");
    for (const draft of drafts) draftFiles.current.set(draft.id, draft);
    const images = drafts.filter((file) => draftMetadata(file).mimeType.startsWith("image/")).filter((file) => {
      let exists = false;
      editor.state.doc.descendants((node) => { if (node.type.name === "cacheImage" && node.attrs.attachmentId === file.id) exists = true; });
      return !exists;
    });
    if (!images.length) return;
    const selection = bookmark?.resolve(editor.state.doc) ?? editor.state.selection;
    editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to })
      .insertContent(images.map((file) => ({ type: "cacheImage", attrs: { attachmentId: file.id } }))).run();
  }

  function pasteFiles(files: File[]) {
    if (!editor || !editor.isEditable) return;
    const id = crypto.randomUUID();
    bookmarks.current.set(id, editor.state.selection.getBookmark());
    void latest.current.onAddFiles(files, (drafts) => {
      insertImages(drafts, bookmarks.current.get(id));
      bookmarks.current.delete(id);
    });
  }

  async function reminderAction(action: () => Promise<void>) {
    setReminderBusy(true);
    try { await action(); } finally { setReminderBusy(false); }
  }
  const task = props.items.find((item) => item.id === selected?.taskId);
  if (!editor || !selected) return null;
  const toolbarDisabled = props.disabled || reminderBusy;
  const command = (run: (editor: Editor) => void) => { if (editor.isEditable) run(editor); };
  return <section className="rich-editor" aria-label="Document editor">
    <div className="rich-editor__toolbar" role="toolbar" aria-label="Text formatting" onMouseDown={(event) => { if ((event.target as HTMLElement).closest("button")) event.preventDefault(); }}>
      <div className="rich-editor__group rich-editor__group--text" role="group" aria-label="Text">
        <div className="rich-editor__group-controls">
          <select aria-label="Paragraph style" value={selected.heading} disabled={toolbarDisabled}
            onChange={(event) => command((editor) => { const level = Number(event.target.value); if (level) editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run(); else editor.chain().focus().setParagraph().run(); })}>
            <option value="0">Normal text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
          </select>
          <button type="button" aria-label="Bold" title="Bold · ⌘B" aria-pressed={selected.bold} disabled={toolbarDisabled} onClick={() => command((e) => e.chain().focus().toggleBold().run())}><b>B</b></button>
          <button type="button" aria-label="Italic" title="Italic · ⌘I" aria-pressed={selected.italic} disabled={toolbarDisabled} onClick={() => command((e) => e.chain().focus().toggleItalic().run())}><i>I</i></button>
          <button type="button" aria-label="Underline" title="Underline · ⌘U" aria-pressed={selected.underline} disabled={toolbarDisabled} onClick={() => command((e) => e.chain().focus().toggleUnderline().run())}><u>U</u></button>
        </div>
        <span className="rich-editor__group-label" aria-hidden="true">Text</span>
      </div>
      <div className="rich-editor__group" role="group" aria-label="Lists">
        <div className="rich-editor__group-controls">
          <button type="button" aria-label="Bulleted list" title="Bulleted list" aria-pressed={selected.bullet} disabled={toolbarDisabled} onClick={() => command((e) => e.chain().focus().toggleBulletList().run())}><FormattingIcon name="bullets" /></button>
          <button type="button" aria-label="Numbered list" title="Numbered list" aria-pressed={selected.numbered} disabled={toolbarDisabled} onClick={() => command((e) => e.chain().focus().toggleOrderedList().run())}><FormattingIcon name="numbers" /></button>
          <button type="button" aria-label="Checklist" title="Checklist" aria-pressed={selected.tasks} disabled={toolbarDisabled} onClick={() => command((e) => e.chain().focus().toggleTaskList().run())}><FormattingIcon name="checklist" /></button>
        </div>
        <span className="rich-editor__group-label" aria-hidden="true">Lists</span>
      </div>
      <div className="rich-editor__group" role="group" aria-label="Insert">
        <div className="rich-editor__group-controls">
          <button type="button" className="rich-editor__image-button" aria-label="Insert image" title="Insert image" disabled={toolbarDisabled} onClick={() => fileInput.current?.click()}><FormattingIcon name="image" /><span>Image</span></button>
        </div>
        <span className="rich-editor__group-label" aria-hidden="true">Insert</span>
      </div>
      <div className="rich-editor__group" role="group" aria-label="History">
        <div className="rich-editor__group-controls">
          <button type="button" aria-label="Undo typing" title="Undo · ⌘Z" disabled={!selected.undo || toolbarDisabled} onClick={() => command((e) => e.chain().focus().undo().run())}><FormattingIcon name="undo" /></button>
          <button type="button" aria-label="Redo typing" title="Redo · ⇧⌘Z" disabled={!selected.redo || toolbarDisabled} onClick={() => command((e) => e.chain().focus().redo().run())}><FormattingIcon name="redo" /></button>
        </div>
        <span className="rich-editor__group-label" aria-hidden="true">History</span>
      </div>
      <input ref={fileInput} hidden type="file" multiple accept="image/*" onChange={(event) => { pasteFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
    <EditorContent editor={editor} className="rich-editor__content" />
    {props.showProgress !== false && props.items.length > 0 && <div className="rich-editor__progress"><ChecklistProgress items={props.items} /></div>}
    {task && !task.completed && <div className="rich-editor__task-reminder">
      <span>Selected item: {task.text}</span>
      <NoteReminder key={task.id} label="item" reminder={task.reminder} onSet={(date) => reminderAction(() => props.onSetReminder(task.id, date))}
        onClear={() => reminderAction(() => props.onClearReminder(task.id))} onOpenSettings={props.onOpenSettings} />
    </div>}
  </section>;
});

function FormattingIcon({ name }: { name: "bullets" | "numbers" | "checklist" | "image" | "undo" | "redo" }) {
  return <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    {name === "bullets" && <><path d="M7 4h9M7 9h9M7 14h9" /><circle cx="2" cy="4" r=".65" /><circle cx="2" cy="9" r=".65" /><circle cx="2" cy="14" r=".65" /></>}
    {name === "numbers" && <><path d="M7 4h9M7 9h9M7 14h9M1.5 2.5l1-.5v4M1.5 6h2M1 10c0-2 3-2 3 0 0 1-3 2-3 4h3" /></>}
    {name === "checklist" && <><rect x="1.5" y="2.5" width="7" height="7" rx="1" /><path d="m3.5 6 1.2 1.2L7 4.8M12 6h4M3 14h13" /></>}
    {name === "image" && <><rect x="2" y="3" width="14" height="12" rx="1.5" /><circle cx="6" cy="7" r="1" /><path d="m3 14 5-5 3 3 2-2 3 3" /></>}
    {name === "undo" && <path d="M3 5h7a5 5 0 0 1 0 10M3 5l4-4M3 5l4 4" />}
    {name === "redo" && <path d="M15 5H8a5 5 0 0 0 0 10m7-10-4-4m4 4-4 4" />}
  </svg>;
}

export function RichDocumentContent({ document, files, onToggle, disabled }: { document: RichDocument; files: Attachment[]; onToggle?: (id: string) => void; disabled?: boolean }) {
  function render(node: RichNode, key: number): React.ReactNode {
    const children = node.content?.map(render);
    if (node.type === "text") return (node.marks ?? []).reduce<React.ReactNode>((content, mark) => mark.type === "bold" ? <strong key={key}>{content}</strong>
      : mark.type === "italic" ? <em key={key}>{content}</em> : mark.type === "underline" ? <u key={key}>{content}</u>
      : mark.type === "strike" ? <s key={key}>{content}</s> : <code key={key}>{content}</code>, node.text);
    if (node.type === "cacheImage") { const file = files.find((file) => file.id === node.attrs?.attachmentId); return file ? <AttachmentPreview key={key} file={file} card /> : null; }
    if (node.type === "heading") { const Tag = `h${node.attrs?.level ?? 2}` as "h1"; return <Tag key={key}>{children}</Tag>; }
    if (node.type === "paragraph") return <p key={key}>{children ?? <br />}</p>;
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "horizontalRule") return <hr key={key} />;
    if (node.type === "blockquote") return <blockquote key={key}>{children}</blockquote>;
    if (node.type === "orderedList") return <ol key={key} start={Number(node.attrs?.start) || 1}>{children}</ol>;
    if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
    if (node.type === "taskList") return <ul key={key} data-type="taskList">{children}</ul>;
    if (node.type === "taskItem") return <li key={String(node.attrs?.id ?? key)} data-type="taskItem" data-checked={Boolean(node.attrs?.checked)}>
      <label><input type="checkbox" checked={Boolean(node.attrs?.checked)} disabled={disabled || !onToggle}
        aria-label={`Mark ${richText(node)} ${node.attrs?.checked ? "incomplete" : "complete"}`}
        onChange={() => onToggle?.(String(node.attrs?.id))} /></label><div>{children}</div>
    </li>;
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    return children;
  }
  return <div className="rich-document rich-document--card">{document.content.map(render)}</div>;
}
