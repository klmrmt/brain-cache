#!/usr/bin/env python3
"""Verify the manual SQLite recovery path using disposable synthetic data only.

This script accepts no database path and never opens Application Support.
Run from any directory: python3 scripts/release/verify-backup-restore.py
"""

import base64
import hashlib
import json
import re
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[2]
SQLITE = "/usr/bin/sqlite3"
TABLES = {
    "thoughts", "tags", "thought_tags", "checklist_items", "task_completions",
    "checklist_reminders", "thought_reminders", "attachments", "preferences",
    "text_preferences",
}


def sqlite_cli(database, *commands, readonly=False, cwd=None):
    args = [SQLITE, "-batch", "-bail"]
    if readonly:
        args.append("-readonly")
    result = subprocess.run(
        [*args, str(database), *commands], cwd=cwd, check=True,
        capture_output=True, text=True,
    )
    return result.stdout.strip()


def create_schema(connection):
    source = (REPOSITORY / "apps/mac/src-tauri/src/storage.rs").read_text()
    opening = source.split("pub fn open(", 1)[1].split("pub fn list(", 1)[0]
    initial = re.search(
        r'\.execute_batch\(\s*"(CREATE TABLE IF NOT EXISTS thoughts .*?)",\s*\)',
        opening, re.DOTALL,
    )
    assert initial, "Review the verifier when the native schema format changes."
    connection.executescript(initial.group(1))
    for match in re.finditer(
        r'"(ALTER TABLE (thoughts|tags) ADD COLUMN (\w+) .*?;)"',
        opening, re.DOTALL,
    ):
        statement, table, column = match.groups()
        columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
        if column not in columns:
            connection.executescript(statement)
    actual = {
        row[0] for row in connection.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    assert actual == TABLES, "Review fixture coverage when native tables change."


def snapshot(database):
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        result = {}
        for table in sorted(TABLES):
            columns = len(connection.execute(f'PRAGMA table_info("{table}")').fetchall())
            order = ",".join(str(index) for index in range(1, columns + 1))
            result[table] = connection.execute(f'SELECT * FROM "{table}" ORDER BY {order}').fetchall()
        return result


def directory_hashes(directory):
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in directory.iterdir() if path.is_file()
    }


def main():
    with tempfile.TemporaryDirectory(prefix="braincache-backup-verification-") as temporary:
        root = Path(temporary)
        source_dir = root / "source"
        source_dir.mkdir()
        source = source_dir / "brain-cache.sqlite3"
        connection = sqlite3.connect(source)
        connection.executescript(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; "
            "PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=0;"
        )
        create_schema(connection)
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        attachment = bytes(range(256)) + b"\x00synthetic attachment\xff"
        image = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII="
        )
        rich_document = json.dumps({"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Synthetic note"}]},
            {"type": "cacheImage", "attrs": {"attachmentId": "fixture-image"}},
        ]}, separators=(",", ":"))
        connection.executemany(
            "INSERT INTO thoughts(id,body,created_at,archived,pinned,source,kind,completed,rich_document,document) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                ("fixture-note", "Synthetic note", "2026-01-02T03:04:05.006Z", 0, 1, "mac-capture", "text", 0, rich_document, None),
                ("fixture-checklist", "Read\nWrite", "2026-01-03T04:05:06.007Z", 0, 0, "mac-library", "checklist", 0, None, None),
                ("fixture-trash", "Synthetic completed Trash note", "2025-12-30T01:02:03.004Z", 1, 0, "mac-library", "text", 1, None, None),
                ("fixture-legacy-document", "Synthetic image blocks", "2026-01-01T01:02:03.004Z", 0, 0, "mac-library", "text", 0, None,
                 json.dumps([{"type": "text", "id": "fixture-block", "text": "Synthetic image blocks"}])),
            ],
        )
        connection.execute("INSERT INTO tags VALUES ('synthetic','moss')")
        connection.execute("INSERT INTO thought_tags VALUES ('fixture-note','synthetic')")
        connection.executemany("INSERT INTO checklist_items VALUES (?,?,?,?,?)", [
            ("fixture-read", "fixture-checklist", "Read", 1, 0),
            ("fixture-write", "fixture-checklist", "Write", 0, 1),
        ])
        connection.executemany("INSERT INTO task_completions VALUES (?,?,?)", [
            ("fixture-checklist", "fixture-read", "2026-01-03T05:06:07.008Z"),
            ("fixture-checklist", "fixture-removed-item", None),
        ])
        connection.execute(
            "INSERT INTO attachments VALUES (?,?,?,?,?,?)",
            ("fixture-attachment", "fixture-note", "synthetic.bin", "application/octet-stream", len(attachment), attachment),
        )
        connection.execute(
            "INSERT INTO attachments VALUES (?,?,?,?,?,?)",
            ("fixture-image", "fixture-note", "synthetic.png", "image/png", len(image), image),
        )
        connection.execute(
            "INSERT INTO thought_reminders VALUES (?,?,?,?,?,?)",
            ("fixture-note", "Synthetic note", "2027-01-01T12:00:00.000Z", "scheduled", None, "2026-01-03T05:00:00.000Z"),
        )
        connection.execute(
            "INSERT INTO checklist_reminders VALUES (?,?,?,?,?,?,?)",
            ("fixture-write", "fixture-checklist", "Write", "2027-01-02T12:00:00.000Z", "permission-denied", "Synthetic permission failure", "2026-01-03T05:00:00.000Z"),
        )
        connection.execute("INSERT INTO preferences VALUES ('light_mode',1)")
        connection.execute("INSERT INTO text_preferences VALUES ('font_size','large')")
        connection.commit()
        assert source.with_name(source.name + "-wal").stat().st_size > 32
        main_only = root / "unsafe-main-only.sqlite3"
        shutil.copy2(source, main_only)
        with sqlite3.connect(main_only) as unsafe:
            assert unsafe.execute("SELECT count(*) FROM thoughts").fetchone() == (0,)
        expected = snapshot(source)
        backup_dir = root / "verified-backup"
        backup_dir.mkdir()
        backup = backup_dir / "brain-cache.sqlite3"
        sqlite_cli(source, ".timeout 5000", ".backup brain-cache.sqlite3", readonly=True, cwd=backup_dir)
        assert sqlite_cli(backup, "PRAGMA journal_mode=DELETE;") == "delete"
        assert snapshot(backup) == expected
        connection.close()

        current_dir = root / "application-data"
        current_dir.mkdir()
        current = current_dir / "brain-cache.sqlite3"
        shutil.copy2(backup, current)
        # A terminated fixture writer leaves committed WAL bytes, as after a crash.
        subprocess.run([
            "python3", "-c",
            "import os, sqlite3, sys; c=sqlite3.connect(sys.argv[1]); "
            "c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA wal_autocheckpoint=0'); "
            "c.execute(\"INSERT INTO thoughts(id,body,source) VALUES ('fixture-later','Later synthetic thought','mac-capture')\"); "
            "c.commit(); os._exit(0)", str(current),
        ], check=True)
        original_hashes = directory_hashes(current_dir)
        assert "brain-cache.sqlite3-wal" in original_hashes
        staged_dir = root / "staged-restore"
        staged_dir.mkdir()
        staged = staged_dir / "brain-cache.sqlite3"
        shutil.copy2(backup, staged)
        assert snapshot(staged) == expected
        preserved_dir = root / "before-restore"
        current_dir.rename(preserved_dir)
        staged_dir.rename(current_dir)
        assert directory_hashes(preserved_dir) == original_hashes
        assert snapshot(current) == expected
        with sqlite3.connect(current) as reopened:
            reopened.executescript("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;")
            assert reopened.execute("SELECT data FROM attachments WHERE id='fixture-attachment'").fetchone()[0] == attachment
            assert reopened.execute("SELECT data FROM attachments WHERE id='fixture-image'").fetchone()[0] == image
        assert snapshot(current) == expected

        # Roll back without combining databases or sidecars from different stores.
        current_dir.rename(root / "restored-copy-before-rollback")
        preserved_dir.rename(current_dir)
        assert directory_hashes(current_dir) == original_hashes
        with sqlite3.connect(current) as rolled_back:
            assert rolled_back.execute("SELECT body FROM thoughts WHERE id='fixture-later'").fetchone() == ("Later synthetic thought",)
        print("PASS: committed WAL data included; main-only copy intentionally omitted it.")
        print("PASS: backup, clean restore, WAL reopen and rollback; integrity and foreign keys valid.")
        print("PASS: all 10 tables preserved, including IDs/timestamps, task history, rich documents, attachment bytes, reminders and preferences.")
        print("PASS: original database and sidecar bytes preserved; only disposable synthetic stores used.")
        print("SQLite CLI:", sqlite_cli(":memory:", "SELECT sqlite_version();"))
        print("Python SQLite:", sqlite3.sqlite_version)


if __name__ == "__main__":
    main()
