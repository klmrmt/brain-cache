# Brain Cache for iPhone

> **Retained for future development.** The upcoming public Brain Cache release is Mac only. This code, its tests, and the instructions below remain available for future mobile work; iPhone features are outside the current release scope. See the [Mac release plan](../../RELEASE.md).

BC-005 is a native SwiftUI capture door. It launches directly into a focused editor, writes the documented thought contract to the originating iPhone before reporting success, and shows only the most recently saved local thought as a recovery check. BC-006 adds a `Cache a Thought` App Intent and App Shortcut for Siri, Shortcuts, and Action button workflows. The system action accepts text with `source: "shortcut"` and confirms success only after local read-back. BC-007 adds an `accessoryCircular` Lock Screen widget that links through the strict `braincache://capture` route to focus the existing editor. The widget contains no thought text or persistence. BC-008 adds a Share Sheet extension for one text item or absolute web link, lets the person review or add surrounding text, and saves only after an explicit **CACHE IT** action with `source: "iphone"`. The app, App Intent, and Share extension now share coordinated local storage; none of these paths has an account, network dependency, sync, or full library.

## Requirements

- Xcode 16 or later with an iOS Simulator runtime
- iOS 17 or later
- No package installation or network access

The checked-in workspace is `BrainCache.xcworkspace`; the shared app, widget, Share extension, and test scheme is `BrainCache`.

## Build

From `apps/ios`:

```sh
xcodebuild \
  -workspace BrainCache.xcworkspace \
  -scheme BrainCache \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/braincache-derived-data \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Test

Choose an installed iPhone simulator name when needed. This is the exact command used for BC-007 with Xcode 26.6 and the installed iOS 26.5 runtime:

```sh
xcodebuild \
  -workspace BrainCache.xcworkspace \
  -scheme BrainCache \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath /tmp/braincache-derived-data \
  CODE_SIGNING_ALLOWED=NO \
  test
```

The focused suite covers edge-only normalization, CRLF-to-LF canonicalization, whitespace rejection with zero writes, every shared contract field, legacy five-field decoding, malformed additive-field rejection without archive rewrites, atomic persistence and reopen, concurrent/repeated-save idempotency, conflicting IDs, draft retention and stable retry identity after an error, edited-draft attempt replacement, recovery-load retry, shortcut-source persistence, shortcut validation and failure mapping, the App Intent's same-attempt local retry, strict capture-route parsing, focus-only deep-link handling, and draft/retry/error preservation. BC-008 coverage adds text and URL parsing, unsupported or multiple payload rejection, explicit-Save behavior, stable Share identity with `source: "iphone"`, cross-process writes, journal replay after interruption, conflict-safe legacy migration, malformed archive and journal preservation, backup collisions, and visible failure when the App Group is unavailable.

## Offline walking path

1. Open `BrainCache.xcworkspace`, select the shared `BrainCache` scheme and an iPhone simulator or device, then run.
2. Before launch, take the device offline (Airplane Mode on hardware; on a simulator, disable the Mac network connection or use an equivalent fully blocked network profile).
3. Confirm the app opens to `DUMP TO CACHE` with the thought editor already focused. Return must insert a new line.
4. With the editor empty or whitespace-only, tap `CACHE IT`. Confirm `GIVE BLOB SOMETHING TO REMEMBER.` appears and `LAST SAVED ON THIS IPHONE` does not change.
5. Type a multiline thought and tap `CACHE IT` rapidly more than once. Confirm `WRITING LOCALLY…` changes to `SAVED LOCALLY`, the editor clears and refocuses, and exactly that normalized thought appears in the read-only recovery card.
6. Force-quit Brain Cache while still offline, relaunch it, and confirm the same thought returns under `LAST SAVED ON THIS IPHONE`.
7. Repeat with a second thought and confirm only the newest record is shown; this card is deliberately a recovery proof, not a library.

Persistence failures keep the whole draft visible and change the primary action to `TRY AGAIN`. Recovery-load failures are scoped to the recovery card and offer `TRY LOADING AGAIN`. Focused tests inject both failures because normal app execution has no deliberate debug failure switch.

## App Intent walking path

1. Install and launch Brain Cache once on an iPhone running iOS 17 or later.
2. In Shortcuts, add the `Cache Thought` action from Brain Cache. Supply text directly, ask for input first, or invoke the shortcut through Siri or the Action button.
3. Take the device offline, run the shortcut, and confirm the system reports `Saved locally to Brain Cache` only after the action completes.
4. Relaunch Brain Cache while still offline and confirm the shortcut text appears under `LAST SAVED ON THIS IPHONE`.
5. Run the action with empty or whitespace-only text and confirm the system asks for usable text without changing the latest saved thought.

The App Intent still runs from the main application target and retries one failed local persistence call with the same prepared UUID and timestamp. BC-008 moved the production app store, and therefore the App Intent, to the shared App Group archive without changing the intent's source or confirmation contract. If validation fails or the retry cannot be verified, the invoking system surface receives an actionable error and no success confirmation.

## Lock Screen walking path

1. Install and launch Brain Cache once on a physical iPhone running iOS 17 or later, then add the circular Brain Cache widget to the Lock Screen.
2. Enter a draft in the app without saving it, lock the device, tap the widget, and complete the device's normal authentication challenge.
3. Confirm Brain Cache opens directly to the focused editor with the existing draft unchanged. Canceling or failing authentication must leave the app and draft untouched.
4. While offline, save the draft, relaunch the app, and confirm it appears under `LAST SAVED ON THIS IPHONE` with `source: "iphone"`.
5. Repeat the widget tap while a save error or retryable attempt is visible and confirm the draft, retry identity, recovery card, and error are preserved.

The simulator can verify URL registration, strict route handling, app launch, focus requests, state preservation, and extension embedding. It cannot prove the real Lock Screen placement, authentication transition, post-unlock keyboard focus, or locked/offline/relaunch journey; those acceptance steps require a physical device.

## Share Sheet walking path

1. Install and launch Brain Cache once on a physical iPhone running iOS 17 or later.
2. From a system app, share one selected text item to Brain Cache. Confirm the extension opens with that text editable and that canceling before **CACHE IT** creates no durable thought.
3. Share the text again, add optional surrounding text, take the device offline, and tap **CACHE IT**. Relaunch Brain Cache and confirm the exact normalized body appears under `LAST SAVED ON THIS IPHONE` with `source: "iphone"`.
4. Repeat with one absolute web link and confirm the full link is preserved. Empty, unsupported, relative, or multiple payloads must show an actionable local error and perform no archive write.
5. Interrupt a save after tapping **CACHE IT**, then relaunch Brain Cache. Confirm the app's recovery access replays the pending journal once and does not duplicate the thought.

These physical-device steps remain a merge gate for the BC-008 branch; the shipped documentation does not claim they have already passed. Simulator tests cover the same parsing, explicit-Save, persistence, interruption, and recovery contracts without standing in for the signed device path.

## Shared capture boundary

`CaptureOperation` is UI-independent. A caller first prepares a `CaptureAttempt`, which normalizes and validates the body and fixes one UUID, UTC timestamp, `archived: false`, source, `kind: "text"`, `checklistItems: []`, and `tags: []` for that logical attempt. Saving passes that attempt to the injected `ThoughtStore`. Production stores resolve the coordinated App Group `group.com.braincache.iphone`; `FileThoughtStore` and `SharedThoughtStorage` serialize each read-modify-write cycle across processes, atomically replace the JSON archive with data protection, read the record back, and only then return success. Retrying the same attempt is idempotent; reusing its ID for different content is an error. A missing or misconfigured App Group produces a visible error instead of falling back to an isolated private archive.

The iPhone UI and Share extension pass `source: "iphone"`; the App Intent passes `source: "shortcut"`. All three use the same normalization, validation, timestamp, UUID, eight-field contract, and coordinated persistence implementation. The BC-007 widget does not call this operation: it only opens the app, where the existing UI path preserves `source: "iphone"`.

A Share draft is not durable before the person taps **CACHE IT**. Once Save begins, the exact prepared attempt is written to `pending-shares` before the canonical archive is read or changed. Every later app, intent, or Share access replays pending journals idempotently, verifies the archive, and removes the journal only after success.

The app lazily migrates its former Application Support archive on first access to the coordinated store. It decodes the complete legacy and group archives before mutation, merges identical IDs without duplication, rejects conflicting IDs without changing either file, writes and verifies the group archive, and retires the legacy bytes to a non-overwriting safety backup. The Share extension never performs that legacy migration by itself. Device sync is still intentionally absent.
