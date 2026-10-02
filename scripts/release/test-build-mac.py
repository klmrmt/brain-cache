#!/usr/bin/env python3
"""Exercise candidate guardrails with disposable sources and synthetic bundles only.

All external commands are replaced in these tests. No app, dependency download,
user database, signing tool, or network access is used.
"""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


# Keep guard verification from changing a clean source checkout.
sys.dont_write_bytecode = True

SCRIPT = Path(__file__).with_name("build-mac.py")
spec = importlib.util.spec_from_file_location("braincache_candidate", SCRIPT)
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="braincache-candidate-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "source"
        self.mac = self.root / "apps/mac"
        self.native = self.mac / "src-tauri"
        self.native.mkdir(parents=True)
        (self.root / "scripts/release").mkdir(parents=True)
        self.version = "0.8.0"
        self.identifier = "com.braincache.synthetic-test"
        self.tools = {"node": "26.8.1", "pnpm": "11.24.0", "rust": "1.98.0",
                      "target": "aarch64-apple-darwin"}
        self.write_json(self.mac / "package.json", {
            "version": self.version, "packageManager": "pnpm@" + self.tools["pnpm"],
        })
        self.write_json(self.native / "tauri.conf.json", {
            "version": self.version, "identifier": self.identifier,
            "productName": "Synthetic Cache", "bundle": {"macOS": {"signingIdentity": "-"}},
        })
        (self.root / "VERSION").write_text(self.version + "\n")
        (self.native / "Cargo.toml").write_text('[package]\nname = "brain-cache-mac"\nversion = "0.8.0"\n')
        (self.native / "Cargo.lock").write_text('[[package]]\nname = "brain-cache-mac"\nversion = "0.8.0"\n')
        self.write_json(self.root / "scripts/release/toolchain.json", self.tools)
        self.target = self.root / "build-target"
        self.bundle = self.target / self.tools["target"] / "release/bundle"
        self.app = self.bundle / "macos/Synthetic Cache.app"
        (self.app / "Contents/MacOS").mkdir(parents=True)
        self.plist = self.app / "Contents/Info.plist"
        with self.plist.open("wb") as stream:
            plistlib.dump({
                "CFBundleShortVersionString": self.version,
                "CFBundleIdentifier": self.identifier,
                "CFBundleExecutable": "synthetic-cache",
            }, stream)
        self.executable = self.app / "Contents/MacOS/synthetic-cache"
        self.executable.write_bytes(b"synthetic executable; never launched")
        self.dmg = self.bundle / "dmg/Synthetic Cache_0.8.0_aarch64.dmg"
        self.dmg.parent.mkdir(parents=True)
        self.dmg.write_bytes(b"synthetic disk image; never mounted")
        self.output = Path(self.temporary.name) / "candidate"
        self.calls = []
        self.environments = []
        self.observed = dict(self.tools, cargo=self.tools["rust"])
        self.revisions = ["a" * 40]
        self.statuses = [""]
        self.revision_reads = 0
        self.status_reads = 0
        self.architecture = "arm64"
        self.regenerate_plist = True
        self.regenerate_dmg = True
        self.tracked_source = None
        self.untracked_names = []
        self.fail_when = lambda arguments: False
        self.on_command = lambda arguments: None
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(candidate, "ROOT", self.root))
        self.stack.enter_context(patch.object(candidate, "MAC", self.mac))
        self.stack.enter_context(patch.object(candidate.platform, "system", return_value="Darwin"))
        self.stack.enter_context(patch.object(candidate, "run", side_effect=self.fake_run))
        self.stack.enter_context(patch.object(candidate.subprocess, "check_output", side_effect=self.fake_git_bytes))

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value))

    def fake_git_bytes(self, arguments, cwd=None, env=None):
        self.environments.append(dict(env or {}))
        if arguments[:2] == ["git", "diff"]:
            return b"" if self.tracked_source is None else b"synthetic diff " + self.tracked_source.read_bytes()
        if arguments[:2] == ["git", "ls-files"]:
            return b"".join(name.encode() + b"\0" for name in self.untracked_names)
        raise AssertionError("Unexpected command; no external command may run in these tests.")

    def fake_run(self, arguments, cwd=None, capture=False, env=None):
        command = tuple(str(value) for value in arguments)
        self.calls.append(command)
        self.environments.append(dict(env or {}))
        self.on_command(command)
        if self.fail_when(command):
            raise subprocess.CalledProcessError(1, command)
        if command == ("node", "--version"):
            return "v" + self.observed["node"]
        if command == ("pnpm", "--version"):
            return self.observed["pnpm"]
        if command == ("rustc", "--version"):
            return "rustc " + self.observed["rust"] + " (synthetic)"
        if command == ("cargo", "--version"):
            return "cargo " + self.observed["cargo"] + " (synthetic)"
        if command == ("rustc", "-vV"):
            return "host: " + self.tools["target"]
        if command[:2] == ("git", "rev-parse"):
            value = self.revisions[min(self.revision_reads, len(self.revisions) - 1)]
            self.revision_reads += 1
            return value
        if command[:2] == ("git", "status"):
            value = self.statuses[min(self.status_reads, len(self.statuses) - 1)]
            self.status_reads += 1
            return value
        if command[:2] == ("cargo", "metadata"):
            return json.dumps({"target_directory": str(self.target)})
        if command[:3] == ("pnpm", "tauri", "build"):
            for path, regenerate in ((self.plist, self.regenerate_plist), (self.dmg, self.regenerate_dmg)):
                if regenerate and path.is_file():
                    # Preserve deliberately invalid metadata and missing fixtures.
                    # Replacement models a newly bundled file even when bytes match.
                    rebuilt = path.with_name(path.name + ".rebuilt")
                    rebuilt.write_bytes(path.read_bytes())
                    rebuilt.replace(path)
        if command[0] == "/usr/bin/lipo":
            return self.architecture
        if command[0] == "/usr/bin/ditto":
            Path(command[-1]).write_bytes(b"synthetic app archive; never extracted")
        if command[0] == "/usr/bin/sw_vers":
            return "15.0"
        if command[0] == "xcodebuild":
            return "Xcode 26.0\nBuild version synthetic"
        return "" if capture else None

    def invoke(self, *arguments):
        with patch.object(sys, "argv", [str(SCRIPT), "--output-dir", str(self.output), *arguments]):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                candidate.main()

    def assert_no_candidate(self):
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.output.parent.glob(".braincache-candidate-*")), [])

    def assert_no_build(self):
        self.assertFalse(any(command[:2] == ("cargo", "metadata") for command in self.calls))
        self.assertFalse(any(command[:2] == ("pnpm", "install") for command in self.calls))

    def test_all_version_sources_must_agree_before_running_commands(self):
        paths = [self.root / "VERSION", self.mac / "package.json",
                 self.native / "Cargo.toml", self.native / "Cargo.lock",
                 self.native / "tauri.conf.json"]
        for path in paths:
            with self.subTest(path=path.name):
                original = path.read_text()
                path.write_text(original.replace("0.8.0", "0.8.1"))
                try:
                    with self.assertRaisesRegex(ValueError, "Version mismatch"):
                        self.invoke()
                    self.assertEqual(self.calls, [])
                    self.assert_no_candidate()
                finally:
                    path.write_text(original)

    def test_pnpm_pin_drift_is_rejected_before_running_commands(self):
        package = json.loads((self.mac / "package.json").read_text())
        package["packageManager"] = "pnpm@11.25.0"
        self.write_json(self.mac / "package.json", package)
        with self.assertRaisesRegex(ValueError, "pinned pnpm"):
            self.invoke()
        self.assertEqual(self.calls, [])
        self.assert_no_candidate()

    def test_installed_pnpm_drift_is_rejected_without_building(self):
        self.observed["pnpm"] = "11.25.0"
        with self.assertRaisesRegex(ValueError, "exact Node, pnpm, Rust and Cargo"):
            self.invoke()
        self.assert_no_build()
        self.assert_no_candidate()

    def test_existing_output_and_its_bytes_are_preserved(self):
        self.output.mkdir()
        sentinel = self.output / "original.dmg"
        sentinel.write_bytes(b"original candidate")
        with self.assertRaisesRegex(ValueError, "existing artifacts"):
            self.invoke()
        self.assertEqual(sentinel.read_bytes(), b"original candidate")
        self.assertEqual(list(self.output.iterdir()), [sentinel])
        self.assert_no_build()

    def test_dirty_source_is_rejected_without_building(self):
        self.statuses = [" M VERSION"]
        with self.assertRaisesRegex(ValueError, "Commit source changes"):
            self.invoke()
        self.assert_no_build()
        self.assert_no_candidate()

    def test_failed_install_tests_or_build_never_stage_stale_bundles(self):
        failing_commands = [
            ("pnpm", "install"), ("pnpm", "test"), ("pnpm", "build"),
            ("cargo", "test"), ("pnpm", "tauri", "build"),
        ]
        for prefix in failing_commands:
            with self.subTest(command=prefix):
                self.calls.clear()
                self.fail_when = lambda command, prefix=prefix: command[:len(prefix)] == prefix
                with self.assertRaises(subprocess.CalledProcessError):
                    self.invoke()
                self.assert_no_candidate()
                self.assertEqual(self.dmg.read_bytes(), b"synthetic disk image; never mounted")
                self.assertEqual(self.executable.read_bytes(), b"synthetic executable; never launched")
                self.assertFalse(any(command[0] == "/usr/bin/ditto" for command in self.calls))

    def test_command_failure_during_preflight_creates_nothing(self):
        self.fail_when = lambda command: command == ("pnpm", "--version")
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke()
        self.assert_no_build()
        self.assert_no_candidate()

    def test_changed_revision_during_build_is_rejected_before_staging(self):
        self.revisions = ["a" * 40, "b" * 40]
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.invoke()
        self.assert_no_candidate()
        self.assertFalse(any(command[0] == "/usr/bin/ditto" for command in self.calls))

    def test_new_source_change_during_build_is_rejected_before_staging(self):
        self.statuses = ["", " M VERSION"]
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.invoke()
        self.assert_no_candidate()
        self.assertFalse(any(command[0] == "/usr/bin/ditto" for command in self.calls))

    def test_already_modified_file_changed_during_build_is_rejected(self):
        self.tracked_source = self.root / "tracked-source.txt"
        self.tracked_source.write_text("before build")
        self.statuses = [" M tracked-source.txt"]
        def modify_source(command):
            if command[:3] == ("pnpm", "tauri", "build"):
                self.tracked_source.write_text("changed during build")
        self.on_command = modify_source
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.invoke("--allow-dirty")
        self.assert_no_candidate()
        self.assertFalse(any(command[0] == "/usr/bin/ditto" for command in self.calls))

    def test_untracked_file_changed_during_build_is_rejected(self):
        source = self.root / "new-source.txt"
        source.write_text("before build")
        self.untracked_names = [source.name]
        self.statuses = ["?? new-source.txt"]
        def modify_source(command):
            if command[:3] == ("pnpm", "tauri", "build"):
                source.write_text("changed during build")
        self.on_command = modify_source
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.invoke("--allow-dirty")
        self.assert_no_candidate()
        self.assertFalse(any(command[0] == "/usr/bin/ditto" for command in self.calls))

    def test_unchanged_exploratory_source_is_recorded_as_dirty(self):
        self.tracked_source = self.root / "tracked-source.txt"
        self.tracked_source.write_text("unchanged exploratory source")
        self.statuses = [" M tracked-source.txt"]
        self.invoke("--allow-dirty")
        info = json.loads((self.output / "build-info.json").read_text())
        self.assertTrue(info["sourceDirty"])
        self.assertRegex(info["sourceFingerprint"], r"^[0-9a-f]{64}$")

    def assert_cached_bundle_rejected(self):
        old_plist = self.plist.read_bytes()
        old_dmg = self.dmg.read_bytes()
        with self.assertRaisesRegex(ValueError, "cached bundles will not be staged"):
            self.invoke()
        self.assert_no_candidate()
        self.assertEqual(self.plist.read_bytes(), old_plist)
        self.assertEqual(self.dmg.read_bytes(), old_dmg)
        self.assertFalse(any(command[0] == "/usr/bin/ditto" for command in self.calls))

    def test_cached_app_is_rejected_even_when_disk_image_is_regenerated(self):
        self.regenerate_plist = False
        self.assert_cached_bundle_rejected()

    def test_cached_disk_image_is_rejected_even_when_app_is_regenerated(self):
        self.regenerate_dmg = False
        self.assert_cached_bundle_rejected()

    def test_successful_command_that_regenerates_no_bundles_is_rejected(self):
        self.regenerate_plist = False
        self.regenerate_dmg = False
        self.assert_cached_bundle_rejected()

    def test_missing_bundle_is_rejected_before_staging(self):
        self.dmg.unlink()
        with self.assertRaisesRegex(ValueError, "were not produced"):
            self.invoke()
        self.assert_no_candidate()

    def test_bundle_version_or_identifier_mismatch_is_rejected(self):
        for field in ("CFBundleShortVersionString", "CFBundleIdentifier"):
            with self.subTest(field=field):
                with self.plist.open("rb") as stream:
                    original = plistlib.load(stream)
                changed = dict(original, **{field: "incorrect"})
                with self.plist.open("wb") as stream:
                    plistlib.dump(changed, stream)
                try:
                    with self.assertRaisesRegex(ValueError, "does not match"):
                        self.invoke()
                    self.assert_no_candidate()
                finally:
                    with self.plist.open("wb") as stream:
                        plistlib.dump(original, stream)

    def test_wrong_architecture_is_rejected_before_staging(self):
        self.architecture = "x86_64"
        with self.assertRaisesRegex(ValueError, "Expected an arm64"):
            self.invoke()
        self.assert_no_candidate()

    def test_failed_signature_or_disk_image_validation_creates_no_candidate(self):
        for executable in ("/usr/bin/codesign", "/usr/bin/hdiutil"):
            with self.subTest(executable=executable):
                self.fail_when = lambda command, executable=executable: command[0] == executable
                with self.assertRaises(subprocess.CalledProcessError):
                    self.invoke()
                self.assert_no_candidate()

    def test_failed_archive_or_checksum_validation_removes_temporary_staging(self):
        for executable in ("/usr/bin/ditto", "/usr/bin/shasum"):
            with self.subTest(executable=executable):
                self.fail_when = lambda command, executable=executable: command[0] == executable
                with self.assertRaises(subprocess.CalledProcessError):
                    self.invoke()
                self.assert_no_candidate()
                self.assertEqual(self.dmg.read_bytes(), b"synthetic disk image; never mounted")

    def test_output_directory_that_appears_during_build_is_preserved(self):
        def create_output(command):
            if command[:3] == ("pnpm", "tauri", "build"):
                self.output.mkdir()
        self.on_command = create_output
        with self.assertRaises((ValueError, FileExistsError)):
            self.invoke()
        self.assertTrue(self.output.is_dir())
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(list(self.output.parent.glob(".braincache-candidate-*")), [])

    def test_check_mode_creates_no_artifacts_and_never_builds(self):
        self.invoke("--check")
        self.assert_no_candidate()
        self.assert_no_build()

    def test_success_records_actual_hashes_and_strips_signing_credentials(self):
        secrets = {key: "synthetic-secret" for key in candidate.SIGNING_VARIABLES}
        with patch.dict(os.environ, secrets):
            self.invoke()
        info = json.loads((self.output / "build-info.json").read_text())
        self.assertEqual(info["version"], self.version)
        self.assertEqual(info["commit"], "a" * 40)
        self.assertFalse(info["sourceDirty"])
        self.assertEqual(info["signing"], "ad hoc")
        self.assertFalse(info["notarized"])
        for artifact in info["artifacts"]:
            path = self.output / artifact["name"]
            self.assertEqual(artifact["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(artifact["bytes"], path.stat().st_size)
        expected_checksums = "".join(item["sha256"] + "  " + item["name"] + "\n" for item in info["artifacts"])
        self.assertEqual((self.output / "SHA256SUMS").read_text(), expected_checksums)
        self.assertEqual(len(list(self.output.iterdir())), 4)
        self.assertEqual(list(self.output.parent.glob(".braincache-candidate-*")), [])
        for env in self.environments:
            self.assertTrue(set(candidate.SIGNING_VARIABLES).isdisjoint(env))


if __name__ == "__main__":
    unittest.main()
