use std::{collections::BTreeSet, fs, io::Read, path::PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_FILES: usize = 20;

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDraft {
    pub id: String,
    pub name: String,
    pub data: String,
}

#[derive(Debug)]
pub struct PreparedAttachment {
    pub metadata: Attachment,
    pub bytes: Vec<u8>,
}

pub fn safe_name(name: &str) -> String {
    let basename = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut value = String::new();
    for ch in basename.chars().filter(|ch| !ch.is_control()) {
        if value.len() + ch.len_utf8() > 180 {
            break;
        }
        value.push(ch);
    }
    let value = value.trim().trim_start_matches('.');
    if value.is_empty() {
        "attachment".into()
    } else {
        value.into()
    }
}

pub fn mime_for_name(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "txt" | "md" | "csv" | "log" => "text/plain",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

pub fn prepare(drafts: &[AttachmentDraft]) -> Result<Vec<PreparedAttachment>, String> {
    if drafts.len() > MAX_FILES {
        return Err("Attach up to 20 files per thought.".into());
    }
    let mut total = 0;
    let mut ids = BTreeSet::new();
    drafts
        .iter()
        .map(|draft| {
            Uuid::parse_str(&draft.id).map_err(|_| "Invalid attachment identifier.")?;
            if !ids.insert(&draft.id) {
                return Err("The same attachment was included twice.".into());
            }
            if draft.data.len() > MAX_FILE_BYTES.div_ceil(3) * 4 {
                return Err("Each attachment must be 20 MB or smaller.".into());
            }
            let bytes = STANDARD
                .decode(&draft.data)
                .map_err(|_| "Could not read the attachment data.")?;
            if bytes.len() > MAX_FILE_BYTES {
                return Err("Each attachment must be 20 MB or smaller.".into());
            }
            total += bytes.len();
            if total > MAX_TOTAL_BYTES {
                return Err("Attachments must total 50 MB or less per thought.".into());
            }
            let name = safe_name(&draft.name);
            Ok(PreparedAttachment {
                metadata: Attachment {
                    id: draft.id.clone(),
                    mime_type: mime_for_name(&name).into(),
                    name,
                    size: bytes.len(),
                },
                bytes,
            })
        })
        .collect()
}

pub fn insert(
    connection: &Connection,
    thought_id: &str,
    files: &[PreparedAttachment],
) -> Result<(), String> {
    let (count, total): (usize, usize) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM attachments WHERE thought_id = ?1",
            [thought_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if count + files.len() > MAX_FILES {
        return Err("Attach up to 20 files per thought.".into());
    }
    if total + files.iter().map(|file| file.metadata.size).sum::<usize>() > MAX_TOTAL_BYTES {
        return Err("Attachments must total 50 MB or less per thought.".into());
    }
    for file in files {
        connection.execute(
            "INSERT INTO attachments (id, thought_id, name, mime_type, size, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![file.metadata.id, thought_id, file.metadata.name, file.metadata.mime_type, file.metadata.size, file.bytes],
        ).map_err(|e| format!("Could not save the attachment: {e}"))?;
    }
    Ok(())
}

pub fn list(connection: &Connection, thought_id: &str) -> Result<Vec<Attachment>, String> {
    let mut statement = connection.prepare(
        "SELECT id, name, mime_type, size FROM attachments WHERE thought_id = ?1 ORDER BY rowid",
    ).map_err(|e| e.to_string())?;
    let files = statement
        .query_map([thought_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                name: row.get(1)?,
                mime_type: row.get(2)?,
                size: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(files)
}

pub fn read_selected_files(paths: Vec<PathBuf>) -> Result<Vec<AttachmentDraft>, String> {
    if paths.len() > MAX_FILES {
        return Err("Attach up to 20 files at a time.".into());
    }
    let mut total = 0;
    paths
        .into_iter()
        .map(|path| {
            let file = fs::File::open(&path).map_err(|_| {
                "Could not read a selected file. Check its permissions and try again."
            })?;
            let metadata = file.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                return Err("Choose files rather than folders.".into());
            }
            if metadata.len() > MAX_FILE_BYTES as u64 {
                return Err("Each attachment must be 20 MB or smaller.".into());
            }
            let mut bytes = Vec::new();
            file.take(MAX_FILE_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > MAX_FILE_BYTES {
                return Err("Each attachment must be 20 MB or smaller.".into());
            }
            total += bytes.len();
            if total > MAX_TOTAL_BYTES {
                return Err("Attachments must total 50 MB or less per thought.".into());
            }
            Ok(AttachmentDraft {
                id: Uuid::new_v4().to_string(),
                name: safe_name(&path.file_name().unwrap_or_default().to_string_lossy()),
                data: STANDARD.encode(bytes),
            })
        })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn choose_files() -> Result<Vec<PathBuf>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalPanelWindowLevel, NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::NSString;
    let mtm = MainThreadMarker::new().ok_or("The file picker must open on the main thread.")?;
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setLevel(NSModalPanelWindowLevel);
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(true);
    panel.setTitle(Some(&NSString::from_str("Attach files to Brain Cache")));
    if panel.runModal() != NSModalResponseOK {
        return Ok(Vec::new());
    }
    Ok(panel
        .URLs()
        .iter()
        .filter_map(|url| url.path().map(|path| PathBuf::from(path.to_string())))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_cannot_escape_export_directory_and_unicode_is_preserved() {
        assert_eq!(safe_name("../../secret.txt"), "secret.txt");
        assert_eq!(safe_name("C:\\temp\\photo.png"), "photo.png");
        assert_eq!(safe_name("..."), "attachment");
        assert_eq!(safe_name("résumé.pdf"), "résumé.pdf");
        assert!(safe_name(&"🖼".repeat(100)).len() <= 180);
    }

    #[test]
    fn malformed_oversized_and_duplicate_payloads_are_rejected() {
        let mut file = AttachmentDraft {
            id: Uuid::new_v4().to_string(),
            name: "a.txt".into(),
            data: "not base64".into(),
        };
        assert!(prepare(&[file.clone()]).is_err());
        file.data = STANDARD.encode(b"hello");
        assert!(prepare(&[file.clone(), file.clone()]).is_err());
        file.data = "A".repeat(MAX_FILE_BYTES.div_ceil(3) * 4 + 4);
        assert!(prepare(&[file]).unwrap_err().contains("20 MB"));
    }
}
