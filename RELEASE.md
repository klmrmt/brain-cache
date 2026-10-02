# Brain Cache Mac Release Plan

Historical build evidence below was recorded in the private development repository; it does not refer to inherited commits or CI runs in this fresh repository. The maintainer approved public source publication at klmrmt/brain-cache on October 1, 2026; official installers remain deferred.

Assessment updated: 2026-10-01. Initial baseline: `50ed1e9`; fresh contributor setup: `41459ec`. Release documents and engineering fixes are now combined on `codex/release-preparation`, based on `41459ec`. See the [engineering check](docs/release/engineering-review.md) for current evidence and limits.

**Decision: prepare source publication first; defer the downloadable app.** The maintainer chose a Mac-only source preview on 2026-10-01. Apple Developer membership, signing, notarization, installer notices, and installed-app acceptance are not gates for this source milestone. Public source must come from a fresh reviewed snapshot; the development repository must remain private because its history contains screenshot-derived note text and personal Git attribution. A public downloadable app remains NO-GO until its separate checks pass. This assessment does not claim complete security or native acceptance.

## Agreed scope

- Publish the current Mac capture and library source as a development preview: local notes, rich text, checklists, tags, pins, attachments, reminders, activity, and recoverable Trash. Document unverified native paths rather than claiming installer acceptance.
- Keep capture fully usable offline without an account.
- Defer mobile and device synchronization. Preserve `apps/ios`, its tests, documentation, and existing serialized source values. Mobile testing is not a gate for this Mac release unless shared contract changes affect mobile code.
- Remove mobile from the public feature list and setup path. Retained developer documentation may still describe it.

## Agreed release milestones

**First: source-only Mac preview.** Make the reviewed repository available under MIT with build instructions, contributor and security guidance, and the current limitations. Contributors build locally with the checked-in ad hoc configuration; no Apple Developer Program membership is required. Do not attach the CI app/DMG candidates as official release downloads. The current development version is `0.8.0`; a versioned tag is optional and has not been chosen for this source milestone.

**Later: packaged Mac beta.** After the maintainer decides to enroll and selects the distribution identity, complete signing/notarization, distribution notices, supported-system verification, and installed-app acceptance. Then offer a verified DMG through GitHub Releases, initially with manual updates. The Mac App Store and automatic updater can be separate projects.

For the source preview, report the build target of macOS 13 or later and the verified Apple-silicon environments of macOS 15.7.9 and 26.4. This does not establish macOS 13 or Intel runtime support. The installer support matrix still needs an owner decision and acceptance on each advertised configuration.

## Source-publication checklist

- [x] Maintainer chose source-first publication and deferred paid Apple signing on 2026-10-01.
- [x] Prepare the MIT license, Mac setup instructions, shared agent rules, contributor guide, issue forms, security policy, and source-preview limitations.
- [x] Reconcile the prepared branch with `main` at `41459ec`; validate builds and native packaging locally and on GitHub. The signing-preparation revision `186af48` passed Mac CI (private development evidence) with 453 automated tests, production bundling, synthetic backup/restore, and ad hoc app/DMG packaging.
- [x] Verify the project creation records for the Blob icon and design board; record origin, hashes, and limits in the [asset review](docs/release/asset-provenance.md).
- [x] Replace the screenshot-derived board with a new text-only generated board using fictional notes; add a fictional example attachment and review current images.
- [x] Maintainer approved publication at `klmrmt/brain-cache` on 2026-10-01. Use a fresh reviewed source history and keep the development repository private.
- [ ] Finish the new repository checks and public activation using the [clean-source procedure](docs/release/public-source.md).
- [x] Review nine actual remote branches, historical attribution, twenty PRs, and four Actions logs; scan all 623 unique blobs in the broader retained remote-tracking history. No operational credentials were found, but historical board text and seventeen commits with personal email attribution require the fresh-source route. See the [privacy review](docs/release/repository-review.md#privacy-and-replacement-follow-up--october-1-2026) for scope and limits.
- [ ] Scan the exact committed revision and any newer public surfaces immediately before publication.
- [ ] Review preparation privately, export only reviewed source, and validate the new private destination before making it public. Do not publish the development repository or its history; do not offer CI candidates as official installers.
- [ ] Enable GitHub private vulnerability reporting, verify the hosted README/license/forms/security route, and check anonymous clone access after publication.

**Done when:** the public repository has accurate source-only setup and reuse terms, a usable contribution/security route, reviewed public content, and no implication that an official Mac installer is available.

## Current evidence

The initial baseline below describes `50ed1e9`. The later contributor setup check on `41459ec` is recorded separately so build evidence is tied to the correct source revision.

| Area | Observed state |
| --- | --- |
| Interface tests | 254 tests passed across 11 files |
| Rust tests | 74 tests passed |
| Production interface build | Passed TypeScript compilation and Vite bundling |
| Native packaging | `pnpm tauri build` passed and produced an Apple-silicon `.app` and `.dmg`; ad hoc signed, not notarized |
| Public distribution signing | `signingIdentity` is `-` (ad hoc); notarization skipped because credentials were not supplied |
| Versions | `VERSION` and release history use `0.7.1.0`; JavaScript, Cargo, Cargo lockfile package entry, and Tauri app configuration use `0.2.0` |
| Webview content policy | `app.security.csp` is `null`; review and configure an appropriate production policy |
| Repository | GitHub metadata checked during this session: private, no releases; MIT license now prepared locally with copyright holder `braincache` |
| Publication review | Initial history and working-file scans completed; see the [review record](docs/release/repository-review.md). Asset confirmation and final-branch review remain open |
| Release branch | GitHub `main` at `41459ec` is four commits ahead of the assessed checkout; reconcile before choosing the release revision |
| Automation | No checked-in GitHub Actions workflows or release scripts were found |
| Installed release acceptance | Not exercised in this assessment; a native build alone does not establish it |

The earlier README screenshots use the browser preview with synthetic notes. They demonstrate the interface, not native persistence, permissions, or installer acceptance.

The first packaging attempt failed while creating the DMG in the restricted execution environment. Repeating the same build with macOS packaging access succeeded without source changes. This does not establish signed-download installation or Gatekeeper acceptance.

### Contributor setup check on `41459ec`

Used a fresh managed Git worktree of the verified GitHub `main` tip, with no existing project dependency folder or build output. This used the machine's installed tools and shared package caches; it was not a clean-machine or anonymous-clone test.

| Check | Result |
| --- | --- |
| Locked dependency installation | `pnpm install --frozen-lockfile` passed |
| Interface tests | 296 tests passed across 14 files |
| Production interface build | `pnpm build` passed |
| Rust tests | 79 tests passed with the existing lockfile |
| Native packaging | Apple-silicon `.app` and `.dmg` produced on the diagnostic retry, using ad hoc signing; notarization skipped |
| Source cleanliness | Verification checkout remained free of tracked changes and untracked source files |
| Contributor documents | Local links, section anchors, YAML parsing/form structure, whitespace, and secret scan passed; hosted GitHub forms are not active yet |

Environment: macOS 26.4 on Apple silicon, Node.js 26.8.1, pnpm 11.24.0, Rust/Cargo 1.98.0, and Xcode 26.6. Minimum tool versions, macOS 13, and Intel were not exercised.

The first `pnpm tauri build` attempt compiled and bundled the app but failed in `bundle_dmg.sh` without a detailed cause in its output. A diagnostic retry with `pnpm tauri build --verbose` completed both bundles without source changes. The initial packaging failure's cause remains unconfirmed; repeatable release packaging still needs the release automation work below. The packaged app was not launched, installed, or tested against a person's data.

### Combined release-preparation check

The development version is aligned to `0.8.0` and the app identifier/data location are unchanged. Production and development content policies are explicit, native permissions are narrowed, and Tauri is patched to `2.11.6`. The source-launch notification crash is fixed. The combined application passes 296 interface tests and 82 Rust tests; the production interface bundle passes, and the normal configuration produces an ad hoc signed `0.8.0` app and DMG. Native sample capture, attachments, quit/reopen persistence, Settings loading/focus restoration, and Activity were exercised in a separate production app bundle. [Full evidence and remaining acceptance](docs/release/engineering-review.md).

The verified [manual backup/restore procedure](docs/release/backup-restore.md) preserves committed WAL data, attachment bytes, and history using disposable stores. Production JavaScript and complete Cargo advisory scans report zero listed vulnerabilities; development-tool advisories and informational Cargo warnings are recorded in the engineering check. Distribution signing, notices/assets, supported-system acceptance, and global offline capture remain open. The [repeatable build procedure](docs/release/building.md) has now passed locally and on GitHub, as recorded below.

### Repeatable-build check

The clean local candidate at `44c6896` passed the complete [build procedure](docs/release/building.md), producing version `0.8.0` app and DMG files with checksums and a source record. This local run reused existing build caches on macOS 26.4 with Xcode 26.6.

GitHub Mac CI run 36791520875 (private development evidence) passed on 2026-09-30 from a fresh checkout without dependency or build caches. It tested PR head `44c6896` against `main` at `41459ec`, recording test merge commit `175b6957ad73f22b90de2f01ac2bf825d6d35024`. The runner used macOS 15.7.9, Xcode 16.4, and the same pinned Node 26.8.1, pnpm 11.24.0, and Rust/Cargo 1.98.0.

Both runs passed 23 build-safeguard tests, 296 interface tests, the production interface bundle, 82 Rust tests, synthetic WAL backup/restore, native app/DMG packaging, bundle metadata and arm64 checks, local signature verification, DMG integrity, and artifact checksums. The hosted artifacts were downloaded and their checksums checked again; both local and hosted app archives extracted with executable permissions and valid local signatures. Neither build launched the app or accessed a person's database.

CI artifacts are ad hoc signed and explicitly not notarized; they are review candidates, retained on GitHub for 14 days. Hosted Tauri packaging skips Finder layout automation. Download/install appearance and all release acceptance paths remain separate checks. Apple-silicon packaging on these build hosts does not establish Intel or macOS 13 support.

### Distribution-signing preparation

The separate [local signing procedure](docs/release/signing.md) is prepared without changing ordinary development signing or adding GitHub secrets. Its 52 synthetic tests pass without a real certificate or Apple service. Read-only checks on the existing clean candidate verify hashes, archive safety, extraction, bundle metadata, executable permissions, arm64, the current local signature, hardened runtime, and empty entitlements. The available Apple Development identity is correctly rejected for public distribution.

The signing Mac has no usable Developer ID Application identity in the checked Keychain search list. Membership status and a maintainer-selected distribution certificate still need confirmation. Keychain notary-profile access, Developer ID signing, Apple's actual acceptance, stapling, signed Gatekeeper assessments, and installed-app acceptance have not passed a real run; synthetic tests are not substitutes for those checks. No signing, submission, certificate import/export, or public release was performed in this preparation step.

## 1. Set the release decisions

**Owner decisions:**

- [x] Choose a project license and copyright holder: [MIT](LICENSE), `Copyright (c) 2026 braincache`, explicitly selected by the maintainer. See [GitHub's MIT license guide](https://choosealicense.com/licenses/mit/).
- [ ] When proceeding with an official installer, confirm Apple Developer Program membership and access to a Developer ID Application certificate. Deferred for source publication.
- [ ] Confirm supported processors: Apple silicon only, or Apple silicon and Intel.
- [ ] Choose one next release version. Use the same valid app version across packaging, package manifests, release notes, and the Git tag, with a consistent policy for `VERSION`.

**Done when:** licensing, architecture support, and release identity are explicit. Do not select legal terms or publish under someone's identity by inference.

## 2. Prepare the repository for public use

- [x] Complete the initial file/history and credential review, including retained mobile code and local snapshots. Scope, evidence, limitations, and remaining privacy checks are in the [review record](docs/release/repository-review.md).
- [x] Combine release documents with GitHub `main` at `41459ec`; review the prepared diff and rescan the 146-file candidate source snapshot.
- [ ] Review any additional public GitHub surfaces and rerun scanning on the exact revision to publish.
- [x] Inventory the declared licenses of the assessed Mac production dependencies and Rust target graph. See [dependencies and assets](THIRD_PARTY.md).
- [x] Confirm project asset provenance and visually review fictional images and GIFs; see the [asset review](docs/release/asset-provenance.md).
- [ ] Prepare and verify dependency notices for the actual distributed artifact before the later app download.
- [x] Add the chosen `LICENSE` and matching package metadata.
- [x] Add the [contributor guide](CONTRIBUTING.md), [bug and feature issue forms](.github/ISSUE_TEMPLATE), [pull request template](.github/pull_request_template.md), and [security-reporting policy](SECURITY.md). GitHub Issues is enabled; the policy provides a contact-request fallback without vulnerability details.
- [ ] After the owner-authorized visibility change, enable GitHub private vulnerability reporting, verify the reporter-facing form and maintainer notifications, and update `SECURITY.md` with the active route. It is only available for public repositories; the current private-repository endpoint returned 404 with an administrator session. See [GitHub's setup instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
- [ ] Verify issue forms, the pull request template, and security-policy links on GitHub after these files reach the default branch. Local validation does not prove the hosted forms are active.
- [x] Verify documented dependency installation, automated checks, and native packaging from a fresh source checkout on the recorded environment. No private signing credentials were needed; initial DMG failure and successful retry are recorded above.
- [ ] Check a new contributor's clone/setup path after publication, including access to the hosted documentation. Validate the intended minimum tool and macOS versions before advertising a tested support matrix.
- [x] Finish the README, agent instructions, screenshots, and release documentation on the local `codex/release-preparation` branch. Hosted activation and publication remain separate.

**Done when:** a new contributor can understand the scope, build the app, report a problem, and identify the reuse terms without access to the maintainer's computer.

## 3. Close the release-specific engineering gaps

- [x] Resolve the version mismatch: current development version `0.8.0`. Preserve the app identifier and data location so existing installations retain their thoughts.
- [x] Configure production and development Content Security Policies; check native capture, editor styling, local images, attachments, and messages in the isolated production app. Full acceptance on the support matrix remains open. [Tauri CSP guidance](https://v2.tauri.app/security/csp/).
- [x] Review native command permissions, rich-text import, file opening, and production diagnostics. Narrow unused core permissions, apply the Tauri advisory patch, and run dependency scans. Limits and remaining maintenance warnings are recorded in the engineering check.
- [x] Document and test manual backup/restore with disposable data, including committed SQLite WAL pages. Installed-app recovery is still an acceptance check; an export interface can wait for the beta.
- [ ] Confirm oldest-supported macOS/webview compatibility and any architecture-specific behavior.

**Done when:** changes preserve existing data, the production configuration is deliberate, and there is a verified recovery procedure. No known data-loss, corruption, or critical security defect remains.

## 4. Make builds repeatable

- [x] Validate the [Mac CI workflow](.github/workflows/mac-ci.yml) on GitHub; the first hosted run passes as recorded above. It covers interface tests, the production interface bundle, Rust tests, synthetic backup/restore, and native Apple-silicon packaging. The final release support matrix remains an owner decision.
- [x] Record exact Node, pnpm, and Rust/Cargo versions in the [toolchain manifest](scripts/release/toolchain.json), and require locked dependency installation. The passing hosted run verifies a fresh checkout without dependency or build caches.
- [x] Add the [verified candidate-build procedure](docs/release/building.md) and script. Require matching versions and unchanged source; verify app metadata, architecture, signatures, DMG integrity, and checksums; refuse existing output folders and stale bundles.
- [x] Keep ordinary checks ad hoc signed and without distribution secrets or publishing steps. The candidate script removes signing credential variables; a privileged release-signing job is deferred.

**Done when:** the same source revision can produce the intended artifacts predictably, and failed checks prevent accidental publication. Automated publishing is optional; a reviewed manual release is acceptable.

## 5. Sign, notarize, and verify the download

Deferred for source publication. For the later direct-download release, use a Developer ID Application identity, the hardened runtime and required entitlements, Apple's notarization service, and a stapled ticket. The present ad hoc signature is for local development. Follow [Apple's notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and [Tauri's Mac signing instructions](https://v2.tauri.app/distribute/sign/macos/).

- [ ] Validate the prepared [local signing and notarization procedure](docs/release/signing.md) with the maintainer's Developer ID Application certificate and Keychain notary profile. The ordinary development build and CI stay ad hoc signed. Local prerequisite checks found only an Apple Development identity; no Developer ID Application identity or actual notarization run is available yet.
- [ ] Store signing/notarization credentials in the Keychain or protected release secrets, not in source or chat messages.
- [ ] Produce a signed, notarized, stapled DMG for each supported architecture or a verified universal build.
- [ ] Verify signatures, the notarization ticket, and Gatekeeper acceptance of the final downloadable artifact.

**Done when:** a downloaded copy installs and opens through the normal macOS flow without requiring users to disable security protections.

## 6. Test the installed app

This is a gate for the later downloadable app, not the source preview. Use sample data and the actual packaged app on the supported macOS/processor combinations, including a clean user environment or another Mac.

- [ ] Download, mount the DMG, copy to Applications, launch, quit, and relaunch.
- [ ] Open capture with `⌥ Space`, save with `⌘ Return`, and verify persistence after relaunch while offline.
- [ ] Edit rich text and checklists, attach/paste/open files, and confirm edits and bytes survive relaunch.
- [ ] Exercise search, tags, pins, completion/reopen, Trash, Undo, and Restore.
- [ ] Check reminder permission granted/denied states, notification delivery and reopening, rescheduling, and cancellation.
- [ ] Check Dock/menu-bar reopening, launch at login, single-instance behavior, keyboard focus, reduced motion, and multiple displays where available.
- [ ] Upgrade from a representative older data store and verify content, metadata, history, and attachments. Use backups and do not assume a binary downgrade can reverse a storage migration.
- [ ] Exercise relevant failure/retry cases and prove the backup/restore procedure using a disposable archive.

**Done when:** every launch-critical journey has recorded evidence and no unresolved data loss, startup failure, broken capture, or advertised feature blocker remains.

## 7. Publish the later packaged beta, then broaden

- [ ] Prepare release notes with the supported OS/processors, installation instructions, known limitations, storage/backup information, and manual update steps.
- [ ] Prepare a GitHub release with the verified DMG files and checksums, tied to the tested commit and tag.
- [ ] After signing, support-matrix and installed-app checks, publish the packaged beta release. Source visibility belongs to the earlier source-publication checklist.
- [ ] Replace the README's source-only installation message with the actual verified download link.
- [ ] Have a small group install it from the published download and report failures through the agreed support route. Resolve launch blockers before widening distribution.

**Done when:** people outside the development environment can install, use, recover, and update the released app, and the maintainer can receive and act on reports.

## Work that can wait

Apple Developer enrollment, distribution signing/notarization, official installer downloads, mobile, device sync, the Mac App Store, automatic updates, a separate marketing website, and additional features can wait beyond source publication. Before an official installer, complete its dedicated acceptance and licensing checks.

## Next action

Close the source-publication checklist: asset provenance and the content review are complete; scan the final reviewed source revision and finish hosted activation. The prepared PR contains the README, license, contributor/agent instructions, engineering fixes, CI, and reusable signing tools. Keep development history private and prepare a fresh repository with the reviewed source snapshot using the [publication procedure](docs/release/public-source.md). Verify new CI, public access, and security reporting before treating publication as complete. Apple membership and signing are deferred. Preserve the signing procedure and mobile code for their later milestones.
