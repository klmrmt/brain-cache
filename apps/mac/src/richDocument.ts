import type { Attachment, ChecklistItem, Thought } from "./types";
import { normalizeChecklistItemText } from "./domain";

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: Array<{ type: string }>;
}
export interface RichDocument extends RichNode { type: "doc"; content: RichNode[] }

export function paragraph(text = ""): RichNode {
  return { type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) };
}

export function richDocumentForThought(thought: Thought): RichDocument {
  if (thought.richDocument) return thought.richDocument;
  if (thought.kind === "checklist") return { type: "doc", content: [{ type: "taskList", content: thought.checklistItems.map((item) => ({
    type: "taskItem", attrs: { id: item.id, checked: item.completed }, content: [paragraph(item.text)],
  })) }] };
  if (thought.document) return { type: "doc", content: thought.document.flatMap((block) => block.type === "image"
    ? [{ type: "cacheImage", attrs: { attachmentId: block.attachmentId } }]
    : block.text.split("\n").map(paragraph)) };
  return { type: "doc", content: thought.body.split("\n").map(paragraph) };
}

export function richText(node: RichNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(richText).join(["doc", "taskList", "bulletList", "orderedList", "taskItem", "listItem", "blockquote"].includes(node.type) ? "\n" : "");
}

export function richImageIds(node?: RichNode): Set<string> {
  const ids = new Set<string>();
  function visit(node: RichNode) {
    if (node.type === "cacheImage" && typeof node.attrs?.attachmentId === "string") ids.add(node.attrs.attachmentId);
    node.content?.forEach(visit);
  }
  if (node) visit(node);
  return ids;
}

export function projectRichDocument(doc: RichDocument, files: Attachment[] = []) {
  if (JSON.stringify(doc).length > 2_000_000) throw new Error("This note is too large to save.");
  const items: ChecklistItem[] = [];
  const ids = new Set<string>();
  const images = new Set<string>();
  const blocks = new Set(["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "horizontalRule", "cacheImage"]);
  function visit(node: RichNode, parent: string, depth: number) {
    if (!node || depth > 32 || typeof node.type !== "string") throw new Error("This formatted document could not be read.");
    const type = node.type;
    const allowed = parent === "root" ? type === "doc" : ["paragraph", "heading"].includes(parent) ? ["text", "hardBreak"].includes(type)
      : parent === "taskList" ? type === "taskItem" : ["bulletList", "orderedList"].includes(parent) ? type === "listItem" : ["doc", "taskItem", "listItem", "blockquote"].includes(parent) && blocks.has(type);
    if (!allowed) throw new Error("This formatted document contains an unsupported block.");
    if (type === "text" && typeof node.text !== "string") throw new Error("This document contains invalid text.");
    if (node.marks && !Array.isArray(node.marks)) throw new Error("This document contains invalid formatting.");
    if (node.marks?.some((mark) => !["bold", "italic", "strike", "underline", "code"].includes(mark.type))) throw new Error("This document contains unsupported formatting.");
    if (type === "heading" && ![1, 2, 3].includes(Number(node.attrs?.level))) throw new Error("Choose a supported heading size.");
    if (type === "taskItem") {
      const id = node.attrs?.id;
      if (typeof id !== "string" || !id || ids.has(id) || typeof node.attrs?.checked !== "boolean") throw new Error("Checklist item IDs must be unique.");
      ids.add(id);
      const text = richText(node).replace(/\s*\n\s*/g, " ").trim();
      if (text) items.push({ id, text: normalizeChecklistItemText(text), completed: node.attrs.checked, reminder: null });
    }
    if (type === "cacheImage") {
      const id = node.attrs?.attachmentId;
      if (typeof id !== "string" || !files.some((file) => file.id === id && file.mimeType.startsWith("image/"))) throw new Error("An image in this document is missing. Please retry adding it.");
      images.add(id);
    }
    if (node.content && !Array.isArray(node.content)) throw new Error("This formatted document could not be read.");
    node.content?.forEach((child) => visit(child, type, depth + 1));
  }
  visit(doc, "root", 0);
  if (items.length > 100) throw new Error("Checklists can contain up to 100 items.");
  const body = richText(doc).trim() || [...images].map((id) => files.find((file) => file.id === id)!.name).join("\n") || "Untitled note";
  return { body, items, kind: items.length ? "checklist" as const : "text" as const };
}

// Grid checkbox changes preserve paragraphs, marks, images, and item identities.
export function updateRichTasks(doc: RichDocument, items: ChecklistItem[]): RichDocument {
  function visit(node: RichNode): RichNode {
    const item = node.type === "taskItem" ? items.find((item) => item.id === node.attrs?.id) : undefined;
    return { ...node, ...(item ? { attrs: { ...node.attrs, checked: item.completed } } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}) };
  }
  return visit(doc) as RichDocument;
}
