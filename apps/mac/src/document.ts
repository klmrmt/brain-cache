import type { Attachment, DocumentBlock } from "./types";

export function textBlock(text = ""): DocumentBlock & { type: "text" } {
  return { id: crypto.randomUUID(), type: "text", text };
}

export function documentBody(blocks: DocumentBlock[]): string {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim().replace(/\r\n/g, "\n");
}

export function isDocument(value: unknown): value is DocumentBlock[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 101
    && value.every((block) => block && typeof block.id === "string" && block.id.length > 0
      && (block.type === "text" ? typeof block.text === "string"
        : block.type === "image" && typeof block.attachmentId === "string"));
}

export function validateDocument(blocks: DocumentBlock[], files: Attachment[]): void {
  if (!isDocument(blocks)) throw new Error("This document could not be read.");
  const ids = new Set<string>();
  const images = new Set<string>();
  for (const block of blocks) {
    if (ids.has(block.id)) throw new Error("Document block IDs must be unique.");
    ids.add(block.id);
    if (block.type === "image") {
      if (images.has(block.attachmentId) || !files.some((file) => file.id === block.attachmentId && file.mimeType.startsWith("image/"))) {
        throw new Error("An image in this document is missing. Please retry adding it.");
      }
      images.add(block.attachmentId);
    }
  }
}

export function inlineImageIds(blocks?: DocumentBlock[]): Set<string> {
  return new Set(blocks?.flatMap((block) => block.type === "image" ? [block.attachmentId] : []));
}

// Keep a stable text boundary while image bytes are being read. Typing after paste
// or moving the cursor cannot move the eventual image to a different paragraph.
export function reserveImageInsertion(blocks: DocumentBlock[], id: string, start: number, end: number) {
  const index = blocks.findIndex((block) => block.id === id && block.type === "text");
  if (index < 0) throw new Error("Place the cursor in the thought before pasting an image.");
  const block = blocks[index];
  if (block.type !== "text") throw new Error("Choose a text position.");
  const anchor = textBlock(block.text.slice(start, end));
  const after = textBlock(block.text.slice(end));
  return {
    blocks: [...blocks.slice(0, index), { ...block, text: block.text.slice(0, start) }, anchor, after, ...blocks.slice(index + 1)],
    anchorId: anchor.id,
    afterId: after.id,
  };
}

export function completeImageInsertion(blocks: DocumentBlock[], anchorId: string, files: Attachment[]): DocumentBlock[] {
  return blocks.flatMap((block): DocumentBlock[] => block.id === anchorId
    ? files.filter((file) => file.mimeType.startsWith("image/")).map((file) => ({ id: crypto.randomUUID(), type: "image", attachmentId: file.id }))
    : [block]);
}
