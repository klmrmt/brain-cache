# Mac backup and restore

Brain Cache stores Mac thoughts and their attachment bytes in a local SQLite database:

```text
~/Library/Application Support/com.braincache.desktop/brain-cache.sqlite3
```

The database also contains tags and colors, checklist item identities, completion history, rich documents, Trash, pins, reminder intents, and appearance preferences. Temporary copies of attachments opened in another app are caches; the attachment bytes in SQLite are the saved originals. Browser-preview data and the retained iPhone archive use separate stores and are outside this procedure.

This is a manual recovery path for the Mac release. There is no backup or export interface yet.

## Before either operation

1. Finish editing and wait for the saved confirmation. Resolve any save error; an unsaved draft is not in a database backup.
2. Choose **Quit Brain Cache** from its menu or menu-bar icon. Closing a window is insufficient because capture can run in the background. In Activity Monitor, confirm no Brain Cache process remains. Stop a development instance as well.
3. Keep Brain Cache closed until the operation finishes. Use the same app version to restore, or a newer version with supported migrations. Do not open a newer database with an older app.

SQLite uses write-ahead logging (WAL). Committed records can still be in `brain-cache.sqlite3-wal`, with coordination state in `brain-cache.sqlite3-shm`. Copying only the original main file can omit those records. Never remove the original sidecars to force a backup or restore. SQLite's [backup API](https://www.sqlite.org/backup.html) produces a consistent snapshot, including committed WAL data; the [SQLite shell](https://www.sqlite.org/cli.html) exposes it as `.backup`.

## Make a verified backup

Open Terminal and paste this block. It uses the SQLite tool shipped on the verification Mac, creates a new private folder for every backup, and never overwrites an earlier backup. The database source is opened read-only. Converting the **new snapshot** to DELETE journal mode makes its main file self-contained; it does not change the application database.

```sh
(
  set -eu
  umask 077
  data_directory="$HOME/Library/Application Support/com.braincache.desktop"
  database="$data_directory/brain-cache.sqlite3"
  test -f "$database" || {
    printf 'No Brain Cache database found. Stop and confirm the data location.\n' >&2
    exit 1
  }
  mkdir -p "$HOME/BrainCache Backups"
  backup_directory=$(mktemp -d "$HOME/BrainCache Backups/backup-$(date +%Y%m%d-%H%M%S).XXXXXX")
  cd "$backup_directory"
  /usr/bin/sqlite3 -batch -bail -readonly "$database" \
    '.timeout 5000' '.backup brain-cache.sqlite3'
  test "$(/usr/bin/sqlite3 -batch -bail brain-cache.sqlite3 'PRAGMA journal_mode=DELETE;')" = delete
  test "$(/usr/bin/sqlite3 -batch -bail -readonly brain-cache.sqlite3 'PRAGMA integrity_check;')" = ok
  test -z "$(/usr/bin/sqlite3 -batch -bail -readonly brain-cache.sqlite3 'PRAGMA foreign_key_check;')"
  /usr/bin/shasum -a 256 brain-cache.sqlite3 > SHA256SUMS
  printf 'Verified backup: %s/brain-cache.sqlite3\n' "$backup_directory"
)
```

Treat the backup as successful only if the final `Verified backup:` message appears without an error. If a command fails, keep the original database and its sidecars in place; the incomplete new folder is not a verified backup. The checks report structural integrity without printing thought content. A checksum detects later changes to the backup file; it is not encryption or proof that every thought the person expected was saved.

Record the app version with the backup. Copy the verified backup folder to another private storage device if it needs to survive loss of the Mac. Backup files contain readable thoughts and attachments; store them with the same care as the original data. Any incidental sidecar created while checking the snapshot can remain in the backup folder; after the successful DELETE-mode conversion, restore the verified main file by the procedure below.

## Restore a backup

Restoring replaces the current library with the backup's contents. It does not merge notes created after the backup. First make a fresh backup of the current store if it is readable. The restore also preserves the entire current application-data directory, including any WAL and SHM files, so recovery remains possible if that backup fails.

Keep Brain Cache quit. Replace the example `backup_directory` value below with the folder printed by the backup step. Keep the quotes around the path. The chosen backup folder must contain `brain-cache.sqlite3` and `SHA256SUMS` from the verified backup procedure.

```sh
(
  set -eu
  umask 077
  backup_directory="$HOME/BrainCache Backups/backup-YYYYMMDD-HHMMSS.XXXXXX"
  data_parent="$HOME/Library/Application Support"
  data_directory="$data_parent/com.braincache.desktop"
  test -d "$data_directory" && test ! -L "$data_directory"
  test -f "$backup_directory/brain-cache.sqlite3"
  (
    cd "$backup_directory"
    /usr/bin/shasum -a 256 -c SHA256SUMS
  )
  stage_directory=$(mktemp -d "$data_parent/.braincache-restore.XXXXXX")
  cp -p "$backup_directory/brain-cache.sqlite3" "$stage_directory/brain-cache.sqlite3"
  test "$(/usr/bin/sqlite3 -batch -bail -readonly "$stage_directory/brain-cache.sqlite3" 'PRAGMA journal_mode;')" = delete
  test "$(/usr/bin/sqlite3 -batch -bail -readonly "$stage_directory/brain-cache.sqlite3" 'PRAGMA integrity_check;')" = ok
  test -z "$(/usr/bin/sqlite3 -batch -bail -readonly "$stage_directory/brain-cache.sqlite3" 'PRAGMA foreign_key_check;')"
  cmp -s "$backup_directory/brain-cache.sqlite3" "$stage_directory/brain-cache.sqlite3"
  safety_directory=$(mktemp -d "$data_parent/com.braincache.desktop.before-restore.XXXXXX")
  mv "$data_directory" "$safety_directory/original"
  printf 'Previous store preserved at: %s/original\n' "$safety_directory"
  if ! mv "$stage_directory" "$data_directory"; then
    mv "$safety_directory/original" "$data_directory"
    printf 'Restore did not complete; previous store returned to its original location.\n' >&2
    exit 1
  fi
  printf 'Restored verified backup. Keep the previous-store folder until app checks pass.\n'
)
```

The restored main file enters a clean directory. None of the previous store's sidecars are mixed with it. The preserved `original` folder keeps the previous database and all its sidecars together. If interrupted between the two moves, leave the app closed: the previous store remains in the printed safety folder and the staged snapshot remains in `.braincache-restore.*`. Do not launch into an empty data directory; use the rollback instructions first.

After the final success message, launch Brain Cache. Check several familiar notes, tags, checklist order and checks, Activity completion history, Completed and Trash, and an attachment. Capture a temporary sample, quit, relaunch, and confirm it persists. Keep both the chosen backup and the previous-store folder until satisfied.

Reminder intents are restored from SQLite. macOS notification requests and notification permission are separate system state; the app reconciles requests at startup. Review pending reminders after a restore, especially if the backup is old. Launch-at-login settings and other macOS permissions are also outside the SQLite backup.

### Roll back to the previous store

Quit Brain Cache and confirm it is no longer running. In Finder, choose **Go → Go to Folder** and open `~/Library/Application Support/`. Move the current `com.braincache.desktop` folder to a new clearly named safety folder. Then move the **entire** `original` folder from the printed `com.braincache.desktop.before-restore.*` folder back into Application Support and rename it to `com.braincache.desktop`. Keep each database and its own sidecars together. Reopen the app and verify the previous library. Do not replace individual files or combine the two stores.

## Verification evidence

Run the disposable check from the repository root:

```sh
python3 scripts/release/verify-backup-restore.py
```

The verifier accepts no database path and never opens a person's Application Support store. It reads the current table-creation SQL and additive column migrations from the native [storage implementation](../../apps/mac/src-tauri/src/storage.rs), creates temporary synthetic stores, and uses `/usr/bin/sqlite3` for the same `.backup` and journal conversion operations documented above.

Verified on September 30, 2026 with SQLite CLI 3.51.0 and Python SQLite 3.51.0:

- A deliberately uncheckpointed committed WAL contained fixture records absent from a main-file-only copy; `.backup` recovered them.
- The backup and restored copy passed `integrity_check` and `foreign_key_check`.
- All rows and fields across all ten current application tables matched after backup, staged restore, and reopening with the native store's WAL/FULL/foreign-key settings. Coverage includes IDs and timestamps, checklist order and completion dates (including undated history and a removed item), tags, rich/legacy document JSON, attachment bytes, Completed and Trash, pins, reminder intents, and preferences.
- Restoring beside an existing store with committed WAL preserved the original database and sidecar bytes unchanged. Rolling the full directory back recovered a later synthetic note.
- The exact backup and restore Terminal blocks also passed in zsh with a disposable synthetic home path containing spaces. A deliberately incorrect checksum rejected restore before changing the current store.

This verifies the SQLite recovery procedure and data preservation. It does not exercise the installed native app, native migrations through `ThoughtStore`, notification delivery, or an older supported macOS SQLite executable. Installed-app recovery acceptance and oldest-supported-macOS verification remain release checks. A person should never delete or reset their store to run this verifier.
