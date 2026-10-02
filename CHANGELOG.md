# Changelog

All notable changes to Brain Cache are documented in this file.

## [Unreleased]

### Added

- Add automatic secret checks for source and Git history on pushes and pull requests, using checksum-verified Gitleaks with redacted output.
- Choose a source-only Mac preview as the first public milestone; defer Apple Developer membership, signing, notarization, and official installer distribution.
- Prepare a separate local Developer ID signing and notarization procedure with candidate verification, durable submission records, ticket checks, and synthetic safeguard tests; actual distribution signing requires maintainer credentials.
- Add Mac CI and a pinned, verified candidate-build procedure with app and DMG artifacts, checksums, source records, and safeguards against stale or overwritten output.
- License the project under MIT with the copyright holder `braincache`; preserve mobile source while keeping the first public release focused on Mac.
- Add public setup instructions, contributor guidance, GitHub issue forms, a pull request template, and a security-reporting policy.
- Open Activity from the sidebar for compact counts, a growing garden strip, and recent checklist completions. Expand More activity for full history and charts; days away never reduce garden growth.
- Set, edit, and clear whole-note reminders with local persistence and native macOS notifications.
- Complete or reopen notes, and move deleted notes into recoverable Trash.
- Edit notes with rich text, mixed paragraphs and checklists, inline images, and undo/redo while preserving existing task identities and completion history.

### Changed

- Replace the capture concept board with fictional examples generated without screenshot references, and add a synthetic plant illustration for example attachments.
- Prepare publication from a fresh source snapshot so private historical notes and personal Git identities can remain outside public history.
- Align the current app version to `0.8.0` across packaging and manifests, using three-part versions going forward; retain the historical four-part changelog entries.
- Enable a production content policy that restricts scripts and network access while supporting local attachment images and editor styling.
- Reorganize card detail into Note/Details tabs with a grouped formatting toolbar, compact tags and reminders, and shared autosave and file controls.
- Match card outlines to tag colors, keep pinned outlines yellow, and allow right-click color changes on attached tags.
- Show only non-image attachments in the Files section; insert selected images into the note document.

### Fixed

- Keep native development launch and capture working when macOS notifications require a bundled app; retain reminder intent and show an unavailable error for unbundled scheduling.
- Update Tauri to address its cross-webview IPC response access advisory (GHSA-w28w-mhc8-qvjv).

## [0.8.0.0] - 2026-09-18

### Added

- Open Settings from the sidebar or header to manage appearance, launch at login, sidebar visibility, and the capture shortcut button.
- Choose light mode and Default, Large, or Extra large text across the library and capture, with preferences saved locally across restarts.

### Changed

- Keep Settings compact with short labels, centered rows, immediate saves, and retryable errors.
- Resize capture when font size changes while preserving unfinished thoughts and selection.

## [0.7.1.0] - 2026-09-16

### Changed

- Read all dashboard note formats at a consistent 17px size, with larger text in opened notes and clearer navigation, tags, and small controls.
- Align editor sections and use consistent padding for matching buttons, reminder fields, and capture text.

### Fixed

- Keep completed checklist text readable with muted text and green checkboxes aligned to the first line.
- Fit the full checklist capture invitation and preserve text padding when inserting inline images.
- Keep reminder actions inside narrow windows and separate tag suggestions and feedback cleanly.
- Use singular wording for the first Activity milestone.

## [0.7.0.0] - 2026-09-05

### Added

- Save one shared text item or absolute web link from the iPhone Share Sheet, review or add surrounding text, and keep the capture fully offline.
- Share the app and extension's durable local archive through an App Group while preserving the existing App Intent and Lock Screen entry points.

### Fixed

- Journal each Share Sheet save before archive mutation and replay it exactly once after an interruption.
- Migrate legacy iPhone archives into coordinated shared storage without overwriting extension-first data, malformed archives, conflicting IDs, or earlier safety backups.

## [0.6.0.0] - 2026-09-03

### Added

- Start iPhone capture from an embedded iOS 17 circular Lock Screen widget that opens the strict `braincache://capture` route.
- Register the capture URL in the host app and validate every URL component before requesting editor focus.

### Fixed

- Preserve the current draft, retry identity, recovery state, and visible save error when Lock Screen capture opens a warm app.
- Keep the widget outside the persistence boundary: it displays no thought content, performs no write, and adds no App Group or authentication code.

## [0.5.0.0] - 2026-09-03

### Added

- Capture a thought from Siri, Shortcuts, or the Action button through a background-capable **Cache a Thought** App Intent.
- Publish suggested Shortcut phrases while keeping the required text input and saved confirmation available to system surfaces.

### Fixed

- Reuse the iPhone capture operation so App Intent records receive the same validation, eight-field thought contract, durable local write, readback confirmation, and single retry with stable identity.
- Return localized validation and persistence failures without claiming success, and stop retrying when the invoking task is cancelled.

## [0.4.0.0] - 2026-09-03

### Added

- Archive or restore a thought directly from its library card without opening Focus Lens, with separate accessible Open and Archive controls.
- Reverse the most recent card action through an eight-second Undo that persists the inverse change before restoring the card and its focus.

### Fixed

- Keep cards visible until local persistence succeeds, preserve filtered-grid context, and recover deterministic focus after success, failure, retry, or Undo.
- Preserve concurrent updates to other cards when a delayed archive write completes.

## [0.3.0.0] - 2026-09-03

### Added

- Reach recently used tags from a compact single-line rail above the card grid, with deterministic ordering, keyboard navigation, and a searchable **More…** picker.
- Turn a selected `#fragment` in library search into the active tag filter while preserving the rest of the text query and leaving unknown hashtags untouched.

## [0.2.1.0] - 2026-09-03

### Fixed

- Kept iPhone captures aligned with the shared thought contract by writing explicit text kind, checklist, and tag fields.
- Preserved existing five-field iPhone archives through additive decoding and verified migration on the next local save.

## [0.2.0.0] - 2026-09-03

### Added

- Added a card-first Focus Lens with an expandable Canvas Drill-In for reviewing and editing saved thoughts.
- Added reusable tag colors across capture, cards, filters, search, and detail views.
- Added structured numbered lists, bulleted lists, and actionable checklist items with keyboard continuation and exit behavior.
- Added an on-demand shortcut drawer for list, checklist, tag, and capture commands.
- Added persisted checklist reminder intent, local macOS notification scheduling, cancellation, reconciliation, and exact-item notification targeting.

### Changed

- Existing tags now remain visible as color-aware buttons in Focus Lens and Canvas so they can be attached with one click.
- Kept the compact capture surface focused by placing list discovery and reminder controls in contextual detail views.

### Fixed

- Improved disabled-save, tag-color removal, and shortcut-drawer contrast during design review.

### For contributors

- Native reminder delivery, notification selection, rescheduling, cancellation, and denied-permission recovery completed final macOS Notification Center acceptance.

## [0.1.1.0] - 2026-09-03

### Added

- Approved a minimal top tag rail with one-click recent tags, a searchable **More…** picker, and structured `#` suggestions that preserve ordinary text search.
- Approved direct Archive and Restore actions on library cards, including local-write-before-removal behavior, Undo, failure recovery, and deterministic keyboard focus.

### Changed

- Kept the shipped Focus Lens contract intact by defining direct grid archive and restore as a separate follow-on slice.

## [0.1.0.0] - 2026-09-02

### Added

- Added the Pet Dock quick-capture experience: a compact one-line companion that expands downward only as thoughts wrap or the optional tag shelf opens.
- Added active-display height limits with internal scrolling so long thoughts remain editable without the capture window leaving the usable screen.

### Changed

- Kept the thought field and save control stable through animated native-window resizing, with immediate resizing when Reduce Motion is enabled.
- Kept ordinary typing responsive by avoiding repeated native resize work until the measured capture height changes.

### Fixed

- Prevented superseded resize frames from restoring an outdated window height during rapid edits, contraction, or reveal.
- Kept tag-validation feedback inside the tag shelf and the newest text and caret visible when long thoughts reach the screen-height limit.

## [0.0.2.0] - 2026-09-02

### Added

- Approved a card-first library detail pattern: cards open in Focus Lens and can expand into Canvas Drill-In without a permanent right-side inspector.
- Approved a minimal on-demand shortcut drawer that keeps the one-line Pet Dock quiet while exposing numbered-list, bullet-list, checklist, tag, and future image-attachment commands.
- Captured durable local screenshot attachments as a decision-gated backlog item so storage limits, file handling, deletion, and sync behavior are settled before implementation.

### Changed

- Updated future tag, checklist, and reminder work to use Focus Lens and Canvas Drill-In instead of the outgoing inspector.
- Assigned `⌘⇧7` to numbered lists, `⌘⇧8` to bulleted lists, `⌘⇧9` to checklists, and `⌘?` to the shortcut drawer.

### For contributors

- Added implementation-ready BC-012 and BC-013 contracts, refined BC-003 dependencies and behavior, and recorded BC-014 as **Needs decision** rather than authorizing incomplete attachment work.

## [0.0.1.0] - 2026-09-02

### Added

- Approved the Pet Dock capture direction: a one-line upper-left popup that grows downward with wrapped text or optional controls.
- Defined an optional accessible tag-color palette and consistent color treatment across capture, cards, filters, and search.

### For contributors

- Added implementation-ready backlog slices for the adaptive Pet Dock and assignable tag colors, including acceptance evidence and scope boundaries.
