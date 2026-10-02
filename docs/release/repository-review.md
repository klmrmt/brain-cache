# Initial public-repository review

Reviewed on 2026-09-29. The working checkout is based on `50ed1e9`. GitHub's `main` was `41459ec`, four commits ahead, when remote branch tips were checked. This report records preparation work; it is not approval to publish or a complete application security audit.

## Completed

- Added the [MIT License](../../LICENSE) with the maintainer-selected notice `Copyright (c) 2026 braincache`. Updated the README and JavaScript/Rust license metadata.
- Reviewed the current file inventory and filenames across reachable local history, including retained mobile code, the old Mac prototype, branches, and local Codex snapshots.
- Ran Gitleaks 8.30.1 from an official release whose archive matched its published SHA-256 checksum. Reports remained outside the repository; secret values were redacted. Inline `gitleaks:allow` comments were not honored.
- Scanned all local Git refs with `gitleaks git --log-opts=--all`; the scanner reported 122 commits examined and no findings. Git enumerated 140 reachable commits overall; Gitleaks' count reflects its diff scan.
- Separately scanned the full contents of 770 unique reachable file objects, commit metadata, and a 126-file working-tree snapshot taken before these license-review documents were added. This supplements the diff-based history scan.
- Scanned bodies from all 19 existing GitHub pull requests. The queries returned no issues, issue comments on those pull requests, submitted reviews, or inline review comments. No secret matches were found in this text.
- Recorded 61 JavaScript production packages and 280 external Rust packages in the [dependency inventory](dependency-licenses.csv). See [dependencies and assets](../../THIRD_PARTY.md) for its scope and remaining distribution work.
- Added ignore rules for local environment files, signing keys, application databases and SQLite sidecars, and the pnpm store. Example environment files remain allowed.
- Rechecked the resulting 129 tracked/candidate files with Gitleaks: no findings. Local documentation links, Markdown whitespace, ignore-rule behavior, JavaScript license metadata, and locked offline Cargo metadata checks passed; `git diff --check` passed. No application behavior changed, so application tests and builds were not repeated for this documentation/metadata slice.

## Findings and disposition

| Finding | Disposition |
| --- | --- |
| One generic-key match in a local snapshot's encryption fixture | Checked the bytes: this is a deterministic ascending-byte test vector, not an operational credential. It was not reachable from any `origin` branch. No credential removal or history rewrite was needed. |
| A pnpm SQLite index in a local snapshot | A dependency cache, not a Brain Cache thought database. It was not present in the history of the working branch or `origin/main`. Added a pnpm-store ignore rule. |
| Git identities | Commit history includes author/committer names and email addresses. Those will be visible with public history. This review did not alter attribution or rewrite commits. |
| Remote branch ahead of checkout | History scanning included the locally available remote commits. Documentation, dependency, and build evidence is based on the stated checkout. Reconcile the four newer commits and refresh the assessment before choosing a release revision. |
| Asset provenance | The SVG and rendered icon were inspected, as was the capture design board. Maintainer confirmation of permission to publish the icon, board, and its sample task text is pending. README screenshots use synthetic data. |
| Third-party notices | Package license declarations were inventoried. A complete notice bundle for a downloadable app has not yet been assembled or checked in the packaged artifact. |

## What this establishes

No operational credentials were identified in the material scanned. Gitleaks used its built-in rules and default allowlists. Pattern scanning cannot prove the absence of secrets or personal information. Images were visually inspected; the scanner does not perform OCR. No suspected credentials were sent to an issuing service for validation.

The dependency inventory came from installed package manifests and the locked, offline Cargo graph for `aarch64-apple-darwin`. The installed pnpm store could not produce its license report because package-index metadata was missing; the JavaScript inventory instead traversed installed production dependencies and required peers, with no unresolved required packages. License declarations alone do not establish that every upstream notice has been collected.

GitHub Actions logs/artifacts, deleted content, and other private services were not reviewed. Wiki and Discussions were verified disabled during the contributor-setup follow-up. Before changing visibility, inspect any additional content that exists and will become accessible. This review did not change repository visibility, publish a release, push commits, or rewrite history.

## Contributor setup follow-up

The contributor and security guides, issue forms, and pull request template were added after the initial scan. Local links/anchors, YAML parsing and form structure, whitespace, and a secret scan of these documents passed. The GitHub API confirmed that Issues is enabled and the repository is still private; the private-vulnerability-reporting endpoint returned 404 with administrator access, consistent with GitHub's public-repository requirement.

The documented installation and build commands were also exercised in a fresh managed worktree of `41459ec`, without modifying its source. Dependency installation, 296 interface tests, 79 Rust tests, and the production interface build passed. Native app and DMG packaging completed on a verbose retry after the first DMG attempt failed. See [the release plan](../../RELEASE.md#contributor-setup-check-on-41459ec) for the environment, packaging limitation, and distinction from installed-app acceptance.

## Remaining before source publication

- [x] Verify the original icon and design-board creation records, with evidence and limits in the [asset review](asset-provenance.md).
- [x] Replace the screenshot-derived board with fictional text-only generation; exclude the private historical board from the proposed fresh public source repository.
- [ ] Reconcile this checkout with the intended release branch, then check the final diff and rerun secret scanning on the exact commit to publish.
- [x] Review existing Git identities and GitHub surfaces; retain the development repository privately and prepare fresh noreply-attributed public history.
- [x] Prepare the [contributor guide](../../CONTRIBUTING.md), issue forms, pull request template, and [security policy](../../SECURITY.md). GitHub Issues was verified enabled; wiki and discussions were disabled when checked.
- [x] Check installation, automated tests, and native packaging in a fresh source checkout of `41459ec`, with the limitations recorded above.
- [ ] Activate/check the hosted templates and GitHub private vulnerability reporting as described in the [release plan](../../RELEASE.md). The private-report endpoint is currently unavailable; the policy documents a contact-request fallback.
- [x] Maintainer chose source-first publication on 2026-10-01; close the remaining content checks before making the repository public.

Before a downloadable app release, also assemble and verify the notices described in [THIRD_PARTY.md](../../THIRD_PARTY.md), alongside the remaining native release checks. The app's own MIT license is in place; installer licensing work remains.

## Combined branch follow-up — September 30, 2026

Release documentation is combined with `41459ec` on `codex/release-preparation`. Current version, production policy, native permissions, dependency patch, startup fix, and native/test evidence are recorded in the [engineering check](engineering-review.md). A new 146-file candidate source snapshot passed Gitleaks 8.30.1 with no findings. This included the prepared documents, screenshots, and synthetic recovery verifier. The final publication commit and GitHub surfaces still require the publication-time check above; no source or installer was published by this preparation work.

## Source-first follow-up — October 1, 2026

The maintainer chose a source-only Mac preview and deferred Apple enrollment and official installer distribution. The [release checklist](../../RELEASE.md#source-publication-checklist) now separates source publication from later signing/notarization, artifact notices, and installed-app acceptance. Revision `186af48` passed Mac CI (private development evidence), including 453 automated tests and native ad hoc app/DMG packaging. This follow-up changes documentation only; it does not establish a signed download or additional runtime acceptance.

The icon’s SVG addition was found in the original Codex implementation record. The design board’s image-generation record was found in the maintainer’s earlier project chat, and its original generated PNG matches the checked-in file byte for byte. This resolves the missing generation origin described in the initial review. The board reuses text from an app screenshot; public suitability of that task text cannot be determined from the creation record. See the [asset review](asset-provenance.md).

Publication-time review on October 1 covered the nine remote branch heads present locally, twenty PRs, all three retained Actions runs and their three candidate artifacts. The API returned no ordinary issues, issue/review/commit comments, submitted reviews, releases, or tags. Wiki, Discussions, and Pages were disabled. Approximately 878 KB of PR text, Actions logs, checksums, and build records passed Gitleaks with redaction. A GitHub-generated temporary clone token in the administrator API response was removed from the temporary review capture; it was not stored repository content and was never published.

All artifact manifests record clean source and no notarization. Their four members are the expected app ZIP, DMG, checksums, and build record. Artifact binaries were not separately inspected in this follow-up. Deleted content and later changes remain outside this snapshot. The source tree includes no vendored dependency directories or font binaries.

The source-only documentation update passed 108 local path/anchor checks, configuration/command review, and `git diff --check`. A 155-file candidate source snapshot and the 88-commit diff scan across all remote branch history passed Gitleaks with inline allow comments disabled. The earlier complete reachable-object scan supplements this history diff scan. Git attribution includes the maintainer’s name and email identities plus GitHub service attribution; the fresh public source history excludes those private identities and uses the project name with GitHub noreply attribution. Final commit scanning and hosted activation remain publication steps.

## Privacy and replacement follow-up — October 1, 2026

The maintainer asked to remove screenshot-derived board content, create fictional example images, and check public-source suitability for personal information and tokens. The current board was replaced by a text-only generated concept board with three generic invented notes; a second generated plant study is available as a synthetic example attachment. Neither generation used a screenshot or reference image. The three README screenshots were visually rechecked and contain generic synthetic notes. Prompts and final hashes are in the [asset review](asset-provenance.md).

The independent privacy review examined source text and the 623 unique file blobs reachable through ten locally retained remote-tracking refs, covering 94 commits. GitHub advertised nine actual branches with 87 reachable commits; the extra local ref retained a deleted mobile branch. No real email, personal home path, private service link, or operational credential was identified in source text. Gitleaks 8.30.1 scanned full historical blob contents and commit metadata, with redaction and inline allow comments disabled; no findings were reported.

The historical board is reachable from eight of the nine actual GitHub branches. Seventeen of the 87 reachable commits carry a personal, non-noreply email address. Those are publication blockers for the existing repository, even though replacing the current board fixes the current source snapshot. The maintainer approved a fresh public source repository at `klmrmt/brain-cache` on October 1, 2026. See the [clean-source procedure](public-source.md). The development repository remains private, with no history rewrite or visibility change.

All twenty PR titles/bodies and four retained successful Actions logs, about 992 KB of text, passed separate personal-information checks and a full Gitleaks scan. The only home paths identified were standard GitHub runner paths. Four retained candidate artifacts were inventoried; their binaries were not fully audited in this pass and must not be copied to the new public repository. No issues, submitted reviews, issue/review/commit comments, releases, or tags were present in the earlier surface inventory; wiki, Discussions, and Pages were disabled. Deleted remote content and other private services remain outside this review.

Automatic source-secret checks now run on pushes and pull requests. They are a detection aid, not proof of complete privacy or a substitute for screenshot review and GitHub push protection. Application behavior is unchanged by this documentation, image, ignore-rule, and workflow slice.

Local checks covered 133 documentation paths/anchors, workflow structure and shell syntax, the scanner's published archive checksum, credential/database ignore behavior, and a 160-file full-source scan. A synthetic, never-issued token pattern was rejected with redacted output despite an inline allow marker. Independent review also demonstrated that checked-out scanner configuration could suppress a finding; the workflow now selects trusted runner-local default rules and rejects any repository scanner configuration or ignore file, including nested copies, before scanning. Explicit ignore-path selection alone did not prevent repository ignore fingerprints from suppressing findings in Gitleaks 8.30.1; the fail-closed file guard closes that separate bypass. Generated-image metadata was separately checked for user identity, reference paths, prompt data, and credentials, with no such finding.

The scanner guard runs Python in isolated mode so a checkout module cannot replace the standard-library path walker. Independent synthetic checks verified clean-source acceptance, root/nested suppression rejection, and resistance to a shadowed path module. No application data was used.

Hosted source-secret checks passed on the reviewed preparation branch. Mac CI then exposed two existing focus-test timing races: the next simulated interaction began before the prior tag commit's deferred input focus finished. The tests now await the existing animation-frame helper without changing assertions or application behavior. The failure reproduced in two of five focused baseline runs; the corrected tests passed ten consecutive focused runs, all 296 interface tests, TypeScript, and the production bundle. Final hosted Mac CI is rerun on this test-only correction. No manual native path was repeated for the image/documentation and test-timing changes.

## New public repository verification — October 2, 2026 (UTC)

The approved [source preview](https://github.com/klmrmt/brain-cache) was created privately from 168 reviewed source files and made public after its own source-secret and Mac checks passed. Its one fresh root and subsequent preparation commits use project/GitHub noreply attribution; no old branches, board object, private commits, PRs, or build logs were imported. The original development repository remains private. Anonymous cloning and hosted documentation were verified; private vulnerability reporting, secret scanning, and push protection are enabled.

The exact new source/history scans found no credentials, personal email, or home paths. New successful Mac logs and one temporary artifact passed separate privacy review. The artifact contained only the expected app ZIP, DMG, checksums, and clean-source build record. Readable app/resource strings and a read-only DMG inventory were scanned; the app was not launched and the volume was detached. No detected secret or private PII was found, but static inspection is not exhaustive binary analysis. The reviewed candidate was removed from GitHub, and source-preview CI skips public app uploads. No official installer or GitHub Release is hosted. No private report or maintainer notification test was submitted.
