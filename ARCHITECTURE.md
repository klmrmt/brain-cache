# Brain Cache Architecture

## Product contract

Brain Cache gives one person the fastest private path from an unstructured thought to durable local storage. Capture cannot depend on network availability, an account, classification, or optional metadata.

The first critical journey is: press `⌥ Space`, type, press `⌘ Return`, see local-save confirmation, and continue working.

## Current release scope

The upcoming public release targets Mac only. The iPhone implementation and its documented contracts remain in the repository for future development, outside this release's feature and acceptance scope. Preserve existing mobile source values and schema compatibility. Device synchronization is also deferred. See [`RELEASE.md`](RELEASE.md) for the Mac release requirements.

## System shape

### Mac

- `apps/mac/src`: React UI for the library and floating capture surface.
- `apps/mac/src/bridge.ts`: the only interface between React and native commands. It also provides a browser-only fallback for visual development and tests.
- `apps/mac/src-tauri`: Tauri host for lifecycle, global shortcut, tray menu, launch at login, and SQLite.
- The library has two persistent regions: left navigation and the thought-card canvas. Selecting a card opens a modal Focus Lens above the dimmed grid; expanding it reuses the same editor state in Canvas Drill-In while keeping left navigation visible.
- The React capture panel measures the Pet Dock's content and requests its logical window height through the bridge. The Tauri host keeps the upper-left anchor fixed, clamps that height to the active display's usable bounds, owns the resize transition, and returns the applied limit so React can switch the editor or tag shelf to internal scrolling.
- The tag shelf and shortcut drawer are mutually exclusive optional regions inside that same measured Pet Dock surface. The shortcut drawer never creates a second window or backdrop, and its hidden-trigger preference is durable without changing whether shortcuts are active.
- SQLite is the Mac source of truth. Each write uses a transaction and is read back before returning success.
- Quick-capture tag suggestions and their optional colors come only from canonical tag definitions already persisted in the local SQLite database, including assignments on archived thoughts. Tagging never calls a network or account service.

### iPhone

- `apps/ios/BrainCache.xcworkspace` contains the native SwiftUI iPhone app, Lock Screen WidgetKit extension, Share Sheet extension, and focused tests. The app target opens directly to capture; it does not include a general library.
- `CaptureOperation` is independent of SwiftUI. It prepares one logical attempt by normalizing and validating the body and fixing a UUID, UTC timestamp, `archived: false`, explicit allowed source, `kind: "text"`, `checklistItems: []`, and `tags: []` before any persistence call.
- `ThoughtStore` is the injectable native persistence boundary. The current `FileThoughtStore` actor delegates to `SharedThoughtStorage`, which coordinates every archive and journal read-modify-write cycle across processes, uses atomic file replacement with data protection, and reads the exact record back before reporting success. Production entry points resolve the App Group archive under `group.com.braincache.iphone`; a missing group is a visible error, never a silent fallback to isolated private storage.
- Repeating or concurrently submitting one prepared attempt is idempotent. The same identifier with different contract fields is rejected rather than overwritten.
- The app asks the store only for its newest record to power a single read-only recovery card. This proves relaunch persistence without expanding BC-005 into an iPhone library.
- BC-006's `Cache a Thought` App Intent lives in the main application target, accepts text from Siri, Shortcuts, or an Action button workflow, and saves through `CaptureOperation` with `source: "shortcut"`. It runs without foregrounding the app, needs no network or account, and returns success only after `FileThoughtStore` reads back the local record.
- The intent retries one local persistence failure with the exact prepared attempt, preserving its UUID and UTC timestamp. Validation and persistent storage failures become localized system-surface errors rather than false success.
- BC-007's `accessoryCircular` Lock Screen widget is a trigger-only extension. It displays no thought content, accepts no text, persists nothing, and links only to `braincache://capture`; iOS owns the Lock Screen authentication boundary.
- The main app strictly validates that route and treats it as a focus request. Opening it never clears or replaces the current draft, retry identity, recovery card, or visible save error, and any eventual save continues to use `source: "iphone"`.

### iPhone system entry points

- BC-006 stays in the application target. It now reaches the coordinated App Group archive through `FileThoughtStore.applicationStore()` while preserving `source: "shortcut"`, same-attempt retry, and local read-back confirmation.
- BC-007 stays outside the persistence boundary: the widget only opens the app's allowlisted capture route, so it needs no App Group and never calls `CaptureOperation` itself.
- BC-008 is a separate Share extension target. It accepts exactly one text item or absolute web URL, loads that value into an editable review surface, and creates no durable record until the person explicitly taps Save. Optional surrounding text becomes part of that same thought.
- The Share extension calls the same `CaptureOperation` contract with the approved existing `source: "iphone"`; sharing is an iPhone-origin capture channel, not a new cross-device schema identity.
- Both the application and Share extension carry the `group.com.braincache.iphone` entitlement. The app, App Intent, and Share extension therefore converge on one coordinated local archive while the widget remains trigger-only.
- Once Share Save begins, the stable UUID, UTC timestamp, body, and source are journaled before the canonical archive is read or mutated. Any later local store access replays pending journals idempotently and removes them only after archive verification, so interruption cannot duplicate or silently discard the submitted attempt.
- The application lazily migrates its former Application Support archive on first coordinated access. Migration decodes both sources before mutation, merges non-conflicting records deterministically, fails closed on malformed data or conflicting IDs, verifies the group archive, and retires legacy bytes to a collision-safe backup without overwriting an earlier safety copy. The Share extension does not initiate legacy migration.
- iOS authenticates before following the Lock Screen widget's deep link to the auto-focused capture screen; the widget itself does not host free-form text input.

### Synchronization

Synchronization is not part of the current slice. When added, each device will save to its own local outbox first. Transport retries must never block capture or rewrite the original creation timestamp.

## Thought contract

```json
{
  "id": "UUID string",
  "body": "non-empty UTF-8 text",
  "kind": "text | checklist",
  "checklistItems": [
    {
      "id": "UUID string",
      "text": "non-empty single-line UTF-8 text",
      "completed": false,
      "reminder": {
        "scheduledFor": "UTC ISO-8601 timestamp",
        "state": "pending | scheduled | overdue | permission-denied | scheduling-failed",
        "lastError": "nullable recovery message"
      }
    }
  ],
  "createdAt": "UTC ISO-8601 timestamp",
  "archived": false,
  "source": "mac-library | mac-capture | iphone | shortcut",
  "tags": ["canonical-tag"]
}
```

- IDs are generated on the originating device.
- The Mac library supports an additive optional `pinned` boolean; an absent value means unpinned. SQLite stores it on `thoughts` with a default of `0`, and `set_thought_pinned` updates only that field in a transaction with read-back. Older databases gain the column without changing thought content, timestamps, or relations. Browser previews preserve the same flag. The React library sorts matching pinned records first, preserving the store's newest-first order within pinned and unpinned groups. Pinning is not part of the iPhone capture requirement.
- Body text is trimmed at the edges and preserves internal line breaks.
- `kind` is explicit. Existing and newly captured prose uses `text`; structured lists use `checklist`.
- Text thoughts always return `checklistItems: []`. Checklist thoughts contain 1–100 ordered items with stable UUIDs, a normalized single-line label of at most 500 Unicode scalar values, and an explicit completion bit.
- Thoughts may expose the same optional `reminder` shape for the whole note; legacy records without it have no note reminder. Note and item reminders are independent.
- Every checklist item exposes `reminder`; it is `null` unless that item has an active or recoverable one-shot reminder intent. Reminder time is stored as an absolute UTC instant. `overdue` is a read-time presentation of a previously accepted `scheduled` reminder whose instant has passed.
- For legacy checklist thoughts, `body` is a compatibility and search projection made by joining item text with newline characters in item order. The item records are authoritative. Checklist capture and replacement write the ordered items and projection in one transaction, so older readers still see useful text without flattening completion state.
- Mac Delete is reversible: the existing `archived` storage flag now represents Trash, preserving older archived notes and Restore compatibility. No content is purged.
- New source values require a schema decision because they cross the future sync boundary.
- Share Sheet captures deliberately reuse `iphone`; the approved channel does not expand the serialized source enum.
- `tags` is always present. It is an unordered semantic set of zero or more canonical tag strings; untagged and legacy thoughts use `[]`.
- A canonical tag trims surrounding Unicode whitespace and uses locale-independent Unicode lowercase. Internal whitespace and punctuation are preserved. Empty labels, labels containing line breaks or control characters, and labels longer than 32 Unicode code points (Rust scalar values) are invalid.
- Case variants share one identity: `Work`, ` work `, and `WORK` all serialize and display as `work`. Duplicate assignment is a successful no-op.

## Mac tag storage and transactions

SQLite keeps the original `thoughts` rows as the durable thought record. Tag identity and membership are additive relational data:

- `tags(name TEXT PRIMARY KEY, color TEXT NULL)` is the local vocabulary. `name` is already canonical lowercase before it crosses the storage boundary. `color` is either null or one of Graphite, Clay, Moss, Sky, Plum, and Rose; null is the neutral Graphite treatment.
- `thought_tags(thought_id, tag_name)` links thoughts to tags, enforces one relationship per pair, and uses foreign keys to both tables.
- Opening the store creates the vocabulary, join table, and lookup index inside an idempotent transaction, then additively introduces the nullable color column when migrating an older tag table. It does not alter, normalize, reorder, or rewrite an existing `thoughts` row or tag assignment. A database from the prior release therefore returns the exact same ID, body, creation timestamp, archive state, source, and tags, with existing tag colors defaulting to neutral.
- Tagged capture inserts the thought and all tag relationships in one transaction. It applies only color changes explicitly made in that capture draft, so reusing a canonical tag never overwrites its existing color by accident. Library add/remove operations change only tag relationships (plus unused vocabulary cleanup), and color changes update only the canonical tag definition. Every operation reads back its persisted result before commit and reports success only after commit.
- Removing the final assignment removes that label from the suggestion vocabulary. Assignments on archived thoughts remain valid vocabulary and remain filterable in Trash.

`apps/mac/src/bridge.ts` mirrors the same contract in browser preview mode. It safely hydrates pre-tag local-storage records to `tags: []`, canonicalizes persisted tag arrays, implements duplicate-safe add/remove, stores canonical tag colors separately, and reconciles definitions against currently assigned tags. Invalid preview-only color metadata degrades to neutral instead of making a tag unreadable. This fallback exists for interface development and focused tests; SQLite remains native truth.

Tag filtering is a React library concern. It compares canonical tag membership directly and combines as an AND constraint with All/Today/Completed/Trash and the text query. Search matches normal body text and checklist item text; it never infers a tag from either.

Tag color is presentation metadata, not thought identity. `Thought.tags` remains an unordered set of canonical strings, while the React surfaces join those strings to `TagDefinition` values. Text labels remain visible everywhere; the color dot, restrained border, and low-opacity tint are supplemental cues shared by capture, cards, Focus Lens, Canvas Drill-In, filters, and suggestions.

The relationship model deliberately keeps tags independent of the thought body and checklist payload. Checklist thoughts carry the same top-level `tags` set; tag mutations continue to touch only `thought_tags`, and tag filtering does not parse checklist text.

## Mac checklist storage and transactions

Checklist support extends the existing SQLite model without reclassifying or rewriting prior thoughts:

- `thoughts.kind` is a constrained `text | checklist` discriminator. Opening an older database adds the column with the default `text`; reopening the migrated store is idempotent.
- `checklist_items(id, thought_id, text, completed, position)` owns structured checklist state. Item IDs are stable UUIDs, the foreign key cascades with its thought, and a unique `(thought_id, position)` constraint preserves one deterministic order.
- Checklist capture inserts the thought, optional tags and tag-color changes, and every item in one transaction. Item replacement validates the complete next list, replaces its rows, updates the newline `body` projection, reads back the expanded thought, and commits before reporting success.
- Direct card toggles and Focus Lens or Canvas edits update the interface only after that persisted record returns. A failed write therefore leaves the last confirmed item order, labels, and completion state on screen.
- Plain-text body editing is limited to `kind: text`; checklist content is changed only through the structured item operation. This keeps item identity and completion from being lost through a body-only edit.

`apps/mac/src/bridge.ts` mirrors this representation in browser preview storage. Legacy preview records hydrate as text thoughts with an empty item list. Malformed checklist metadata degrades to a text record instead of fabricating structured state; valid checklist records recompute their body projection from ordered items.

## Mac task completion history

`task_completions(thought_id, item_id, completed_at)` keeps one completion per thought/item identity and is returned as `Thought.taskCompletions`. It references the thought, not the current checklist row, so deleting a finished item preserves its history. Checklist capture/replacement updates the history in the same transaction as the ordered items and body projection. A checked item inserts an ISO UTC timestamp only if no record exists; an unchecked item removes its record. Renaming, reordering, repeated saves, and archive changes preserve completion dates. Failed writes roll back both the checklist and history.

Opening an older database seeds its checked items with null dates, idempotently. Browser preview uses the same semantics in its single thought-store write and derives undated records for older previews. The separate Activity panel counts all checklist history, including archived cards, independently of search and filters. Its modal presentation leaves the underlying dashboard mounted and inert, preserves retrieval state and scroll position, and returns focus to the Activity button on close. Null dates contribute only to the total. Seven-day activity uses local calendar days; streaks include consecutive completion days ending today or yesterday, with midnight and window-focus refreshes. Milestones count total completed items, and UI rewards follow confirmed count increases, never the initial load. No analytics leaves the device.

## Mac note completion and Trash

`Thought.completed` defaults to false for legacy records. SQLite adds a checked boolean column in the existing migration transaction. `set_thought_completed` changes completion locally, then reconciles native notifications. Completing a checklist checks all remaining items and inserts only missing completion history entries. The same transaction writes cancellation tombstones for whole-note and item reminders. Reopening preserves item checks and history; adding or unchecking unfinished work clears note completion. Completed notes cannot schedule reminders until reopened. The browser bridge mirrors these rules in one local-storage write.

All thoughts and Today exclude completed notes; Completed excludes Trash. Search, tag filters, and pins work across all views. Complete and Delete wait for detail autosave and confirmed persistence before removing a card. Failures retain the note and offer retry. Delete uses the existing archive bridge as recoverable Trash, including Undo and Restore; restoring a completed note returns it to Completed.

## Mac note and checklist reminder storage and delivery

Note and checklist reminders use SQLite as a durable local outbox and Apple's UserNotifications framework as the delivery adapter:

- `thought_reminders(thought_id, item_text, scheduled_for, state, last_error)` adds one optional reminder per note without modifying existing note or checklist rows. It retains cancellation tombstones until native cancellation succeeds. A body-update trigger refreshes future notification text inside the same transaction as content edits.
- The shared scheduler reads both outboxes; a null item target represents the whole note. Notification identifiers use `brain-cache-note|thought-id|instant` for notes and preserve the existing checklist identifier format. Native set/clear commands stay behind the TypeScript bridge.
- `checklist_reminders(item_id, thought_id, item_text, scheduled_for, state, last_error)` stores one reminder intent per item. It intentionally has no foreign key to `checklist_items`, so a `cancel-pending` tombstone can survive long enough to remove a system request after its item or containing thought has changed.
- Scheduling first validates and stores the UTC instant as `pending`. Only a successful UserNotifications add callback changes it to `scheduled`; denied permission and adapter failures remain visible as recoverable local states.
- Each system request uses a deterministic identifier derived from the thought ID, item ID, and UTC millisecond instant. Rescheduling therefore adds the new request and reconciliation removes every stale identifier for that item without touching unrelated notifications.
- Completing or removing an item, clearing its reminder, or archiving its thought writes `cancel-pending` in the same local transaction as the user action. Reconciliation removes the system request before deleting the tombstone.
- Reconciliation runs at startup and when the main window regains focus. It repairs interrupted scheduling or cancellation, removes orphaned Brain Cache requests, avoids duplicates, and refreshes permission-denied state after a person returns from macOS Settings. It never asks for permission unless scheduling was explicitly requested.
- Selecting a delivered notification stores its thought/item target, reveals the main window, and emits `reminder-opened`. React loads fresh thoughts, opens Focus Lens for that thought, and focuses the note body or exact checklist item; a pending-target command covers cold launch before the listener mounts.
- Notification content stays on-device. The body uses the checklist item text, while macOS owns lock-screen and preview visibility.

The browser fallback mirrors validation and visible reminder states in local storage for interface development and focused tests. It does not claim to deliver a native notification.

## Mac capture commands and preferences

Numbered and bulleted lists remain plain `text` thoughts. Their markers are body formatting only, so toggling `⌘⇧7` or `⌘⇧8`, continuing with Return, and exiting from an empty item do not add another persisted thought kind. `⌘⇧9` continues to toggle the structured `checklist` contract above.

The Tauri application menu and capture-panel keyboard handlers converge on the same React capture commands through `apps/mac/src/bridge.ts`. Native menu items reveal the capture window and emit a command event; they do not implement a parallel formatting or tagging path. The bridge mirrors those events with browser custom events for focused interface tests.

`preferences(key TEXT PRIMARY KEY, enabled INTEGER)` stores local boolean Mac preferences independently from thought data. The shortcut-button visibility key defaults to visible, is upserted transactionally, and is read back before success. Hiding the trigger does not unregister any shortcut. `⌘?` remains available in React, while **View → Show Shortcut Button** persists the restored preference natively and notifies the mounted capture panel.

## Mac thought editing and detail state

Text-thought body edits cross the same `apps/mac/src/bridge.ts` boundary as capture, archive, tag, and checklist mutations. The native `update_thought_body` command normalizes and validates the new body, requires `kind: text`, updates only that field inside a SQLite transaction, reads back the complete expanded `Thought`, and commits before returning success. ID, creation timestamp, archive state, source, and tags remain unchanged. Browser preview mode mirrors that contract in local storage for interface development and focused tests.

Focus Lens and Canvas Drill-In are two presentations of one mounted detail editor. Expanding therefore preserves the unsaved body or checklist-item draft, tag editor state, and keyboard focus instead of recreating the form. Opening detail records the originating card and grid scroll offset; closing or navigating Back restores the prior collection filter, text query, tag filter, scroll position, selected card, and keyboard focus. If an edit or archive removes the selected card from the current result set, restoration chooses the correct remaining card or falls back to search when the result is empty.

Card-grid Delete and Restore reuse the same `setThoughtArchived` bridge boundary without opening detail. React keeps the card in place until the returned `Thought` confirms the local write, then replaces only that record so concurrent changes to other cards survive. The eight-second Undo performs the inverse persisted write before returning the card. Success, failure, retry, and Undo preserve the active filters and scroll offset while moving keyboard focus deterministically to the next card, previous card, empty-state heading, or restored card.

## Current non-goals

- Accounts, collaboration, SMS providers, AI classification, and cloud-only storage.
- Free-form keyboard entry inside a locked iPhone widget.
- A shared cross-platform UI framework for the iPhone extension.

## Vertical slices

1. Mac walking skeleton: summon Blob, capture to SQLite, browse, search, archive, and relaunch without losing data.
2. Native iPhone capture door: focused capture scene, durable app-local persistence, and relaunch recovery.
3. Native App Intent capture door: background text capture from Siri, Shortcuts, and Action button workflows through the shared capture operation.
4. Native Lock Screen capture door: an authenticated, trigger-only WidgetKit surface deep-links into focused app capture without crossing the persistence boundary.
5. Native Share Sheet capture door: explicit-Save text or URL review, journal-first `source: "iphone"` persistence, coordinated App Group storage, and conflict-safe legacy migration.
6. Private device sync: idempotent transfer, retry, conflict rules, and visible sync state without blocking capture.

## Mac rich text documents

Mac notes optionally carry `richDocument`, a validated Tiptap/ProseMirror JSON document stored in the additive nullable `thoughts.rich_document` column. It supports paragraphs, three heading levels, blockquotes, bullet/ordered/task lists, horizontal rules, hard breaks, bold/italic/underline/strike/code marks, and local attachment-backed images. The original text/checklist and ordered image-block formats load into the editor without rewriting storage until an edit. Capture stays lightweight and loads independently of the library editor bundle.

`update_rich_document` commits document JSON, searchable plain `body`, projected checklist rows, completion history, and new attachment bytes together. Task nodes carry stable UUIDs; split/pasted rows receive fresh IDs. Empty task rows remain in the document without becoming reminder targets. A note with nonempty tasks has `kind: checklist`; mixed paragraph text remains in its body projection. Removed completed tasks retain history, including when the last task becomes prose. Grid checkbox and whole-note completion commands update the matching document attributes in the same transaction. Legacy editing commands reject changes that would discard a rich document.

Images reference owned attachment IDs, never arbitrary URLs. Removing an image from the document retains its bytes for Undo. Note detail filters image MIME types out of the Files shelf without deleting their stored bytes. New image selections from Add files are saved atomically with image blocks in the editor; mixed selections leave non-image attachments in Files. Validators bound document size/depth, reject unsupported node/mark types and duplicate task identities, and roll back attachment writes if validation fails. Editor transactions preserve cursor position during autosave, and mapped selection bookmarks preserve image insertion positions while files are read. Browser preview mirrors the native storage contract.

### Familiar card editor layout

Focus Lens and Canvas Drill-In share Note/Details tabs. The rich editor stays mounted when Details is selected, preserving the Tiptap document, selection, undo history, and pending attachment work. Both views share one AttachmentArea queue and the same autosave/progress status. Reminder notifications activate the Note tab before focusing the requested document or checklist item. The compact note-reminder editor uses a viewport-positioned portal with contained keyboard focus; Details and item reminders retain the full inline editor. These are interface changes over the existing local persistence and native reminder contracts.
