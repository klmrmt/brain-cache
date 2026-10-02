# Local attachments

Files can be added in Option-Space capture and in either card detail mode. The picker, file drops, and pasted images share the same import path. Existing-card attachment changes save immediately and preserve concurrent text/tag edits. Capture commits its text, tags, checklist items, and attachment contents in one transaction before reporting success. Capturing files without text initializes the thought body from the filenames.

## Persistence and compatibility

The additive `attachments` SQLite table contains an immutable UUID, thought owner, safe basename, media type, byte length, and file bytes. Originals are not referenced and can be moved or removed after saving. Thought responses include only attachment metadata: `attachments: [{ id, name, mimeType, size }]`. Older records or clients may omit the array, which means no files. This is additive to the thought schema; it does not implement iPhone file sharing or synchronization.

Each file may be up to 20 MiB; a thought may have up to 20 files totaling 50 MiB. These limits are checked in both the interface and Rust before the transaction. A failed batch leaves no partial thought or attachments. Removal is scoped to the owning thought. Archiving retains the files.

Images with supported raster formats have thumbnails. Other files display their name and size. Opening an attachment writes a copy to the app cache and opens it in its default Mac app, only after an explicit click. Editing that external copy does not update the stored attachment. No attachment content is executed or opened automatically.

The browser preview keeps file contents with thought metadata in its local storage record, so preview writes remain atomic. It offers file download instead of opening a Mac application. Browser storage quotas may be smaller than the native limits and failures remain visible and retryable.

## Interaction

The Pet Dock grows downward to show files and keeps the thought editor focused while typing. File selection temporarily suppresses native focus-loss dismissal. Both detail modes wait for pending writes before closing or archiving. Failed additions keep their selected bytes available for Retry while the view remains open; Dismiss abandons that failed attempt without changing saved files. Capture retains selected files after a failed save. Images use data-backed previews rather than exposing general filesystem access to the webview.

## Inline screenshot documents

Pasting a screenshot into a text thought reserves its caret position and inserts an image between the surrounding text blocks. Typing continues after the image. Images remain in that order in capture, dashboard cards, and both editing views; adding a file with the picker or pasting into a checklist retains the attachment shelf. Image previews preserve aspect ratio.

Text thoughts may additionally contain `document: [{ id, type: "text", text }, { id, type: "image", attachmentId }, ...]`. The additive nullable `thoughts.document` column stores this ordered JSON; absent means the legacy body-plus-attachments layout. `body` remains a searchable plain-text projection, with image filenames as the fallback for an image-only document. Image references must resolve to raster attachments owned by the same thought; duplicate block IDs and image references are rejected. The document and new image bytes are saved together in one SQLite transaction. Editing without a document cannot flatten an existing document. Removing an inline image deletes its stored attachment atomically with the document edit. Other files are preserved.

The browser bridge uses the same validation and commits the document and file bytes in its single local-storage record. Card autosave recovery retains the document structure; a failed image import keeps its selected bytes in memory for Retry while the editor remains open. Importing does not wait for network access. This does not add cross-device attachment synchronization or a full rich-text format.
