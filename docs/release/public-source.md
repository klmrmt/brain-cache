# Publish a clean source snapshot

The source-only Mac preview was published October 2, 2026 (UTC) at [klmrmt/brain-cache](https://github.com/klmrmt/brain-cache). Its fresh history, public access, security configuration, and native CI were verified. The procedure below records the publication approach and safeguards for future changes. Official installers remain deferred.

The current development repository must remain private. Its historical board contains screenshot-derived note text, and some commits carry a personal email address. Replacing a file on the preparation branch does not erase either from history. A new public repository made from a reviewed source snapshot is the recommended publication route. The maintainer approved publication at `klmrmt/brain-cache` on October 1, 2026. This is a source-only Mac development preview; official installers remain deferred.

## What to publish

Export only the reviewed tracked files from the final preparation commit, including the new fictional images. Preserve all application code, retained mobile source, dependency locks, licenses, contributor guidance, and source-preview limitations. Do not copy `.git`, old branches, PRs, Actions logs/artifacts, local configuration, databases, attachment stores, signing material, dependencies, or build outputs. Do not fork, import, mirror, or push the old repository's refs.

The public package needs its README clone command and issue/security links pointed at the new destination. Replace private CI/commit hyperlinks with plain historical evidence; the new repository must run its own checks. The approved destination is `klmrmt/brain-cache`. Existing development work remains in the private repository.

## Publication checks

1. Reconcile and commit the intended source files. Export that exact revision into a new empty directory with no inherited Git metadata.
2. Review the exported filenames, text, all images and their metadata, and links. Run Gitleaks on the complete export and review potential personal information separately. Secret scanners do not perform OCR or prove that every sensitive value is absent.
3. Initialize a new repository with a single source-preview commit. Use the maintainer's verified GitHub noreply email and a project display name. Confirm its history has exactly one root commit and no old board object, inherited refs, personal email, or old remote.
4. Create the approved destination initially private; push only the fresh `main` branch. Run both the source-secret workflow and Mac CI on that source, inspect the new logs/artifacts, and verify contributor/security templates.
5. After its source and checks have passed, use the maintainer's October 1 publication approval to change only the new repository's visibility. Enable private vulnerability reporting and GitHub secret scanning/push protection where available. Verify anonymous README/license/source access and a fresh clone. Do not attach ad hoc CI candidates as official installer downloads.

Keep the original development repository private. Switching it public would expose retained history and GitHub surfaces that are deliberately excluded from the new repository.

## Future contributions

The [source-secret workflow](../../.github/workflows/source-safety.yml) scans checked-out files and all fetched Git history with checksum-verified Gitleaks 8.30.1, read-only repository permissions, no persisted checkout credentials, redacted output, runner-local default rules and a fail-closed guard that forbids repository scanner configuration/ignore files, including nested copies, and no uploaded scan report. A detected secret fails the job; this check must be required in the public repository's merge rules before relying on it as a merge gate. Scanning after a push cannot undo exposure, so also enable GitHub push protection and review staged changes before committing.

Use synthetic thoughts and files for tests and demonstrations. Review screenshot text manually, use noreply commit attribution, and keep the ignored local credential/database files out of Git. Ignore rules do not remove files already tracked. Do not paste credentials or private notes into issues, pull requests, or build logs. If an actual credential is exposed, revoke or rotate it before handling historical copies.

GitHub documents the limits of history rewriting, including surviving PR references, caches, and other clones, in [Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository). This preparation does not rewrite the development repository or claim that its private historical copies have been erased.
