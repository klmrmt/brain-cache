# Brain Cache Feature Backlog

This is the durable handoff between product decisions and the agent workflow. It describes user-visible outcomes, not an implementation checklist.

## Current release focus

The upcoming public release is Mac only; see [`RELEASE.md`](RELEASE.md). Mobile code and its completed implementation records are retained, but mobile features and BC-009 synchronization are deferred from this release. Existing **Shipped** records below describe historical implementation evidence, not availability in a public download. Do not delete mobile code or change its serialized contracts as part of this scope reduction.

## Product guardrails

- The job is to move a thought into durable local storage as quickly as possible.
- Capture must work without a network connection, account, classification step, or optional metadata.
- Tagging is optional and must never add a required step to capture.
- Checklist creation is optional and must not complicate ordinary thought capture.
- Shortcut help is optional. Hiding its visual affordance must never disable the commands themselves.
- Attachments must be copied into durable app-managed local storage before the app reports success; a source-file reference is not a stored attachment.
- Reminder notifications are opt-in and must not make saving a thought or checklist depend on notification permission.
- Persist on the originating device before any synchronization begins.
- Preserve the thought contract in `ARCHITECTURE.md`. Treat new `source` values as schema decisions.
- Follow `DESIGN.md` for every visual or interaction decision.
- Do not add accounts, collaboration, AI classification, cloud-only storage, or locked-screen free-form text entry unless the product contract is explicitly changed.

## Status vocabulary

- **Shipped** — implemented and verified through the real product path.
- **Ready** — sufficiently decided for an agent to implement without product clarification.
- **Needs decision** — valuable, but a named product choice blocks implementation.
- **Idea** — captured for later shaping; not authorized for implementation.

## Shipped baseline — do not rebuild

The current product already provides:

- `⌥ Space` global quick capture with focused text entry.
- `⌘ Return` local save with confirmation before the capture panel closes.
- Tauri/React application backed by local SQLite storage.
- Library browsing, text search, Today and Archive filters, and archive/restore.
- Menu-bar access, launch-at-login, and single-instance behavior.
- Browser fallback for interface development and focused tests.
- Compact, upper-left Mac quick capture with one rounded transparent surface.
- Optional keyboard-native tags, tag editing, and persistent tag filtering on Mac.
- Native iPhone capture with durable coordinated App Group persistence, retry safety, relaunch recovery, a background-capable **Cache a Thought** App Intent, a trigger-only Lock Screen widget, and a Share Sheet extension for one reviewed text item or absolute web link. Share saves use `source: "iphone"`, journal the explicit Save before archive mutation, and remain fully offline.

Before changing this baseline, reproduce a defect or connect the work to a Ready feature below.

## Agent-ready queue

Work top to bottom. Finish and verify one feature before beginning the next.

### BC-001 — Compact top-left Mac capture

- **Status:** Shipped
- **Priority:** P0
- **Outcome:** When a person summons Blob, the capture popup feels like a small companion in the upper-left rather than a large centered window, and only the intended rounded panel is visible.

**In scope**

- Position the capture window near the upper-left of the currently active display, inset from the macOS menu bar and usable screen edges.
- Reduce the native capture window from its current `560 × 220` size and tighten the contents proportionally while preserving legible 14 pt thought text and comfortable controls.
- Keep Blob visible at a smaller scale appropriate to the reduced panel.
- Render one rounded capture surface with transparent native window chrome outside it.
- Remove the visible secondary black rectangle behind or around the rounded panel.
- Preserve the 14 pt floating-panel corner radius and ensure the corners and shadow are not clipped.
- Preserve autofocus, `⌘ Return` save, local save/error status, `Escape` dismissal, and the existing offline persistence contract.

**Non-goals**

- Redesigning Blob's character, changing capture persistence, or adding new thought fields.
- Moving the main library window or changing its three-pane layout.

**Acceptance evidence**

- Invoke `⌥ Space` on a Mac and confirm the popup is fully visible near the upper-left of the active display rather than centered.
- Repeat on each display in a multi-monitor setup; the popup follows the display where the person is working and respects its usable bounds.
- The native capture window is smaller in both width and height than `560 × 220`.
- Native screenshots show exactly one rounded surface, transparent pixels outside its corners, and no rectangular black backdrop.
- Type immediately, save with `⌘ Return`, observe local confirmation, reopen, and dismiss with `Escape` without regressions.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-02**

- **Commit:** `2534a55` (private development evidence) via PR #2.
- **Walking path:** Invoked the native popup with `⌥ Space`, verified the compact upper-left single-surface presentation, typed immediately, saved locally, reopened, and dismissed without regressing focus or keyboard behavior.
- **Verification:** 12 React tests, the production bundle, 17 Rust tests, formatting checks, and a real Tauri macOS app bundle passed.
- **Follow-ups or limitations:** No open in-scope P0–P2 findings.

### BC-002 — Quick tagging and retrieval

- **Status:** Shipped
- **Priority:** P1
- **Outcome:** A person can attach a short label to a thought in a few keystrokes and use that label to find related thoughts later, without slowing down untagged capture.

**In scope**

- Add structured tags to the thought contract and migrate existing local records safely with no tags by default.
- Provide a keyboard-native path to add one or more tags during quick capture without moving focus away from the thought until the person explicitly invokes tagging.
- Allow tags to be added to or removed from the selected thought in the Mac library.
- Suggest existing tags as the person types and allow a new tag to be created without leaving the current surface.
- Treat tag identity case-insensitively, trim surrounding whitespace, reject empty tags, and prevent duplicates on one thought.
- Show attached tags on the thought card and in the inspector without overpowering the thought body.
- Support filtering or searching the library by tag and make the active tag filter obvious and easy to clear.
- Keep tag writes local-first and transactional with the thought update.
- Update `ARCHITECTURE.md` and every Mac TypeScript/Rust representation so the expanded contract is explicit before later iPhone or sync work begins.

**Non-goals**

- Required tags, nested tag hierarchies, tag colors, AI-generated tags, or a standalone tag-management screen.
- Replacing full-text search or automatically removing tag-like text from the thought body.

**Acceptance evidence**

- From `⌥ Space`, type a thought, invoke tagging from the keyboard, choose or create a tag, and save without using the pointer.
- Save another thought without invoking tagging and confirm the original capture path has no additional required interaction.
- In the library, add and remove a tag from an existing thought without changing its body or creation timestamp.
- Filter by a tag and see all and only thoughts carrying that tag; clear the filter and return to the prior library view.
- Restart the app and confirm tag assignments and tag filtering persist offline.
- Migrate a database created by the current release without losing or rewriting existing thoughts.
- Focused tests cover normalization, case-insensitive reuse, duplicate prevention, add/remove, filtering, persistence, and migration.
- Automated gates are green: 44 React tests, the production bundle, and 11 Rust tests all pass; a real Tauri build produced both the Mac app and DMG.
- The legacy SQLite migration is additive and preserves existing thought fields; applying it again on reopen is idempotent.
- Packaged-native QA passed the `⌥ Space` keyboard tagging and save journey, offline reopen, persisted tag filtering, and unchanged normal-database path.
- Both QA-discovered P2 regressions were fixed and retested; final QA reports zero open P0–P2 issues.

**Completion record — 2026-09-02**

- **Commit:** `4df0ca4` (private development evidence) via PR #3.
- **Walking path:** Added tags from quick capture using the keyboard, saved an untagged thought through the unchanged path, edited tags in the library, filtered by tag, and verified offline persistence after reopen.
- **Verification:** The final BC-001/BC-002 integration passed 49 React tests, 25 Rust tests, TypeScript, the Vite production bundle, formatting checks, a real Tauri app bundle, and a focused keyboard/visual pass.
- **Follow-ups or limitations:** Apple notarization was not attempted because release credentials are not configured; it is outside this feature's acceptance gate.

### BC-010 — Pet Dock adaptive capture

- **Status:** Shipped
- **Priority:** P0
- **Depends on:** BC-001, BC-002
- **Outcome:** Summoning Brain Cache reveals a one-line companion-sized capture dock that occupies only the space it needs, then expands downward when the thought or optional controls need more room.
- **Approved design:** Direction C, **Pet Dock**, documented in `docs/design/compact-capture-pet-dock.md`.

**In scope**

- Replace the current capture card layout with the approved Pet Dock composition: a roughly `455 × 50` logical-pixel resting frame, a roughly 38 pt Blob badge docked slightly over the left edge, one line of thought text, and a compact Return-key save affordance.
- Size the native capture window and its rounded surface to one text line at rest; grow both downward as the text wraps rather than reserving empty rows in advance.
- Keep the input focused and controls stable while the window grows. Constrain the maximum expanded height to the active screen's usable bounds and provide an internal scroll path only after those bounds are reached.
- Reveal tags in a slim shelf below the input only when tagging is invoked. Closing the shelf returns the popup to the smallest height its current text allows.
- Preserve the existing upper-left active-display positioning, 14 pt panel radius, transparent native chrome, and single-surface presentation with no secondary black rectangle.
- Preserve `⌘ Return` save, local saved/error feedback, `Escape` dismissal, keyboard tagging, and offline-first persistence.
- Respect Reduce Motion and keep resize transitions within the existing 120–180 ms motion budget without delaying typing or saving.

**Non-goals**

- Changing Blob's character design, moving the main library, or adding required metadata.
- Reworking tag storage or color assignment; optional tag colors are the separate BC-011 slice.

**Acceptance evidence**

- Invoke `⌥ Space` and confirm the resting popup contains one text line with no preallocated multiline or tag area.
- Type enough text to wrap across several lines and confirm the rounded surface and native window grow downward without losing focus, clipping corners, or leaving a second backdrop.
- Delete back to one line and confirm the popup contracts to its resting height.
- Open and close the tag shelf entirely from the keyboard and confirm the popup grows and contracts around it.
- Repeat near the usable bottom edge and on multiple displays; the expanded popup stays on the active screen.
- Save with both `Return` affordance and `⌘ Return`, reopen, and dismiss with `Escape` without regressing local persistence.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-02**

- **Commit:** `b39ec09` (private development evidence) on `feature/bc-010-pet-dock`.
- **Walking path:** Invoked the native Pet Dock, verified the one-line resting state, downward wrap growth and contraction, keyboard tag-shelf growth and dismissal, active-display height limits with internal scrolling, local save and reopen, and layered `Escape` behavior.
- **Verification:** 66 React tests, the production bundle, 30 Rust tests, formatting and lint checks, a real Tauri macOS app bundle, and packaged-native QA all passed. Acceptance-path coverage reached 27 of 30 paths (90%).
- **Follow-ups or limitations:** Apple notarization was not attempted because release credentials are not configured; it is outside this feature's acceptance gate. Final QA found no open in-scope P0–P2 issues.

### BC-011 — Assignable tag colors

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-002, BC-012
- **Outcome:** A person can give a tag a quiet, recognizable color and see that identity consistently wherever the tag appears.
- **Approved design:** Optional color metadata using the palette and restrained treatment in `DESIGN.md` and `docs/design/compact-capture-pet-dock.md`.

**In scope**

- Add one optional color assignment to each canonical tag, with Graphite as the neutral default and a path to remove an assigned color.
- Offer a compact, keyboard-accessible swatch picker when a person creates or edits a tag; color choice must never be required to create the tag or save a thought.
- Provide the approved Graphite, Clay, Moss, Sky, Plum, and Rose palette. Do not offer Signal amber, Saved green, or Error red as ordinary tag colors.
- Render color as a small dot, border, and low-opacity tint rather than a saturated filled chip, while preserving accessible text and focus contrast.
- Reuse the canonical tag color in quick capture, thought cards, Focus Lens, Canvas Drill-In, tag filters, suggestions, and search results.
- Persist color locally with the tag definition and migrate existing tags safely to the neutral default without rewriting thought assignments.
- Define color behavior when case-insensitive duplicate tag names are merged or reused; the existing canonical tag keeps its color unless the person explicitly changes it.

**Non-goals**

- Arbitrary color pickers, gradients, per-thought colors for the same tag, automatic color assignment, or using color as the only way to identify a tag.
- Required tags or any change that adds a step to ordinary capture.

**Acceptance evidence**

- Create a tag without choosing a color and save normally; it uses the neutral treatment and adds no required interaction.
- Assign each palette color using keyboard and pointer controls, then remove the color and return to neutral.
- Reuse a colored tag in quick capture and confirm the same color appears on the saved card, Focus Lens, Canvas Drill-In, active filter, suggestions, and search results after relaunch.
- Change a tag's color and confirm every existing assignment updates without altering thought bodies, creation timestamps, or tag identity.
- Migrate a database containing existing tags and confirm assignments remain intact with a neutral color default.
- Verify every tag remains distinguishable by text with color perception disabled or reduced, and all chip/focus combinations meet contrast requirements.
- Focused tests cover palette validation, default/removal, canonical reuse, duplicate handling, persistence, migration, and rendering across tag surfaces.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-02**

- **Commits:** `ead4cc7` implements canonical tag colors; `1ec78ae` applies the verified design-review copy fix on `feature/bc-011-tag-colors`.
- **Walking path:** Created a neutral tag without an extra step, assigned and removed colors with keyboard and pointer controls, changed an existing canonical tag, saved a newly colored tag from quick capture, and verified the same identity across cards, Focus Lens, Canvas Drill-In, suggestions, and filtering.
- **Verification:** 85 React tests, the TypeScript/Vite production bundle, 34 Rust tests, formatting, strict Clippy, a real ad-hoc-signed Tauri macOS app bundle, and browser interaction/design passes all passed. The legacy tag-table migration preserved assignments as neutral, and browser QA reported no console or request failures.
- **Design review:** One medium interaction/content issue was fixed so the neutral action reads **Remove color** instead of appearing to be a seventh palette choice. Final design score and AI-slop score are both A.
- **Follow-ups or limitations:** Apple notarization was not attempted because release credentials are not configured; it remains outside this feature's acceptance gate. The color controls are optimized for a keyboard-and-pointer native Mac interface rather than touch input.

### BC-012 — Card-first Focus Lens and Canvas Drill-In

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-002
- **Outcome:** A person can read or edit a selected card without permanently giving a third of the library to an inspector, then expand into a full working canvas only when needed.
- **Approved design:** Focus Lens by default with Canvas Drill-In on demand, documented in `docs/design/card-detail-focus-lens.md`.

**In scope**

- Remove the permanent right-side inspector so the library keeps two persistent regions: left navigation and the thought-card canvas.
- Open a selected card in a card-shaped Focus Lens above the dimmed grid, preserving the visible library as context.
- Include the full thought, tags, essential metadata, archive and close actions, and an obvious Expand control in Focus Lens. Checklist content uses the same surface after BC-003 ships.
- Expand the same card into Canvas Drill-In while keeping left navigation in place and preserving current edits, selection, and focus.
- Return from either detail state to the exact prior filter, query, grid scroll position, selected card, and keyboard focus.
- Keep long content inside the active display bounds and introduce internal scrolling only after those bounds are reached.
- Preserve local-first writes, archive behavior, tag filtering, search, and keyboard access throughout both detail states.

**Non-goals**

- A permanent replacement inspector, a third persistent application region, multiple stacked card-detail overlays, or a separate editor window.
- Changing the thought schema, adding attachments, or redesigning the left navigation.

**Acceptance evidence**

- Select a card by pointer and keyboard; each path opens one Focus Lens over the dimmed grid without changing the current query or scroll position.
- Read and edit a long thought and its tags in Focus Lens, then expand the same card into Canvas Drill-In without losing unsaved UI state or focus context.
- Close Focus Lens and navigate Back from Canvas Drill-In; both paths restore the exact prior card, grid position, filter, search query, and keyboard focus.
- Archive the selected thought from each detail state and confirm the library returns to the correct remaining card without an empty inspector region.
- Exercise long content and a small usable screen; the detail surface remains reachable and scrolls internally only when required.
- Focused tests cover pointer and keyboard entry, layer dismissal, expansion, state transfer, archive, and restoration of selection, scroll, query, and focus.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-02**

- **Commits:** `56b2630` implements the feature; `30ccee6` applies the verified design-review polish on `feature/bc-012-focus-lens`.
- **Walking path:** Opened cards by pointer and keyboard, edited and saved body text and tags in Focus Lens, expanded the same draft into Canvas Drill-In without losing focus, restored query/tag/selection context on return, archived from Canvas into an empty filtered result, and exercised long content at `800 × 600`.
- **Verification:** 77 React tests, the TypeScript/Vite production bundle, 31 Rust tests, formatting, strict Clippy, a real ad-hoc-signed Tauri macOS app bundle, and a browser interaction/design pass all passed with no console or request failures.
- **Design review:** One medium visual-hierarchy issue was fixed so the disabled Save Changes action no longer dominates an unchanged thought. Scoped design score improved from B to A; AI-slop score remained A.
- **Follow-ups or limitations:** Apple notarization was not attempted because release credentials are not configured; it remains outside the feature acceptance gate. The `375px` browser viewport clips horizontally, but BrainCache is a native macOS app and the supported constrained-desktop path was verified separately.

### BC-003 — Quick checklist cards

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-002, BC-012
- **Outcome:** A person can quickly capture a small to-do list, see its items directly on the thought card, and check items off without opening a separate task manager.

**In scope**

- Add an optional checklist form of thought while leaving plain-text thoughts unchanged.
- Use `⌘⇧9` as the keyboard-native way to enter or toggle checklist mode from quick capture, create one item per line, move between items, and save the whole list without using the pointer.
- Render checklist items as accessible interactive checkboxes directly on library cards.
- Save each completion change locally before reflecting success and preserve the thought's original creation timestamp.
- Keep completed items visible but visually quieter; show compact progress on the card when the full list cannot fit.
- Allow a person to add, rename, remove, and reorder checklist items from Focus Lens and Canvas Drill-In using both keyboard and pointer controls.
- Preserve checklist item order and completion state across archive/restore, search, tag filtering, and application relaunch.
- Define and document a durable checklist representation in the shared thought contract before iPhone and sync work begins.
- Migrate existing databases safely so every current thought remains an ordinary text thought.

**Non-goals**

- Due dates, recurring tasks, priorities, subtasks, assignments, calendars, or a dedicated task-management view. Local reminder notifications are a separate slice in BC-004.
- Automatically converting normal prose into a checklist or hiding completed items by default.

**Acceptance evidence**

- From `⌥ Space`, enter checklist mode from the keyboard, type at least three items, and save without using the pointer.
- The saved thought appears as a checklist card; toggle an item directly on the card and confirm the state survives relaunch.
- Add, rename, reorder, and remove items in Focus Lens and Canvas Drill-In without recreating the list or changing its original creation timestamp.
- Navigate and toggle every visible checklist item with the keyboard and verify its accessible name and checked state.
- Search by checklist-item text, combine a checklist with a tag, then archive and restore it without losing order or completion state.
- Save a normal thought and confirm its original quick-capture path, card rendering, and persistence remain unchanged.
- Migrate a database created by the current release without losing or reclassifying existing thoughts.
- Focused tests cover creation, validation, item mutations, ordering, completion, filtering/search, persistence, and migration.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-02**

- **Commit:** `85a8564` implements the feature on `feature/bc-003-checklists`.
- **Walking path:** Entered checklist mode from compact capture with `⌘⇧9`, saved four tagged items, toggled items directly on the card, added/renamed/reordered/removed items in Focus Lens, expanded the same editor into Canvas, searched by hidden item text, combined the result with a tag filter, archived/restored it, and reloaded with order and completion intact.
- **Verification:** 94 React tests, the TypeScript/Vite production bundle, 36 Rust tests, formatting, strict Clippy, a real ad-hoc-signed Tauri macOS app bundle, `codesign --verify --deep --strict`, and browser interaction QA all passed with no console errors.
- **Design review:** No actionable issues. The checklist card, Focus Lens, Canvas, compact capture, constrained window, and keyboard-focus states all scored A; AI-slop score remained A.
- **Follow-ups or limitations:** Apple notarization was not attempted because release credentials are not configured; it remains outside this feature's acceptance gate. Due dates and notifications remain intentionally reserved for BC-004.

### BC-013 — Minimal shortcut drawer and list hotkeys

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-003, BC-010
- **Outcome:** A person can create numbered, bulleted, or actionable lists from the keyboard and can discover the commands without turning the compact Pet Dock into a toolbar.
- **Approved design:** Direction C, minimal on-demand shortcut drawer, documented in `docs/design/shortcut-hints-minimal-c.md`.

**In scope**

- Support `⌘⇧7` for numbered lists, `⌘⇧8` for bulleted lists, and `⌘⇧9` for the structured checklist mode owned by BC-003.
- Toggle numbered or bulleted formatting on the current or selected lines. `Return` continues the list, and `Return` on an empty item exits it.
- Add one small borderless `⌘` glyph to the resting Pet Dock near the save affordance. Keep it quiet at rest and visible on hover or keyboard focus.
- Expand the same rounded Pet Dock downward into a compact shortcut drawer when the glyph or `⌘?` is invoked; never open a detached secondary box.
- Show the highest-value available capture commands for lists and tags while leaving the existing `⌘ Return` hint on the save affordance. Reserve `⌘⇧A` for image attachment, but do not show or activate it until BC-014 ships.
- Let the person hide the `⌘` glyph without disabling shortcuts, persist that preference locally, and restore it through **View → Show Shortcut Button**.
- Keep `⌘?` available as an unconditional recovery path and expose the commands in native menus with accessible names and `aria-keyshortcuts` where applicable.
- Preserve immediate typing, local-first save, adaptive Pet Dock sizing, Reduce Motion behavior, and ordinary unformatted capture.

**Non-goals**

- A persistent formatting toolbar, inline teaching strip, onboarding tour, arbitrary rich-text editor, nested lists, or subtasks.
- Remapping the system screenshot commands or making shortcut discovery a prerequisite for capture.
- Implementing attachment storage; BC-014 owns that separate capability.

**Acceptance evidence**

- From the focused Pet Dock, use `⌘⇧7`, `⌘⇧8`, and `⌘⇧9` to create each list type without using the pointer; verify continuation and empty-line exit behavior.
- Select multiple lines and toggle numbered or bulleted formatting without losing text, ordering, or focus.
- Open the drawer with both the `⌘` glyph and `⌘?`; it grows the existing surface downward and closes back to the minimum current height without a second backdrop.
- Hide the glyph, relaunch, and confirm it remains hidden while every command and `⌘?` still works; restore it from the View menu.
- Navigate the glyph and drawer entirely by keyboard and verify visible focus, accessible names, and shortcut metadata.
- Save an ordinary thought without invoking formatting or help and confirm the current number of required capture actions and local persistence behavior are unchanged.
- Focused tests cover list toggling, selected lines, continuation/exit, drawer open/close, hidden preference persistence, recovery, native menu wiring, and accessibility.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-02**

- **Commits:** `c67ecb4` implements the feature and `f95ee41` contains the verified design-review fix on `feature/bc-013-shortcut-drawer`.
- **Walking path:** Opened the drawer from both the `⌘` glyph and `⌘?`, formatted selected lines as numbered and bulleted lists, continued a list with Return, exited from an empty marker, toggled structured checklist mode, opened tags, traversed the drawer by keyboard, hid the glyph, recovered the drawer while hidden, restored the glyph through the native visibility event path, and saved an ordinary thought through the unchanged local path.
- **Verification:** 101 React tests, the TypeScript/Vite production bundle, 38 Rust tests, formatting, strict Clippy, browser interaction QA, a real ad-hoc-signed Tauri macOS app and DMG, `codesign --verify --deep --strict`, and packaged-executable startup all passed. The live browser pass reported no console errors.
- **Design review:** One polish finding raised the tiny drawer utility labels from 3.20:1 to 5.71:1 contrast using the existing muted token. The final design score and AI-slop score are both A; the persistent audit is under `designs/design-audit-20260902-bc013/` in the gstack project data.
- **Follow-ups or limitations:** Apple notarization was not attempted because release credentials are not configured; it remains outside this feature's acceptance gate. Image attachment remains intentionally absent until BC-014 ships.

### BC-015 — Top tag rail and unified tag search

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-002, BC-011, BC-012
- **Outcome:** A person can reach frequently used tags from the top of the card canvas and combine one tag with a text search without opening a hidden picker first.
- **Approved design:** Minimal single-line tag rail and `#` search suggestions, documented in `docs/design/top-tag-rail.md`.

**In scope**

- Place one slim horizontal tag rail directly below the always-visible search field and above the results announcement and card grid.
- Show **All**, up to eight recently used tags, and **More…**. Derive recency from the newest non-archived thought carrying each tag, de-duplicate canonical tags, and break ties by canonical name so the order is deterministic without a new tracking field or filter-dependent reshuffling.
- Keep the active tag visible even when it falls outside the recent set. Selecting **All** or the active tag clears the filter.
- Support one active tag in the first release. Clicking a tag or activating it with `Enter` or `Space` replaces the current tag while preserving the text query.
- When a person types a `#fragment` at the start of the query or immediately after whitespace, suggest canonical tags case-insensitively. Do not trigger inside text such as `C#`.
- Only choosing a suggestion creates the structured tag filter. Remove that active fragment from the body query, preserve all other query text, and leave unknown or unselected hashtags as ordinary searchable text.
- Let **More…** open the existing searchable tag picker with keyboard focus in its search field. After applying a tag, focus its selected rail control; after dismissing without a selection, return focus to **More…**.
- Reuse each canonical tag's restrained color treatment while keeping its text label visible so color is never the only identifier.
- Preserve the text query, active tag, card selection, grid scroll position, and keyboard focus while opening and closing Focus Lens or Canvas Drill-In.
- Scroll the rail horizontally on narrow windows instead of wrapping it into multiple rows or pushing the cards downward.
- When no tags exist, omit the empty rail and retain the compact existing tag entry point.

**Non-goals**

- Multi-tag AND/OR filtering, pinned or manually reordered tags, a standalone tag-management screen, required tagging, or AI-generated tags.
- Persisting tag-filter state across application relaunch in this slice.

**Acceptance evidence**

- With more than eight tags, confirm **All**, the deterministic recent set, the active tag, and **More…** remain reachable without wrapping the rail.
- Select and clear a tag with pointer and keyboard controls; the card results and active state update without losing the current text query.
- Type `#`, choose a case-insensitive suggestion, and confirm it becomes the single structured tag filter while the remaining text continues to search within that tag.
- Type an unknown hashtag and confirm it remains ordinary text; choose another known tag and confirm it replaces rather than stacks with the first.
- Open **More…**, search for a tag, apply it, and confirm focus lands on the selected tag; dismiss without a selection and confirm focus returns to **More…**.
- Open and close Focus Lens and Canvas Drill-In, then confirm query, tag, card selection, grid position, and focus are restored.
- Exercise a narrow window and a database with no tags; the rail never wraps or adds an empty row, and ordinary search and capture remain unchanged.
- Focused tests cover ordering, active-tag retention, filtering, `#` suggestions, picker handoff, empty state, overflow, and keyboard accessibility.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-03**

- **Commit:** `2558fbb` implements the feature on `codex/bc-015-tag-rail`, stacked after the iOS contract prerequisite in PR #12.
- **Walking path:** Filtered with the recent-tag rail and structured `#` suggestions, replaced and cleared the active tag without losing the text query, exercised the searchable **More…** picker, returned through Focus Lens and Canvas, and verified the no-tag and narrow single-row states.
- **Verification:** 126 React tests, the TypeScript/Vite production bundle, 50 Rust tests, formatting, strict Clippy, a real ad-hoc-signed Tauri macOS app and DMG, and headless interaction QA at normal and narrow widths all passed with no console errors.
- **Design review:** The rail follows the approved compact hierarchy, canonical color treatment, horizontal overflow, and visible keyboard focus contract; no actionable pre-landing design issues were found.
- **Follow-ups or limitations:** Six lower-risk coverage gaps remain around the exhaustive keyboard matrix, suggestion dismissal variants, and automated narrow-layout assertions; the assessed coverage gate passed at 86% and the narrow layout was verified manually.

### BC-016 — Direct card-grid archive and restore

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-012
- **Outcome:** A person can archive or restore a thought while scanning the multi-card grid without opening its detail surface first.
- **Approved design:** Quiet card-corner action documented in `docs/design/card-detail-focus-lens.md`.

**In scope**

- Reveal a quiet Archive control in a consistent card corner on pointer hover and whenever the card receives keyboard focus.
- Keep Open and Archive as distinct accessible actions without nesting one interactive control inside another or covering thought text, checklist controls, or tags.
- Persist the archive change locally before removing the card from the current grid, then show a brief Undo action that restores the same thought to the current filtered result set when applicable.
- If the local write fails, keep the card visible, preserve focus, and show an actionable error.
- In the Archive grid, use the same card action and position for Restore.
- Preserve the current search, tag filter, and scroll position when a card leaves the grid. Focus the card that moves into the removed card's index, otherwise the previous card, otherwise the grid's empty-state heading. Undo restores focus to the returned card.

**Non-goals**

- Selecting and bulk-archiving multiple cards, swipe gestures, destructive deletion, or changing archive storage semantics.

**Acceptance evidence**

- Archive a card from the grid using pointer and keyboard without opening Focus Lens; confirm it disappears only after the local write succeeds.
- Invoke Undo and confirm the thought returns to the correct filtered result set without resetting query, tag, or scroll state.
- Force an archive failure and confirm the card stays visible, focus is preserved, and the error offers a recovery path.
- Repeat from Archive and confirm the same control restores the card while preserving the surrounding grid context and deterministic focus order.
- Navigate a card containing checklist controls and tags entirely by keyboard; Open, Archive or Restore, and each inline control have distinct accessible names and focus targets.
- Focused tests cover hover and focus disclosure, pointer and keyboard activation, success ordering, failure, Undo, restore, empty-result behavior, and focus recovery.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-03**

- **Commit:** `c89108b` implements the feature on `codex/bc-016-card-archive`, stacked after the top tag rail in PR #13.
- **Walking path:** Archived and restored cards directly from active and Archive grids, exercised delayed and failed local writes with retry, reversed each action with Undo, and verified focus, query, tag-filter, and scroll recovery through empty and populated result states.
- **Verification:** 133 React tests, the TypeScript/Vite production bundle, 50 Rust tests, formatting, strict Clippy, a real ad-hoc-signed Tauri macOS app and DMG, and browser interaction walks at normal and narrow widths all passed without console errors.
- **Design review:** The quiet corner action remains separate from Open, tags, and checklist controls; hover and focus disclosure, visible busy state, restrained feedback, and compact narrow-window placement match the approved card-detail design.
- **Follow-ups or limitations:** Five lower-risk coverage clusters remain around fake-timer expiry, same-card concurrency guards, filtered Undo fallback, assistive-technology announcement behavior, and automated native hit-testing; the assessed behavioral coverage gate passed at 89% and the relevant native interactions were walked manually.

### BC-004 — Local checklist reminders

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-003
- **Outcome:** A person can choose when a checklist item should come back to their attention and receive a reliable local macOS notification at that time.
- **Design reference:** Checklist reminder behavior and presentation are documented in `docs/design/checklist-reminders.md`.

**In scope**

- Allow one optional date-and-time reminder to be scheduled, changed, or removed for each checklist item from Focus Lens or Canvas Drill-In using keyboard or pointer controls.
- Keep reminder scheduling out of the required quick-capture path; a checklist can always be saved without choosing a time or granting permission.
- Request macOS notification permission in context when the first reminder is scheduled, not at application launch.
- Store the intended reminder locally before scheduling it with macOS and never claim the notification is active until the system accepts it.
- Show clear upcoming, overdue, permission-denied, and scheduling-failed states on the relevant checklist item without obscuring its text.
- Deliver notifications locally without an account, server, network connection, or remote analytics.
- Open Brain Cache to the correct thought and checklist item when its notification is selected.
- Reschedule when the reminder time changes and cancel pending delivery when the item is completed or removed, the reminder is cleared, or the containing thought is archived.
- Reconcile the local database with macOS notification state after relaunch, upgrade, interrupted scheduling, and permission changes.
- Define and document reminder time and scheduling state in the shared contract before iPhone and sync work begins.
- Let macOS notification preview settings govern whether reminder text appears on a locked screen; never send the text off-device.

**Non-goals**

- Recurring reminders, repeated nagging, snooze, location triggers, shared assignments, email/SMS/push services, or calendar integration.
- Requiring a reminder for every checklist item or sending notifications for ordinary unstructured thoughts.

**Acceptance evidence**

- Schedule a reminder for a future checklist item, quit Brain Cache, and receive the macOS notification at the expected local time.
- Select the notification and land on the correct thought with the relevant checklist item identified.
- Change the time and verify the original delivery is cancelled; then clear, complete, remove, and archive separate reminded items and confirm each pending delivery is cancelled.
- Deny notification permission and confirm the checklist still saves, the UI never claims the reminder is active, and an actionable path to macOS settings is available.
- Relaunch after an interrupted or failed scheduling attempt and confirm the app reconciles to one accurate pending notification without duplicates.
- Exercise a time-zone or daylight-saving transition and verify the documented delivery behavior.
- Save and use a checklist with no reminder and confirm there is no permission prompt or additional required interaction.
- Focused tests cover reminder validation, persistence, scheduling reconciliation, permission states, rescheduling, cancellation, and deep-link targeting.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

**Completion record — 2026-09-03**

- **Commits:** `2bfe00c` persists reminder intent and cancellation tombstones; `e08049f` adds local UserNotifications scheduling, reconciliation, Focus Lens controls, and exact-item notification targeting on `feature/bc-004-local-reminders`. The completion and landing passes classify scheduler rejection after permission denial, prevent stale native results from overwriting a renamed or rescheduled intent, and keep recovery failures visible beside the affected item.
- **Walking path:** Saved a checklist without seeing a notification prompt, scheduled a near-future reminder, quit Brain Cache completely, received the local notification, selected it, and landed on the exact checklist item with keyboard focus. Rescheduled a second reminder from 11:35 AM to 11:38 AM, confirmed nothing arrived at the original time, restarted the app, received exactly one notification at the new time, and focused the rescheduled item. Independently scheduled and then cleared, completed, removed, and archived separate reminded items; each native cancellation removed only the intended pending reminder. In a fresh isolated app identity, chose `Don't Allow`, confirmed the checklist remained saved, saw `notifications off` instead of an active claim, and opened macOS Notification Settings from the recovery action.
- **Verification:** 116 React tests, the TypeScript/Vite production bundle, 50 Rust tests, formatting, strict Clippy, a real ad-hoc-signed Tauri macOS app and DMG, packaged-executable startup, native Notification Center delivery, cold-launch targeting, rescheduling, cancellation, restart reconciliation, and permission-denial recovery all passed. A controlled `America/Chicago` spring-forward case confirms that the nonexistent 2:30 AM wall time is rejected before persistence.
- **Design review:** The Mac reminder states scored A for design and A for AI-slop; the persistent audit is under `designs/design-audit-20260903/` in the gstack project data. The landing pass aligned overdue text with the approved amber treatment. A 375 px browser-only action clip is deferred because the current product surface is the constrained desktop Mac app.
- **Follow-ups or limitations:** Apple notarization was not attempted because release credentials are not configured; it remains outside this feature's acceptance gate. No open in-scope P0-P2 findings remain.

### BC-014 — Local screenshot attachments

- **Status:** Needs decision
- **Priority:** P1
- **Depends on:** BC-010, BC-012
- **Outcome:** A person can attach a screenshot to a thought and trust that Brain Cache stores its own durable local copy rather than depending on the original file.

**Decisions required before Ready**

- Confirm whether the first release accepts screenshots and images only or general files. Current recommendation: PNG, JPEG, and HEIC images only.
- Choose the per-thought attachment count and size limits. Current recommendation: up to five images with a clear per-file limit.
- Decide whether to preserve original bytes, transcode HEIC, generate thumbnails, or compress large captures.
- Define removal and recovery behavior for attachment files, including whether deletion is immediate or recoverable.
- Confirm whether future BC-009 synchronization includes attachment bytes in its first release or leaves them local-only until a later slice.

**Required behavior once decided**

- Accept screenshots through clipboard paste, drag and drop, and an Attach action without making an attachment necessary to save a thought.
- Copy accepted bytes into app-managed local storage before reporting attachment success; never persist only a fragile reference to the source file.
- Store attachment identity, media type, dimensions, byte size, creation time, and owning thought in an additive local schema with a one-to-many relationship.
- Keep the text draft intact and show an actionable error when copying, validation, thumbnail generation, or metadata persistence fails.
- Show a restrained thumbnail on the thought card, preview the image in Focus Lens, and use Canvas Drill-In for the full view.
- Retain attachments when their thought is archived and keep file and database cleanup consistent when an attachment or thought is removed.
- Keep attachment writes local-first. Future transfer or sync must occur after the originating-device copy is durable and must not delay capture confirmation.
- Define browser-fallback behavior and update the shared thought contract before adding attachment support to the iPhone app or sync.

**Acceptance evidence once Ready**

- Paste, drop, and attach each supported format, save offline, remove the source file, relaunch Brain Cache, and still open the stored image.
- Attach multiple images up to the chosen limit and confirm clear rejection without draft loss beyond that limit or above the size boundary.
- Observe the card thumbnail, Focus Lens preview, and Canvas Drill-In full view using both keyboard and pointer controls.
- Force a storage or metadata failure and confirm the thought draft remains recoverable, no success is claimed, and no orphaned file remains.
- Archive and restore a thought without losing its attachments; remove an attachment and verify the chosen deletion/recovery contract.
- Migration preserves every existing thought and introduces no network, account, or permission requirement for ordinary text capture.
- Focused tests cover validation, copy durability, metadata transactions, multiple attachments, failure cleanup, archive/restore, removal, fallback behavior, and accessibility.
- React tests and production bundle, Rust tests, and a real Tauri build all pass.

### BC-005 — Native iPhone capture door

- **Status:** Shipped
- **Priority:** P0
- **Outcome:** A person can open Brain Cache on an iPhone, type a thought immediately, save it locally, and trust that it survives relaunch and loss of connectivity.

**In scope**

- Create the native Xcode workspace and minimal SwiftUI iPhone app under `apps/ios`.
- Open directly to an auto-focused capture scene.
- Save a valid thought locally using the documented shared thought contract and `source: "iphone"`.
- Show an immediate saved or actionable error state without waiting for network access.
- Make repeated save attempts safe and prevent empty thoughts.
- Provide a simple local view or test surface that proves saved thoughts survive process restart.

**Non-goals**

- Device-to-device sync, accounts, classification, or a full iPhone library.
- Reusing the Mac React/Tauri implementation.

**Acceptance evidence**

- On an iPhone simulator or device: launch, type, save, force-quit, relaunch, and recover the saved thought.
- Repeat the walking path with networking unavailable.
- Focused tests cover normalization, empty input, persistence, and stable ID/timestamp/source fields.
- The app builds successfully with the documented Xcode command or scheme.

**Completion record — 2026-09-02**

- **Commit:** `8210e65` (private development evidence) via PR #1.
- **Walking path:** Launched into the auto-focused iPhone editor, saved locally, force-quit and relaunched to recover the exact thought, then exercised empty input, rapid duplicate submission, persistence failure, retained-draft retry, and accessibility layouts.
- **Verification:** 13 focused iOS tests and the Release simulator build passed, along with project/workspace validation and debug-residue checks.
- **Follow-ups or limitations:** A real simulator network cutoff was not available through supported tooling; the capture path was verified to contain no network code or network-linked dependency and persisted entirely through the app-local store.

### BC-006 — App Intent capture

- **Status:** Shipped
- **Priority:** P0
- **Depends on:** BC-005
- **Outcome:** A person can send text into Brain Cache from Siri, Shortcuts, or the Action button and receive confirmation only after it is stored locally.

**In scope**

- Add an App Intent that accepts thought text and calls the same native capture operation as the iPhone app.
- Preserve the thought body, creation timestamp, generated record ID, and `source: "shortcut"`.
- Return useful success and failure results to the invoking system surface.
- Keep the path fully usable offline.

**Non-goals**

- Natural-language classification, remote processing, or sync.

**Acceptance evidence**

- Invoke from Shortcuts, save with networking unavailable, relaunch the app, and find the thought locally.
- Tests prove the app and intent use the same validation and persistence behavior.
- Every saved record conforms to the documented thought contract.

**Completion record — 2026-09-03**

- **Commit:** `b661d99` implements the feature on `codex/bc-006-app-intent`, stacked after BC-016 and the shared iPhone contract prerequisite.
- **Walking path:** Exercised the background **Cache a Thought** intent through its production capture operation, confirmed an eight-field `source: "shortcut"` record only after durable local write and readback, and verified validation, retry, cancellation, and failure results exposed to the invoking system surface.
- **Verification:** 24 iOS tests with 26 executions, a generic iOS Simulator build, App Intents metadata extraction and training, and Xcode project lint all passed.
- **Coverage:** The focused audit reached 81%; every testable intent function is covered, including stable retry identity and timestamp, required-text validation, durable confirmation, localized failures, cancellation, and Shortcut phrase registration.
- **Follow-ups or limitations:** A physical device remains required to exercise Siri phrases, Action-button invocation, the production app container, and offline system-surface capture followed by relaunch. These are hardware integration checks rather than uncovered local persistence logic.

### BC-007 — Lock Screen capture control

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-005
- **Outcome:** A person can start a new capture from the Lock Screen with the fewest OS-permitted steps.

**In scope**

- Add the appropriate Lock Screen control or WidgetKit extension.
- Authenticate/deep-link into an auto-focused capture scene.
- Save through the same local operation as BC-005.
- Handle cancelled authentication and app-launch failure without losing already-entered text.

**Non-goals**

- Free-form text input while the device remains locked.
- Sync or a general-purpose widget dashboard.

**Acceptance evidence**

- On a locked device or supported simulator path: invoke, authenticate, type, save, and verify local persistence after relaunch.
- The control never claims success before the local write completes.

**Completion record — 2026-09-03**

- **Commit:** `4d8c94f` implements the feature on `codex/bc-007-lock-screen`, stacked after the BC-006 App Intent PR.
- **Walking path:** Installed the app and embedded extension in an iPhone simulator, invoked the registered `braincache://capture` route through the system confirmation, and verified focus-only routing, warm-draft preservation, and the unchanged local save/readback path through focused tests.
- **Verification:** 29 logical iOS tests with 45 parameterized executions, a generic arm64/x86_64 Simulator build, Xcode static analysis, source-plist validation, embedded-extension inspection, Simulator extension registration, and App Intents metadata validation all passed.
- **Coverage:** The independent audit covered 25 of 30 acceptance paths (83%), including strict route validation, repeated focus requests, draft/retry/error preservation, extension privacy boundaries, and existing local persistence guarantees.
- **Follow-ups or limitations:** Physical-device acceptance remains for real Lock Screen gallery placement, Face ID or passcode success and cancellation, post-unlock keyboard focus, launch-failure behavior, and the complete locked/offline/save/relaunch journey. No device-only outcome is claimed by this release.

### BC-008 — Share Sheet capture

- **Status:** Shipped
- **Priority:** P1
- **Depends on:** BC-005
- **Outcome:** A person can save selected text or a shared link from another iPhone app without manually copying it into Brain Cache.

**In scope**

- Add a Share Sheet extension for text and URLs.
- Present the captured material for quick review, allow optional surrounding text, and save locally.
- Keep a draft non-durable until the person explicitly taps Save, then journal that exact attempt before changing the canonical archive.
- Preserve a submitted Share save when the extension is interrupted or the main app is unavailable, replaying it exactly once on later local access.
- Use the approved existing `source: "iphone"` for Share records.
- Coordinate the app, App Intent, and Share extension through `group.com.braincache.iphone`; fail visibly when the group is unavailable instead of falling back to isolated storage.
- Lazily migrate the legacy app archive into shared storage without overwriting extension-first data, conflicting records, malformed bytes, or an earlier safety backup.

**Non-goals**

- Web scraping, attachment storage, link previews, or automatic summarization.

**Acceptance evidence**

- Share text and a URL from at least one system app, save offline, then verify both after launching Brain Cache.
- Tests cover unsupported, empty, multiple, and relative payloads; the explicit-Save boundary; interrupted extension execution; exact-once journal replay; cross-process concurrency; conflict-safe migration; and missing-group failure.

**Completion record — 2026-09-05**

- **Commits:** `e510ca9` adds the offline Share extension and coordinated storage; `570a2f6` preserves comfortable Share action hit areas; `03713eb` closes journal, migration, conflict, and missing-group recovery edges on `codex/bc-008-share-sheet`.
- **Walking path:** The simulator and test-host path loaded one shared text item and one absolute URL into the editable review surface, proved that preparation alone performs no write, saved only after the explicit action with `source: "iphone"`, and reopened the coordinated archive after injected interruptions without loss or duplication.
- **Verification:** 66 logical iOS tests, the generic iOS Simulator build with both embedded extensions, Xcode static analysis, focused Share and shared-storage tests, App Group entitlement inspection, and source-plist validation passed.
- **Follow-ups or limitations:** Physical-device acceptance remains a merge gate: share text and a URL from system apps while offline, complete the signed App Group path, relaunch the host app, and verify both records. No physical-device Share Sheet outcome is claimed here.

### BC-009 — Private Mac/iPhone synchronization

- **Status:** Needs decision
- **Priority:** P1
- **Depends on:** BC-005
- **Outcome:** Thoughts captured on either device appear on the other without making capture depend on network availability.

**Decisions required before Ready**

- Choose the transport and trust model.
- Define device identity and first-time pairing/onboarding.
- Define conflict behavior for archive state, tag additions/removals, checklist edits/completion, and any future editable fields.
- Decide whether reminder metadata syncs, which device delivers it, and how duplicate notifications are prevented.
- Define retention, recovery, and user-visible failure expectations.

**Required behavior once decided**

- Write to a durable local outbox before attempting transport.
- Transfer idempotently and preserve the original ID and creation timestamp.
- Retry safely after interruption, duplication, reordering, and extended offline periods.
- Never block or slow the local capture confirmation on either device.
- Show enough state to distinguish local-only, syncing, synced, and actionable failure.

**Acceptance evidence**

- Capture Mac → observe on iPhone; capture iPhone → observe on Mac.
- Repeat while one device is offline, then reconnect and converge without duplicates.
- Interrupt transfer at multiple points and verify automatic recovery.
- Archive and restore across devices according to the chosen conflict rules.

## Wishlist intake

Add new ideas here before promoting them into the queue. A rough sentence is enough; shaping happens before implementation.

| Idea | Desired user outcome | Status | Notes or open decision |
| --- | --- | --- | --- |
| _Add the next idea here_ | _What becomes easier or possible?_ | Idea | _Why it matters, constraints, examples_ |

## Workflow handoff

Use this prompt when returning the backlog to an implementation agent:

> Continue Brain Cache using `FEATURE_BACKLOG.md` as the ordered product queue. Read `AGENTS.md`, `DESIGN.md`, `ARCHITECTURE.md`, and the relevant source before changing files. Take the first **Ready** item whose dependencies are **Shipped**. Implement the smallest complete vertical slice, exercise its real walking path, run the repository-required focused and native verification, and update that item's status and evidence in the backlog. Then continue to the next eligible **Ready** item. Do not implement **Idea** or **Needs decision** items, silently expand scope, or weaken local-first capture. Stop only for a genuine product decision, required approval, external dependency, or unrecoverable verification failure; report the exact blocker and preserve completed work.

## Completion record

When an item ships, add a compact record under its acceptance evidence:

- completion date and commit;
- walking path exercised;
- test/build commands and results;
- intentional follow-ups or known limitations.
