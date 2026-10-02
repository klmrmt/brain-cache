import { describe, expect, it } from "vitest";
import {
  addTag,
  assignedTags,
  checklistBody,
  checklistTextsFromDraft,
  continueTextList,
  filterThoughts,
  firstLine,
  normalizeChecklistItems,
  normalizeTag,
  normalizeTagColor,
  normalizeTags,
  normalizeThoughtBody,
  recentTags,
  removeTagQueryFragment,
  removeTag,
  suggestTags,
  tagQueryFragment,
  toggleTextList,
} from "./domain";
import type { Thought } from "./types";

const thoughts: Thought[] = [
  {
    id: "today",
    body: "Build the fastest capture door",
    createdAt: "2026-09-01T15:00:00.000Z",
    archived: false,
    source: "mac-capture",
    tags: ["product", "work"],
    kind: "text",
    checklistItems: [],
  },
  {
    id: "older",
    body: "Remember the terminal typography",
    createdAt: "2026-08-30T15:00:00.000Z",
    archived: false,
    source: "mac-library",
    tags: ["design"],
    kind: "text",
    checklistItems: [],
  },
  {
    id: "archived",
    body: "An archived idea",
    createdAt: "2026-09-01T14:00:00.000Z",
    archived: true,
    source: "mac-library",
    tags: ["work"],
    kind: "text",
    checklistItems: [],
  },
];

describe("thought domain", () => {
  it("separates completed notes and Trash while retaining tag and text filters", () => {
    const done = { ...thoughts[0], id: "done", completed: true };
    const deleted = { ...done, id: "deleted", archived: true };
    const notes = [thoughts[0], done, deleted];
    expect(filterThoughts(notes, "all", "").map((note) => note.id)).toEqual([thoughts[0].id]);
    expect(filterThoughts(notes, "completed", "capture", "work").map((note) => note.id)).toEqual(["done"]);
    expect(filterThoughts(notes, "completed", "no match")).toEqual([]);
    expect(filterThoughts(notes, "archive", "").map((note) => note.id)).toEqual(["deleted"]);
  });

  it("normalizes capture input without changing internal line breaks", () => {
    expect(normalizeThoughtBody("  first\r\nsecond  ")).toBe("first\nsecond");
  });

  it("keeps archived thoughts out of the active library", () => {
    expect(filterThoughts(thoughts, "all", "").map((thought) => thought.id)).toEqual([
      "today",
      "older",
    ]);
  });

  it("combines the today filter with search", () => {
    const now = new Date("2026-09-01T18:00:00.000Z");
    expect(
      filterThoughts(thoughts, "today", "fastest", null, now).map((thought) => thought.id),
    ).toEqual(["today"]);
  });

  it("places pins first without changing date order within groups or bypassing filters", () => {
    const records = thoughts.map((thought) => ({ ...thought, pinned: thought.id !== "today" }));
    const now = new Date("2026-09-01T18:00:00.000Z");
    expect(filterThoughts(records, "all", "").map(({ id }) => id)).toEqual(["older", "today"]);
    expect(filterThoughts(records, "all", "#work").map(({ id }) => id)).toEqual(["today"]);
    expect(filterThoughts(records, "today", "", null, now).map(({ id }) => id)).toEqual(["today"]);
    expect(filterThoughts(records, "archive", "").map(({ id }) => id)).toEqual(["archived"]);
    expect(filterThoughts(records.map((thought) => ({ ...thought, pinned: true })), "all", "").map(({ id }) => id)).toEqual(["today", "older"]);
    expect(records.map(({ id }) => id)).toEqual(["today", "older", "archived"]);
    expect(filterThoughts(records.map((thought) => ({ ...thought, pinned: false })), "all", "").map(({ id }) => id)).toEqual(["today", "older"]);
  });

  it("treats the active tag as an AND constraint without parsing the body", () => {
    const thoughtWithBodyOnlyMatch: Thought = {
      ...thoughts[1],
      id: "body-only-tag",
      body: "work is written in the body only",
      tags: ["design"],
    };
    const now = new Date("2026-09-01T18:00:00.000Z");

    expect(
      filterThoughts([...thoughts, thoughtWithBodyOnlyMatch], "all", "fastest", "WORK", now).map(
        (thought) => thought.id,
      ),
    ).toEqual(["today"]);
    expect(filterThoughts(thoughts, "archive", "", "work", now).map(({ id }) => id)).toEqual([
      "archived",
    ]);
  });

  it.each(["work", "  WORK  ", "#wo", "#WORK"])(
    "finds tags absent from the body when searching %s",
    (query) => {
      expect(filterThoughts(thoughts, "all", query).map(({ id }) => id)).toEqual(["today"]);
    },
  );

  it("limits hashtags to assigned tags and combines them with text and library filters", () => {
    const records = [
      ...thoughts,
      { ...thoughts[1], id: "body-only", body: "Build the fastest #work capture" },
    ];
    const now = new Date("2026-09-01T18:00:00.000Z");
    expect(filterThoughts(records, "all", "fastest #wo").map(({ id }) => id)).toEqual(["today"]);
    expect(filterThoughts(records, "all", "#work #prod").map(({ id }) => id)).toEqual(["today"]);
    expect(filterThoughts(records, "today", "#des", null, now)).toEqual([]);
    expect(filterThoughts(records, "archive", "#wo").map(({ id }) => id)).toEqual(["archived"]);
    expect(filterThoughts(records, "all", "#work", "design")).toEqual([]);
    expect(filterThoughts(records, "all", "#missing")).toEqual([]);
  });

  it("searches multiword tag names and keeps embedded hashes in ordinary text", () => {
    const record = { ...thoughts[0], body: "Learn C# this weekend", tags: ["personal projects"] };
    expect(filterThoughts([record], "all", "PERSONAL PROJECTS")).toEqual([record]);
    expect(filterThoughts([record], "all", "C# #personal")).toEqual([record]);
    expect(filterThoughts([record], "all", "Learn weekend")).toEqual([]);
    expect(filterThoughts([{ ...record, tags: [] }], "all", "#")).toEqual([]);
  });

  it("uses the first non-empty line as a card title", () => {
    expect(firstLine("A useful title\nmore detail")).toBe("A useful title");
  });

  it("normalizes checklist drafts and preserves the ordered body projection", () => {
    expect(checklistTextsFromDraft("  Buy milk  \r\n\nCall Sam\nShip build ")).toEqual([
      "Buy milk",
      "Call Sam",
      "Ship build",
    ]);
    const items = normalizeChecklistItems([
      { id: "one", text: " Buy milk ", completed: false, reminder: null },
      { id: "two", text: "Call Sam", completed: true, reminder: null },
    ]);
    expect(checklistBody(items)).toBe("Buy milk\nCall Sam");
    expect(() => checklistTextsFromDraft("\n   \n")).toThrow("at least one");
    expect(() => normalizeChecklistItems([])).toThrow("at least one");
    expect(() =>
      normalizeChecklistItems([
        { id: "same", text: "One", completed: false, reminder: null },
        { id: "same", text: "Two", completed: false, reminder: null },
      ]),
    ).toThrow("IDs must be unique");
  });

  it("searches checklist item text while preserving tag constraints", () => {
    const checklist: Thought = {
      id: "checklist",
      body: "Buy milk\nCall Sam",
      createdAt: "2026-09-01T16:00:00.000Z",
      archived: false,
      source: "mac-capture",
      tags: ["home"],
      kind: "checklist",
      checklistItems: [
        { id: "one", text: "Buy milk", completed: false, reminder: null },
        { id: "two", text: "Call Sam", completed: true, reminder: null },
      ],
    };

    expect(filterThoughts([...thoughts, checklist], "all", "call sam", "home")).toEqual([
      checklist,
    ]);
    expect(filterThoughts([...thoughts, checklist], "all", "call sam", "work")).toEqual([]);
  });
});

describe("plain-text list editing", () => {
  it.each([
    ["numbered", "1. "],
    ["bulleted", "- "],
  ] as const)("starts and removes a %s marker in an empty draft or trailing blank line", (kind, marker) => {
    for (const prefix of ["", "Existing thought\n"]) {
      const added = toggleTextList(prefix, prefix.length, prefix.length, kind);
      expect(added).toEqual({
        text: prefix + marker,
        selectionStart: prefix.length + marker.length,
        selectionEnd: prefix.length + marker.length,
      });
      expect(toggleTextList(added.text, added.selectionStart, added.selectionEnd, kind)).toEqual({
        text: prefix,
        selectionStart: prefix.length,
        selectionEnd: prefix.length,
      });
    }
  });

  it("toggles numbered formatting on the current line and keeps the cursor with its text", () => {
    const added = toggleTextList("Plan release", 4, 4, "numbered");
    expect(added).toEqual({
      text: "1. Plan release",
      selectionStart: 7,
      selectionEnd: 7,
    });
    expect(toggleTextList(added.text, added.selectionStart, added.selectionEnd, "numbered")).toEqual({
      text: "Plan release",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it("formats every selected line, switches marker kinds, and preserves order", () => {
    const numbered = toggleTextList("Alpha\nBeta\nGamma", 1, 11, "numbered");
    expect(numbered).toEqual({
      text: "1. Alpha\n2. Beta\nGamma",
      selectionStart: 0,
      selectionEnd: 16,
    });
    const bulleted = toggleTextList(
      numbered.text,
      numbered.selectionStart,
      numbered.selectionEnd,
      "bulleted",
    );
    expect(bulleted.text).toBe("- Alpha\n- Beta\nGamma");
  });

  it("continues numbered and bulleted lists and exits an empty list item", () => {
    expect(continueTextList("3. Ship it", 10, 10)).toEqual({
      text: "3. Ship it\n4. ",
      selectionStart: 14,
      selectionEnd: 14,
    });
    expect(continueTextList("- One", 5, 5)).toEqual({
      text: "- One\n- ",
      selectionStart: 8,
      selectionEnd: 8,
    });
    expect(continueTextList("- One\n- ", 8, 8)).toEqual({
      text: "- One\n",
      selectionStart: 6,
      selectionEnd: 6,
    });
    expect(continueTextList("ordinary", 8, 8)).toBeNull();
  });
});

describe("tag domain", () => {
  it("accepts only the approved optional color palette", () => {
    expect(normalizeTagColor(null)).toBeNull();
    expect(normalizeTagColor("graphite")).toBe("graphite");
    expect(normalizeTagColor("rose")).toBe("rose");
    expect(() => normalizeTagColor("signal")).toThrow(
      "Choose a color from the Brain Cache tag palette.",
    );
  });

  it("canonicalizes Unicode labels and deduplicates case-insensitively", () => {
    expect(normalizeTag("  WORK  ")).toBe("work");
    expect(normalizeTag("\u2003WORK\u2003")).toBe("work");
    expect(normalizeTag(" CAFÉ ")).toBe("café");
    expect(normalizeTags(["Work", " work ", "WORK", "deep focus"])).toEqual([
      "deep focus",
      "work",
    ]);
  });

  it("preserves internal whitespace and punctuation", () => {
    expect(normalizeTag("  Project:  North Star  ")).toBe("project:  north star");
  });

  it("rejects empty, control-containing, and overlong labels", () => {
    expect(() => normalizeTag(" \u2003 ")).toThrow("visible character");
    expect(() => normalizeTag("one\ntwo")).toThrow("control characters");
    expect(() => normalizeTag("\nwork\n")).toThrow("control characters");
    expect(() => normalizeTag("one\u2028two")).toThrow("control characters");
    expect(() => normalizeTag("one\u2029two")).toThrow("control characters");
    expect(() => normalizeTag("x".repeat(33))).toThrow("32 characters");
    expect(() => normalizeTag("😀".repeat(32))).not.toThrow();
    expect(() => normalizeTag("😀".repeat(33))).toThrow("32 characters");
  });

  it("makes duplicate add a no-op and removes by canonical identity", () => {
    expect(addTag(["work"], " WORK ")).toEqual(["work"]);
    expect(removeTag(["design", "work"], " Work ")).toEqual(["design"]);
  });

  it("suggests prefix matches before substring matches alphabetically", () => {
    expect(suggestTags(["homework", "worker", "design", "work"], "wor", 5)).toEqual([
      "work",
      "worker",
      "homework",
    ]);
    expect(suggestTags(["zeta", "alpha"], "", 5)).toEqual(["alpha", "zeta"]);
    expect(suggestTags(["ideas", "work"], "     ", 5)).toEqual([]);
    expect(suggestTags(["ideas", "work"], "bad\u2028draft", 5)).toEqual([]);
  });

  it("collects assigned tags from active and archived thoughts", () => {
    expect(assignedTags(thoughts)).toEqual(["design", "product", "work"]);
  });

  it("orders recent tags by their newest active thought and breaks ties canonically", () => {
    const recencyThoughts: Thought[] = [
      {
        ...thoughts[0],
        id: "newest",
        createdAt: "2026-09-02T12:00:00.000Z",
        tags: ["zeta", "alpha"],
      },
      {
        ...thoughts[1],
        id: "middle",
        createdAt: "2026-09-01T12:00:00.000Z",
        tags: ["work", "alpha"],
      },
      {
        ...thoughts[2],
        id: "archived-only",
        createdAt: "2026-09-03T12:00:00.000Z",
        tags: ["archive"],
      },
    ];

    expect(recentTags(recencyThoughts)).toEqual(["alpha", "zeta", "work"]);
    expect(recentTags(recencyThoughts, 2)).toEqual(["alpha", "zeta"]);
  });

  it("finds only a start-or-whitespace hashtag at the caret", () => {
    expect(tagQueryFragment("#Wo")).toEqual({ start: 0, end: 3, value: "Wo" });
    expect(tagQueryFragment("notes #des next", 10)).toEqual({
      start: 6,
      end: 10,
      value: "des",
    });
    expect(tagQueryFragment("C#sharp")).toBeNull();
    expect(tagQueryFragment("#work later")).toBeNull();
  });

  it("removes only the selected hashtag fragment and preserves the other query text", () => {
    const query = "alpha  #wo   #unknown notes";
    const fragment = tagQueryFragment(query, 10);
    expect(fragment).not.toBeNull();
    expect(removeTagQueryFragment(query, fragment!)).toBe("alpha #unknown notes");
  });
});
