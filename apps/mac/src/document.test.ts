import { describe, expect, it } from "vitest";
import { completeImageInsertion, documentBody, reserveImageInsertion, textBlock, validateDocument } from "./document";
import type { Attachment, DocumentBlock } from "./types";
const image: Attachment = { id: "screenshot", name: "Screenshot.png", mimeType: "image/png", size: 20 };

describe("ordered image documents", () => {
  it("replaces the selected text with an image between the surrounding text", () => {
    const before = textBlock("Before SELECT After");
    const insertion = reserveImageInsertion([before], before.id, 7, 13);
    // Preserve the selection while reading: a failed import must not delete it.
    expect(documentBody(insertion.blocks)).toContain("SELECT");
    const blocks = completeImageInsertion(insertion.blocks, insertion.anchorId, [image]);
    expect(blocks.map((block) => block.type === "text" ? block.text : block.attachmentId)).toEqual(["Before ", "screenshot", " After"]);
    expect(documentBody(blocks)).toBe("Before \n After");
  });
  it("keeps the paste boundary while typing after it and while a second image is loading", () => {
    const before = textBlock("Before");
    const first = reserveImageInsertion([before], before.id, 6, 6);
    const typed = first.blocks.map((block) => block.id === first.afterId ? { ...textBlock("After"), id: first.afterId } : block);
    const second = reserveImageInsertion(typed, first.afterId, 5, 5);
    let blocks = completeImageInsertion(second.blocks, second.anchorId, [{ ...image, id: "second" }]);
    blocks = completeImageInsertion(blocks, first.anchorId, [image]);
    expect(blocks.map((block) => block.type === "text" ? block.text : block.attachmentId)).toEqual(["Before", "screenshot", "After", "second", ""]);
  });
  it("rejects missing, duplicate, and non-image attachment references", () => {
    const blocks: DocumentBlock[] = [{ id: "block", type: "image", attachmentId: image.id }];
    expect(() => validateDocument(blocks, [])).toThrow("missing");
    expect(() => validateDocument(blocks, [{ ...image, mimeType: "text/plain" }])).toThrow("missing");
    expect(() => validateDocument([...blocks, { ...blocks[0], id: "other" }], [image])).toThrow("missing");
    expect(() => validateDocument(blocks, [image])).not.toThrow();
  });
});
