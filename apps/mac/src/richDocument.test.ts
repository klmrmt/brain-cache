import { describe, expect, it } from "vitest";
import { paragraph, projectRichDocument, richDocumentForThought, updateRichTasks, type RichDocument } from "./richDocument";
import type { Thought } from "./types";

const thought: Thought = { id: "note", body: "First\nSecond", createdAt: "2026-09-08T12:00:00Z", source: "mac-library", archived: false, tags: [], kind: "checklist", checklistItems: [
  { id: "first", text: "First", completed: false, reminder: null }, { id: "second", text: "Second", completed: true, reminder: null },
] };

describe("rich documents", () => {
  it("migrates legacy checklists and inline images without losing order or task identities", () => {
    const checklist = richDocumentForThought(thought);
    expect(projectRichDocument(checklist).items).toEqual(thought.checklistItems);
    const document = richDocumentForThought({ ...thought, kind: "text", document: [
      { type: "text", id: "a", text: "Before" }, { type: "image", id: "b", attachmentId: "image" }, { type: "text", id: "c", text: "After" },
    ] });
    expect(document.content.map(node => node.type)).toEqual(["paragraph", "cacheImage", "paragraph"]);
  });

  it("projects searchable text while checkbox updates preserve formatting and mixed paragraphs", () => {
    const doc = richDocumentForThought(thought);
    doc.content.unshift({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plan", marks: [{ type: "bold" }] }] });
    doc.content.push(paragraph("Context"));
    const updated = updateRichTasks(doc, thought.checklistItems.map(item => ({ ...item, completed: true })));
    expect(projectRichDocument(updated).body).toBe("Plan\nFirst\nSecond\nContext");
    expect(updated.content[0]).toEqual(doc.content[0]);
    expect(projectRichDocument(updated).items.every(item => item.completed)).toBe(true);
    expect(projectRichDocument({ type: "doc", content: [paragraph()] }).body).toBe("Untitled note");
  });

  it("rejects unsupported content, duplicate task IDs, and unowned images", () => {
    const doc = richDocumentForThought(thought);
    doc.content[0].content![1].attrs!.id = "first";
    expect(() => projectRichDocument(doc)).toThrow("unique");
    for (const node of [{ type: "script" }, { type: "cacheImage", attrs: { attachmentId: "missing" } }, { type: "paragraph", content: [{ type: "text", text: "unsafe", marks: [{ type: "link" }] }] }]) {
      expect(() => projectRichDocument({ type: "doc", content: [node] } as RichDocument)).toThrow();
    }
  });
});
