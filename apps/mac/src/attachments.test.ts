import { describe, expect, it } from "vitest";
import { clipboardAttachmentFiles, draftMetadata, MAX_FILE_BYTES, readAttachmentFiles, validateAttachments } from "./attachments";

describe("attachment import", () => {
  it("reads exact binary content, assigns distinct ids, and keeps the image filename", async () => {
    const file = new File([new Uint8Array([0, 255, 17, 33])], "photo.png", { type: "image/png" });
    const [first, second] = await readAttachmentFiles([file, file]);
    expect(first.id).not.toBe(second.id);
    expect(Array.from(atob(first.data), (char) => char.charCodeAt(0))).toEqual([0, 255, 17, 33]);
    expect(draftMetadata(first)).toMatchObject({ name: "photo.png", size: 4, mimeType: "image/png" });
  });

  it("rejects oversized files before reading and checks combined attachment limits", async () => {
    const oversized = new File([], "large.pdf");
    Object.defineProperty(oversized, "size", { value: MAX_FILE_BYTES + 1 });
    await expect(readAttachmentFiles([oversized])).rejects.toThrow("20 MB");
    const draft = { id: crypto.randomUUID(), name: "a.txt", data: btoa("bytes") };
    expect(() => validateAttachments([draft, draft])).toThrow("duplicate");
    expect(() => validateAttachments([draft], [{ ...draftMetadata(draft), id: "existing", size: 50 * 1024 * 1024 }])).toThrow("50 MB");
    expect(() => validateAttachments([{ ...draft, data: "bad!data" }])).toThrow("read");
  });

  it("preserves the image type when the clipboard supplies no filename extension", async () => {
    const image = new File([new Uint8Array([0, 255, 17])], "image", { type: "image/jpeg" });
    const item = { kind: "file", getAsFile: () => image } as DataTransferItem;
    const data = { files: [], items: [item] } as unknown as DataTransfer;
    const [draft] = await readAttachmentFiles(clipboardAttachmentFiles(data));
    expect(draftMetadata(draft)).toMatchObject({ name: "image.jpg", mimeType: "image/jpeg", size: 3 });
    expect(draft.data).toBe("AP8R");
    expect(clipboardAttachmentFiles({ files: [image], items: [item] } as unknown as DataTransfer)).toEqual([image]);
    expect(clipboardAttachmentFiles({ files: [], items: [{ kind: "string" }] } as unknown as DataTransfer)).toEqual([]);
  });
});
