export const THOUGHT_SOURCES = ["mac-library", "mac-capture", "iphone", "shortcut"] as const;

export type ThoughtSource = (typeof THOUGHT_SOURCES)[number];

export const TAG_COLORS = ["graphite", "clay", "moss", "sky", "plum", "rose"] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export interface TagDefinition {
  name: string;
  color: TagColor | null;
}

export const THOUGHT_KINDS = ["text", "checklist"] as const;

export type ThoughtKind = (typeof THOUGHT_KINDS)[number];

export type ReminderState =
  | "pending"
  | "scheduled"
  | "permission-denied"
  | "scheduling-failed"
  | "overdue";

export interface ChecklistReminder {
  scheduledFor: string;
  state: ReminderState;
  lastError: string | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  reminder: ChecklistReminder | null;
}

export interface TaskCompletion {
  itemId: string;
  completedAt: string | null;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface AttachmentDraft {
  id: string;
  name: string;
  data: string;
}

export type DocumentBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; attachmentId: string };

export interface Thought {
  id: string;
  body: string;
  createdAt: string;
  archived: boolean;
  completed?: boolean;
  pinned?: boolean;
  source: ThoughtSource;
  tags: string[];
  kind: ThoughtKind;
  checklistItems: ChecklistItem[];
  reminder?: ChecklistReminder | null;
  richDocument?: import("./richDocument").RichDocument;
  taskCompletions?: TaskCompletion[];
  attachments?: Attachment[];
  document?: DocumentBlock[];
}

export type LibraryFilter = "all" | "today" | "completed" | "archive";
