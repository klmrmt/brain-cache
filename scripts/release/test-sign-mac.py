#!/usr/bin/env python3
"""Verify signing safeguards using synthetic artifacts and mocked commands only.

No test accesses a Keychain, signs real code, submits to Apple, mounts an image,
launches an app, downloads dependencies, or reads a person's database.
"""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from unittest.mock import patch


sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name("sign-mac.py")
spec = importlib.util.spec_from_file_location("braincache_signing", SCRIPT)
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class SigningGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="braincache-signing-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "source"
        self.mac = self.root / "apps/mac"
        self.native = self.mac / "src-tauri"
        self.native.mkdir(parents=True)
        (self.root / "scripts/release").mkdir(parents=True)
        self.version = "0.8.0"
        self.product = "Brain Cache"
        self.identifier = "com.braincache.synthetic-test"
        self.app_name = self.product + ".app"
        self.commit = "a" * 40
        self.identity = "B" * 40
        self.team = "SYNTHETIC1"
        self.profile = "synthetic-profile"
        self.tools = {"node": "26.8.1", "pnpm": "11.24.0", "rust": "1.98.0",
                      "target": "aarch64-apple-darwin"}
        self.config = {"version": self.version, "identifier": self.identifier,
                       "productName": self.product,
                       "bundle": {"macOS": {"signingIdentity": "-"}}}
        self.write_json(self.mac / "package.json", {
            "version": self.version, "packageManager": "pnpm@" + self.tools["pnpm"],
        })
        self.write_json(self.native / "tauri.conf.json", self.config)
        (self.root / "VERSION").write_text(self.version + "\n")
        (self.native / "Cargo.toml").write_text(
            '[package]\nname = "brain-cache-mac"\nversion = "0.8.0"\n')
        (self.native / "Cargo.lock").write_text(
            '[[package]]\nname = "brain-cache-mac"\nversion = "0.8.0"\n')
        self.write_json(self.root / "scripts/release/toolchain.json", self.tools)
        self.candidate = self.base / "candidate"
        self.candidate.mkdir()
        self.output = self.base / "distribution"
        self.prefix = self.product + "_" + self.version + "_aarch64"
        self.archive = self.candidate / (self.prefix + ".app.zip")
        self.dmg = self.candidate / (self.prefix + ".dmg")
        self.dmg.write_bytes(b"synthetic candidate image; never mounted")
        self.bundle_info = {
            "CFBundleShortVersionString": self.version,
            "CFBundleVersion": self.version,
            "CFBundleIdentifier": self.identifier,
            "CFBundleExecutable": "synthetic-cache",
            "CFBundlePackageType": "APPL",
        }
        self.members = {
            self.app_name + "/": (b"", stat.S_IFDIR | 0o755),
            self.app_name + "/Contents/Info.plist": (
                plistlib.dumps(self.bundle_info), stat.S_IFREG | 0o644),
            self.app_name + "/Contents/MacOS/synthetic-cache": (
                b"\xcf\xfa\xed\xfe" + b"synthetic executable; never launched", stat.S_IFREG | 0o755),
            self.app_name + "/Contents/Resources/sample.txt": (
                b"synthetic resources", stat.S_IFREG | 0o644),
        }
        self.write_archive()
        self.build_info = {
            "version": self.version, "commit": self.commit, "sourceDirty": False,
            "sourceFingerprint": hashlib.sha256(b"").hexdigest(),
            "target": self.tools["target"], "identifier": self.identifier,
            "signing": "ad hoc", "notarized": False, "tools": dict(self.tools, cargo=self.tools["rust"]),
            "artifacts": [],
        }
        self.refresh_candidate()
        self.calls = []
        self.environments = []
        self.git_status = ""
        self.git_commit = self.commit
        self.git_commits = []
        self.git_reads = 0
        self.certificate_name = "Developer ID Application: Synthetic Publisher (" + self.team + ")"
        self.certificate_team = self.team
        self.certificate_identity = self.identity
        self.architecture = "arm64"
        self.entitlements = {}
        self.runtime_flags = "0x10002(adhoc,runtime)"
        self.submission_status = "Accepted"
        self.notary_exception = None
        self.notary_wait_exception = None
        self.notary_stdout = None
        self.notary_returncode = 0
        self.notary_log_status = None
        self.notary_log_job = None
        self.notary_log_issues = []
        self.notary_log_digest = None
        self.notary_log_filename = None
        self.log_metadata = True
        self.notary_wait_stdout = None
        self.notary_log_stdout = None
        self.history_stdout = None
        self.certificate_has_oid = True
        self.fail_when = lambda command: False
        self.on_command = lambda command: None
        self.signed_paths = set()
        self.stapled_paths = set()
        self.submissions = []
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(signing, "ROOT", self.root))
        self.stack.enter_context(patch.object(signing, "MAC", self.mac))
        self.stack.enter_context(patch.object(signing.platform, "system", return_value="Darwin"))
        self.stack.enter_context(patch.object(signing, "run", side_effect=self.fake_run))
        self.stack.enter_context(patch.object(signing, "read_contract", return_value=(
            self.version, self.config, self.tools)))
        self.stack.enter_context(patch.object(signing.subprocess, "run", side_effect=AssertionError(
            "All external commands must use the mocked signing.run seam.")))

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value, indent=2) + "\n")

    @staticmethod
    def hash_file(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def write_archive(self):
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, (data, mode) in self.members.items():
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = mode << 16
                archive.writestr(info, data)

    def refresh_candidate(self):
        self.build_info["artifacts"] = [
            {"name": path.name, "sha256": self.hash_file(path), "bytes": path.stat().st_size}
            for path in (self.dmg, self.archive)
        ]
        self.write_json(self.candidate / "build-info.json", self.build_info)
        (self.candidate / "SHA256SUMS").write_text("".join(
            item["sha256"] + "  " + item["name"] + "\n" for item in self.build_info["artifacts"]
        ))

    def invoke(self, *arguments):
        args = ["--candidate", str(self.candidate), "--expected-commit", self.commit,
                "--identity", self.identity, "--team-id", self.team,
                "--notary-profile", self.profile, "--output-dir", str(self.output),
                *arguments]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            signing.main(args)

    def result(self, command, stdout="", stderr="", returncode=0):
        return subprocess.CompletedProcess(command, returncode, stdout, stderr)

    def fake_run(self, arguments, env=None, timeout=120, cwd=None):
        command = tuple(str(value) for value in arguments)
        self.calls.append(command)
        self.environments.append(dict(env or {}))
        self.on_command(command)
        if self.fail_when(command):
            return self.result(command, stderr="synthetic private failure", returncode=1)
        program = Path(command[0]).name
        if program == "git":
            if "status" in command:
                return self.result(command, self.git_status)
            revision = self.git_commits[min(self.git_reads, len(self.git_commits) - 1)] if self.git_commits else self.git_commit
            self.git_reads += 1
            return self.result(command, revision)
        if program == "security" and "find-identity" in command:
            return self.result(command, '  1) ' + self.certificate_identity + ' "' + self.certificate_name + '"\n     1 valid identities found\n')
        if program == "security" and "find-certificate" in command:
            return self.result(command, "-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----\n")
        if program == "security" and "verify-cert" in command:
            return self.result(command)
        if program == "openssl":
            if "-fingerprint" in command:
                fingerprint = ":".join(self.certificate_identity[index:index + 2] for index in range(0, 40, 2))
                return self.result(command, "SHA1 Fingerprint=" + fingerprint + "\n")
            if "-subject" in command:
                return self.result(command, "subject=\n    CN = " + self.certificate_name +
                                   "\n    OU = " + self.certificate_team + "\n")
            if "-text" in command:
                return self.result(command, "X509v3 extensions:\n  " +
                                   (signing.DEVELOPER_ID_OID if self.certificate_has_oid else "synthetic other OID") + "\n")
            return self.result(command)
        if program == "lipo":
            return self.result(command, self.architecture)
        if program == "codesign":
            path = Path(command[-1])
            if "--sign" in command:
                self.signed_paths.add(str(path))
                if path.is_dir():
                    executable = path / "Contents/MacOS/synthetic-cache"
                    executable.write_bytes(executable.read_bytes() + b" signed")
                else:
                    path.write_bytes(path.read_bytes() + b" signed")
                return self.result(command)
            if "--entitlements" in command:
                return self.result(command, plistlib.dumps(self.entitlements).decode())
            if "-d" in command or "--display" in command:
                signed = str(path) in self.signed_paths or (path.is_dir() and (path / "Contents/MacOS/synthetic-cache").read_bytes().endswith(b" signed"))
                stderr = ("Identifier=" + self.identifier + "\nSignature=adhoc\nTeamIdentifier=not set\n" +
                          "CodeDirectory v=20500 size=123 flags=" + self.runtime_flags + "\n")
                if signed:
                    stderr = ("Identifier=" + self.identifier + "\nAuthority=" + self.certificate_name +
                              "\nAuthority=Developer ID Certification Authority\nTeamIdentifier=" + self.team +
                              "\nCodeDirectory v=20500 size=123 flags=0x10000(runtime)\nTimestamp=Sep 30, 2026 at 12:00:00\n")
                return self.result(command, stderr=stderr)
            return self.result(command)
        if program == "ditto":
            if "-x" in command:
                with zipfile.ZipFile(command[-2]) as archive:
                    archive.extractall(command[-1])
                    for info in archive.infolist():
                        extracted = Path(command[-1]) / info.filename
                        if extracted.is_file():
                            extracted.chmod((info.external_attr >> 16) & 0o777)
                return self.result(command)
            app = Path(command[-2])
            destination = Path(command[-1])
            if "-c" not in command:
                shutil.copytree(app, destination)
                return self.result(command)
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.write(app, app.name)
                for path in app.rglob("*"):
                    if path.is_file():
                        archive.write(path, path.relative_to(app.parent))
            return self.result(command)
        if program == "hdiutil" and "create" in command:
            Path(command[-1]).write_bytes(b"synthetic rebuilt image")
            return self.result(command)
        if program == "xcrun" and "notarytool" in command:
            if "submit" in command:
                self.submissions.append(command)
                if self.notary_exception:
                    raise self.notary_exception
                submission = "11111111-1111-1111-1111-" + str(len(self.submissions)).zfill(12)
                stdout = self.notary_stdout if self.notary_stdout is not None else json.dumps({
                    "id": submission, "status": self.submission_status, "message": "Synthetic response"})
                return self.result(command, stdout, returncode=self.notary_returncode)
            if "history" in command:
                return self.result(command, self.history_stdout if self.history_stdout is not None
                                   else json.dumps({"history": []}))
            submission = command[3]
            if "log" in command:
                value = {
                    "jobId": self.notary_log_job or submission,
                    "status": self.notary_log_status or self.submission_status,
                    "statusCode": 0 if self.submission_status == "Accepted" else 4000,
                    "issues": self.notary_log_issues}
                if self.log_metadata:
                    submitted_path = Path(self.submissions[-1][3])
                    value["sha256"] = self.notary_log_digest or self.hash_file(submitted_path)
                    value["archiveFilename"] = self.notary_log_filename or submitted_path.name
                stdout = self.notary_log_stdout if self.notary_log_stdout is not None else json.dumps(value)
                return self.result(command, stdout)
            if "wait" in command and self.notary_wait_exception:
                raise self.notary_wait_exception
            return self.result(command, self.notary_wait_stdout if self.notary_wait_stdout is not None
                               else json.dumps({"id": submission, "status": self.submission_status}))
        if program == "xcrun" and "stapler" in command:
            path = Path(command[-1])
            if "staple" in command:
                self.stapled_paths.add(str(path))
                if path.is_dir():
                    (path / "Contents/Resources/synthetic-ticket").write_bytes(b"stapled synthetic ticket")
                else:
                    path.write_bytes(path.read_bytes() + b" stapled synthetic ticket")
            return self.result(command)
        if program in {"hdiutil", "spctl", "shasum", "xcodebuild", "sw_vers"}:
            return self.result(command, "synthetic tool output")
        raise AssertionError("Unexpected external command: " + str(command))

    def assert_no_submission(self):
        self.assertEqual(self.submissions, [])
        self.assertFalse(any("--sign" in command for command in self.calls))

    def test_check_is_read_only_and_does_not_sign_or_submit(self):
        before = {path.name: path.read_bytes() for path in self.candidate.iterdir()}
        self.invoke("--check")
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.candidate.iterdir()})
        self.assertFalse(self.output.exists())
        self.assert_no_submission()
        self.assertFalse(any("create" in command or "staple" in command for command in self.calls))

    def test_changed_candidate_bytes_are_rejected(self):
        self.archive.write_bytes(self.archive.read_bytes() + b" tampered")
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_dirty_candidate_is_rejected(self):
        self.build_info["sourceDirty"] = True
        self.refresh_candidate()
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_candidate_from_another_commit_is_rejected(self):
        self.build_info["commit"] = "c" * 40
        self.refresh_candidate()
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_candidate_contract_drift_is_rejected(self):
        for field, value in (("version", "99.0.0"), ("identifier", "com.synthetic.other"),
                             ("target", "x86_64-apple-darwin")):
            with self.subTest(field=field):
                original = self.build_info[field]
                self.build_info[field] = value
                self.refresh_candidate()
                with self.assertRaises((ValueError, RuntimeError)):
                    self.invoke("--check")
                self.build_info[field] = original
        self.assert_no_submission()

    def test_dirty_source_checkout_is_rejected(self):
        self.git_status = " M VERSION"
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_source_commit_change_during_preflight_is_rejected(self):
        self.git_commits = [self.commit, "d" * 40]
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_development_certificate_is_rejected(self):
        self.certificate_name = "Apple Development: Synthetic Publisher (" + self.team + ")"
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_wrong_identity_or_certificate_team_is_rejected(self):
        for field, value in (("certificate_identity", "E" * 40), ("certificate_team", "OTHERTEAM1")):
            with self.subTest(field=field):
                original = getattr(self, field)
                setattr(self, field, value)
                with self.assertRaises((ValueError, RuntimeError)):
                    self.invoke("--check")
                setattr(self, field, original)
        self.assert_no_submission()

    def test_archive_traversal_is_rejected_before_extraction(self):
        self.members["../escape"] = (b"not extracted", stat.S_IFREG | 0o644)
        self.write_archive()
        self.refresh_candidate()
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assertFalse(any("-x" in command for command in self.calls))
        self.assertFalse((self.base / "escape").exists())
        self.assert_no_submission()

    def test_archive_symlink_is_rejected_before_extraction(self):
        self.members[self.app_name + "/Contents/Resources/link"] = (b"/tmp", stat.S_IFLNK | 0o777)
        self.write_archive()
        self.refresh_candidate()
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assertFalse(any("-x" in command for command in self.calls))
        self.assert_no_submission()

    def test_unexpected_nested_code_is_rejected(self):
        self.members[self.app_name + "/Contents/Resources/helper"] = (
            b"\xcf\xfa\xed\xfeunexpected nested code", stat.S_IFREG | 0o755)
        self.write_archive()
        self.refresh_candidate()
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_dangerous_entitlements_are_rejected(self):
        self.entitlements = {"com.apple.security.get-task-allow": True}
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_wrong_app_metadata_and_architecture_are_rejected(self):
        self.architecture = "x86_64"
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.architecture = "arm64"
        self.bundle_info["CFBundleIdentifier"] = "com.synthetic.other"
        self.members[self.app_name + "/Contents/Info.plist"] = (
            plistlib.dumps(self.bundle_info), stat.S_IFREG | 0o644)
        self.write_archive()
        self.refresh_candidate()
        with self.assertRaises((ValueError, RuntimeError)):
            self.invoke("--check")
        self.assert_no_submission()

    def test_existing_output_is_preserved(self):
        self.output.mkdir()
        sentinel = self.output / "preserve-me"
        sentinel.write_bytes(b"earlier attempt")
        with self.assertRaises((ValueError, RuntimeError, FileExistsError)):
            self.invoke()
        self.assertEqual(sentinel.read_bytes(), b"earlier attempt")
        self.assert_no_submission()

    def test_candidate_tool_drift_is_rejected(self):
        self.build_info["tools"]["cargo"] = "99.0.0"
        self.refresh_candidate()
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_candidate_record_path_traversal_is_rejected(self):
        self.build_info["artifacts"][0]["name"] = "../outside.dmg"
        self.write_json(self.candidate / "build-info.json", self.build_info)
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_candidate_artifact_symlink_is_rejected(self):
        outside = self.base / "outside.dmg"
        self.dmg.rename(outside)
        self.dmg.symlink_to(outside)
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_checksum_record_drift_is_rejected(self):
        sums = self.candidate / "SHA256SUMS"
        sums.write_text(sums.read_text() + "unexpected extra checksum\n")
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_archive_absolute_and_duplicate_paths_are_rejected(self):
        self.members["/absolute"] = (b"not extracted", stat.S_IFREG | 0o644)
        self.write_archive()
        self.refresh_candidate()
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assertFalse(any("-x" in command for command in self.calls))
        del self.members["/absolute"]
        self.write_archive()
        with zipfile.ZipFile(self.archive, "a") as archive:
            # Duplicate records are ambiguous even when they carry equal bytes.
            info = zipfile.ZipInfo(self.app_name + "/Contents/Resources/sample.txt")
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(info, b"ambiguous replacement")
        self.refresh_candidate()
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_candidate_change_while_snapshotting_is_rejected(self):
        changed = False

        def change_before_snapshot(command):
            nonlocal changed
            if Path(command[0]).name == "git" and not changed:
                self.archive.write_bytes(self.archive.read_bytes() + b" changed between checks")
                changed = True

        self.on_command = change_before_snapshot
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assertFalse(any("-x" in command for command in self.calls))
        self.assert_no_submission()

    def test_certificate_without_developer_id_extension_is_rejected(self):
        self.certificate_has_oid = False
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_race_created_output_is_preserved(self):
        def reserve_from_another_attempt(command):
            if Path(command[0]).name == "security" and "verify-cert" in command:
                self.output.mkdir()
                (self.output / "preserve-me").write_bytes(b"other attempt")

        self.on_command = reserve_from_another_attempt
        with self.assertRaises((signing.SigningError, FileExistsError)):
            self.invoke()
        self.assertEqual((self.output / "preserve-me").read_bytes(), b"other attempt")
        self.assert_no_submission()

    def preserved_attempt(self):
        self.assertTrue(self.output.is_dir())
        self.assertFalse((self.output / "build-info.json").exists())
        self.assertFalse((self.output / "SHA256SUMS").exists())
        return json.loads((self.output / "notarization.json").read_text())

    def test_signing_failure_preserves_attempt_without_submitting(self):
        self.fail_when = lambda command: "--sign" in command
        with self.assertRaises(signing.SigningError):
            self.invoke()
        record = self.preserved_attempt()
        self.assertEqual(record["submissions"], {})
        self.assertEqual(record["phase"], "stopped")
        self.assertEqual(self.submissions, [])

    def test_signature_failure_stops_before_submitting(self):
        self.fail_when = lambda command: "--test-requirement" in command
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertEqual(self.preserved_attempt()["submissions"], {})
        self.assertEqual(self.submissions, [])

    def test_gatekeeper_failure_preserves_accepted_receipt_and_no_final_checksums(self):
        self.fail_when = lambda command: Path(command[0]).name == "spctl"
        with self.assertRaises(signing.SigningError):
            self.invoke()
        record = self.preserved_attempt()
        self.assertEqual(record["submissions"]["app"]["status"], "Accepted")
        self.assertEqual(len(self.submissions), 1)

    def test_notary_rejection_retains_receipt_and_private_log(self):
        self.submission_status = "Invalid"
        with self.assertRaises(signing.SigningError):
            self.invoke()
        record = self.preserved_attempt()
        submission = record["submissions"]["app"]
        self.assertEqual(submission["status"], "Invalid")
        self.assertTrue(submission["id"])
        self.assertTrue((self.output / "app-notary-log.json").is_file())
        self.assertEqual(len(self.submissions), 1)
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertEqual(len(self.submissions), 1)

    def test_submit_timeout_retains_unknown_attempt_and_does_not_resubmit(self):
        self.notary_exception = subprocess.TimeoutExpired(["synthetic notarytool"], 180)
        with self.assertRaises(signing.SigningError):
            self.invoke()
        submission = self.preserved_attempt()["submissions"]["app"]
        self.assertEqual(submission["state"], "submission outcome unknown")
        self.assertNotIn("id", submission)
        self.assertTrue(submission["sha256"])
        self.assertTrue(submission["startedAt"])
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertEqual(len(self.submissions), 1)

    def test_submit_unknown_reply_retains_unknown_attempt(self):
        self.notary_stdout = "synthetic response is not JSON"
        with self.assertRaises(signing.SigningError):
            self.invoke()
        submission = self.preserved_attempt()["submissions"]["app"]
        self.assertEqual(submission["state"], "submission outcome unknown")
        self.assertNotIn("id", submission)
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertEqual(len(self.submissions), 1)

    def test_submit_error_with_receipt_keeps_id_before_stopping(self):
        self.notary_returncode = 1
        with self.assertRaises(signing.SigningError):
            self.invoke()
        submission = self.preserved_attempt()["submissions"]["app"]
        self.assertEqual(submission["state"], "submission outcome unknown")
        self.assertTrue(submission["id"])
        self.assertFalse(any("wait" in command for command in self.calls))
        self.assertEqual(len(self.submissions), 1)

    def test_wait_timeout_keeps_id_and_does_not_resubmit(self):
        self.notary_wait_exception = subprocess.TimeoutExpired(["synthetic notarytool wait"], 660)

        def check_receipt_already_on_disk(command):
            if "notarytool" in command and "wait" in command:
                record = json.loads((self.output / "notarization.json").read_text())
                self.assertEqual(record["submissions"]["app"]["id"], command[3])

        self.on_command = check_receipt_already_on_disk
        with self.assertRaises(signing.SigningError):
            self.invoke()
        submission = self.preserved_attempt()["submissions"]["app"]
        self.assertTrue(submission["id"])
        self.assertEqual(submission["state"], "submitted")
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertEqual(len(self.submissions), 1)

    def test_accepted_wait_requires_matching_error_free_accepted_log(self):
        cases = (("notary_log_status", "Invalid"),
                 ("notary_log_job", "22222222-2222-2222-2222-222222222222"),
                 ("notary_log_issues", [{"severity": "error", "message": "synthetic diagnostic"}]))
        for field, value in cases:
            with self.subTest(field=field):
                original = getattr(self, field)
                setattr(self, field, value)
                with self.assertRaises(signing.SigningError):
                    self.invoke()
                record = self.preserved_attempt()
                self.assertEqual(record["submissions"]["app"]["status"], "Accepted")
                self.assertNotEqual(record["submissions"]["app"]["state"], "accepted")
                self.assertEqual(len(self.submissions), 1)
                shutil.rmtree(self.output)
                self.submissions.clear()
                setattr(self, field, original)

    def test_success_hashes_stapled_outputs_and_retains_both_accepted_submissions(self):
        original = {path.name: path.read_bytes() for path in self.candidate.iterdir()}
        self.invoke()
        record = json.loads((self.output / "notarization.json").read_text())
        info = json.loads((self.output / "build-info.json").read_text())
        self.assertEqual(record["phase"], "complete")
        self.assertEqual(set(record["submissions"]), {"app", "dmg"})
        self.assertEqual(len(self.submissions), 2)
        for kind in ("app", "dmg"):
            self.assertEqual(record["submissions"][kind]["state"], "accepted")
            self.assertEqual(info["notarization"][kind]["status"], "Accepted")
            self.assertTrue((self.output / record["submissions"][kind]["log"]).is_file())
        self.assertTrue(info["notarized"])
        self.assertFalse(info["sourceDirty"])
        self.assertEqual(info["commit"], self.commit)
        final_archive = self.output / self.archive.name
        with zipfile.ZipFile(final_archive) as archive:
            self.assertEqual(archive.read(self.app_name + "/Contents/Resources/synthetic-ticket"),
                             b"stapled synthetic ticket")
        self.assertTrue((self.output / self.dmg.name).read_bytes().endswith(b"stapled synthetic ticket"))
        for artifact in info["artifacts"]:
            path = self.output / artifact["name"]
            self.assertEqual(artifact["sha256"], self.hash_file(path))
            self.assertEqual(artifact["bytes"], path.stat().st_size)
        self.assertEqual((self.output / "SHA256SUMS").read_text(), "".join(
            artifact["sha256"] + "  " + artifact["name"] + "\n" for artifact in info["artifacts"]))
        self.assertEqual(original, {path.name: path.read_bytes() for path in self.candidate.iterdir()})

    def test_archive_code_without_execute_permission_is_rejected(self):
        name = self.app_name + "/Contents/MacOS/synthetic-cache"
        data, _ = self.members[name]
        self.members[name] = (data, stat.S_IFREG | 0o644)
        self.write_archive()
        self.refresh_candidate()
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_output_symlink_is_preserved_and_never_followed(self):
        target = self.base / "missing-other-attempt"
        self.output.symlink_to(target, target_is_directory=True)
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertTrue(self.output.is_symlink())
        self.assertFalse(target.exists())
        self.assert_no_submission()

    def test_output_inside_candidate_is_rejected(self):
        self.output = self.candidate / "distribution"
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertFalse(self.output.exists())
        self.assert_no_submission()

    def test_archive_case_and_unicode_collisions_are_rejected(self):
        cases = (
            ((self.app_name + "/Contents/Resources/SAMPLE.txt", b"case collision"),),
            ((self.app_name + "/Contents/Resources/caf\u00e9", b"composed"),
             (self.app_name + "/Contents/Resources/cafe\u0301", b"decomposed")),
        )
        for members in cases:
            with self.subTest(members=members):
                for name, data in members:
                    self.members[name] = (data, stat.S_IFREG | 0o644)
                self.write_archive()
                self.refresh_candidate()
                with self.assertRaises(signing.SigningError):
                    self.invoke("--check")
                for name, _ in members:
                    del self.members[name]
        self.assertFalse(any("-x" in command for command in self.calls))
        self.assert_no_submission()

    def test_source_contract_change_during_preflight_is_rejected(self):
        def change_contract(command):
            if Path(command[0]).name == "security" and "find-identity" in command:
                (self.root / "VERSION").write_text("0.9.0\n")

        self.on_command = change_contract
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_expired_or_untrusted_certificate_is_rejected(self):
        for selected in ("-checkend", "verify-cert"):
            with self.subTest(selected=selected):
                self.fail_when = lambda command: selected in command
                with self.assertRaises(signing.SigningError):
                    self.invoke("--check")
        self.assert_no_submission()

    def test_missing_or_invalid_notary_profile_is_read_only_failure(self):
        self.history_stdout = "[]"
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assertFalse(self.output.exists())
        self.assert_no_submission()

    def test_malformed_submit_receipts_never_trigger_wait_or_resubmission(self):
        for reply in ("[]", "null", '{"id": 123}', '{"id": "not-a-uuid"}'):
            with self.subTest(reply=reply):
                self.notary_stdout = reply
                with self.assertRaises(signing.SigningError):
                    self.invoke()
                submission = self.preserved_attempt()["submissions"]["app"]
                self.assertEqual(submission["state"], "submission outcome unknown")
                self.assertNotIn("id", submission)
                self.assertFalse(any("wait" in command for command in self.calls))
                self.assertEqual(len(self.submissions), 1)
                with self.assertRaises(signing.SigningError):
                    self.invoke()
                self.assertEqual(len(self.submissions), 1)
                shutil.rmtree(self.output)
                self.submissions.clear()

    def test_malformed_or_mismatched_wait_keeps_original_receipt(self):
        for reply in ("[]", "null", '{"id": 123}',
                      '{"id": "22222222-2222-2222-2222-222222222222", "status": "Accepted"}'):
            with self.subTest(reply=reply):
                self.notary_wait_stdout = reply
                with self.assertRaises(signing.SigningError):
                    self.invoke()
                submission = self.preserved_attempt()["submissions"]["app"]
                self.assertEqual(submission["id"], "11111111-1111-1111-1111-000000000001")
                self.assertEqual(submission["state"], "submitted")
                self.assertEqual(len(self.submissions), 1)
                shutil.rmtree(self.output)
                self.submissions.clear()

    def test_invalid_log_structure_or_boolean_status_code_cannot_accept(self):
        valid_id = "11111111-1111-1111-1111-000000000001"
        log = {"jobId": valid_id, "status": "Accepted", "statusCode": 0, "issues": []}
        replies = ["[]", "null", json.dumps(dict(log, issues=[None])),
                   json.dumps(dict(log, issues={"severity": "error"})),
                   json.dumps(dict(log, statusCode=False))]
        for reply in replies:
            with self.subTest(reply=reply):
                self.notary_log_stdout = reply
                with self.assertRaises(signing.SigningError):
                    self.invoke()
                submission = self.preserved_attempt()["submissions"]["app"]
                self.assertNotEqual(submission["state"], "accepted")
                self.assertEqual(len(self.submissions), 1)
                shutil.rmtree(self.output)
                self.submissions.clear()

    def test_app_stapling_failure_stops_before_disk_image_submission(self):
        self.fail_when = lambda command: "stapler" in command and "staple" in command
        with self.assertRaises(signing.SigningError):
            self.invoke()
        self.assertEqual(self.preserved_attempt()["submissions"]["app"]["state"], "accepted")
        self.assertEqual(len(self.submissions), 1)

    def test_disk_image_failure_retains_both_submissions_without_final_checksums(self):
        self.fail_when = lambda command: Path(command[0]).name == "spctl" and "open" in command
        with self.assertRaises(signing.SigningError):
            self.invoke()
        record = self.preserved_attempt()
        self.assertEqual(set(record["submissions"]), {"app", "dmg"})
        self.assertEqual(record["submissions"]["dmg"]["state"], "accepted")
        self.assertEqual(len(self.submissions), 2)

    def test_credentials_are_removed_from_child_environment(self):
        with patch.dict(os.environ, {"APPLE_PASSWORD": "synthetic-private-password",
                                     "ASC_KEY_ID": "synthetic-key", "NOTARY_PASSWORD": "synthetic-private-token",
                                     "TAURI_SIGNING_PRIVATE_KEY": "synthetic-private-key"}):
            self.invoke("--check")
        for environment in self.environments:
            self.assertFalse(any(key.startswith(("APPLE_", "ASC_", "NOTARY_", "TAURI_SIGNING_"))
                                 for key in environment))

    def test_runtime_label_cannot_replace_hardened_runtime_flag(self):
        self.runtime_flags = "0x2(adhoc,runtime)"
        with self.assertRaises(signing.SigningError):
            self.invoke("--check")
        self.assert_no_submission()

    def test_distribution_requirement_is_literal_and_pins_expected_certificate(self):
        self.invoke()
        requirements = [command[command.index("--test-requirement") + 1]
                        for command in self.calls if "--test-requirement" in command]
        self.assertTrue(requirements)
        for requirement in requirements:
            # codesign interprets a requirement without '=' as a filename.
            self.assertTrue(requirement.startswith("=anchor apple generic"))
            self.assertIn('H"' + self.identity + '"', requirement)
            self.assertIn('subject.OU] = "' + self.team + '"', requirement)
            self.assertIn(signing.DEVELOPER_ID_OID, requirement)
            self.assertIn('identifier "' + self.identifier, requirement)

    def test_service_digest_or_filename_mismatch_is_preserved_and_rejected(self):
        cases = (("notary_log_digest", "F" * 64),
                 ("notary_log_digest", "invalid digest"),
                 ("notary_log_filename", "different-submission.zip"))
        for field, value in cases:
            with self.subTest(field=field, value=value):
                original = getattr(self, field)
                setattr(self, field, value)
                with self.assertRaises(signing.SigningError):
                    self.invoke()
                record = self.preserved_attempt()
                self.assertEqual(record["submissions"]["app"]["status"], "Accepted")
                self.assertNotEqual(record["submissions"]["app"]["state"], "accepted")
                self.assertEqual(len(self.submissions), 1)
                shutil.rmtree(self.output)
                self.submissions.clear()
                setattr(self, field, original)

    def test_older_accepted_service_logs_can_omit_optional_digest_fields(self):
        self.log_metadata = False
        self.invoke()
        info = json.loads((self.output / "build-info.json").read_text())
        self.assertTrue(info["notarized"])
        self.assertEqual(info["notarization"]["app"]["state"], "accepted")
        self.assertEqual(info["notarization"]["dmg"]["state"], "accepted")

    def test_source_change_while_notary_waits_cannot_produce_final_record(self):
        def change_source(command):
            if "notarytool" in command and "wait" in command:
                self.git_commit = "c" * 40

        self.on_command = change_source
        with self.assertRaises(signing.SigningError):
            self.invoke()
        record = self.preserved_attempt()
        self.assertEqual(record["submissions"]["app"]["state"], "accepted")
        self.assertEqual(record["submissions"]["dmg"]["state"], "accepted")
        self.assertEqual(len(self.submissions), 2)

    def test_copied_preflight_leaves_source_unchanged_without_cache_environment(self):
        release = self.root / "scripts/release"
        copied_script = release / "sign-mac.py"
        shutil.copy2(SCRIPT, copied_script)
        shutil.copy2(SCRIPT.with_name("build-mac.py"), release / "build-mac.py")

        def snapshot():
            return {str(path.relative_to(self.base)): self.hash_file(path) if path.is_file() else "directory"
                    for path in self.base.rglob("*")}

        before = snapshot()
        environment = {key: value for key, value in os.environ.items()
                       if key not in {"PYTHONDONTWRITEBYTECODE", "PYTHONPYCACHEPREFIX"}}
        module_spec = importlib.util.spec_from_file_location("braincache_signing_copied_check", copied_script)
        fresh = importlib.util.module_from_spec(module_spec)
        with patch.dict(os.environ, environment, clear=True), \
                patch.object(sys, "dont_write_bytecode", False), patch.object(sys, "pycache_prefix", None):
            # Executing the entry source models `python3 sign-mac.py`; that entry
            # is not imported through a loader that writes its own bytecode first.
            exec(compile(copied_script.read_text(), str(copied_script), "exec"), fresh.__dict__)
            with patch.object(fresh, "run", side_effect=self.fake_run), patch.object(signing, "main", fresh.main):
                self.invoke("--check")
        self.assertEqual(before, snapshot())
        self.assertFalse(list(self.base.rglob("__pycache__")))
        self.assertFalse(self.output.exists())
        self.assert_no_submission()


if __name__ == "__main__":
    unittest.main()
