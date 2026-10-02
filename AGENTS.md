# Brain Cache Repository Instructions

These instructions apply throughout the repository. Keep shared project guidance here; tool-specific instruction files should refer to this file rather than duplicate it.

## Current Release Scope

The first public milestone is a Mac-only source preview. Apple Developer membership, signing, notarization, and installer acceptance are deferred to a later downloadable app release; do not require them for source publication or advertise CI artifacts as official downloads. Follow [`RELEASE.md`](RELEASE.md) for each milestone’s readiness requirements. Mobile and device sync are deferred: preserve `apps/ios`, its tests, documentation, and shared schema compatibility, but do not advertise mobile as a released feature or require iPhone acceptance for Mac-only changes. Changes to retained mobile code still require the iPhone verification below.

Source publication must use a fresh reviewed source snapshot as described in [the publication procedure](docs/release/public-source.md). Keep the existing development repository private; its historical board and personal Git identities are excluded from the proposed public repository. Do not mirror, fork, or import its history as a shortcut.

## Start Here

- Read [`README.md`](README.md) for setup, supported platforms, and current capabilities.
- Read the relevant sections of [`ARCHITECTURE.md`](ARCHITECTURE.md) before changing storage, native commands, or the shared thought contract.
- Check [`FEATURE_BACKLOG.md`](FEATURE_BACKLOG.md) before implementing a feature. Stay within the requested scope; an item in the backlog is not authorization to start it.
- For iPhone work, read [`apps/ios/README.md`](apps/ios/README.md) for build commands and device acceptance paths.
- Inspect the working-tree status before editing. Preserve unrelated changes, including work from other contributors or agents.

## Product Contract

Build the fastest private path from a thought to durable local storage. Preserve local-first behavior and do not make capture depend on network availability, account state, classification, or optional metadata.

- Preserve the core Mac journey: `⌥ Space`, type, `⌘ Return`, verified local-save confirmation, then return to work.
- Optional tags, checklists, attachments, reminders, and animation must not delay ordinary text capture.
- Save locally on the originating device before any synchronization begins. Device sync is not implemented yet; do not imply that Mac and iPhone share data today.
- Keep the iPhone app focused on capture. A full library, accounts, collaboration, AI classification, and cloud-only storage are outside the current product contract unless explicitly requested.

## Design System

Always read [`DESIGN.md`](DESIGN.md) before making visual or UI decisions. Font choices, colors, spacing, layout, motion, and the pet's behavioral constraints are defined there. Do not deviate without explicit user approval.

Preserve keyboard access, focus restoration, reduced-motion behavior, and visible save/error states. Use the existing components and design tokens when extending the interface.

## Architecture

- The primary Mac application lives in `apps/mac`: React and TypeScript own the interface; Tauri and Rust own native windows, hotkeys, menu-bar behavior, and SQLite persistence.
- Keep native calls behind the TypeScript bridge in `apps/mac/src/bridge.ts`; browser fallback behavior must preserve the same capture contract for preview and focused tests.
- The native iPhone app, its `Cache a Thought` App Intent, Lock Screen WidgetKit extension, and Share Sheet extension live under `apps/ios`. They exchange records using the documented thought schema rather than importing Mac implementation code; the app, App Intent, and Share extension use the coordinated `group.com.braincache.iphone` archive.
- Keep iPhone capture behavior in the UI-independent `CaptureOperation` and persistence behind `ThoughtStore`. The Lock Screen widget only opens capture; it does not store or display thought content.
- The earlier Swift Mac implementation in `legacy/swift-mac-prototype` is a preserved prototype, not the primary product architecture. Change it only when the task specifically concerns the prototype.

## Persistence and Data Safety

- Report save success only after a durable local write and verification. Preserve the draft and a usable retry path when persistence fails.
- Keep related Mac writes transactional. Save captured thoughts and their attachment bytes together; a reference to the source file is not a saved attachment.
- Preserve record IDs, creation timestamps, task identities, completion history, and unrelated fields during edits and migrations.
- Keep schema changes compatible with existing records. Update the documented contract and every affected TypeScript, Rust, Swift, and browser-preview representation together. Treat new serialized `source` values as a schema decision.
- Preserve the iPhone store's cross-process coordination, atomic replacement, journal recovery, and same-attempt retry identity. An unavailable App Group must remain a visible error, without falling back to an isolated private archive.
- Keep Delete recoverable through Trash. Do not introduce permanent deletion as an incidental change.
- Use temporary stores and synthetic thoughts for automated tests. Do not reset a person's database or archive to make tests pass, and do not include real thoughts, attachments, or credentials in logs, fixtures, screenshots, or commits.

## Working on a Change

1. Identify the requested outcome and trace the affected behavior through the existing code and tests. For a bug, reproduce it or establish the failing path before choosing a fix.
2. Make the smallest complete change that fits the architecture. Reuse existing dependencies and conventions; avoid unrelated refactors or lockfile churn.
3. Add or update focused tests for behavior changes. Cover observable outcomes and relevant failure paths, especially failed writes, retries, reopen behavior, and compatibility with older stored records.
4. Run the required verification below and inspect the final diff for unintended changes or generated artifacts.
5. Update documentation that the change makes inaccurate. Record user-visible behavior changes in [`CHANGELOG.md`](CHANGELOG.md); update backlog status only when the stated acceptance criteria are met.

Use the pnpm version declared in [`apps/mac/package.json`](apps/mac/package.json) and the checked-in lockfile. Do not replace pnpm with another package manager. Keep generated dependencies, build outputs, and machine-specific Xcode state out of commits.

## Verification

Every completed application slice must have a real walking path and focused tests. Do not describe an unrun check as passing. If the environment cannot run a required check, report that limitation and the remaining verification explicitly.

### Mac application changes

From the repository root:

```sh
cd apps/mac
pnpm install --frozen-lockfile
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

Run the React tests and production bundle, Rust tests, and a real Tauri build. Do not treat a browser-only preview as a successful native build.

For the real walking path, run `pnpm tauri dev` from `apps/mac`. Capture a sample thought with `⌥ Space` and `⌘ Return` while offline, confirm it appears in the library, quit and relaunch, and confirm it persists. Exercise the changed behavior as well, including relevant error recovery and keyboard interactions. Use a test environment that preserves existing user data.

### iPhone application changes

Build and test the checked-in `apps/ios/BrainCache.xcworkspace` with the shared `BrainCache` scheme using the commands in the [iPhone guide](apps/ios/README.md). Select an installed simulator instead of assuming the example runtime is available.

Exercise the affected app, App Intent, widget, or Share Sheet path. Physical-device signing, Lock Screen authentication, and Share Sheet acceptance require the documented device checks; simulator results do not prove those paths passed on hardware.

### Documentation-only changes

Check links, referenced paths, commands, and claims against the repository, then run `git diff --check`. Application builds are not required when only prose changes. State that verification was limited to documentation.

## Delegated Work and Stall Recovery

Apply this watchdog whenever work is delegated to a spawned or subordinate agent:

- Treat an agent attempt as stalled after five continuous minutes with no movement. Movement means a new agent status or revision, message, tool or terminal output, file change, completion, or request for attention. Repeated unchanged polls are not movement.
- Track the last movement time. Do not wait past the remaining five-minute watchdog interval without checking the agent.
- When an attempt stalls, interrupt or terminate that attempt. Inspect and preserve any useful partial output before continuing.
- Reconcile files and externally visible side effects before retrying so the retry cannot blindly duplicate a mutation that may already have succeeded.
- Retry the same objective once using a fresh attempt. Include the partial findings and last known state, and make the retry prompt narrower or more explicit where that could prevent the same stall.
- If the retry also stalls for five minutes, stop retrying and report the blocker and partial progress instead of looping indefinitely.
- Do not classify a still-running long command as agent inactivity solely because it is quiet. Monitor the process itself when its expected runtime can reasonably exceed five minutes.
- If progress is waiting on user approval, user input, or a known external state change, surface that dependency instead of retrying without a changed condition.

## Handoff

Summarize what changed and why, the checks and real app paths actually exercised, and any remaining limitations. Distinguish automated checks from manual verification. Keep the explanation understandable to a contributor who has not read the conversation.
