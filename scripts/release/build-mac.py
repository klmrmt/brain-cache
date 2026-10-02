#!/usr/bin/env python3
"""Check and package an ad hoc signed Mac candidate; never sign for distribution or publish."""

import argparse
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAC = ROOT / "apps/mac"
SIGNING_VARIABLES = (
    "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY",
    "APPLE_API_ISSUER", "APPLE_API_KEY_PATH", "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_PROVIDER_SHORT_NAME",
    "TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
)


def run(arguments, cwd=ROOT, capture=False, env=None):
    if not capture:
        print("Running:", " ".join(str(value) for value in arguments), flush=True)
    result = subprocess.run(
        [str(value) for value in arguments], cwd=cwd, env=env, check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None, text=True,
    )
    return result.stdout.strip() if capture else None


def toml_version(text, section):
    # Only read this repository's single-line package name/version fields.
    for block in re.split(r"(?m)^\[", text):
        if not block.startswith(section + "]"):
            continue
        version = re.search(r'^version\s*=\s*"([^"]+)"\s*$', block, re.M)
        if version:
            return version.group(1)
    raise ValueError("Could not read the Cargo package version.")


def versions():
    version = (ROOT / "VERSION").read_text().strip()
    if not re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", version):
        raise ValueError("VERSION must be a three-part release version, such as 0.8.0.")
    package = json.loads((MAC / "package.json").read_text())
    config = json.loads((MAC / "src-tauri/tauri.conf.json").read_text())
    cargo = toml_version((MAC / "src-tauri/Cargo.toml").read_text(), "package")
    lock = (MAC / "src-tauri/Cargo.lock").read_text()
    entries = [block for block in lock.split("[[package]]") if re.search(
        r'^name\s*=\s*"brain-cache-mac"\s*$', block, re.M
    )]
    if len(entries) != 1:
        raise ValueError("Cargo.lock must contain exactly one application package.")
    lock_match = re.search(r'^version\s*=\s*"([^"]+)"\s*$', entries[0], re.M)
    values = [package.get("version"), config.get("version"), cargo,
              lock_match.group(1) if lock_match else None]
    if any(value != version for value in values):
        raise ValueError("Version mismatch: VERSION, package.json, Cargo.toml, Cargo.lock and Tauri must agree.")
    if config["bundle"]["macOS"].get("signingIdentity") != "-":
        raise ValueError("Candidate builds require the checked-in ad hoc signing identity '-'.")
    toolchain = json.loads((ROOT / "scripts/release/toolchain.json").read_text())
    if package.get("packageManager") != "pnpm@" + toolchain["pnpm"]:
        raise ValueError("The pinned pnpm version must match package.json's packageManager.")
    if toolchain["target"] != "aarch64-apple-darwin":
        raise ValueError("This candidate build procedure currently verifies Apple silicon only.")
    return version, config, toolchain


def verify_bundle(app, version, identifier, env):
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleShortVersionString") != version or info.get("CFBundleIdentifier") != identifier:
        raise ValueError("Packaged app version or identifier does not match the source configuration.")
    executable = app / "Contents/MacOS" / info["CFBundleExecutable"]
    architecture = run(["/usr/bin/lipo", "-archs", executable], capture=True, env=env)
    if architecture != "arm64":
        raise ValueError("Expected an arm64 executable; got " + architecture)
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", app], env=env)
    return info


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def artifact_stamp(path):
    if not path.is_file():
        return None
    stat = path.stat()
    return stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size


def source_fingerprint(env):
    sha = hashlib.sha256(subprocess.check_output(
        ["git", "diff", "--binary", "HEAD"], cwd=ROOT, env=env,
    ))
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--others", "--exclude-standard"], cwd=ROOT, env=env,
    ).decode().split("\0")
    for name in sorted(filter(None, names)):
        path = ROOT / name
        sha.update(name.encode() + b"\0")
        if path.is_symlink():
            sha.update(b"symlink\0" + os.readlink(path).encode())
        else:
            sha.update(b"file\0" + digest(path).encode())
    return sha.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, help="New directory for the candidate and its verification record")
    parser.add_argument("--check", action="store_true", help="Run source/toolchain checks only; do not install, build, or create outputs")
    parser.add_argument("--allow-dirty", action="store_true", help="Permit local exploratory source edits; records the candidate as dirty")
    args = parser.parse_args()
    version, config, toolchain = versions()
    if platform.system() != "Darwin":
        raise ValueError("Native candidates must be built on macOS.")
    # Ordinary candidates never receive signing or notarization credentials.
    env = dict(os.environ)
    for key in SIGNING_VARIABLES:
        env.pop(key, None)
    observed = {
        "node": run(["node", "--version"], capture=True, env=env).removeprefix("v"),
        "pnpm": run(["pnpm", "--version"], capture=True, env=env),
        "rust": run(["rustc", "--version"], capture=True, env=env).split()[1],
        "cargo": run(["cargo", "--version"], capture=True, env=env).split()[1],
    }
    if any(observed[key] != toolchain[key] for key in ("node", "pnpm", "rust")) or observed["cargo"] != toolchain["rust"]:
        raise ValueError("Install the exact Node, pnpm, Rust and Cargo versions in scripts/release/toolchain.json.")
    rust_host = run(["rustc", "-vV"], capture=True, env=env)
    if "host: " + toolchain["target"] not in rust_host.splitlines():
        raise ValueError("Use an Apple-silicon Mac with the native arm64 Rust toolchain.")
    revision = run(["git", "rev-parse", "HEAD"], capture=True, env=env)
    initial_status = run(["git", "status", "--porcelain", "--untracked-files=all"], capture=True, env=env)
    if initial_status and not args.allow_dirty:
        raise ValueError("Commit source changes before building a candidate; --allow-dirty is for local exploration only.")
    fingerprint = source_fingerprint(env)
    output = (args.output_dir or ROOT / "release-artifacts" / (version + "-" + revision[:12])).resolve()
    if output.exists():
        raise ValueError("Choose a new output directory; existing artifacts will never be overwritten.")
    print("Source/toolchain checks passed for", version, toolchain["target"], flush=True)
    if args.check:
        return
    metadata = json.loads(run([
        "cargo", "metadata", "--no-deps", "--locked", "--format-version", "1",
        "--manifest-path", MAC / "src-tauri/Cargo.toml",
    ], capture=True, env=env))
    bundle = Path(metadata["target_directory"]) / toolchain["target"] / "release/bundle"
    app = bundle / "macos" / (config["productName"] + ".app")
    filename = config["productName"] + "_" + version + "_aarch64"
    dmg = bundle / "dmg" / (filename + ".dmg")
    previous_artifacts = {path: artifact_stamp(path) for path in (app / "Contents/Info.plist", dmg)}
    run(["python3", ROOT / "scripts/release/test-build-mac.py"], env=env)
    run(["pnpm", "install", "--frozen-lockfile"], cwd=MAC, env=env)
    run(["pnpm", "test"], cwd=MAC, env=env)
    run(["pnpm", "build"], cwd=MAC, env=env)
    run(["cargo", "test", "--locked", "--manifest-path", "src-tauri/Cargo.toml"], cwd=MAC, env=env)
    run(["python3", ROOT / "scripts/release/verify-backup-restore.py"], env=env)
    run(["pnpm", "tauri", "build", "--target", toolchain["target"], "--bundles", "app", "dmg", "--verbose", "--", "--locked"], cwd=MAC, env=env)
    if run(["git", "rev-parse", "HEAD"], capture=True, env=env) != revision or run(
        ["git", "status", "--porcelain", "--untracked-files=all"], capture=True, env=env
    ) != initial_status or source_fingerprint(env) != fingerprint:
        raise ValueError("Source changed during verification; no candidate will be staged.")
    if not app.is_dir() or not dmg.is_file():
        raise ValueError("The expected versioned app and DMG were not produced.")
    if any(artifact_stamp(path) == stamp for path, stamp in previous_artifacts.items()):
        raise ValueError("The app metadata or DMG was not regenerated; cached bundles will not be staged.")
    verify_bundle(app, version, config["identifier"], env)
    run(["/usr/bin/hdiutil", "verify", dmg], env=env)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".braincache-candidate-", dir=output.parent) as temporary:
        staged = Path(temporary) / "candidate"
        staged.mkdir()
        copied_dmg = staged / dmg.name
        shutil.copy2(dmg, copied_dmg)
        app_zip = staged / (filename + ".app.zip")
        run(["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, app_zip], env=env)
        artifacts = [{"name": path.name, "sha256": digest(path), "bytes": path.stat().st_size}
                     for path in (copied_dmg, app_zip)]
        (staged / "build-info.json").write_text(json.dumps({
            "version": version, "commit": revision, "sourceDirty": bool(initial_status), "sourceFingerprint": fingerprint,
            "target": toolchain["target"], "identifier": config["identifier"],
            "signing": "ad hoc", "notarized": False,
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "tools": observed, "macOS": run(["/usr/bin/sw_vers", "-productVersion"], capture=True, env=env),
            "xcode": run(["xcodebuild", "-version"], capture=True, env=env),
            "artifacts": artifacts,
        }, indent=2) + "\n")
        (staged / "SHA256SUMS").write_text("".join(
            item["sha256"] + "  " + item["name"] + "\n" for item in artifacts
        ))
        run(["/usr/bin/shasum", "-a", "256", "-c", "SHA256SUMS"], cwd=staged, env=env)
        # Reserve the destination only after verification, without replacing a
        # directory another build created while this one was running.
        output.mkdir(mode=0o700)
        for path in staged.iterdir():
            path.rename(output / path.name)
        run(["/usr/bin/shasum", "-a", "256", "-c", "SHA256SUMS"], cwd=output, env=env)
    print("Verified local candidate:", output, flush=True)
    print("Ad hoc signed, not notarized. Distribution acceptance remains in RELEASE.md.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("Candidate build stopped:", error, file=sys.stderr)
        sys.exit(1)
