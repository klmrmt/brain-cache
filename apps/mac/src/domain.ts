import {
  TAG_COLORS,
  type ChecklistItem,
  type LibraryFilter,
  type TagColor,
  type Thought,
} from "./types";

export const TAG_MAX_CHARACTERS = 32;
export const CHECKLIST_ITEM_MAX_CHARACTERS = 500;
export const CHECKLIST_MAX_ITEMS = 100;

export type TextListKind = "numbered" | "bulleted";

export interface TextSelectionEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface TagQueryFragment {
  start: number;
  end: number;
  value: string;
}

export function normalizeThoughtBody(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

export function normalizeTag(value: string): string {
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) {
    throw new Error("Tags cannot contain line breaks or control characters.");
  }
  const normalized = trimTagWhitespace(value).toLowerCase();
  if (!normalized) {
    throw new Error("Tag needs at least one visible character.");
  }
  if ([...normalized].length > TAG_MAX_CHARACTERS) {
    throw new Error(`Tags must be ${TAG_MAX_CHARACTERS} characters or fewer.`);
  }
  return normalized;
}

export function normalizeTags(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeTag))].sort(compareTags);
}

export function normalizeTagColor(value: string | null): TagColor | null {
  if (value === null) return null;
  if ((TAG_COLORS as readonly string[]).includes(value)) return value as TagColor;
  throw new Error("Choose a color from the Brain Cache tag palette.");
}

export function normalizeChecklistItemText(value: string): string {
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) {
    throw new Error("Checklist items must stay on one line.");
  }
  const normalized = value.trim();
  if (!normalized) throw new Error("Checklist items need visible text.");
  if ([...normalized].length > CHECKLIST_ITEM_MAX_CHARACTERS) {
    throw new Error(
      `Checklist items must be ${CHECKLIST_ITEM_MAX_CHARACTERS} characters or fewer.`,
    );
  }
  return normalized;
}

export function checklistTextsFromDraft(value: string): string[] {
  const texts = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(normalizeChecklistItemText);
  if (texts.length === 0) throw new Error("Add at least one checklist item.");
  if (texts.length > CHECKLIST_MAX_ITEMS) {
    throw new Error(`Checklists can contain up to ${CHECKLIST_MAX_ITEMS} items.`);
  }
  return texts;
}

export function normalizeChecklistItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  if (items.length === 0) throw new Error("A checklist needs at least one item.");
  if (items.length > CHECKLIST_MAX_ITEMS) {
    throw new Error(`Checklists can contain up to ${CHECKLIST_MAX_ITEMS} items.`);
  }
  const ids = new Set<string>();
  return items.map((item) => {
    if (!item.id || ids.has(item.id)) throw new Error("Checklist item IDs must be unique.");
    ids.add(item.id);
    return {
      id: item.id,
      text: normalizeChecklistItemText(item.text),
      completed: Boolean(item.completed),
      reminder: item.reminder,
    };
  });
}

export function checklistBody(items: readonly Pick<ChecklistItem, "text">[]): string {
  return items.map((item) => normalizeChecklistItemText(item.text)).join("\n");
}

export function toggleTextList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: TextListKind,
): TextSelectionEdit {
  const start = clampSelection(selectionStart, value.length);
  const end = clampSelection(selectionEnd, value.length);
  const first = Math.min(start, end);
  const last = Math.max(start, end);
  const blockStart = value.lastIndexOf("\n", Math.max(0, first - 1)) + 1;
  const selectedTail = last > first && value[last - 1] === "\n" ? last - 1 : last;
  const nextBreak = value.indexOf("\n", selectedTail);
  const blockEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(blockStart, blockEnd).split("\n");
  const removeTarget =
    lines.some((line) => targetListMatch(line, kind)) &&
    lines.every((line) => line.length === 0 || targetListMatch(line, kind));
  let number = 1;
  const transformed = lines.map((line) => {
    const parsed = parseTextListLine(line);
    const nextMarker = removeTarget ? "" : kind === "bulleted" ? "- " : `${number++}. `;
    const content = removeTarget
      ? targetListMatch(line, kind)?.content ?? line.slice(parsed.indent.length)
      : parsed.content;
    return {
      text: `${parsed.indent}${nextMarker}${content}`,
      oldMarkerLength: parsed.marker.length,
      newMarkerLength: nextMarker.length,
      indentLength: parsed.indent.length,
    };
  });
  const replacement = transformed.map((line) => line.text).join("\n");
  const text = `${value.slice(0, blockStart)}${replacement}${value.slice(blockEnd)}`;

  if (first !== last) {
    return {
      text,
      selectionStart: blockStart,
      selectionEnd: blockStart + replacement.length,
    };
  }

  const prefix = value.slice(blockStart, first);
  const lineIndex = prefix.split("\n").length - 1;
  const lineStart = blockStart + (prefix.lastIndexOf("\n") + 1);
  const column = first - lineStart;
  const line = transformed[lineIndex] ?? transformed[0];
  const contentColumn = Math.max(line.indentLength, column - line.oldMarkerLength);
  const nextColumn = contentColumn + line.newMarkerLength;
  const precedingLength = transformed
    .slice(0, lineIndex)
    .reduce((total, candidate) => total + candidate.text.length + 1, 0);
  const cursor = blockStart + precedingLength + Math.min(nextColumn, line.text.length);
  return { text, selectionStart: cursor, selectionEnd: cursor };
}

export function continueTextList(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): TextSelectionEdit | null {
  const cursor = clampSelection(selectionStart, value.length);
  if (cursor !== clampSelection(selectionEnd, value.length)) return null;
  const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const nextBreak = value.indexOf("\n", cursor);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const parsed = parseTextListLine(line);
  if (!parsed.marker || cursor < lineStart + parsed.indent.length + parsed.marker.length) {
    return null;
  }

  if (!parsed.content.trim()) {
    const text = `${value.slice(0, lineStart)}${parsed.indent}${value.slice(lineEnd)}`;
    const nextCursor = lineStart + parsed.indent.length;
    return { text, selectionStart: nextCursor, selectionEnd: nextCursor };
  }

  const numbered = /^(\d+)\. $/.exec(parsed.marker);
  const marker = numbered ? `${Number(numbered[1]) + 1}. ` : "- ";
  const insertion = `\n${parsed.indent}${marker}`;
  const text = `${value.slice(0, cursor)}${insertion}${value.slice(cursor)}`;
  const nextCursor = cursor + insertion.length;
  return { text, selectionStart: nextCursor, selectionEnd: nextCursor };
}

export function addTag(tags: readonly string[], value: string): string[] {
  return normalizeTags([...tags, value]);
}

export function removeTag(tags: readonly string[], value: string): string[] {
  const target = normalizeTag(value);
  return normalizeTags(tags).filter((tag) => tag !== target);
}

export function assignedTags(thoughts: readonly Thought[]): string[] {
  return normalizeTags(thoughts.flatMap((thought) => thought.tags));
}

export function recentTags(thoughts: readonly Thought[], limit = 8): string[] {
  const latestUse = new Map<string, number>();
  for (const thought of thoughts) {
    if (thought.archived) continue;
    const createdAt = Date.parse(thought.createdAt);
    for (const tag of normalizeTags(thought.tags)) {
      latestUse.set(tag, Math.max(latestUse.get(tag) ?? Number.NEGATIVE_INFINITY, createdAt));
    }
  }

  return [...latestUse]
    .sort(([leftTag, leftTime], [rightTag, rightTime]) => {
      const timeDifference = rightTime - leftTime;
      return Number.isNaN(timeDifference) || timeDifference === 0
        ? compareTags(leftTag, rightTag)
        : timeDifference;
    })
    .slice(0, Math.max(0, limit))
    .map(([tag]) => tag);
}

export function tagQueryFragment(
  query: string,
  caretPosition: number = query.length,
): TagQueryFragment | null {
  const caret = clampSelection(caretPosition, query.length);
  let tokenStart = caret;
  while (tokenStart > 0 && !/\s/u.test(query[tokenStart - 1])) tokenStart -= 1;
  if (query[tokenStart] !== "#") return null;

  const suffix = query.slice(caret);
  const whitespaceIndex = suffix.search(/\s/u);
  const end = whitespaceIndex < 0 ? query.length : caret + whitespaceIndex;
  return {
    start: tokenStart,
    end,
    value: query.slice(tokenStart + 1, end),
  };
}

export function removeTagQueryFragment(query: string, fragment: TagQueryFragment): string {
  const left = query.slice(0, fragment.start).replace(/\s+$/u, "");
  const right = query.slice(fragment.end).replace(/^\s+/u, "");
  if (left && right) return `${left} ${right}`;
  return left || right;
}

export function suggestTags(
  availableTags: readonly string[],
  draft: string,
  limit: number,
): string[] {
  return suggestCanonicalTags(normalizeTags(availableTags), draft, limit);
}

export function suggestCanonicalTags(
  canonicalTags: readonly string[],
  draft: string,
  limit: number,
): string[] {
  if (draft.length === 0) return canonicalTags.slice(0, Math.max(0, limit));

  let normalizedDraft: string;
  try {
    normalizedDraft = normalizeTag(draft);
  } catch {
    return [];
  }

  const prefix = canonicalTags.filter((tag) => tag.startsWith(normalizedDraft));
  const substring = canonicalTags.filter(
    (tag) => !tag.startsWith(normalizedDraft) && tag.includes(normalizedDraft),
  );
  return [...prefix, ...substring].slice(0, Math.max(0, limit));
}

export function filterThoughts(
  thoughts: Thought[],
  filter: LibraryFilter,
  query: string,
  activeTag: string | null = null,
  now = new Date(),
): Thought[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const queryTerms = normalizedQuery.split(/\s+/u);
  const tagQueries = queryTerms.filter((term) => term.startsWith("#")).map((term) => term.slice(1));
  const textQuery = tagQueries.length > 0
    ? queryTerms.filter((term) => !term.startsWith("#")).join(" ")
    : normalizedQuery;
  const normalizedActiveTag = activeTag ? normalizeTag(activeTag) : null;
  const todayKey = localDayKey(now);

  return thoughts.filter((thought) => {
    if (filter === "archive" && !thought.archived) return false;
    if (filter !== "archive" && thought.archived) return false;
    if (filter === "completed" && !thought.completed) return false;
    if ((filter === "all" || filter === "today") && thought.completed) return false;
    if (filter === "today" && localDayKey(new Date(thought.createdAt)) !== todayKey) return false;
    const searchableText =
      thought.kind === "checklist"
        ? `${thought.body}\n${thought.checklistItems.map((item) => item.text).join("\n")}`
        : thought.body;
    const searchableTags = thought.tags.map((tag) => tag.toLocaleLowerCase());
    if (!tagQueries.every((tagQuery) => searchableTags.some((tag) => tag.includes(tagQuery)))) {
      return false;
    }
    if (
      textQuery &&
      !searchableText.toLocaleLowerCase().includes(textQuery) &&
      !searchableTags.some((tag) => tag.includes(textQuery))
    ) {
      return false;
    }
    if (normalizedActiveTag && !thought.tags.includes(normalizedActiveTag)) return false;
    return true;
  }).sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)));
}

function compareTags(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function trimTagWhitespace(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

function clampSelection(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function parseTextListLine(line: string): {
  indent: string;
  marker: string;
  content: string;
} {
  const numbered = /^([ \t]*)(\d+\. )(.*)$/.exec(line);
  if (numbered) {
    return { indent: numbered[1], marker: numbered[2], content: numbered[3] };
  }
  const bulleted = /^([ \t]*)([-*] )(.*)$/.exec(line);
  if (bulleted) {
    return { indent: bulleted[1], marker: bulleted[2], content: bulleted[3] };
  }
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  return { indent, marker: "", content: line.slice(indent.length) };
}

function targetListMatch(
  line: string,
  kind: TextListKind,
): { content: string } | null {
  const match =
    kind === "numbered"
      ? /^[ \t]*\d+\. (.*)$/.exec(line)
      : /^[ \t]*[-*] (.*)$/.exec(line);
  return match ? { content: match[1] } : null;
}

export function firstLine(value: string): string {
  return value.split("\n", 1)[0]?.trim() || "Untitled thought";
}

export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatThoughtTime(createdAt: string): string {
  const date = new Date(createdAt);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
