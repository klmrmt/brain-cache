#!/usr/bin/env python3
"""Sign and notarize a reviewed clean Mac candidate, without rebuilding or publishing it."""

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
MAC = ROOT / "apps/mac"
DEVELOPER_ID_OID = "1.2.840.113635.100.6.1.13"
MACH_O_MAGIC = {bytes.fromhex(value) for value in (
    "feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca",
)}


class SigningError(ValueError):
    """A failed check, reported without private command output."""


def now():
    return datetime.now(timezone.utc).isoformat()


def sanitized_env():
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(("APPLE_", "ASC_", "NOTARY_", "TAURI_SIGNING_")):
            env.pop(key)
    return env


def run(arguments, env, timeout=120, cwd=None):
    # Capture every tool's output. Account history, certificate subjects and
    # authentication errors must not appear in terminal logs.
    return subprocess.run([str(value) for value in arguments], env=env,
                          cwd=cwd or ROOT, timeout=timeout, check=False,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def checked(arguments, env, timeout=120, cwd=None):
    result = run(arguments, env, timeout=timeout, cwd=cwd)
    if result.returncode:
        raise SigningError(Path(str(arguments[0])).name + " failed; private tool output was suppressed.")
    return result


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def read_contract():
    # Share the existing version/lockfile contract; importing does not run a build.
    spec = importlib.util.spec_from_file_location("braincache_candidate_build", ROOT / "scripts/release/build-mac.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT, module.MAC = ROOT, MAC
    try:
        return module.versions()
    except (ValueError, KeyError, TypeError) as error:
        raise SigningError("Source version or toolchain contract is invalid.") from error


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (UnicodeError, json.JSONDecodeError) as error:
        raise SigningError("Invalid JSON verification record.") from error


def validate_candidate(candidate, expected_commit, version, config, toolchain):
    if not candidate.is_dir() or candidate.is_symlink():
        raise SigningError("Candidate must be an existing ordinary directory.")
    info_path, sums = candidate / "build-info.json", candidate / "SHA256SUMS"
    if not info_path.is_file() or info_path.is_symlink() or not sums.is_file() or sums.is_symlink():
        raise SigningError("Candidate verification record and checksum file must be ordinary files.")
    info = read_json(info_path)
    if not isinstance(info, dict) or info.get("sourceDirty") is not False or info.get("commit") != expected_commit:
        raise SigningError("Candidate must be clean and match the explicitly reviewed full commit.")
    if (info.get("version") != version or info.get("identifier") != config["identifier"]
            or info.get("target") != toolchain["target"] or info.get("signing") != "ad hoc"
            or info.get("notarized") is not False):
        raise SigningError("Candidate version, identifier, target or signing state differs from the source contract.")
    tools = info.get("tools", {})
    if not isinstance(tools, dict) or any(tools.get(key) != toolchain[key] for key in ("node", "pnpm", "rust")) or tools.get("cargo") != toolchain["rust"]:
        raise SigningError("Candidate tool versions differ from the pinned toolchain.")
    base = config["productName"] + "_" + version + "_aarch64"
    expected_names = {base + ".app.zip", base + ".dmg"}
    artifacts = info.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != 2:
        raise SigningError("Candidate must list exactly one app ZIP and one DMG.")
    listed = {}
    for item in artifacts:
        if (not isinstance(item, dict) or not isinstance(item.get("name"), str)
                or item["name"] not in expected_names or item["name"] in listed):
            raise SigningError("Candidate artifact list contains an unexpected or duplicate filename.")
        path = candidate / item["name"]
        if (not path.is_file() or path.is_symlink() or type(item.get("bytes")) is not int
                or item["bytes"] <= 0 or path.stat().st_size != item["bytes"]
                or not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
                or digest(path) != item["sha256"]):
            raise SigningError("Candidate artifact bytes or checksum do not match the verification record.")
        listed[item["name"]] = item
    if set(listed) != expected_names:
        raise SigningError("Candidate artifact filenames do not match the current app version.")
    lines = sums.read_text().splitlines()
    expected_lines = {item["sha256"] + "  " + item["name"] for item in artifacts}
    if len(lines) != 2 or set(lines) != expected_lines:
        raise SigningError("SHA256SUMS must agree exactly with the candidate verification record.")
    return info, candidate / (base + ".app.zip")


def validate_archive(path, app_name):
    # Ditto understands AppleDouble resource forks; permit only metadata for
    # this app, and reject all symlinks rather than trying to extract them safely.
    with zipfile.ZipFile(path) as archive:
        seen, canonical, total = set(), set(), 0
        if len(archive.infolist()) > 20000:
            raise SigningError("Candidate archive contains too many entries.")
        for member in archive.infolist():
            name = member.filename.rstrip("/")
            parts = PurePosixPath(name).parts
            if (not name or member.orig_filename != member.filename or member.filename.startswith("/") or "\\" in name or "\x00" in name
                    or any(part in ("", ".", "..") for part in name.split("/")) or name in seen):
                raise SigningError("Candidate archive contains an unsafe or duplicate path.")
            normalized = unicodedata.normalize("NFD", name).casefold()
            if normalized in canonical:
                raise SigningError("Archive paths collide on a case-insensitive Mac filesystem.")
            canonical.add(normalized)
            seen.add(name)
            if parts[0] == "__MACOSX":
                if len(parts) > 1 and parts[1] != app_name:
                    raise SigningError("Archive resource-fork metadata belongs to another app.")
                if not member.is_dir() and not parts[-1].startswith("._"):
                    raise SigningError("Unexpected archive metadata file.")
            elif parts[0] != app_name:
                raise SigningError("Candidate archive contains an unexpected top-level entry.")
            mode = member.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if (kind not in (0, stat.S_IFREG, stat.S_IFDIR) or member.flag_bits & 1
                    or (kind == stat.S_IFDIR and not member.is_dir())
                    or (kind == stat.S_IFREG and member.is_dir())):
                raise SigningError("Candidate archive contains a symlink, special file or encrypted entry.")
            total += member.file_size
            if member.file_size > 2 * 1024 ** 3 or total > 4 * 1024 ** 3:
                raise SigningError("Candidate archive exceeds the bounded extraction size.")
        if app_name not in seen:
            raise SigningError("Candidate archive is missing its application root.")
        if archive.testzip() is not None:
            raise SigningError("Candidate archive integrity check failed.")


def no_entitlements(app, env):
    result = checked(["/usr/bin/codesign", "--display", "--entitlements", "-", "--xml", app], env)
    data = result.stdout.strip()
    if data:
        try:
            entitlements = plistlib.loads(data.encode())
        except (ValueError, plistlib.InvalidFileException) as error:
            raise SigningError("Could not verify app entitlements.") from error
        if not isinstance(entitlements, dict) or entitlements:
            raise SigningError("App contains unreviewed entitlement exceptions.")


def validate_app(app, version, identifier, env):
    if not app.is_dir() or app.is_symlink():
        raise SigningError("Extracted archive does not contain the expected app.")
    info_path = app / "Contents/Info.plist"
    if info_path.is_symlink() or (app / "Contents").is_symlink() or not info_path.is_file():
        raise SigningError("App metadata must be an ordinary file inside the bundle.")
    with info_path.open("rb") as stream:
        info = plistlib.load(stream)
    if not isinstance(info, dict):
        raise SigningError("App metadata must contain a property-list dictionary.")
    executable_name = info.get("CFBundleExecutable")
    if (info.get("CFBundleIdentifier") != identifier or info.get("CFBundleShortVersionString") != version
            or info.get("CFBundleVersion") != version or not isinstance(executable_name, str)
            or not re.fullmatch(r"[A-Za-z0-9._-]+", executable_name)):
        raise SigningError("Extracted app metadata differs from the source contract.")
    executable = app / "Contents/MacOS" / executable_name
    mach_o = []
    for directory, directories, files in os.walk(app, followlinks=False):
        for name in directories + files:
            path = Path(directory) / name
            if path.is_symlink():
                raise SigningError("App contains an unexpected symlink.")
            if path.is_file():
                with path.open("rb") as stream:
                    if stream.read(4) in MACH_O_MAGIC:
                        mach_o.append(path)
            elif not path.is_dir():
                raise SigningError("App contains an unexpected special file.")
    if mach_o != [executable] or set((app / "Contents/MacOS").iterdir()) != {executable}:
        raise SigningError("App must contain exactly its single reviewed Mach-O executable and no helper code.")
    if not executable.stat().st_mode & stat.S_IXUSR:
        raise SigningError("App executable must retain its owner execute permission.")
    if checked(["/usr/bin/lipo", "-archs", executable], env).stdout.strip() != "arm64":
        raise SigningError("App executable must be Apple silicon arm64 only.")
    checked(["/usr/bin/codesign", "--verify", "--deep", "--strict", app], env)
    detail = checked(["/usr/bin/codesign", "--display", "--verbose=4", app], env)
    if not has_runtime(detail.stdout + detail.stderr):
        raise SigningError("App signature must enable the hardened runtime.")
    no_entitlements(app, env)
    return info


def validate_identity(identity, team_id, scratch, env):
    listing = checked(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"], env).stdout
    identities = re.findall(r'\b([0-9A-Fa-f]{40})\s+"([^"]+)"', listing)
    selected = [name for sha, name in identities if sha.upper() == identity]
    if len(selected) != 1 or not selected[0].startswith("Developer ID Application: ") or not selected[0].endswith("(" + team_id + ")"):
        raise SigningError("Select a valid Developer ID Application identity for the expected team; Apple Development cannot distribute this app.")
    certificates = checked(["/usr/bin/security", "find-certificate", "-a", "-p", "-c", "Developer ID Application"], env).stdout
    pem_blocks = re.findall(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", certificates, re.S)
    for index, pem in enumerate(pem_blocks):
        path = scratch / ("public-certificate-" + str(index) + ".pem")
        path.write_text(pem + "\n")
        fingerprint = checked(["/usr/bin/openssl", "x509", "-in", path, "-noout", "-fingerprint", "-sha1"], env).stdout
        value = fingerprint.partition("=")[2].strip().replace(":", "").upper()
        if value != identity:
            continue
        subject = checked(["/usr/bin/openssl", "x509", "-in", path, "-noout", "-subject", "-nameopt", "sep_multiline"], env).stdout
        detail = checked(["/usr/bin/openssl", "x509", "-in", path, "-noout", "-text"], env).stdout
        if not re.search(r"^\s*OU\s*=\s*" + re.escape(team_id) + r"\s*$", subject, re.M) or DEVELOPER_ID_OID not in detail:
            raise SigningError("Selected certificate lacks the expected team or Developer ID Application extension.")
        checked(["/usr/bin/openssl", "x509", "-in", path, "-noout", "-checkend", "0"], env)
        checked(["/usr/bin/security", "verify-cert", "-c", path, "-p", "codeSign"], env)
        return
    raise SigningError("Could not verify the public certificate matching the selected identity.")


def has_runtime(detail):
    match = re.search(r"^CodeDirectory .+flags=(0x[0-9a-fA-F]+)\b", detail, re.M)
    return bool(match and int(match.group(1), 16) & 0x10000)


def verify_distribution_signature(path, identity, team_id, identifier, env, app=True):
    requirement = ('anchor apple generic and certificate leaf = H"' + identity
                   + '" and certificate leaf[subject.OU] = "' + team_id
                   + '" and certificate leaf[field.' + DEVELOPER_ID_OID + '] exists and identifier "' + identifier + '"')
    checked(["/usr/bin/codesign", "--verify", "--strict", "--test-requirement", "=" + requirement, path], env)
    result = checked(["/usr/bin/codesign", "--display", "--verbose=4", path], env)
    detail = result.stdout + result.stderr
    if not re.search(r"^TeamIdentifier=" + re.escape(team_id) + r"$", detail, re.M) or not re.search(r"^Timestamp=.+$", detail, re.M):
        raise SigningError("Distribution signature does not have the expected team and secure timestamp.")
    if app:
        if not has_runtime(detail):
            raise SigningError("Distribution app signature lacks the hardened runtime.")
        no_entitlements(path, env)


def save_record(output, record):
    record["updatedAt"] = now()
    path = output / "notarization.json"
    temporary = output / ".notarization.json.tmp"
    with temporary.open("w") as stream:
        json.dump(record, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(str(output), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def response_uuid(info, field="id"):
    if not isinstance(info, dict) or not isinstance(info.get(field), str):
        raise SigningError("Notary response is missing a valid submission ID.")
    try:
        return str(uuid.UUID(info[field]))
    except ValueError as error:
        raise SigningError("Notary response is missing a valid submission ID.") from error


def notarize(path, kind, profile, output, record, env):
    submissions = record.setdefault("submissions", {})
    if kind in submissions:
        raise SigningError("A submission is already recorded; reconcile its receipt instead of submitting again.")
    submission = {"state": "submission outcome unknown", "startedAt": now(),
                  "artifact": path.name, "sha256": digest(path), "bytes": path.stat().st_size}
    submissions[kind] = submission
    record["phase"] = kind + " submitting"
    save_record(output, record)
    try:
        result = run(["xcrun", "notarytool", "submit", path, "--keychain-profile", profile,
                      "--output-format", "json", "--no-wait"], env, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        raise SigningError("Submission outcome is unknown. Reconcile Keychain-profile notary history before any new attempt.")
    try:
        receipt = json.loads(result.stdout)
        submission_id = response_uuid(receipt)
    except (ValueError, KeyError, TypeError):
        raise SigningError("Submission outcome is unknown. Reconcile Keychain-profile notary history before any new attempt.")
    submission.update({"id": submission_id, "state": "submitted", "submittedAt": now()})
    save_record(output, record)  # Persist the receipt before waiting or inspecting exit status.
    if result.returncode:
        submission["state"] = "submission outcome unknown"
        save_record(output, record)
        raise SigningError("Submission returned an error with a receipt. Reconcile that ID before any new attempt.")
    record["phase"] = kind + " waiting"
    save_record(output, record)
    try:
        waited = run(["xcrun", "notarytool", "wait", submission_id, "--keychain-profile", profile,
                      "--output-format", "json", "--timeout", "10m"], env, timeout=660)
        wait_info = json.loads(waited.stdout)
        if response_uuid(wait_info) != submission_id:
            raise SigningError("Notary wait returned a different submission ID.")
        status = wait_info.get("status")
        if status not in ("Accepted", "Invalid", "In Progress", "Rejected"):
            raise SigningError("Notary wait returned an unrecognized state.")
        submission["status"], submission["state"] = status, "processed" if status in ("Accepted", "Invalid", "Rejected") else "waiting"
        save_record(output, record)
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
        raise SigningError("Notary result remains unconfirmed. Reconcile the recorded submission ID; no retry was sent.")
    log_path = output / (kind + "-notary-log.json")
    log_result = run(["xcrun", "notarytool", "log", submission_id, "--keychain-profile", profile], env)
    try:
        log = json.loads(log_result.stdout)
        issues = log.get("issues") if isinstance(log, dict) else False
        if (not isinstance(log, dict) or (issues is not None and not isinstance(issues, list))
                or any(not isinstance(issue, dict) or issue.get("severity") not in ("warning", "error") for issue in (issues or []))):
            raise SigningError("Notary log has an invalid structure.")
        if response_uuid(log, "jobId") != submission_id:
            raise SigningError("Notary log belongs to another submission.")
        service_digest = log.get("sha256")
        if "sha256" in log and (not isinstance(service_digest, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", service_digest)
                or service_digest.lower() != submission["sha256"]):
            raise SigningError("Notary log checksum differs from the submitted artifact.")
        if "archiveFilename" in log and log["archiveFilename"] != path.name:
            raise SigningError("Notary log filename differs from the submitted artifact.")
    except (ValueError, TypeError):
        raise SigningError("Notary log is unavailable. Reconcile the recorded submission ID; no retry was sent.")
    # Store Apple's log only in the private output, never in console output.
    log_path.write_text(json.dumps(log, indent=2) + "\n")
    if (waited.returncode or log_result.returncode or status != "Accepted" or log.get("status") != "Accepted"
            or type(log.get("statusCode")) is not int or log["statusCode"] != 0
            or any(issue.get("severity") == "error" for issue in (log.get("issues") or []))):
        raise SigningError("Notarization did not complete with an accepted, error-free receipt. Inspect the preserved private log.")
    submission.update({"state": "accepted", "acceptedAt": now(), "log": log_path.name})
    save_record(output, record)


def zip_app(app, target, env):
    checked(["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, target], env)


def validate_output(output):
    if output.exists() or output.is_symlink():
        raise SigningError("Choose a new output directory; an existing attempt is never overwritten or retried.")
    try:
        relative = output.relative_to(ROOT.resolve())
    except ValueError:
        return
    if not relative.parts or relative.parts[0] != "release-artifacts":
        raise SigningError("Repository outputs must be inside the ignored release-artifacts directory.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True, help="Full commit independently reviewed in the trusted build record")
    parser.add_argument("--identity", required=True, help="SHA-1 fingerprint of the installed Developer ID Application certificate")
    parser.add_argument("--team-id", required=True)
    parser.add_argument("--notary-profile", required=True, help="Already-configured Keychain profile; never a password")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--check", action="store_true", help="Validate read-only; do not sign, submit or create the output")
    args = parser.parse_args(argv)
    if platform.system() != "Darwin":
        raise SigningError("Signing and notarization require macOS.")
    args.identity = args.identity.upper()
    if not re.fullmatch(r"[0-9a-f]{40}", args.expected_commit) or not re.fullmatch(r"[0-9A-F]{40}", args.identity) or not re.fullmatch(r"[A-Z0-9]{10}", args.team_id):
        raise SigningError("Use a full 40-character commit and certificate SHA-1, and a 10-character team ID.")
    if not args.notary_profile or len(args.notary_profile) > 200 or any(ord(char) < 32 for char in args.notary_profile):
        raise SigningError("Use an existing, nonempty Keychain profile name.")
    env = sanitized_env()
    version, config, toolchain = read_contract()
    raw_output, candidate = args.output_dir.absolute(), args.candidate.absolute()
    validate_output(raw_output)
    output = raw_output.resolve()
    validate_output(output)
    try:
        output.relative_to(candidate.resolve())
    except ValueError:
        pass
    else:
        raise SigningError("Output must be separate from the original candidate directory.")
    candidate_info, archive = validate_candidate(candidate, args.expected_commit, version, config, toolchain)
    revision = checked(["git", "rev-parse", "HEAD"], env).stdout.strip()
    if checked(["git", "status", "--porcelain", "--untracked-files=all"], env).stdout.strip():
        raise SigningError("Commit signing-procedure source changes before validating a release candidate.")
    source_contract = (ROOT / "VERSION").read_bytes(), (MAC / "src-tauri/tauri.conf.json").read_bytes(), (ROOT / "scripts/release/toolchain.json").read_bytes()
    with tempfile.TemporaryDirectory(prefix="braincache-sign-preflight-") as temporary:
        scratch = Path(temporary)
        copied_zip = scratch / archive.name
        shutil.copy2(archive, copied_zip)
        expected_zip = next(item for item in candidate_info["artifacts"] if item["name"] == archive.name)
        if digest(copied_zip) != expected_zip["sha256"]:
            raise SigningError("Candidate changed while making its verification snapshot.")
        app_name = config["productName"] + ".app"
        validate_archive(copied_zip, app_name)
        extracted = scratch / "extracted"
        extracted.mkdir()
        checked(["/usr/bin/ditto", "-x", "-k", copied_zip, extracted], env)
        app = extracted / app_name
        validate_app(app, version, config["identifier"], env)
        validate_identity(args.identity, args.team_id, scratch, env)
        history = checked(["xcrun", "notarytool", "history", "--keychain-profile", args.notary_profile, "--output-format", "json"], env)
        try:
            private_history = json.loads(history.stdout)
            if not isinstance(private_history, dict) or not isinstance(private_history.get("history"), list):
                raise ValueError()
        except (ValueError, TypeError):
            raise SigningError("Could not validate the existing Keychain notary profile.")
        if (checked(["git", "rev-parse", "HEAD"], env).stdout.strip() != revision
                or checked(["git", "status", "--porcelain", "--untracked-files=all"], env).stdout.strip()
                or source_contract != ((ROOT / "VERSION").read_bytes(), (MAC / "src-tauri/tauri.conf.json").read_bytes(), (ROOT / "scripts/release/toolchain.json").read_bytes())):
            raise SigningError("Source changed during preflight; signing was not started.")
        if args.check:
            print("Read-only candidate, certificate and Keychain-profile checks passed. No signing or submission was performed.")
            return
        validate_output(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.mkdir(mode=0o700)  # Atomically reserve before the first signing/submission.
        work = output / ".work"
        work.mkdir(mode=0o700)
        record = {"candidateCommit": args.expected_commit, "candidateArtifacts": candidate_info["artifacts"],
                  "certificateSha1": args.identity, "teamId": args.team_id, "phase": "reserved", "startedAt": now(), "submissions": {}}
        save_record(output, record)
        try:
            working_app = work / app_name
            checked(["/usr/bin/ditto", app, working_app], env)
            record["phase"] = "app signing"
            save_record(output, record)
            print("Signing the verified app copy.", flush=True)
            checked(["/usr/bin/codesign", "--force", "--sign", args.identity, "--timestamp", "--options", "runtime", working_app], env)
            verify_distribution_signature(working_app, args.identity, args.team_id, config["identifier"], env)
            app_submission = work / "app-submission.zip"
            zip_app(working_app, app_submission, env)
            print("Submitting app; the receipt is retained before waiting.", flush=True)
            notarize(app_submission, "app", args.notary_profile, output, record, env)
            record["phase"] = "app stapling"
            save_record(output, record)
            checked(["xcrun", "stapler", "staple", working_app], env)
            checked(["xcrun", "stapler", "validate", working_app], env)
            verify_distribution_signature(working_app, args.identity, args.team_id, config["identifier"], env)
            checked(["/usr/sbin/spctl", "--assess", "--type", "execute", working_app], env)
            base = config["productName"] + "_" + version + "_aarch64"
            final_zip = output / (base + ".app.zip")
            zip_app(working_app, final_zip, env)
            validate_archive(final_zip, app_name)
            zip_check = work / "zip-acceptance"
            zip_check.mkdir()
            checked(["/usr/bin/ditto", "-x", "-k", final_zip, zip_check], env)
            validate_app(zip_check / app_name, version, config["identifier"], env)
            verify_distribution_signature(zip_check / app_name, args.identity, args.team_id, config["identifier"], env)
            checked(["xcrun", "stapler", "validate", zip_check / app_name], env)
            image_root = work / "image-root"
            image_root.mkdir()
            checked(["/usr/bin/ditto", working_app, image_root / app_name], env)
            validate_app(image_root / app_name, version, config["identifier"], env)
            verify_distribution_signature(image_root / app_name, args.identity, args.team_id, config["identifier"], env)
            checked(["xcrun", "stapler", "validate", image_root / app_name], env)
            (image_root / "Applications").symlink_to("/Applications", target_is_directory=True)
            dmg = output / (base + ".dmg")
            checked(["/usr/bin/hdiutil", "create", "-volname", config["productName"], "-srcfolder", image_root, "-format", "UDZO", dmg], env, timeout=180)
            checked(["/usr/bin/codesign", "--force", "--sign", args.identity, "--timestamp", "--identifier", config["identifier"] + ".dmg", dmg], env)
            verify_distribution_signature(dmg, args.identity, args.team_id, config["identifier"] + ".dmg", env, app=False)
            print("Submitting disk image; the receipt is retained before waiting.", flush=True)
            notarize(dmg, "dmg", args.notary_profile, output, record, env)
            record["phase"] = "dmg stapling"
            save_record(output, record)
            checked(["xcrun", "stapler", "staple", dmg], env)
            checked(["xcrun", "stapler", "validate", dmg], env)
            verify_distribution_signature(dmg, args.identity, args.team_id, config["identifier"] + ".dmg", env, app=False)
            checked(["/usr/bin/hdiutil", "verify", dmg], env)
            checked(["/usr/sbin/spctl", "--assess", "--type", "open", "--context", "context:primary-signature", dmg], env)
            if (checked(["git", "rev-parse", "HEAD"], env).stdout.strip() != revision
                    or checked(["git", "status", "--porcelain", "--untracked-files=all"], env).stdout.strip()
                    or source_contract != ((ROOT / "VERSION").read_bytes(), (MAC / "src-tauri/tauri.conf.json").read_bytes(), (ROOT / "scripts/release/toolchain.json").read_bytes())):
                raise SigningError("Signing-procedure source changed during verification; final checksums were not produced.")
            artifacts = [{"name": path.name, "sha256": digest(path), "bytes": path.stat().st_size} for path in (dmg, final_zip)]
            final_info = {"version": version, "identifier": config["identifier"], "target": toolchain["target"],
                          "commit": args.expected_commit, "sourceDirty": False, "signing": "Developer ID Application", "notarized": True,
                          "candidateArtifacts": candidate_info["artifacts"], "certificateSha1": args.identity, "teamId": args.team_id,
                          "signingProcedureCommit": revision, "tools": candidate_info["tools"],
                          "macOS": checked(["/usr/bin/sw_vers", "-productVersion"], env).stdout.strip(),
                          "xcode": checked(["xcodebuild", "-version"], env).stdout.strip(),
                          "notarization": record["submissions"], "signedAt": now(), "artifacts": artifacts}
            (output / "build-info.json").write_text(json.dumps(final_info, indent=2) + "\n")
            (output / "SHA256SUMS").write_text("".join(item["sha256"] + "  " + item["name"] + "\n" for item in artifacts))
            record["phase"] = "complete"
            save_record(output, record)
        except BaseException:
            record["failedDuring"] = record["phase"]
            record["phase"] = "stopped"
            save_record(output, record)
            print("Attempt stopped. Preserve", output, "and reconcile notarization.json before any new submission.", file=sys.stderr)
            raise
    print("Signed and notarized artifacts verified:", output)
    print("Nothing was published. Installed-app acceptance remains in RELEASE.md.")


if __name__ == "__main__":
    try:
        main()
    except (SigningError, OSError, subprocess.TimeoutExpired, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        print("Signing stopped:", error if isinstance(error, SigningError) else "A local operation failed; inspect the preserved attempt.", file=sys.stderr)
        sys.exit(1)
