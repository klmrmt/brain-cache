# Mac release engineering check

Checked September 30, 2026 on `codex/release-preparation`, based on GitHub `main` at `41459ec`. This combines the prepared public documentation with Settings and the Activity garden. It is not installer acceptance or a claim that every security risk has been eliminated.

## Version and data compatibility

The current development version is `0.8.0` in `VERSION`, JavaScript and Cargo manifests, the Cargo lockfile's application entry, and Tauri packaging. Historical four-part changelog versions remain as recorded. Use three-part versions for future Mac builds and matching tags. The public beta tag still belongs to the final reviewed release revision.

The shipped identifier remains `com.braincache.desktop`; the default data location and stored thought contract did not change. Retained mobile source remains outside the Mac release feature list.

## Content policy and native permissions

Production scripts and assets come from the local bundle. Connections are limited to Tauri IPC; remote scripts, images, fonts, frames, form submissions, and object embeds are not permitted. Attachment previews use `data:` images. Inline style elements and attributes remain permitted for Tiptap's injected editor styles and React's resizing, positioning, and charts. Script hashes/nonces are still supplied by Tauri. The explicit development policy additionally permits Vite's local refresh script and websocket.

The capability keeps explicit event listening, launch-at-login operations, and titlebar dragging/double-click behavior. The unused broad `core:default` grant was removed. The last two window permissions are needed by Tauri's injected `data-tauri-drag-region` handler even though application TypeScript does not import them directly.

Custom application commands remain callable by the two local application webviews. There is no remote capability grant or third webview. Per-window custom-command permissions would be additional hardening if new surfaces are introduced.

The source review found schema-based rich-text import, disabled links/code blocks, owned attachment IDs, native document validation, and file opening through an argument to `/usr/bin/open`. It found no application raw-HTML rendering, arbitrary filesystem-path IPC, shell-string execution, or direct logging of thought bodies or attachment bytes. This is inspection evidence, not a malicious-content penetration test. See [Tauri's CSP guidance](https://v2.tauri.app/security/csp/) and [capabilities documentation](https://v2.tauri.app/security/capabilities/).

## Dependencies

Tauri was patched from `2.11.5` to `2.11.6` for [GHSA-w28w-mhc8-qvjv](https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv). Only that external Cargo package version/checksum changed. The manifest pins this patch to keep this release check bounded. The advisory concerns cross-webview access to queued large IPC responses; no attacker-controlled webview entry path was demonstrated in Brain Cache.

- `pnpm audit --prod --json`: zero advisories across 61 production/optional dependencies.
- `pnpm audit --json`: two moderate development-only findings in Vitest and its mocker, both [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9). The inspected configuration has no exposed mocker server; these tools are not bundled. Track a focused test-tool update separately.
- `cargo-audit 0.22.2` against the complete locked graph and the official RustSec database at `9b3a3b73a7f42606494c943e95f8196e9994df46`: zero listed vulnerabilities. Informational maintenance warnings remain for `proc-macro-error` and five `unic-*` packages. An unsoundness warning for `glib` applies to an alternate platform graph; `cargo tree --locked --target aarch64-apple-darwin -i glib` finds no Mac dependency. Keep tracking upstream replacements. Database scans cannot prove the absence of undisclosed defects; the Tauri GitHub advisory was also checked directly.

The [license inventory](dependency-licenses.csv) was updated for the patched Tauri crate. Distribution notices and asset-origin confirmation remain separate launch requirements.

## Startup and test reliability

A real `pnpm tauri dev` launch reproduced an Objective-C startup exception from requesting UserNotifications in an unbundled executable. The adapter now checks the actual `.app` bundle and identifier before calling that framework. Source development can launch and capture; scheduling reports an unavailable error while retaining locally saved intent. Bundled apps retain their notification path. Nine adapter tests, including the real unbundled test process and durable intent preservation, pass.

Two existing UI focus tests depended on one animation frame completing all work. Their assertions now wait for the prior tag focus frame or observe the exact reminder editor/item focus with a bounded wait. The assertions remain intact; missing focus still fails. Both checks passed ten consecutive targeted runs, and the complete interface suite passed 296 tests.

## Native walking path and remaining acceptance

Used an ad hoc signed app with an explicit temporary configuration: product name `Brain Cache Release Check`, identifier `com.braincache.releasecheck.20260930`. Its application-data directory was separate from the regular app. No personal database was opened or reset.

In the production webview, opened capture through New thought, saved synthetic text with `⌘ Return`, observed `saved locally`, and verified it in the library. Added a sample file and inline PNG with the native picker. Quit and reopened the app; the thought and both attachments remained. A temporary copy of the closed synthetic database passed integrity checking, and both attachment byte hashes matched their sample source files. Settings loaded preferences, Escape restored its opener's focus, and the latest Activity page opened with its garden and local counts.

The machine remained online. A separate existing Brain Cache process was left running, so the global `⌥ Space` registration path was not exercised in this isolated check. Native development relaunched without the former crash, but the UI tool could not select its unbundled executable for an interactive capture walk. The production bundle supplied the interactive persistence evidence. Hot reload, notification permission/delivery, oldest-supported macOS, Intel, multiple displays, installed-download/Gatekeeper behavior, upgrade acceptance, and full app-driven restore still need their documented checks.

The [backup verifier](../../scripts/release/verify-backup-restore.py) passed committed-WAL, all ten tables, attachment bytes, history, safe staged restore, preserved originals, reopen, and rollback checks with temporary synthetic stores. The [manual guide](backup-restore.md) distinguishes that evidence from installed-app recovery and macOS notification state.

## Final build and repository checks

The locked dependency installation passed. The final checks passed 296 interface tests, 82 Rust tests, the production TypeScript/Vite bundle, and `pnpm tauri build --verbose`. The normal configuration produced `Brain Cache.app` and `Brain Cache_0.8.0_aarch64.dmg` with ad hoc signing; notarization was skipped. Both use the unchanged distribution identifier. These artifacts remain local build outputs.

The version values and targeted lockfile diff were checked. Local documentation review validated 76 paths/anchors and the three issue-template YAML files. Gitleaks 8.30.1 scanned a 146-file candidate source snapshot (including untracked release documents) with redaction and inline allow-comments disabled: no matches. `git diff --check` passed. Repository-wide `cargo fmt --check` reports existing formatting differences in unrelated files; no bulk formatting was introduced. The final publishable revision and additional GitHub surfaces still need review at publication time.
