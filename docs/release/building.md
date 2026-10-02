# Verified Mac candidate builds

This procedure builds an Apple-silicon candidate for review. The first public milestone is a source-only preview; this procedure does not publish a GitHub release or produce an official downloadable app. Signing, supported-system acceptance, and installed-app checks belong to the later installer milestone in [the release plan](../../RELEASE.md).

## Prepare the build environment

Use an Apple-silicon Mac, Python 3.9 or later, and a full Xcode installation selected with `xcode-select`. The build records the selected Xcode and macOS versions. The pinned [toolchain manifest](../../scripts/release/toolchain.json) currently requires:

| Tool | Exact version |
| --- | --- |
| Node.js | 26.8.1 |
| pnpm | 11.24.0 |
| Rust and Cargo | 1.98.0 |
| Rust target | `aarch64-apple-darwin` |

Install the exact Node version from [Node.js downloads](https://nodejs.org/en/download). With Node available, install the declared pnpm version:

```sh
npm install --global --ignore-scripts pnpm@11.24.0
```

For a [rustup](https://rustup.rs/) installation, install and select the pinned toolchain in this checkout:

```sh
rustup toolchain install 1.98.0 --profile minimal --target aarch64-apple-darwin
rustup override set 1.98.0
```

An existing Rust installation is also usable if `rustc` and `cargo` report the exact versions and the native host is Apple silicon. Network access is needed to obtain dependencies and toolchains.

## Build from a clean commit

Run from the repository root with no uncommitted source changes. The script checks that `VERSION`, the JavaScript package, Cargo manifest and lockfile, and Tauri configuration agree. The current development version is `0.8.0`; it is not a published release tag.

To check the environment without installing dependencies or creating artifacts:

```sh
python3 scripts/release/build-mac.py --check
```

To verify and package the candidate:

```sh
python3 scripts/release/build-mac.py
```

The script runs its build-safeguard tests, locked pnpm installation, interface tests and production bundle, locked Rust tests, the synthetic backup/restore check, and a real Tauri build targeting `aarch64-apple-darwin`. It explicitly requests both the app and DMG. It then checks the app version and identifier, arm64 executable, local code signature, DMG integrity, and file checksums. It stops if the source changes during verification or the expected bundles were not regenerated.

Successful output goes to a new ignored folder named `release-artifacts/<version>-<commit-prefix>/`. To use another location, pass a new folder:

```sh
python3 scripts/release/build-mac.py --output-dir /tmp/braincache-candidate-review
```

Existing output folders are refused, including a folder another build creates while this build runs. Inspect any failed or partial output and choose a new folder before trying again. The script never overwrites an earlier candidate.

`--allow-dirty` is available for local exploration. Its verification record includes `sourceDirty: true`; use a clean committed source for a candidate intended for release review.

## Review the outputs

| File | Purpose |
| --- | --- |
| `Brain Cache_<version>_aarch64.dmg` | Ad hoc signed local installer candidate |
| `Brain Cache_<version>_aarch64.app.zip` | App archive created with macOS `ditto` to preserve bundle metadata and permissions |
| `SHA256SUMS` | SHA-256 checksums for the DMG and app archive |
| `build-info.json` | Source commit and fingerprint, dirty status, architecture, versions, signing status, environment, artifact sizes and hashes |

From inside the output folder, verify the delivered files:

```sh
shasum -a 256 -c SHA256SUMS
```

The checksums detect damaged or changed files. They do not establish publisher identity. The app uses the checked-in ad hoc signing identity; the script removes signing and notarization credential variables from its child processes and records `notarized: false`.

The build does not launch the app or open a person's database. Use an isolated macOS user with synthetic data for the [native acceptance paths](../../AGENTS.md#mac-application-changes). Automated packaging cannot prove global capture, notification delivery, installation, upgrades, or recovery on the release support matrix. Hosted Tauri builds skip Finder layout automation for the DMG; installer appearance also needs the release acceptance check.

## GitHub checks

[Mac CI](../../.github/workflows/mac-ci.yml) runs this same procedure on pull requests, pushes to `main`, and manual requests. It uses the arm64 `macos-15` runner, exact tool versions, immutable action revisions, a read-only repository token, and a fresh checkout without dependency or build caches. Public source-preview checks build and verify the candidates without uploading app downloads. Private repositories can retain successful artifacts for 14 days; setting the repository variable `UPLOAD_MAC_CANDIDATES` to `false` disables that upload there as well. Failed checks prevent the upload step. For pull requests, `build-info.json` records GitHub's test merge commit, which can differ from the PR head; use that record when identifying the built source.

The runner selection follows [GitHub's hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). It is a build host, not a declaration of Intel support or proof that macOS 13 works. macOS and Xcode are recorded rather than pinned to an immutable image, so this procedure aims for traceable, repeatable checks and packaging, not byte-for-byte identical artifacts.

Distribution signing and notarization use the separate [local maintainer procedure](signing.md). Mac CI also runs synthetic tests for its safeguards; those tests use no Keychain identity or Apple service. No workflow publishes a release, changes repository visibility, or receives distribution signing secrets. Add privileged signing only to a separately reviewed trusted release job when the maintainer has chosen the distribution identity and support matrix.
