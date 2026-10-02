# Contributing to Brain Cache

Brain Cache is a source-only Mac development preview. A signed, notarized installer is deferred; contributing and local builds do not require Apple Developer Program membership. Useful contributions include reproducible bug reports, documentation fixes, and focused improvements to local capture and retrieval. Mobile and device sync are deferred; their retained code is not a promise of release support.

## Report a problem or propose a change

Search [existing issues](https://github.com/klmrmt/brain-cache/issues) before opening a report. Use the bug-report form for broken behavior and the feature-request form to explain a problem and the outcome you need. Discuss substantial changes before implementing them; the [backlog](FEATURE_BACKLOG.md) records ideas, not commitments to accept every implementation.

Include the app version or source commit, macOS version, Mac processor, reproduction steps, and expected result. State whether you used the native app or browser preview. Use synthetic notes and attachments; remove personal information from logs and screenshots.

For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md). Do not put vulnerability details or credentials in an ordinary issue or pull request.

## Set up development

1. Fork the repository and clone your fork.
2. Follow the [Mac requirements and setup instructions](README.md#building-from-source). Use the pnpm version in [`apps/mac/package.json`](apps/mac/package.json) and install with `pnpm install --frozen-lockfile` from `apps/mac`.
3. Create a branch for your change. Read [AGENTS.md](AGENTS.md) for the shared development rules and [ARCHITECTURE.md](ARCHITECTURE.md) for the affected system boundaries. Read [DESIGN.md](DESIGN.md) before changing the interface.
4. Run `pnpm tauri dev` from `apps/mac` for native development, or `pnpm dev` for a browser-only interface preview.

The unbundled `pnpm tauri dev` process cannot use macOS notifications. It keeps capture available and reports a retryable reminder error; build and open the `.app` for notification testing.

For the exact CI toolchain and a verified candidate build, follow the [Mac build procedure](docs/release/building.md). Build-script changes also require `python3 scripts/release/test-build-mac.py`; these tests use synthetic fixtures without building or launching the app.

Distribution signing uses a separate [local maintainer procedure](docs/release/signing.md). Changes to that script require `python3 scripts/release/test-sign-mac.py`; its synthetic checks never use a signing identity or contact Apple.

Local builds use ad hoc signing. You do not need the maintainer's signing certificate, notarization credentials, API keys, or a backend account to contribute.

The native development app uses the same application identifier and default data directory as an installed Brain Cache app. Use a separate macOS user account containing only sample data for manual native tests. The browser preview has separate local storage, but cannot verify native persistence, global shortcuts, or notifications.

## Make and verify a focused change

Preserve the fast capture path and verified local writes. Keep edits small, reuse the existing components, and preserve older records. Add focused tests for changed behavior, including relevant failures and retries. Use temporary stores and synthetic data in automated tests.

[AGENTS.md — Verification](AGENTS.md#verification) is the authoritative checklist:

- Mac application changes require React tests, the production interface build, Rust tests, and a real Tauri build, plus the native walking path. A browser preview is not native acceptance.
- Documentation changes require checking links, paths, commands, and claims, followed by `git diff --check`.
- Changes to retained mobile code require the separate [iPhone verification](apps/ios/README.md). Mac-only work does not require iPhone acceptance unless shared-contract changes affect it.

Update documentation made inaccurate by your change and add user-visible changes to [CHANGELOG.md](CHANGELOG.md). Keep dependency lockfiles unless dependency changes are intentional. Do not commit generated dependencies, build outputs, local databases, signing material, or machine-specific Xcode state.

## Open a pull request

Target `main`. Explain the problem, what changes for a user, and the checks you actually ran. Include the native app path exercised when applicable and clearly label checks you could not run. For interface changes, include screenshots with sample data and describe keyboard and reduced-motion behavior.

Submit only material you have permission to contribute under the project's [MIT License](LICENSE). Preserve third-party notices and record the source and terms of any new assets or dependencies; see [THIRD_PARTY.md](THIRD_PARTY.md).
