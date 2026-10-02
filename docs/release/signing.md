# Mac distribution signing and notarization

Signing is deferred for the source-only preview. No Apple Developer Program membership is required for source publication or ordinary local builds. This is the later local maintainer path for turning a reviewed Apple-silicon candidate into signed, notarized review artifacts. It is separate from ordinary CI and does not publish a release. Public downloads still require the [release acceptance checks](../../RELEASE.md#6-test-the-installed-app), dependency notices, asset confirmation, and an agreed support matrix.

## Get the signing identity ready

The maintainer needs access to an Apple Developer Program team and a usable **Developer ID Application** certificate with its private key on the signing Mac. Apple Development certificates are for a different signing path. Use the team's intended public identity; do not choose a person or organization by inference. Follow [Apple's Developer ID certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).

In the developer account's Certificates, Identifiers & Profiles area, create a Developer ID Application certificate using a certificate signing request from this Mac, then install the downloaded certificate in Keychain Access. Apple documents the required account role. Keep the private key in the Keychain; do not export it into the repository.

In your own terminal, list usable signing identities:

```sh
security find-identity -v -p codesigning
```

Select the exact 40-character SHA-1 fingerprint of the intended Developer ID Application identity and its Team ID. The signing script requires both explicitly and rejects a development certificate, another team, or an ambiguous name. Do not paste passwords, private keys, `.p12` files, or notarization credentials into chat or source.

Local prerequisite check on 2026-09-30: Xcode and `notarytool` are available; this Mac exposes an Apple Development identity but no usable Developer ID Application identity. No distribution signing or notarization has been performed. This does not establish the account's membership status.

## Store notarization access in the Keychain

Run this in your own terminal with your account and team values:

```sh
xcrun notarytool store-credentials braincache-notary \
  --apple-id "<your Apple ID>" \
  --team-id "<your Team ID>"
```

Omitting `--password` makes the installed tool prompt securely for the app-specific password. Create that password in your Apple account; follow [Apple's app-specific password instructions](https://support.apple.com/en-us/102654). The local tool validates access before saving the profile. The signing script receives only the profile name, never the password. An App Store Connect API credential can also be stored using the installed tool's `store-credentials --help`; keep its key file outside the repository.

The public-download workflow follows [Apple's notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution). This setup does not add credentials to GitHub, change the default Keychain, or create a privileged pull-request workflow.

## Choose a trusted candidate

Create a clean candidate with the [verified build procedure](building.md), then review its source commit, successful checks, and artifact record. A checksum or `build-info.json` alone does not authenticate where an archive came from. Sign a candidate you built from reviewed source or obtained through an independently trusted build process; never sign an unreviewed PR artifact just because its recorded commit looks familiar.

Use the full source commit from the candidate's record as `--expected-commit`. For a hosted PR run this may be GitHub's test merge commit. Current version, app identifier, target and pinned tool values must agree with the repository's release configuration. The original candidate is preserved while the script works on a separate extracted copy.

From the repository root, replace every angle-bracket placeholder before running this check:

```sh
python3 scripts/release/sign-mac.py \
  --candidate "<verified candidate folder>" \
  --expected-commit "<full reviewed source commit>" \
  --identity "<Developer ID Application SHA-1>" \
  --team-id "<Team ID>" \
  --notary-profile braincache-notary \
  --output-dir "<new distribution output folder>" \
  --check
```

The check validates prerequisites, candidate records and archive content without signing or submitting an artifact. It may contact Apple's service to validate the named Keychain profile. It uses disposable extraction and creates no distribution output folder. Use a clean source checkout for the signing procedure.

## Sign and notarize

Run the same command without `--check` after the prerequisite check passes. The output folder must be new. Inside the repository, use a location under the ignored `release-artifacts/` folder; a new location outside the checkout is also supported.

The current app contains one native executable with no embedded frameworks or helpers. The script uses hardened runtime and a secure timestamp, with no added entitlement exceptions. Unexpected nested executable code or entitlements require a separate review. This policy follows [Apple's manual signing guidance](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac); it never uses `--deep` for signing.

The script signs and notarizes the app first, saves Apple's submission ID, requires acceptance, and staples and validates the app ticket. It creates the final app ZIP after stapling. It then creates a new compressed DMG containing the stapled app and an Applications shortcut, signs and notarizes the DMG, and staples and validates that ticket too. ZIP archives cannot have a ticket attached directly. See [Apple's packaging guidance](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution).

Successful output contains the app ZIP and DMG, `SHA256SUMS`, and a `build-info.json` record tying the final files to the reviewed candidate, selected certificate and team, and accepted notarization submissions. Hashes are computed after the tickets have been attached. Intermediate files and diagnostic records are retained for inspection; distribute only the artifacts listed in the successful final record.

Verify checksums from inside the output folder:

```sh
shasum -a 256 -c SHA256SUMS
```

## Recover a failed or interrupted attempt

Preserve the output folder and its `notarization.json` record. A timeout or interruption while waiting does not cancel Apple's processing. The script does not automatically resubmit and does not overwrite an existing attempt. If a submission ID was recorded, inspect or continue waiting for that same ID using the installed tools:

```sh
xcrun notarytool info "<submission ID>" \
  --keychain-profile braincache-notary --output-format json
xcrun notarytool wait "<submission ID>" \
  --keychain-profile braincache-notary --timeout 10m --output-format json
xcrun notarytool log "<submission ID>" \
  --keychain-profile braincache-notary "<new diagnostic log path>"
```

If the submission outcome is unknown and no ID was returned, reconcile `notarytool history --keychain-profile braincache-notary --output-format json` with the attempt's artifact, time and diagnostic record before another upload. Inspect rejection logs and resolve the cause. The script does not resume a partially completed signing attempt automatically; accepted uploads alone do not mean the final output passed its remaining checks.

## Verify the installed result

The synthetic safeguard tests pass, and real read-only checks on the existing candidate pass through archive, bundle, signature and entitlement validation before correctly rejecting the development certificate. Signature, ticket, integrity and Gatekeeper checks are part of the prepared procedure. They still need a real successful run with a Developer ID certificate. No installer is marked public-ready by synthetic tests.

After those checks pass, download the intended final DMG through a browser in a clean user environment or another Mac, mount it, copy the app to Applications, launch normally, quit and reopen, and capture sample thoughts offline. Use an isolated user with synthetic data so testing cannot touch an existing archive. Exercise notifications, global capture, upgrades and recovery as listed in the [release plan](../../RELEASE.md#6-test-the-installed-app). Preserve normal macOS security settings. Verify macOS 13 and any additional processor support before advertising them as tested.
