use crate::{attachments::Attachment, storage::ChecklistItem};
use serde_json::Value;
use std::collections::HashSet;

pub struct Projection {
    pub body: String,
    pub items: Vec<ChecklistItem>,
}

pub fn text(node: &Value) -> String {
    match node["type"].as_str().unwrap_or("") {
        "text" => node["text"].as_str().unwrap_or("").into(),
        "hardBreak" => "\n".into(),
        kind => node["content"]
            .as_array()
            .map(|nodes| {
                nodes.iter().map(text).collect::<Vec<_>>().join(
                    if [
                        "doc",
                        "taskList",
                        "bulletList",
                        "orderedList",
                        "taskItem",
                        "listItem",
                        "blockquote",
                    ]
                    .contains(&kind)
                    {
                        "\n"
                    } else {
                        ""
                    },
                )
            })
            .unwrap_or_default(),
    }
}

pub fn validate(doc: &Value, files: &[Attachment]) -> Result<Projection, String> {
    if doc.to_string().len() > 2_000_000 {
        return Err("This note is too large to save.".into());
    }
    let mut items = Vec::new();
    let mut ids = HashSet::new();
    let mut images = Vec::new();
    fn visit(
        node: &Value,
        parent: &str,
        depth: usize,
        files: &[Attachment],
        items: &mut Vec<ChecklistItem>,
        ids: &mut HashSet<String>,
        images: &mut Vec<String>,
    ) -> Result<(), String> {
        if depth > 32 {
            return Err("This formatted document is nested too deeply.".into());
        }
        let kind = node["type"]
            .as_str()
            .ok_or("This formatted document could not be read.")?;
        let allowed = match parent {
            "root" => kind == "doc",
            "paragraph" | "heading" => ["text", "hardBreak"].contains(&kind),
            "taskList" => kind == "taskItem",
            "bulletList" | "orderedList" => kind == "listItem",
            "doc" | "taskItem" | "listItem" | "blockquote" => [
                "paragraph",
                "heading",
                "blockquote",
                "bulletList",
                "orderedList",
                "taskList",
                "horizontalRule",
                "cacheImage",
            ]
            .contains(&kind),
            _ => false,
        };
        if !allowed {
            return Err("This formatted document contains an unsupported block.".into());
        }
        if kind == "text" && !node["text"].is_string() {
            return Err("This document contains invalid text.".into());
        }
        if let Some(marks) = node.get("marks") {
            for mark in marks
                .as_array()
                .ok_or("This document contains invalid formatting.")?
            {
                if !["bold", "italic", "strike", "underline", "code"]
                    .contains(&mark["type"].as_str().unwrap_or(""))
                {
                    return Err("This document contains unsupported formatting.".into());
                }
            }
        }
        if kind == "heading" && ![1, 2, 3].contains(&node["attrs"]["level"].as_i64().unwrap_or(0)) {
            return Err("Choose a supported heading size.".into());
        }
        if kind == "taskItem" {
            let id = node["attrs"]["id"]
                .as_str()
                .ok_or("Checklist item IDs must be valid UUIDs.")?;
            uuid::Uuid::parse_str(id).map_err(|_| "Checklist item IDs must be valid UUIDs.")?;
            if !ids.insert(id.into()) {
                return Err("Checklist item IDs must be unique.".into());
            }
            let checked = node["attrs"]["checked"]
                .as_bool()
                .ok_or("Checklist completion is invalid.")?;
            let value = text(node)
                .lines()
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(" ")
                .trim()
                .to_string();
            if value.chars().count() > 500 || value.chars().any(|c| c.is_control()) {
                return Err("Checklist items must contain at most 500 visible characters.".into());
            }
            if !value.is_empty() {
                items.push(ChecklistItem {
                    id: id.into(),
                    text: value,
                    completed: checked,
                    reminder: None,
                });
            }
        }
        if kind == "cacheImage" {
            let id = node["attrs"]["attachmentId"]
                .as_str()
                .ok_or("An image in this document is missing.")?;
            if !files
                .iter()
                .any(|file| file.id == id && file.mime_type.starts_with("image/"))
            {
                return Err("An image in this document is missing. Please retry adding it.".into());
            }
            if !images.iter().any(|image| image == id) {
                images.push(id.into());
            }
        }
        if let Some(content) = node.get("content") {
            for child in content
                .as_array()
                .ok_or("This formatted document could not be read.")?
            {
                visit(child, kind, depth + 1, files, items, ids, images)?;
            }
        }
        Ok(())
    }
    visit(doc, "root", 0, files, &mut items, &mut ids, &mut images)?;
    if items.len() > 100 {
        return Err("Checklists can contain up to 100 items.".into());
    }
    let mut body = text(doc).trim().to_string();
    if body.is_empty() {
        body = images
            .iter()
            .filter_map(|id| {
                files
                    .iter()
                    .find(|file| file.id == *id)
                    .map(|file| file.name.as_str())
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    if body.is_empty() {
        body = "Untitled note".into();
    }
    Ok(Projection { body, items })
}

pub fn update_checks(node: &mut Value, items: &[ChecklistItem]) {
    if node["type"] == "taskItem" {
        if let Some(item) = items
            .iter()
            .find(|item| node["attrs"]["id"].as_str() == Some(&item.id))
        {
            node["attrs"]["checked"] = Value::Bool(item.completed);
        }
    }
    if let Some(content) = node.get_mut("content").and_then(Value::as_array_mut) {
        for child in content {
            update_checks(child, items);
        }
    }
}

pub fn has_image(node: &Value, id: &str) -> bool {
    (node["type"] == "cacheImage" && node["attrs"]["attachmentId"] == id)
        || node["content"]
            .as_array()
            .is_some_and(|nodes| nodes.iter().any(|node| has_image(node, id)))
}
