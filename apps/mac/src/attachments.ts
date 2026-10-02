import type { Attachment, AttachmentDraft } from "./types";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 20;

export function clipboardAttachmentFiles(data: Pick<DataTransfer, "files" | "items">): File[] {
  // Some clipboard providers expose image items without populating FileList.
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}

function attachmentFileName(file: File): string {
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
    "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp" } as Record<string, string>)[file.type];
  if (extension && attachmentMime(file.name) !== file.type) {
    return `${file.name || "pasted-image"}.${extension}`;
  }
  return file.name || "attachment";
}

export function attachmentMime(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", pdf: "application/pdf", txt: "text/plain", md: "text/plain", csv: "text/plain", log: "text/plain", mp3: "audio/mpeg", mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

export function draftMetadata(draft: AttachmentDraft): Attachment {
  const size = Math.floor(draft.data.length * 3 / 4) - (draft.data.endsWith("==") ? 2 : draft.data.endsWith("=") ? 1 : 0);
  return { id: draft.id, name: draft.name, mimeType: attachmentMime(draft.name), size };
}

export function validateAttachments(drafts: AttachmentDraft[], existing: Attachment[] = []): void {
  if (drafts.length + existing.length > MAX_FILES) throw new Error("Attach up to 20 files per thought.");
  const ids = new Set(existing.map((file) => file.id));
  let total = existing.reduce((sum, file) => sum + file.size, 0);
  for (const draft of drafts) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.id) || ids.has(draft.id)) throw new Error("Invalid or duplicate attachment identifier.");
    ids.add(draft.id);
    if (draft.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || draftMetadata(draft).size > MAX_FILE_BYTES) throw new Error("Each attachment must be 20 MB or smaller.");
    try {
      if (atob(draft.data).length !== draftMetadata(draft).size) throw new Error();
    } catch { throw new Error("Could not read the attachment data."); }
    total += draftMetadata(draft).size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("Attachments must total 50 MB or less per thought.");
}

export async function readAttachmentFiles(files: File[]): Promise<AttachmentDraft[]> {
  if (files.length > MAX_FILES) throw new Error("Attach up to 20 files at a time.");
  if (files.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("Each attachment must be 20 MB or smaller.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error("Attachments must total 50 MB or less per thought.");
  const result: AttachmentDraft[] = [];
  for (const file of files) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
      reader.onerror = () => reject(new Error(`Could not read ${file.name}. Try selecting it again.`));
      reader.onabort = () => reject(new Error("Reading the file was interrupted."));
      reader.readAsDataURL(file);
    });
    result.push({ id: crypto.randomUUID(), name: attachmentFileName(file), data });
  }
  validateAttachments(result);
  return result;
}

export function fileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
