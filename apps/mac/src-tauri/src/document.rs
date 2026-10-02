use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use crate::attachments::Attachment;

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DocumentBlock {
    Text { id: String, text: String },
    Image { id: String, #[serde(rename = "attachmentId")] attachment_id: String },
}

pub fn image_ids(blocks: &[DocumentBlock]) -> HashSet<&str> {
    blocks.iter().filter_map(|block| match block {
        DocumentBlock::Image { attachment_id, .. } => Some(attachment_id.as_str()),
        _ => None,
    }).collect()
}

pub fn validate(blocks: &[DocumentBlock], files: &[Attachment]) -> Result<String, String> {
    if blocks.is_empty() || blocks.len() > 101 { return Err("This document could not be read.".into()); }
    let mut ids = HashSet::new();
    let mut images = HashSet::new();
    let mut text = Vec::new();
    for block in blocks {
        let id = match block { DocumentBlock::Text { id, .. } | DocumentBlock::Image { id, .. } => id };
        if id.is_empty() || !ids.insert(id) { return Err("Document block IDs must be unique.".into()); }
        match block {
            DocumentBlock::Text { text: value, .. } => text.push(value.as_str()),
            DocumentBlock::Image { attachment_id, .. } => {
                if !images.insert(attachment_id) || !files.iter().any(|file| file.id == *attachment_id && file.mime_type.starts_with("image/")) {
                    return Err("An image in this document is missing. Please retry adding it.".into());
                }
            }
        }
    }
    let body = text.join("\n").trim().replace("\r\n", "\n");
    if !body.is_empty() { return Ok(body); }
    let names = blocks.iter().filter_map(|block| match block {
        DocumentBlock::Image { attachment_id, .. } => files.iter().find(|file| file.id == *attachment_id).map(|file| file.name.as_str()),
        _ => None,
    }).collect::<Vec<_>>().join("\n");
    if names.is_empty() { return Err("Give Blob something to remember.".into()); }
    Ok(names)
}
