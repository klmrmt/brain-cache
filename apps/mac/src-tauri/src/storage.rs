use crate::document::{self, DocumentBlock};
use crate::rich_document;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
    time::Duration,
};

use crate::attachments::{self, Attachment, AttachmentDraft};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const ALLOWED_SOURCES: [&str; 4] = ["mac-library", "mac-capture", "iphone", "shortcut"];
const ALLOWED_TAG_COLORS: [&str; 6] = ["graphite", "clay", "moss", "sky", "plum", "rose"];
const TAG_MAX_CHARACTERS: usize = 32;
const CHECKLIST_ITEM_MAX_CHARACTERS: usize = 500;
const CHECKLIST_MAX_ITEMS: usize = 100;

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FontSize {
    Default,
    Large,
    ExtraLarge,
}

impl FontSize {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Large => "large",
            Self::ExtraLarge => "extra-large",
        }
    }

    fn from_saved(value: &str) -> Result<Self, String> {
        match value {
            "default" => Ok(Self::Default),
            "large" => Ok(Self::Large),
            "extra-large" => Ok(Self::ExtraLarge),
            _ => Err("Choose a supported font size.".into()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub completed: bool,
    #[serde(default)]
    pub reminder: Option<ChecklistReminder>,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompletion {
    pub item_id: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistReminder {
    pub scheduled_for: String,
    pub state: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ReminderRecord {
    pub item_id: Option<String>,
    pub thought_id: String,
    pub item_text: String,
    pub scheduled_for: String,
    pub state: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thought {
    pub id: String,
    pub body: String,
    pub created_at: String,
    pub archived: bool,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub pinned: bool,
    pub source: String,
    pub tags: Vec<String>,
    pub kind: String,
    pub checklist_items: Vec<ChecklistItem>,
    #[serde(default)]
    pub reminder: Option<ChecklistReminder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_document: Option<serde_json::Value>,
    #[serde(default)]
    pub task_completions: Vec<TaskCompletion>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<Vec<DocumentBlock>>,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDefinition {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ThoughtStore {
    database_path: PathBuf,
}

impl ThoughtStore {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, String> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("Could not create the Brain Cache data directory: {error}")
            })?;
        }

        let store = Self { database_path };
        let mut connection = store.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS thoughts (
                    id TEXT PRIMARY KEY NOT NULL,
                    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
                    created_at TEXT NOT NULL DEFAULT (
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    ),
                    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
                    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
                    source TEXT NOT NULL CHECK (
                        source IN ('mac-library', 'mac-capture', 'iphone', 'shortcut')
                    ),
                    kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'checklist'))
                );
                CREATE INDEX IF NOT EXISTS thoughts_created_at_index
                    ON thoughts(created_at DESC);
                CREATE INDEX IF NOT EXISTS thoughts_archived_created_at_index
                    ON thoughts(archived, created_at DESC);
                CREATE TABLE IF NOT EXISTS tags (
                    name TEXT PRIMARY KEY NOT NULL,
                    color TEXT CHECK (
                        color IS NULL OR color IN (
                            'graphite', 'clay', 'moss', 'sky', 'plum', 'rose'
                        )
                    )
                );
                CREATE TABLE IF NOT EXISTS thought_tags (
                    thought_id TEXT NOT NULL
                        REFERENCES thoughts(id) ON DELETE CASCADE,
                    tag_name TEXT NOT NULL
                        REFERENCES tags(name) ON DELETE CASCADE,
                    PRIMARY KEY (thought_id, tag_name)
                );
                CREATE INDEX IF NOT EXISTS thought_tags_tag_name_index
                    ON thought_tags(tag_name, thought_id);
                CREATE TABLE IF NOT EXISTS checklist_items (
                    id TEXT PRIMARY KEY NOT NULL,
                    thought_id TEXT NOT NULL
                        REFERENCES thoughts(id) ON DELETE CASCADE,
                    text TEXT NOT NULL CHECK (length(trim(text)) > 0),
                    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
                    position INTEGER NOT NULL CHECK (position >= 0),
                    UNIQUE (thought_id, position)
                );
                CREATE INDEX IF NOT EXISTS checklist_items_thought_position_index
                    ON checklist_items(thought_id, position);
                CREATE TABLE IF NOT EXISTS task_completions (
                    thought_id TEXT NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
                    item_id TEXT NOT NULL,
                    completed_at TEXT,
                    PRIMARY KEY (thought_id, item_id)
                );
                INSERT OR IGNORE INTO task_completions (thought_id, item_id, completed_at)
                    SELECT thought_id, id, NULL FROM checklist_items WHERE completed = 1;
                CREATE TABLE IF NOT EXISTS checklist_reminders (
                    item_id TEXT PRIMARY KEY NOT NULL,
                    thought_id TEXT NOT NULL,
                    item_text TEXT NOT NULL,
                    scheduled_for TEXT NOT NULL,
                    state TEXT NOT NULL CHECK (
                        state IN (
                            'pending', 'scheduled', 'permission-denied',
                            'scheduling-failed', 'cancel-pending'
                        )
                    ),
                    last_error TEXT,
                    updated_at TEXT NOT NULL DEFAULT (
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    )
                );
                CREATE INDEX IF NOT EXISTS checklist_reminders_thought_index
                    ON checklist_reminders(thought_id, item_id);
                CREATE TABLE IF NOT EXISTS thought_reminders (
                    thought_id TEXT PRIMARY KEY NOT NULL,
                    item_text TEXT NOT NULL,
                    scheduled_for TEXT NOT NULL,
                    state TEXT NOT NULL CHECK (state IN (
                        'pending', 'scheduled', 'permission-denied',
                        'scheduling-failed', 'cancel-pending'
                    )),
                    last_error TEXT,
                    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                CREATE TRIGGER IF NOT EXISTS thought_reminder_body_update
                AFTER UPDATE OF body ON thoughts WHEN NEW.body != OLD.body
                BEGIN
                    UPDATE thought_reminders SET item_text = NEW.body,
                        state = 'pending', last_error = NULL,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE thought_id = NEW.id AND state != 'cancel-pending'
                      AND scheduled_for > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
                END;
                CREATE TABLE IF NOT EXISTS attachments (
                    id TEXT PRIMARY KEY NOT NULL,
                    thought_id TEXT NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size INTEGER NOT NULL CHECK (size >= 0),
                    data BLOB NOT NULL CHECK (length(data) = size)
                );
                CREATE INDEX IF NOT EXISTS attachments_thought_index ON attachments(thought_id);
                CREATE TABLE IF NOT EXISTS preferences (
                    key TEXT PRIMARY KEY NOT NULL,
                    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
                );
                CREATE TABLE IF NOT EXISTS text_preferences (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL CHECK (
                        key != 'font_size' OR value IN ('default', 'large', 'extra-large')
                    )
                );",
            )
            .map_err(storage_error)?;
        if !thought_column_exists(&transaction, "rich_document")? {
            transaction.execute_batch("ALTER TABLE thoughts ADD COLUMN rich_document TEXT;").map_err(storage_error)?;
        }
        if !thought_column_exists(&transaction, "completed")? {
            transaction.execute_batch(
                "ALTER TABLE thoughts ADD COLUMN completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1));"
            ).map_err(storage_error)?;
        }
        if !thought_column_exists(&transaction, "document")? {
            transaction.execute_batch("ALTER TABLE thoughts ADD COLUMN document TEXT;").map_err(storage_error)?;
        }
        if !thought_column_exists(&transaction, "pinned")? {
            transaction
                .execute_batch(
                    "ALTER TABLE thoughts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
                        CHECK (pinned IN (0, 1));",
                )
                .map_err(storage_error)?;
        }
        if !thought_column_exists(&transaction, "kind")? {
            transaction
                .execute_batch(
                    "ALTER TABLE thoughts ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'
                        CHECK (kind IN ('text', 'checklist'));",
                )
                .map_err(storage_error)?;
        }
        if !tag_color_column_exists(&transaction)? {
            transaction
                .execute_batch(
                    "ALTER TABLE tags ADD COLUMN color TEXT CHECK (
                        color IS NULL OR color IN (
                            'graphite', 'clay', 'moss', 'sky', 'plum', 'rose'
                        )
                    );",
                )
                .map_err(storage_error)?;
        }
        transaction.commit().map_err(storage_error)?;

        Ok(store)
    }

    pub fn list(&self) -> Result<Vec<Thought>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT thoughts.id,
                        thoughts.body,
                        thoughts.created_at,
                        thoughts.archived,
                        thoughts.source,
                        thoughts.kind,
                        thoughts.pinned,
                        thoughts.document,
                        thoughts.completed,
                        thoughts.rich_document,
                        thought_tags.tag_name
                 FROM thoughts
                 LEFT JOIN thought_tags ON thought_tags.thought_id = thoughts.id
                 ORDER BY thoughts.created_at DESC, thoughts.rowid DESC, thought_tags.tag_name ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    map_thought_without_tags(row)?,
                    row.get::<_, Option<String>>(10)?,
                ))
            })
            .map_err(storage_error)?;
        let mut thoughts: Vec<Thought> = Vec::new();
        for row in rows {
            let (mut thought, tag) = row.map_err(storage_error)?;
            if let Some(previous) = thoughts.last_mut().filter(|item| item.id == thought.id) {
                if let Some(tag) = tag {
                    previous.tags.push(tag);
                }
                continue;
            }
            if let Some(tag) = tag {
                thought.tags.push(tag);
            }
            thoughts.push(thought);
        }
        for thought in &mut thoughts {
            thought.attachments = attachments::list(&connection, &thought.id)?;
            thought.reminder = query_thought_reminder(&connection, &thought.id)?;
            if thought.kind == "checklist" {
                thought.checklist_items = query_checklist_items(&connection, &thought.id)?;
            }
            thought.task_completions = query_task_completions(&connection, &thought.id)?;
        }
        Ok(thoughts)
    }

    pub fn get(&self, id: &str) -> Result<Thought, String> {
        let connection = self.connection()?;
        query_thought(&connection, id)?
            .ok_or_else(|| "That thought is no longer in the cache.".to_string())
    }

    pub fn list_tags(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT name
                 FROM tags
                 WHERE EXISTS (
                    SELECT 1 FROM thought_tags WHERE thought_tags.tag_name = tags.name
                 )
                 ORDER BY name ASC",
            )
            .map_err(storage_error)?;
        let tags = statement
            .query_map([], |row| row.get(0))
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        Ok(tags)
    }

    pub fn shortcut_button_visible(&self) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT enabled FROM preferences WHERE key = 'shortcut_button_visible'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map(|value| value.unwrap_or(true))
            .map_err(storage_error)
    }

    pub fn set_shortcut_button_visible(&self, visible: bool) -> Result<bool, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO preferences (key, enabled)
                 VALUES ('shortcut_button_visible', ?1)
                 ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled",
                [visible],
            )
            .map_err(storage_error)?;
        let persisted = transaction
            .query_row(
                "SELECT enabled FROM preferences WHERE key = 'shortcut_button_visible'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(persisted)
    }

    pub fn light_mode(&self) -> Result<bool, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT enabled FROM preferences WHERE key = 'light_mode'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map(|value| value.unwrap_or(false))
            .map_err(storage_error)
    }

    pub fn set_light_mode(&self, enabled: bool) -> Result<bool, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO preferences (key, enabled)
                 VALUES ('light_mode', ?1)
                 ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled",
                [enabled],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        connection
            .query_row(
                "SELECT enabled FROM preferences WHERE key = 'light_mode'",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(storage_error)
    }

    pub fn font_size(&self) -> Result<FontSize, String> {
        let connection = self.connection()?;
        let saved = connection
            .query_row(
                "SELECT value FROM text_preferences WHERE key = 'font_size'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        saved.as_deref().map(FontSize::from_saved).unwrap_or(Ok(FontSize::Default))
    }

    pub fn set_font_size(&self, size: FontSize) -> Result<FontSize, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO text_preferences (key, value) VALUES ('font_size', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [size.as_str()],
            )
            .map_err(storage_error)?;
        let saved = transaction
            .query_row(
                "SELECT value FROM text_preferences WHERE key = 'font_size'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map_err(storage_error)?;
        let size = FontSize::from_saved(&saved)?;
        transaction.commit().map_err(storage_error)?;
        Ok(size)
    }

    pub fn list_tag_definitions(&self) -> Result<Vec<TagDefinition>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT name, color
                 FROM tags
                 WHERE EXISTS (
                    SELECT 1 FROM thought_tags WHERE thought_tags.tag_name = tags.name
                 )
                 ORDER BY name ASC",
            )
            .map_err(storage_error)?;
        let definitions = statement
            .query_map([], |row| {
                Ok(TagDefinition {
                    name: row.get(0)?,
                    color: row.get(1)?,
                })
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        Ok(definitions)
    }

    #[cfg(test)]
    pub fn capture(&self, body: &str, source: &str, tags: &[String]) -> Result<Thought, String> {
        self.capture_with_tag_definitions(body, source, tags, &[])
    }

    #[cfg(test)]
    pub fn capture_with_tag_definitions(
        &self,
        body: &str,
        source: &str,
        tags: &[String],
        tag_definitions: &[TagDefinition],
    ) -> Result<Thought, String> {
        self.capture_with_attachments(body, source, tags, tag_definitions, &[])
    }

    #[cfg(test)]
    pub fn capture_with_attachments(
        &self,
        body: &str,
        source: &str,
        tags: &[String],
        tag_definitions: &[TagDefinition],
        files: &[AttachmentDraft],
    ) -> Result<Thought, String> {
        self.capture_document(body, source, tags, tag_definitions, files, None)
    }

    pub fn capture_document(
        &self, body: &str, source: &str, tags: &[String], tag_definitions: &[TagDefinition],
        files: &[AttachmentDraft], document: Option<&[DocumentBlock]>,
    ) -> Result<Thought, String> {
        let files = attachments::prepare(files)?;
        let mut body = if let Some(blocks) = document {
            document::validate(blocks, &files.iter().map(|file| file.metadata.clone()).collect::<Vec<_>>())?
        } else { normalize_body(body) };
        if body.is_empty() && !files.is_empty() {
            body = files
                .iter()
                .map(|file| file.metadata.name.as_str())
                .collect::<Vec<_>>()
                .join("\n");
        }
        if body.is_empty() {
            return Err("Give Blob something to remember.".into());
        }
        if !ALLOWED_SOURCES.contains(&source) {
            return Err(format!("Unsupported thought source: {source}"));
        }
        let tags = normalize_tags(tags)?;
        let tag_definitions = normalize_tag_definition_changes(tag_definitions, &tags)?;

        let id = Uuid::new_v4().to_string();
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO thoughts (id, body, source, kind, document) VALUES (?1, ?2, ?3, 'text', ?4)",
                params![id, body, source, document.map(serde_json::to_string).transpose().map_err(|e| e.to_string())?],
            )
            .map_err(storage_error)?;
        assign_tags(&transaction, &id, &tags)?;
        apply_tag_definition_changes(&transaction, &tag_definitions)?;
        attachments::insert(&transaction, &id, &files)?;
        let thought = query_thought(&transaction, &id)?
            .ok_or_else(|| "The thought was saved but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    #[cfg(test)]
    pub fn capture_checklist(
        &self,
        items: &[ChecklistItem],
        source: &str,
        tags: &[String],
        tag_definitions: &[TagDefinition],
    ) -> Result<Thought, String> {
        self.capture_checklist_with_attachments(items, source, tags, tag_definitions, &[])
    }

    pub fn capture_checklist_with_attachments(
        &self,
        items: &[ChecklistItem],
        source: &str,
        tags: &[String],
        tag_definitions: &[TagDefinition],
        files: &[AttachmentDraft],
    ) -> Result<Thought, String> {
        let files = attachments::prepare(files)?;
        if !ALLOWED_SOURCES.contains(&source) {
            return Err(format!("Unsupported thought source: {source}"));
        }
        let items = normalize_checklist_items(items)?;
        let body = checklist_body(&items);
        let tags = normalize_tags(tags)?;
        let tag_definitions = normalize_tag_definition_changes(tag_definitions, &tags)?;
        let id = Uuid::new_v4().to_string();
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO thoughts (id, body, source, kind)
                 VALUES (?1, ?2, ?3, 'checklist')",
                params![id, body, source],
            )
            .map_err(storage_error)?;
        insert_checklist_items(&transaction, &id, &items)?;
        assign_tags(&transaction, &id, &tags)?;
        apply_tag_definition_changes(&transaction, &tag_definitions)?;
        attachments::insert(&transaction, &id, &files)?;
        let thought = query_thought(&transaction, &id)?
            .ok_or_else(|| "The checklist was saved but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn add_attachments(&self, id: &str, files: &[AttachmentDraft]) -> Result<Thought, String> {
        let files = attachments::prepare(files)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought(&transaction, id)?;
        attachments::insert(&transaction, id, &files)?;
        let thought =
            query_thought(&transaction, id)?.ok_or("That thought is no longer in the cache.")?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn remove_attachment(
        &self,
        thought_id: &str,
        attachment_id: &str,
    ) -> Result<Thought, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let existing = query_thought(&transaction, thought_id)?.ok_or("That thought is no longer in the cache.")?;
        if existing.rich_document.as_ref().is_some_and(|doc| rich_document::has_image(doc, attachment_id)) {
            return Err("Remove this image from the document before deleting its file.".into());
        }
        let changed = transaction
            .execute(
                "DELETE FROM attachments WHERE id = ?1 AND thought_id = ?2",
                params![attachment_id, thought_id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err("That attachment is no longer on this thought.".into());
        }
        let mut thought = query_thought(&transaction, thought_id)?
            .ok_or("That thought is no longer in the cache.")?;
        if let Some(blocks) = &mut thought.document {
            blocks.retain(|block| !matches!(block, DocumentBlock::Image { attachment_id: id, .. } if id == attachment_id));
            transaction.execute("UPDATE thoughts SET document = ?1 WHERE id = ?2", params![serde_json::to_string(blocks).map_err(|e| e.to_string())?, thought_id]).map_err(storage_error)?;
        }
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn read_attachment(&self, id: &str) -> Result<(Attachment, Vec<u8>), String> {
        self.connection()?
            .query_row(
                "SELECT id, name, mime_type, size, data FROM attachments WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        Attachment {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            mime_type: row.get(2)?,
                            size: row.get(3)?,
                        },
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| "That attachment is no longer in the cache.".into())
    }

    pub fn update_rich_document(&self, id: &str, doc: &serde_json::Value, files: &[AttachmentDraft]) -> Result<Thought, String> {
        let files = attachments::prepare(files)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought(&transaction, id)?;
        attachments::insert(&transaction, id, &files)?;
        let projection = rich_document::validate(doc, &attachments::list(&transaction, id)?)?;
        replace_checklist_rows(&transaction, id, &projection.items)?;
        let kind = if projection.items.is_empty() { "text" } else { "checklist" };
        let unfinished = projection.items.iter().any(|item| !item.completed);
        transaction.execute(
            "UPDATE thoughts SET body = ?1, rich_document = ?2, document = NULL, kind = ?3,
             completed = CASE WHEN ?4 THEN 0 ELSE completed END WHERE id = ?5",
            params![projection.body, doc.to_string(), kind, unfinished, id],
        ).map_err(storage_error)?;
        let thought = query_thought(&transaction, id)?.ok_or("The document could not be read back.")?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn replace_checklist_items(
        &self,
        id: &str,
        items: &[ChecklistItem],
    ) -> Result<Thought, String> {
        let items = normalize_checklist_items(items)?;
        let body = checklist_body(&items);
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought_kind(&transaction, id, "checklist")?;
        let previous = query_thought(&transaction, id)?.ok_or("That thought is no longer in the cache.")?;
        let mut rich = previous.rich_document;
        let body = if let Some(doc) = &mut rich {
            if previous.checklist_items.len() != items.len() || items.iter().any(|item| !previous.checklist_items.iter().any(|old| old.id == item.id && old.text == item.text)) {
                return Err("Open the document editor to change this checklist's text or structure.".into());
            }
            rich_document::update_checks(doc, &items);
            rich_document::validate(doc, &previous.attachments)?.body
        } else { body };
        replace_checklist_rows(&transaction, id, &items)?;
        transaction.execute("UPDATE thoughts SET rich_document = ?1 WHERE id = ?2", params![rich.map(|doc| doc.to_string()), id]).map_err(storage_error)?;
        transaction
            .execute(
                "UPDATE thoughts SET body = ?1,
                    completed = CASE WHEN EXISTS (
                        SELECT 1 FROM checklist_items WHERE thought_id = ?2 AND completed = 0
                    ) THEN 0 ELSE completed END
                 WHERE id = ?2",
                params![body, id],
            )
            .map_err(storage_error)?;
        let thought = query_thought(&transaction, id)?
            .ok_or_else(|| "The checklist changed but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn add_tag(&self, id: &str, tag: &str) -> Result<Thought, String> {
        let tag = normalize_tag(tag)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought(&transaction, id)?;
        assign_tags(&transaction, id, &[tag])?;
        let thought = query_thought(&transaction, id)?
            .ok_or_else(|| "The thought changed but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn remove_tag(&self, id: &str, tag: &str) -> Result<Thought, String> {
        let tag = normalize_tag(tag)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought(&transaction, id)?;
        transaction
            .execute(
                "DELETE FROM thought_tags WHERE thought_id = ?1 AND tag_name = ?2",
                params![id, tag],
            )
            .map_err(storage_error)?;
        transaction
            .execute(
                "DELETE FROM tags
                 WHERE name = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM thought_tags WHERE thought_tags.tag_name = tags.name
                   )",
                [&tag],
            )
            .map_err(storage_error)?;
        let thought = query_thought(&transaction, id)?
            .ok_or_else(|| "The thought changed but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn set_tag_color(&self, name: &str, color: Option<&str>) -> Result<TagDefinition, String> {
        let name = normalize_tag(name)?;
        let color = normalize_tag_color(color)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let changed = transaction
            .execute(
                "UPDATE tags
                 SET color = ?1
                 WHERE name = ?2
                   AND EXISTS (
                     SELECT 1 FROM thought_tags WHERE thought_tags.tag_name = tags.name
                   )",
                params![color, name],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err("That tag is no longer assigned in the cache.".into());
        }
        let definition = query_tag_definition(&transaction, &name)?
            .ok_or_else(|| "The tag changed but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(definition)
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<Thought, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let changed = transaction
            .execute("UPDATE thoughts SET pinned = ?1 WHERE id = ?2", params![pinned, id])
            .map_err(storage_error)?;
        if changed == 0 {
            return Err("That thought is no longer in the cache.".into());
        }
        let thought = query_thought(&transaction, id)?
            .ok_or_else(|| "The pin changed but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn set_completed(&self, id: &str, completed: bool) -> Result<Thought, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let thought = query_thought(&transaction, id)?.ok_or("That thought is no longer in the cache.")?;
        if thought.archived { return Err("Restore this thought before changing its completion.".into()); }
        transaction.execute("UPDATE thoughts SET completed = ?1 WHERE id = ?2", params![completed, id]).map_err(storage_error)?;
        if completed {
            // Keep earlier completion dates (including unknown legacy dates) intact.
            transaction.execute(
                "INSERT OR IGNORE INTO task_completions (thought_id, item_id, completed_at)
                 SELECT thought_id, id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 FROM checklist_items WHERE thought_id = ?1", [id],
            ).map_err(storage_error)?;
            transaction.execute("UPDATE checklist_items SET completed = 1 WHERE thought_id = ?1", [id]).map_err(storage_error)?;
            if let Some(mut doc) = thought.rich_document {
                let mut items = thought.checklist_items;
                for item in &mut items { item.completed = true; }
                rich_document::update_checks(&mut doc, &items);
                transaction.execute("UPDATE thoughts SET rich_document = ?1 WHERE id = ?2", params![doc.to_string(), id]).map_err(storage_error)?;
            }
            transaction.execute("UPDATE thought_reminders SET state = 'cancel-pending', last_error = NULL WHERE thought_id = ?1", [id]).map_err(storage_error)?;
            transaction.execute("UPDATE checklist_reminders SET state = 'cancel-pending', last_error = NULL WHERE thought_id = ?1", [id]).map_err(storage_error)?;
        }
        let updated = query_thought(&transaction, id)?.ok_or("The completion could not be read back.")?;
        transaction.commit().map_err(storage_error)?;
        Ok(updated)
    }

    pub fn set_archived(&self, id: &str, archived: bool) -> Result<Thought, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let changed = transaction
            .execute(
                "UPDATE thoughts SET archived = ?1 WHERE id = ?2",
                params![archived, id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err("That thought is no longer in the cache.".into());
        }
        if archived {
            transaction.execute(
                "UPDATE thought_reminders SET state = 'cancel-pending', last_error = NULL
                 WHERE thought_id = ?1", [id],
            ).map_err(storage_error)?;
            transaction
                .execute(
                    "UPDATE checklist_reminders
                     SET state = 'cancel-pending', last_error = NULL,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE thought_id = ?1",
                    [id],
                )
                .map_err(storage_error)?;
        }
        let thought = query_thought(&transaction, id)?
            .ok_or_else(|| "The thought changed but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn set_thought_reminder_intent(&self, thought_id: &str, scheduled_for: &str) -> Result<Thought, String> {
        let scheduled_for = normalize_scheduled_for(scheduled_for)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let thought = query_thought(&transaction, thought_id)?
            .ok_or("That thought is no longer in the cache.")?;
        if thought.archived { return Err("Restore this thought before setting a reminder.".into()); }
        if thought.completed { return Err("Reopen this thought before setting a reminder.".into()); }
        transaction.execute(
            "INSERT INTO thought_reminders (thought_id, item_text, scheduled_for, state, last_error)
             VALUES (?1, ?2, ?3, 'pending', NULL)
             ON CONFLICT(thought_id) DO UPDATE SET item_text = excluded.item_text,
                scheduled_for = excluded.scheduled_for, state = 'pending', last_error = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![thought_id, thought.body, scheduled_for],
        ).map_err(storage_error)?;
        let updated = query_thought(&transaction, thought_id)?.ok_or("The reminder could not be read back.")?;
        transaction.commit().map_err(storage_error)?;
        Ok(updated)
    }

    pub fn request_thought_reminder_cancellation(&self, thought_id: &str) -> Result<Thought, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought(&transaction, thought_id)?;
        transaction.execute(
            "UPDATE thought_reminders SET state = 'cancel-pending', last_error = NULL
             WHERE thought_id = ?1", [thought_id],
        ).map_err(storage_error)?;
        let thought = query_thought(&transaction, thought_id)?.ok_or("That thought is no longer in the cache.")?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn set_reminder_intent(
        &self,
        thought_id: &str,
        item_id: &str,
        scheduled_for: &str,
    ) -> Result<Thought, String> {
        let scheduled_for = normalize_scheduled_for(scheduled_for)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let item_text = transaction
            .query_row(
                "SELECT checklist_items.text
                 FROM checklist_items
                 JOIN thoughts ON thoughts.id = checklist_items.thought_id
                 WHERE checklist_items.id = ?1
                   AND checklist_items.thought_id = ?2
                   AND checklist_items.completed = 0
                   AND thoughts.archived = 0
                   AND thoughts.completed = 0
                   AND thoughts.kind = 'checklist'",
                params![item_id, thought_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| {
                "Reminders can only be set on active, incomplete checklist items.".to_string()
            })?;
        transaction
            .execute(
                "INSERT INTO checklist_reminders (
                    item_id, thought_id, item_text, scheduled_for, state, last_error
                 ) VALUES (?1, ?2, ?3, ?4, 'pending', NULL)
                 ON CONFLICT(item_id) DO UPDATE SET
                    thought_id = excluded.thought_id,
                    item_text = excluded.item_text,
                    scheduled_for = excluded.scheduled_for,
                    state = 'pending',
                    last_error = NULL,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                params![item_id, thought_id, item_text, scheduled_for],
            )
            .map_err(storage_error)?;
        let thought = query_thought(&transaction, thought_id)?
            .ok_or_else(|| "That thought is no longer in the cache.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn request_reminder_cancellation(
        &self,
        thought_id: &str,
        item_id: &str,
    ) -> Result<Thought, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought_kind(&transaction, thought_id, "checklist")?;
        let changed = transaction
            .execute(
                "UPDATE checklist_reminders
                 SET state = 'cancel-pending', last_error = NULL,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE item_id = ?1 AND thought_id = ?2",
                params![item_id, thought_id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err("That checklist item has no reminder to clear.".into());
        }
        let thought = query_thought(&transaction, thought_id)?
            .ok_or_else(|| "That thought is no longer in the cache.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    pub fn list_reminder_records(&self) -> Result<Vec<ReminderRecord>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT item_id, thought_id, item_text, scheduled_for, state, last_error
                 FROM checklist_reminders
                 UNION ALL
                 SELECT NULL AS item_id, thought_id, item_text, scheduled_for, state, last_error
                 FROM thought_reminders
                 ORDER BY thought_id, item_id",
            )
            .map_err(storage_error)?;
        let records = statement
            .query_map([], |row| {
                Ok(ReminderRecord {
                    item_id: row.get(0)?,
                    thought_id: row.get(1)?,
                    item_text: row.get(2)?,
                    scheduled_for: row.get(3)?,
                    state: row.get(4)?,
                    last_error: row.get(5)?,
                })
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        Ok(records)
    }

    #[cfg(test)]
    pub fn set_reminder_result(
        &self,
        item_id: &str,
        state: &str,
        last_error: Option<&str>,
    ) -> Result<(), String> {
        validate_reminder_result_state(state)?;
        let connection = self.connection()?;
        connection
            .execute(
                "UPDATE checklist_reminders
                 SET state = ?1, last_error = ?2,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE item_id = ?3 AND state != 'cancel-pending'",
                params![state, last_error, item_id],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn set_reminder_result_if_current(
        &self,
        record: &ReminderRecord,
        state: &str,
        last_error: Option<&str>,
    ) -> Result<bool, String> {
        validate_reminder_result_state(state)?;
        let connection = self.connection()?;
        // Table and key come only from the typed reminder target, never from caller SQL.
        let (table, key) = if record.item_id.is_some() {
            ("checklist_reminders", "item_id")
        } else {
            ("thought_reminders", "thought_id")
        };
        let changed = connection
            .execute(
                &format!("UPDATE {table}
                 SET state = ?1, last_error = ?2,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE {key} = ?3
                   AND thought_id = ?4
                   AND item_text = ?5
                   AND scheduled_for = ?6
                   AND state = ?7
                   AND state != 'cancel-pending'"),
                params![
                    state,
                    last_error,
                    record.item_id.as_ref().unwrap_or(&record.thought_id),
                    record.thought_id,
                    record.item_text,
                    record.scheduled_for,
                    record.state,
                ],
            )
            .map_err(storage_error)?;
        Ok(changed == 1)
    }

    pub fn finish_reminder_cancellation(&self, thought_id: &str, item_id: Option<&str>) -> Result<(), String> {
        let connection = self.connection()?;
        let (table, key, id) = match item_id {
            Some(id) => ("checklist_reminders", "item_id", id),
            None => ("thought_reminders", "thought_id", thought_id),
        };
        connection
            .execute(
                &format!("DELETE FROM {table} WHERE {key} = ?1 AND thought_id = ?2 AND state = 'cancel-pending'"),
                params![id, thought_id],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn update_body(&self, id: &str, body: &str) -> Result<Thought, String> {
        self.update_document(id, body, None, &[])
    }

    pub fn update_document(&self, id: &str, body: &str, document: Option<&[DocumentBlock]>, files: &[AttachmentDraft]) -> Result<Thought, String> {
        let prepared = attachments::prepare(files)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        require_thought_kind(&transaction, id, "text")?;
        let existing = query_thought(&transaction, id)?.ok_or("That thought is no longer in the cache.")?;
        if existing.rich_document.is_some() { return Err("Use the document editor to keep this note’s formatting.".into()); }
        if existing.document.is_some() && document.is_none() {
            return Err("Keep the document layout when editing this thought.".into());
        }
        attachments::insert(&transaction, id, &prepared)?;
        let files = attachments::list(&transaction, id)?;
        let body = match document {
            Some(blocks) => document::validate(blocks, &files)?,
            None => normalize_body(body),
        };
        if body.is_empty() { return Err("Give Blob something to remember.".into()); }
        if let (Some(previous), Some(next)) = (&existing.document, document) {
            for removed in document::image_ids(previous).difference(&document::image_ids(next)) {
                transaction.execute("DELETE FROM attachments WHERE thought_id = ?1 AND id = ?2", params![id, removed]).map_err(storage_error)?;
            }
        }
        let changed = transaction
            .execute(
                "UPDATE thoughts SET body = ?1, document = ?3 WHERE id = ?2",
                params![body, id, document.map(serde_json::to_string).transpose().map_err(|e| e.to_string())?],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err("That thought is no longer in the cache.".into());
        }
        let thought = query_thought(&transaction, id)?
            .ok_or_else(|| "The thought changed but could not be read back.".to_string())?;
        transaction.commit().map_err(storage_error)?;
        Ok(thought)
    }

    fn connection(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.database_path).map_err(storage_error)?;
        connection
            .busy_timeout(Duration::from_secs(3))
            .map_err(storage_error)?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = FULL;
                 PRAGMA foreign_keys = ON;",
            )
            .map_err(storage_error)?;
        Ok(connection)
    }
}

fn normalize_body(body: &str) -> String {
    body.trim().replace("\r\n", "\n")
}

fn normalize_checklist_item_text(text: &str) -> Result<String, String> {
    if text
        .chars()
        .any(|character| character.is_control() || matches!(character, '\u{2028}' | '\u{2029}'))
    {
        return Err("Checklist items must stay on one line.".into());
    }
    let normalized = text.trim();
    if normalized.is_empty() {
        return Err("Checklist items need visible text.".into());
    }
    if normalized.chars().count() > CHECKLIST_ITEM_MAX_CHARACTERS {
        return Err(format!(
            "Checklist items must be {CHECKLIST_ITEM_MAX_CHARACTERS} characters or fewer."
        ));
    }
    Ok(normalized.to_string())
}

fn normalize_checklist_items(items: &[ChecklistItem]) -> Result<Vec<ChecklistItem>, String> {
    if items.is_empty() {
        return Err("A checklist needs at least one item.".into());
    }
    if items.len() > CHECKLIST_MAX_ITEMS {
        return Err(format!(
            "Checklists can contain up to {CHECKLIST_MAX_ITEMS} items."
        ));
    }
    let mut ids = BTreeSet::new();
    items
        .iter()
        .map(|item| {
            Uuid::parse_str(&item.id)
                .map_err(|_| "Checklist item IDs must be valid UUIDs.".to_string())?;
            if !ids.insert(item.id.clone()) {
                return Err("Checklist item IDs must be unique.".into());
            }
            Ok(ChecklistItem {
                id: item.id.clone(),
                text: normalize_checklist_item_text(&item.text)?,
                completed: item.completed,
                reminder: item.reminder.clone(),
            })
        })
        .collect()
}

fn normalize_scheduled_for(value: &str) -> Result<String, String> {
    let scheduled = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "Choose a valid reminder date and time.".to_string())?
        .with_timezone(&Utc);
    if scheduled <= Utc::now() {
        return Err("Choose a reminder time in the future.".into());
    }
    Ok(scheduled.to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn validate_reminder_result_state(state: &str) -> Result<(), String> {
    if matches!(
        state,
        "pending" | "scheduled" | "permission-denied" | "scheduling-failed"
    ) {
        Ok(())
    } else {
        Err("Unsupported reminder state.".into())
    }
}

fn checklist_body(items: &[ChecklistItem]) -> String {
    items
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_tag(tag: &str) -> Result<String, String> {
    if tag
        .chars()
        .any(|character| character.is_control() || matches!(character, '\u{2028}' | '\u{2029}'))
    {
        return Err("Tags cannot contain line breaks or control characters.".into());
    }
    let normalized = tag.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Tag needs at least one visible character.".into());
    }
    if normalized.chars().count() > TAG_MAX_CHARACTERS {
        return Err(format!(
            "Tags must be {TAG_MAX_CHARACTERS} characters or fewer."
        ));
    }
    Ok(normalized)
}

fn normalize_tags(tags: &[String]) -> Result<Vec<String>, String> {
    tags.iter()
        .map(|tag| normalize_tag(tag))
        .collect::<Result<BTreeSet<_>, _>>()
        .map(|tags| tags.into_iter().collect())
}

fn normalize_tag_color(color: Option<&str>) -> Result<Option<String>, String> {
    match color {
        None => Ok(None),
        Some(color) if ALLOWED_TAG_COLORS.contains(&color) => Ok(Some(color.to_string())),
        Some(_) => Err("Choose a color from the Brain Cache tag palette.".into()),
    }
}

fn normalize_tag_definition_changes(
    definitions: &[TagDefinition],
    allowed_tags: &[String],
) -> Result<Vec<TagDefinition>, String> {
    let allowed: BTreeSet<&str> = allowed_tags.iter().map(String::as_str).collect();
    let mut normalized = BTreeMap::new();
    for definition in definitions {
        let name = normalize_tag(&definition.name)?;
        if !allowed.contains(name.as_str()) {
            return Err("Tag colors can only be saved for tags attached to this thought.".into());
        }
        normalized.insert(
            name.clone(),
            TagDefinition {
                name,
                color: normalize_tag_color(definition.color.as_deref())?,
            },
        );
    }
    Ok(normalized.into_values().collect())
}

fn apply_tag_definition_changes(
    connection: &Connection,
    definitions: &[TagDefinition],
) -> Result<(), String> {
    for definition in definitions {
        connection
            .execute(
                "UPDATE tags SET color = ?1 WHERE name = ?2",
                params![definition.color, definition.name],
            )
            .map_err(storage_error)?;
    }
    Ok(())
}

fn assign_tags(connection: &Connection, id: &str, tags: &[String]) -> Result<(), String> {
    for tag in tags {
        connection
            .execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])
            .map_err(storage_error)?;
        connection
            .execute(
                "INSERT OR IGNORE INTO thought_tags (thought_id, tag_name) VALUES (?1, ?2)",
                params![id, tag],
            )
            .map_err(storage_error)?;
    }
    Ok(())
}

fn replace_checklist_rows(connection: &Connection, id: &str, items: &[ChecklistItem]) -> Result<(), String> {
        connection
            .execute("DELETE FROM checklist_items WHERE thought_id = ?1", [id])
            .map_err(storage_error)?;
        insert_checklist_items(&connection, id, &items)?;
        connection
            .execute(
                "UPDATE checklist_reminders
                 SET state = 'cancel-pending', last_error = NULL,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE thought_id = ?1
                   AND item_id NOT IN (
                     SELECT id FROM checklist_items WHERE thought_id = ?1
                   )",
                [id],
            )
            .map_err(storage_error)?;
        connection
            .execute(
                "UPDATE checklist_reminders
                 SET state = 'cancel-pending', last_error = NULL,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE thought_id = ?1
                   AND item_id IN (
                     SELECT id FROM checklist_items
                     WHERE thought_id = ?1 AND completed = 1
                   )",
                [id],
            )
            .map_err(storage_error)?;
        connection
            .execute(
                "UPDATE checklist_reminders
                 SET state = CASE
                       WHEN item_text != (
                         SELECT text FROM checklist_items WHERE id = checklist_reminders.item_id
                       ) THEN 'pending'
                       ELSE state
                     END,
                     item_text = (
                       SELECT text FROM checklist_items WHERE id = checklist_reminders.item_id
                     ),
                     last_error = CASE
                       WHEN item_text != (
                         SELECT text FROM checklist_items WHERE id = checklist_reminders.item_id
                       ) THEN NULL
                       ELSE last_error
                     END,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE thought_id = ?1
                   AND state != 'cancel-pending'
                   AND item_id IN (
                     SELECT id FROM checklist_items
                     WHERE thought_id = ?1 AND completed = 0
                   )",
                [id],
            )
            .map_err(storage_error)?;
    Ok(())
}

fn insert_checklist_items(
    connection: &Connection,
    thought_id: &str,
    items: &[ChecklistItem],
) -> Result<(), String> {
    for (position, item) in items.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO checklist_items (id, thought_id, text, completed, position)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    item.id,
                    thought_id,
                    item.text,
                    item.completed,
                    position as i64
                ],
            )
            .map_err(storage_error)?;
        if item.completed {
            connection.execute(
                "INSERT OR IGNORE INTO task_completions (thought_id, item_id, completed_at)
                 VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![thought_id, item.id],
            ).map_err(storage_error)?;
        } else {
            connection.execute(
                "DELETE FROM task_completions WHERE thought_id = ?1 AND item_id = ?2",
                params![thought_id, item.id],
            ).map_err(storage_error)?;
        }
    }
    Ok(())
}

fn require_thought(connection: &Connection, id: &str) -> Result<(), String> {
    let exists = connection
        .query_row("SELECT 1 FROM thoughts WHERE id = ?1", [id], |_| Ok(()))
        .optional()
        .map_err(storage_error)?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err("That thought is no longer in the cache.".into())
    }
}

fn require_thought_kind(connection: &Connection, id: &str, expected: &str) -> Result<(), String> {
    let kind = connection
        .query_row("SELECT kind FROM thoughts WHERE id = ?1", [id], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(storage_error)?;
    match kind.as_deref() {
        None => Err("That thought is no longer in the cache.".into()),
        Some(kind) if kind == expected => Ok(()),
        Some("checklist") => Err("Edit this checklist through its items.".into()),
        Some(_) => Err("That thought is not a checklist.".into()),
    }
}

fn query_tag_definition(
    connection: &Connection,
    name: &str,
) -> Result<Option<TagDefinition>, String> {
    connection
        .query_row(
            "SELECT name, color FROM tags WHERE name = ?1",
            [name],
            |row| {
                Ok(TagDefinition {
                    name: row.get(0)?,
                    color: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

fn tag_color_column_exists(connection: &Connection) -> Result<bool, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(tags)")
        .map_err(storage_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(storage_error)?;
    for column in columns {
        if column.map_err(storage_error)? == "color" {
            return Ok(true);
        }
    }
    Ok(false)
}

fn thought_column_exists(connection: &Connection, name: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(thoughts)")
        .map_err(storage_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(storage_error)?;
    for column in columns {
        if column.map_err(storage_error)? == name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn query_thought(connection: &Connection, id: &str) -> Result<Option<Thought>, String> {
    let mut thought = connection
        .query_row(
            "SELECT id, body, created_at, archived, source, kind, pinned, document, completed, rich_document
             FROM thoughts WHERE id = ?1",
            [id],
            map_thought_without_tags,
        )
        .optional()
        .map_err(storage_error)?;
    if let Some(thought) = &mut thought {
        thought.tags = query_tags(connection, id)?;
        thought.reminder = query_thought_reminder(connection, id)?;
        thought.attachments = attachments::list(connection, id)?;
        if thought.kind == "checklist" {
            thought.checklist_items = query_checklist_items(connection, id)?;
        }
        thought.task_completions = query_task_completions(connection, id)?;
    }
    Ok(thought)
}

fn query_tags(connection: &Connection, id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT tag_name
             FROM thought_tags
             WHERE thought_id = ?1
             ORDER BY tag_name ASC",
        )
        .map_err(storage_error)?;
    let tags = statement
        .query_map([id], |row| row.get(0))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    Ok(tags)
}

fn query_thought_reminder(connection: &Connection, id: &str) -> Result<Option<ChecklistReminder>, String> {
    connection.query_row(
        "SELECT scheduled_for, state, last_error FROM thought_reminders
         WHERE thought_id = ?1 AND state != 'cancel-pending'", [id], |row| {
            let scheduled_for: String = row.get(0)?;
            let mut state: String = row.get(1)?;
            if state == "scheduled" && DateTime::parse_from_rfc3339(&scheduled_for)
                .is_ok_and(|time| time.with_timezone(&Utc) <= Utc::now()) {
                state = "overdue".into();
            }
            Ok(ChecklistReminder { scheduled_for, state, last_error: row.get(2)? })
        },
    ).optional().map_err(storage_error)
}

fn query_checklist_items(connection: &Connection, id: &str) -> Result<Vec<ChecklistItem>, String> {
    let mut statement = connection
        .prepare(
            "SELECT checklist_items.id,
                    checklist_items.text,
                    checklist_items.completed,
                    checklist_reminders.scheduled_for,
                    checklist_reminders.state,
                    checklist_reminders.last_error
             FROM checklist_items
             LEFT JOIN checklist_reminders
               ON checklist_reminders.item_id = checklist_items.id
              AND checklist_reminders.thought_id = checklist_items.thought_id
              AND checklist_reminders.state != 'cancel-pending'
             WHERE checklist_items.thought_id = ?1
             ORDER BY checklist_items.position ASC",
        )
        .map_err(storage_error)?;
    let items = statement
        .query_map([id], |row| {
            let scheduled_for = row.get::<_, Option<String>>(3)?;
            let state = row.get::<_, Option<String>>(4)?;
            let reminder = scheduled_for.zip(state).map(|(scheduled_for, mut state)| {
                if state == "scheduled"
                    && DateTime::parse_from_rfc3339(&scheduled_for)
                        .is_ok_and(|scheduled| scheduled.with_timezone(&Utc) <= Utc::now())
                {
                    state = "overdue".into();
                }
                ChecklistReminder {
                    scheduled_for,
                    state,
                    last_error: row.get(5).ok().flatten(),
                }
            });
            Ok(ChecklistItem {
                id: row.get(0)?,
                text: row.get(1)?,
                completed: row.get(2)?,
                reminder,
            })
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    Ok(items)
}

fn query_task_completions(connection: &Connection, id: &str) -> Result<Vec<TaskCompletion>, String> {
    let mut statement = connection.prepare(
        "SELECT item_id, completed_at FROM task_completions WHERE thought_id = ?1 ORDER BY item_id",
    ).map_err(storage_error)?;
    let rows = statement.query_map([id], |row| Ok(TaskCompletion {
        item_id: row.get(0)?, completed_at: row.get(1)?,
    })).map_err(storage_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
}

fn map_thought_without_tags(row: &Row<'_>) -> rusqlite::Result<Thought> {
    Ok(Thought {
        id: row.get(0)?,
        body: row.get(1)?,
        created_at: row.get(2)?,
        archived: row.get(3)?,
        completed: row.get(8)?,
        rich_document: row.get::<_, Option<String>>(9)?.map(|json| serde_json::from_str(&json).map_err(|e| rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(e)))).transpose()?,
        pinned: row.get(6)?,
        source: row.get(4)?,
        tags: Vec::new(),
        kind: row.get(5)?,
        checklist_items: Vec::new(),
        reminder: None,
        task_completions: Vec::new(),
        attachments: Vec::new(),
        document: row.get::<_, Option<String>>(7)?.map(|json| serde_json::from_str(&json).map_err(|e| rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e)))).transpose()?,
    })
}

fn storage_error(error: rusqlite::Error) -> String {
    format!("Brain Cache storage error: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDatabase {
        path: PathBuf,
    }

    impl TestDatabase {
        fn new() -> Self {
            Self {
                path: std::env::temp_dir()
                    .join(format!("brain-cache-storage-{}.sqlite3", Uuid::new_v4())),
            }
        }

        fn store(&self) -> ThoughtStore {
            ThoughtStore::open(&self.path).expect("test database should open")
        }

        fn create_legacy_schema(&self) {
            let connection = Connection::open(&self.path).expect("legacy database should open");
            connection
                .execute_batch(
                    "CREATE TABLE thoughts (
                        id TEXT PRIMARY KEY NOT NULL,
                        body TEXT NOT NULL CHECK (length(trim(body)) > 0),
                        created_at TEXT NOT NULL DEFAULT (
                            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                        ),
                        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
                        source TEXT NOT NULL CHECK (
                            source IN ('mac-library', 'mac-capture', 'iphone', 'shortcut')
                        )
                    );
                    CREATE INDEX thoughts_created_at_index ON thoughts(created_at DESC);
                    CREATE INDEX thoughts_archived_created_at_index
                        ON thoughts(archived, created_at DESC);",
                )
                .expect("legacy schema should be created");
            connection
                .execute(
                    "INSERT INTO thoughts (id, body, created_at, archived, source)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        "legacy-id",
                        "  legacy body\r\nkeeps exact bytes  ",
                        "2026-08-30T11:22:33.444Z",
                        true,
                        "mac-capture"
                    ],
                )
                .expect("legacy row should be inserted");
            connection
                .execute(
                    "INSERT INTO thoughts (id, body, created_at, archived, source)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        "legacy-second",
                        "second row keeps insertion order",
                        "2026-08-30T11:22:33.444Z",
                        false,
                        "mac-library"
                    ],
                )
                .expect("second legacy row should be inserted");
        }
    }

    impl Drop for TestDatabase {
        fn drop(&mut self) {
            for path in [
                self.path.clone(),
                PathBuf::from(format!("{}-shm", self.path.display())),
                PathBuf::from(format!("{}-wal", self.path.display())),
            ] {
                let _ = fs::remove_file(path);
            }
        }
    }

    fn checklist_item(text: &str) -> ChecklistItem {
        ChecklistItem {
            id: Uuid::new_v4().to_string(),
            text: text.into(),
            completed: false,
            reminder: None,
        }
    }

    #[test]
    fn rich_documents_preserve_identity_reminders_and_history_across_reopening_and_conversion() {
        use serde_json::json;
        let database = TestDatabase::new();
        let store = database.store();
        let item = checklist_item("First task");
        let thought = store.capture_checklist(&[item.clone()], "mac-library", &["work".into()], &[]).unwrap();
        store.set_pinned(&thought.id, true).unwrap();
        store.set_reminder_intent(&thought.id, &item.id, "2099-02-03T16:00:00Z").unwrap();
        let doc = json!({"type":"doc", "content":[
            {"type":"heading", "attrs":{"level":1}, "content":[{"type":"text","text":"Plan","marks":[{"type":"bold"}]}]},
            {"type":"taskList", "content":[{"type":"taskItem","attrs":{"id":item.id,"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Renamed task"}]}]}]},
            {"type":"paragraph", "content":[{"type":"text","text":"Context"}]}
        ]});
        let saved = store.update_rich_document(&thought.id, &doc, &[]).unwrap();
        assert_eq!(saved.body, "Plan\nRenamed task\nContext");
        assert_eq!(saved.created_at, thought.created_at);
        assert_eq!(saved.tags, thought.tags);
        assert!(saved.pinned);
        assert_eq!(saved.checklist_items[0].id, item.id);
        assert!(saved.checklist_items[0].reminder.is_some());
        assert_eq!(database.store().get(&thought.id).unwrap().rich_document, Some(doc.clone()));
        let mut checked = saved.checklist_items;
        checked[0].completed = true;
        let checked = store.replace_checklist_items(&thought.id, &checked).unwrap();
        assert_eq!(checked.rich_document.as_ref().unwrap()["content"][0], doc["content"][0]);
        assert_eq!(checked.body, saved.body);
        assert!(checked.checklist_items[0].reminder.is_none());
        let plain = json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Finished project"}]}]});
        let converted = store.update_rich_document(&thought.id, &plain, &[]).unwrap();
        assert_eq!(converted.kind, "text");
        assert_eq!(converted.task_completions, checked.task_completions);
        assert_eq!(database.store().get(&thought.id).unwrap().task_completions.len(), 1);
        assert!(store.update_body(&thought.id, "Overwrite formatting").is_err());
    }

    #[test]
    fn rich_image_save_is_atomic_and_keeps_bytes_for_undo() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use serde_json::json;
        let database = TestDatabase::new();
        let store = database.store();
        let thought = store.capture("Before", "mac-library", &[]).unwrap();
        let file = AttachmentDraft { id: Uuid::new_v4().to_string(), name: "image.png".into(), data: STANDARD.encode(b"image bytes") };
        let doc = json!({"type":"doc","content":[{"type":"cacheImage","attrs":{"attachmentId":file.id}}]});
        let saved = store.update_rich_document(&thought.id, &doc, &[file.clone()]).unwrap();
        assert_eq!(saved.body, "image.png");
        assert_eq!(database.store().get(&thought.id).unwrap().rich_document, Some(doc.clone()));
        assert!(store.remove_attachment(&thought.id, &file.id).is_err());
        let other = store.capture("Other", "mac-library", &[]).unwrap();
        let extra = AttachmentDraft { id: Uuid::new_v4().to_string(), name: "extra.png".into(), data: file.data.clone() };
        assert!(store.update_rich_document(&other.id, &doc, &[extra.clone()]).is_err());
        assert!(store.read_attachment(&extra.id).is_err());
        assert_eq!(store.get(&other.id).unwrap().body, "Other");
        let blank = json!({"type":"doc","content":[{"type":"paragraph"}]});
        assert_eq!(store.update_rich_document(&thought.id, &blank, &[]).unwrap().body, "Untitled note");
        assert!(store.read_attachment(&file.id).is_ok());
        store.update_rich_document(&thought.id, &doc, &[]).unwrap();
        store.update_rich_document(&thought.id, &blank, &[]).unwrap();
        store.remove_attachment(&thought.id, &file.id).unwrap();
        assert!(store.read_attachment(&file.id).is_err());
    }

    #[test]
    fn rich_completion_updates_document_and_failed_validation_leaves_everything_unchanged() {
        use serde_json::json;
        let database = TestDatabase::new();
        let store = database.store();
        let note = store.capture("Original", "mac-library", &[]).unwrap();
        let id = Uuid::new_v4().to_string();
        let doc = json!({"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"id":id,"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"Task"}]}]}]}]});
        store.update_rich_document(&note.id, &doc, &[]).unwrap();
        let completed = store.set_completed(&note.id, true).unwrap();
        assert_eq!(completed.rich_document.as_ref().unwrap()["content"][0]["content"][0]["attrs"]["checked"], true);
        let reopened = store.update_rich_document(&note.id, &doc, &[]).unwrap();
        assert!(!reopened.completed);
        let mut duplicate = doc.clone();
        duplicate["content"][0]["content"].as_array_mut().unwrap().push(doc["content"][0]["content"][0].clone());
        assert!(store.update_rich_document(&note.id, &duplicate, &[]).is_err());
        assert!(store.update_rich_document(&note.id, &json!({"type":"doc","content":[{"type":"script"}]}), &[]).is_err());
        assert_eq!(store.get(&note.id).unwrap().rich_document, Some(doc));
    }

    #[test]
    fn whole_note_completion_is_durable_and_trash_restore_preserves_it() {
        let database = TestDatabase::new();
        database.create_legacy_schema();
        let store = database.store();
        assert!(store.list().unwrap().iter().all(|thought| !thought.completed));
        let thought = store.capture("Follow up", "mac-library", &["work".into()]).unwrap();
        store.set_thought_reminder_intent(&thought.id, "2099-02-03T16:00:00Z").unwrap();
        let completed = store.set_completed(&thought.id, true).unwrap();
        assert!(completed.completed);
        assert!(completed.reminder.is_none());
        assert!(database.store().get(&thought.id).unwrap().completed);
        assert!(store.set_thought_reminder_intent(&thought.id, "2099-02-03T16:00:00Z").is_err());
        assert_eq!(store.list_reminder_records().unwrap()[0].state, "cancel-pending");
        store.set_archived(&thought.id, true).unwrap();
        assert!(store.set_completed(&thought.id, false).is_err());
        assert!(store.set_archived(&thought.id, false).unwrap().completed);
        let reopened = store.set_completed(&thought.id, false).unwrap();
        assert!(!reopened.completed);
        assert!(reopened.reminder.is_none());
        assert_eq!(reopened.tags, thought.tags);
        assert!(store.set_completed("missing", true).is_err());
    }

    #[test]
    fn completing_checklist_preserves_history_and_cancels_every_reminder() {
        let database = TestDatabase::new();
        let store = database.store();
        let mut one = checklist_item("One");
        one.completed = true;
        let two = checklist_item("Two");
        let thought = store.capture_checklist(&[one, two.clone()], "mac-library", &[], &[]).unwrap();
        store.set_thought_reminder_intent(&thought.id, "2099-02-03T16:00:00Z").unwrap();
        store.set_reminder_intent(&thought.id, &two.id, "2099-02-03T16:00:00Z").unwrap();
        let completed = store.set_completed(&thought.id, true).unwrap();
        assert!(completed.checklist_items.iter().all(|item| item.completed && item.reminder.is_none()));
        assert_eq!(completed.task_completions.len(), 2);
        assert!(completed.task_completions.contains(&thought.task_completions[0]));
        assert_eq!(store.set_completed(&thought.id, true).unwrap().task_completions, completed.task_completions);
        assert!(store.list_reminder_records().unwrap().iter().all(|record| record.state == "cancel-pending"));
        let mut items = completed.checklist_items;
        items[1].completed = false;
        let reopened = store.replace_checklist_items(&thought.id, &items).unwrap();
        assert!(!reopened.completed);
        assert_eq!(reopened.task_completions, thought.task_completions);
    }

    #[test]
    fn failed_whole_checklist_completion_rolls_back_note_items_history_and_reminders() {
        let database = TestDatabase::new();
        let store = database.store();
        let thought = store.capture_checklist(&[checklist_item("One")], "mac-library", &[], &[]).unwrap();
        let before = store.set_thought_reminder_intent(&thought.id, "2099-02-03T16:00:00Z").unwrap();
        store.connection().unwrap().execute_batch(
            "CREATE TRIGGER reject_completion BEFORE UPDATE ON checklist_items BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
        ).unwrap();
        assert!(store.set_completed(&thought.id, true).is_err());
        assert_eq!(store.get(&thought.id).unwrap(), before);
        assert_eq!(store.list_reminder_records().unwrap()[0].state, "pending");
    }

    #[test]
    fn completion_history_survives_edits_removal_archive_and_reopen() {
        let database = TestDatabase::new();
        let store = database.store();
        let mut one = checklist_item("One");
        let two = checklist_item("Two");
        let thought = store.capture_checklist(&[one.clone(), two.clone()], "mac-library", &[], &[]).unwrap();
        assert!(thought.task_completions.is_empty());
        one.completed = true;
        let checked = store.replace_checklist_items(&thought.id, &[one.clone(), two.clone()]).unwrap();
        let history = checked.task_completions;
        assert_eq!(history.len(), 1);
        assert!(history[0].completed_at.as_ref().unwrap().ends_with('Z'));
        one.text = "Renamed".into();
        assert_eq!(store.replace_checklist_items(&thought.id, &[two.clone(), one.clone()]).unwrap().task_completions, history);
        one.completed = false;
        assert!(store.replace_checklist_items(&thought.id, &[one.clone(), two.clone()]).unwrap().task_completions.is_empty());
        one.completed = true;
        let rechecked = store.replace_checklist_items(&thought.id, &[one.clone(), two.clone()]).unwrap().task_completions;
        assert_eq!(rechecked.len(), 1);
        assert_eq!(store.replace_checklist_items(&thought.id, &[two]).unwrap().task_completions, rechecked);
        store.set_archived(&thought.id, true).unwrap();
        assert_eq!(database.store().list().unwrap()[0].task_completions, rechecked);
    }

    #[test]
    fn completion_history_migrates_existing_checks_without_dates() {
        let database = TestDatabase::new();
        let store = database.store();
        let mut item = checklist_item("Already finished");
        item.completed = true;
        let thought = store.capture_checklist(&[item.clone()], "mac-library", &[], &[]).unwrap();
        // Simulate the pre-analytics database, where checked items had no timestamps.
        Connection::open(&database.path).unwrap().execute("DROP TABLE task_completions", []).unwrap();
        let migrated = database.store().list().unwrap().remove(0);
        assert_eq!(migrated.task_completions, vec![TaskCompletion { item_id: item.id.clone(), completed_at: None }]);
        item.text = "Renamed older task".into();
        assert_eq!(database.store().replace_checklist_items(&thought.id, &[item]).unwrap().task_completions, migrated.task_completions);
        assert_eq!(database.store().list().unwrap()[0].task_completions, migrated.task_completions);
    }

    #[test]
    fn failed_checklist_write_rolls_back_completion_history() {
        let database = TestDatabase::new();
        let store = database.store();
        let mut item = checklist_item("One");
        let thought = store.capture_checklist(&[item.clone()], "mac-library", &[], &[]).unwrap();
        Connection::open(&database.path).unwrap().execute_batch(
            "CREATE TRIGGER fail_completion BEFORE INSERT ON task_completions BEGIN SELECT RAISE(ABORT, 'disk failure'); END;"
        ).unwrap();
        item.completed = true;
        assert!(store.replace_checklist_items(&thought.id, &[item]).is_err());
        assert_eq!(store.list().unwrap(), vec![thought]);
    }

    #[test]
    fn capture_persists_a_normalized_tagged_thought() {
        let database = TestDatabase::new();
        let store = database.store();

        let captured = store
            .capture(
                "  first line\r\nsecond line  ",
                "mac-capture",
                &[" Work ".into(), "WORK".into(), "deep focus".into()],
            )
            .expect("capture should succeed");
        let reopened = database.store();

        assert_eq!(captured.body, "first line\nsecond line");
        assert_eq!(captured.source, "mac-capture");
        assert_eq!(captured.tags, vec!["deep focus", "work"]);
        assert!(!captured.archived);
        assert!(captured.created_at.ends_with('Z'));
        assert_eq!(
            reopened.list().expect("list should succeed"),
            vec![captured]
        );
    }

    #[test]
    fn capture_without_tags_keeps_the_original_path() {
        let database = TestDatabase::new();
        let captured = database
            .store()
            .capture("ordinary thought", "mac-capture", &[])
            .expect("untagged capture should succeed");

        assert!(captured.tags.is_empty());
        assert_eq!(captured.kind, "text");
        assert!(captured.checklist_items.is_empty());
    }

    #[test]
    fn shortcut_button_preference_defaults_visible_and_persists_across_reopen() {
        let database = TestDatabase::new();
        let store = database.store();

        assert!(store.shortcut_button_visible().unwrap());
        assert!(!store.set_shortcut_button_visible(false).unwrap());
        assert!(!database.store().shortcut_button_visible().unwrap());
        assert!(store.set_shortcut_button_visible(true).unwrap());
        assert!(database.store().shortcut_button_visible().unwrap());
    }

    #[test]
    fn light_mode_defaults_dark_and_persists_across_reopen() {
        let database = TestDatabase::new();
        let store = database.store();

        assert!(!store.light_mode().unwrap());
        assert!(store.set_light_mode(true).unwrap());
        assert!(database.store().light_mode().unwrap());
        assert!(!store.set_light_mode(false).unwrap());
        assert!(!database.store().light_mode().unwrap());
        assert!(store.shortcut_button_visible().unwrap());
    }

    #[test]
    fn failed_light_mode_write_preserves_the_saved_preference() {
        let database = TestDatabase::new();
        let store = database.store();
        store.set_light_mode(true).unwrap();
        store.connection().unwrap().execute_batch(
            "CREATE TRIGGER reject_light_mode BEFORE UPDATE ON preferences
             WHEN NEW.key = 'light_mode'
             BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
        ).unwrap();

        assert!(store.set_light_mode(false).is_err());
        assert!(database.store().light_mode().unwrap());
    }

    #[test]
    fn font_size_defaults_and_persists_each_size_across_reopen() {
        let database = TestDatabase::new();
        let store = database.store();
        assert_eq!(store.font_size().unwrap(), FontSize::Default);

        for size in [FontSize::Large, FontSize::ExtraLarge, FontSize::Default] {
            assert_eq!(store.set_font_size(size).unwrap(), size);
            assert_eq!(database.store().font_size().unwrap(), size);
        }
        assert!(!store.light_mode().unwrap());
        assert!(store.shortcut_button_visible().unwrap());
    }

    #[test]
    fn font_size_rejects_invalid_command_values_and_database_values() {
        for size in ["default", "large", "extra-large"] {
            let encoded = serde_json::to_string(size).unwrap();
            let decoded: FontSize = serde_json::from_str(&encoded).unwrap();
            assert_eq!(serde_json::to_string(&decoded).unwrap(), encoded);
        }
        for invalid in ["\"small\"", "\"LARGE\"", "20", "null", "true"] {
            assert!(serde_json::from_str::<FontSize>(invalid).is_err());
        }

        let database = TestDatabase::new();
        let store = database.store();
        store.set_font_size(FontSize::Large).unwrap();
        assert!(store.connection().unwrap().execute(
            "UPDATE text_preferences SET value = 'giant' WHERE key = 'font_size'", []
        ).is_err());
        assert_eq!(database.store().font_size().unwrap(), FontSize::Large);
    }

    #[test]
    fn failed_font_size_write_preserves_the_saved_preference() {
        let database = TestDatabase::new();
        let store = database.store();
        store.set_font_size(FontSize::Large).unwrap();
        store.connection().unwrap().execute_batch(
            "CREATE TRIGGER reject_font_size BEFORE UPDATE ON text_preferences
             WHEN NEW.key = 'font_size'
             BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
        ).unwrap();

        assert!(store.set_font_size(FontSize::ExtraLarge).is_err());
        assert_eq!(database.store().font_size().unwrap(), FontSize::Large);
    }

    #[test]
    fn checklist_capture_and_replacement_preserve_order_identity_and_metadata() {
        let database = TestDatabase::new();
        let store = database.store();
        let one = checklist_item("  Buy milk  ");
        let two = checklist_item("Call Sam");
        let three = checklist_item("Ship build");
        let captured = store
            .capture_checklist(
                &[one.clone(), two.clone(), three.clone()],
                "mac-capture",
                &[" Home ".into()],
                &[TagDefinition {
                    name: "home".into(),
                    color: Some("clay".into()),
                }],
            )
            .expect("checklist capture should succeed");

        assert_eq!(captured.kind, "checklist");
        assert_eq!(captured.body, "Buy milk\nCall Sam\nShip build");
        assert_eq!(captured.tags, vec!["home"]);
        assert_eq!(captured.checklist_items[0].id, one.id);
        assert_eq!(captured.checklist_items[0].text, "Buy milk");
        assert_eq!(database.store().list().unwrap()[0], captured);

        let updated = store
            .replace_checklist_items(
                &captured.id,
                &[
                    ChecklistItem {
                        text: "Call Alex".into(),
                        completed: true,
                        ..two
                    },
                    three,
                    one,
                ],
            )
            .expect("checklist replacement should succeed");
        assert_eq!(updated.body, "Call Alex\nShip build\nBuy milk");
        assert!(updated.checklist_items[0].completed);
        assert_eq!(updated.created_at, captured.created_at);
        assert_eq!(updated.source, captured.source);
        assert_eq!(updated.tags, captured.tags);
        assert_eq!(database.store().list().unwrap()[0], updated);
        assert_eq!(
            store.update_body(&captured.id, "not allowed").unwrap_err(),
            "Edit this checklist through its items."
        );
    }

    #[test]
    fn note_reminders_persist_reschedule_and_ignore_stale_scheduler_results() {
        let database = TestDatabase::new();
        let store = database.store();
        let note = store.capture("Call Sam", "mac-library", &["work".into()]).unwrap();
        let scheduled = store.set_thought_reminder_intent(&note.id, "2099-02-03T10:15:00-06:00").unwrap();
        assert_eq!(scheduled.body, note.body);
        assert_eq!(scheduled.reminder.as_ref().unwrap().scheduled_for, "2099-02-03T16:15:00.000Z");
        assert_eq!(database.store().get(&note.id).unwrap(), scheduled);
        assert_eq!(store.list().unwrap(), vec![scheduled]);
        let original = store.list_reminder_records().unwrap().remove(0);
        assert!(original.item_id.is_none());
        assert!(store.set_reminder_result_if_current(&original, "permission-denied", Some("Notifications off")).unwrap());
        assert_eq!(store.get(&note.id).unwrap().reminder.unwrap().state, "permission-denied");
        store.set_thought_reminder_intent(&note.id, "2099-02-04T16:15:00Z").unwrap();
        assert!(!store.set_reminder_result_if_current(&original, "scheduled", None).unwrap());
        let current = store.list_reminder_records().unwrap().remove(0);
        assert!(store.set_reminder_result_if_current(&current, "scheduled", None).unwrap());
        let edited = store.update_body(&note.id, "Call Sam about the trip").unwrap();
        assert_eq!(edited.reminder.unwrap().state, "pending");
        assert_eq!(store.list_reminder_records().unwrap()[0].item_text, "Call Sam about the trip");
        assert!(!store.set_reminder_result_if_current(&current, "scheduled", None).unwrap());
        assert_eq!(store.list_reminder_records().unwrap().len(), 1);
    }

    #[test]
    fn note_and_item_reminders_are_independent_and_archive_cancels_both() {
        let database = TestDatabase::new();
        let store = database.store();
        let item = checklist_item("Call Sam");
        let note = store.capture_checklist(&[item.clone()], "mac-library", &[], &[]).unwrap();
        store.set_thought_reminder_intent(&note.id, "2099-02-03T16:15:00Z").unwrap();
        store.set_reminder_intent(&note.id, &item.id, "2099-02-04T16:15:00Z").unwrap();
        let updated = store.request_thought_reminder_cancellation(&note.id).unwrap();
        assert!(updated.reminder.is_none());
        assert!(updated.checklist_items[0].reminder.is_some());
        store.finish_reminder_cancellation(&note.id, None).unwrap();
        assert_eq!(store.list_reminder_records().unwrap().len(), 1);
        store.set_thought_reminder_intent(&note.id, "2099-02-03T16:15:00Z").unwrap();
        let mut completed = item.clone();
        completed.completed = true;
        let updated = store.replace_checklist_items(&note.id, &[completed]).unwrap();
        assert!(updated.reminder.is_some());
        assert!(updated.checklist_items[0].reminder.is_none());
        let archived = store.set_archived(&note.id, true).unwrap();
        assert!(archived.reminder.is_none());
        assert!(store.list_reminder_records().unwrap().iter().all(|record| record.state == "cancel-pending"));
        assert!(store.set_archived(&note.id, false).unwrap().reminder.is_none());
    }

    #[test]
    fn note_reminders_validate_before_writing_and_hide_cancelled_intents_after_reopen() {
        let database = TestDatabase::new();
        let store = database.store();
        let note = store.capture("A note", "mac-library", &[]).unwrap();
        for date in ["tomorrow", "2020-01-01T00:00:00Z"] {
            assert!(store.set_thought_reminder_intent(&note.id, date).is_err());
        }
        assert!(store.set_thought_reminder_intent("missing", "2099-02-03T16:15:00Z").is_err());
        assert!(store.list_reminder_records().unwrap().is_empty());
        store.set_archived(&note.id, true).unwrap();
        assert!(store.set_thought_reminder_intent(&note.id, "2099-02-03T16:15:00Z").is_err());
        store.set_archived(&note.id, false).unwrap();
        store.set_thought_reminder_intent(&note.id, "2099-02-03T16:15:00Z").unwrap();
        let stale = store.list_reminder_records().unwrap().remove(0);
        store.request_thought_reminder_cancellation(&note.id).unwrap();
        assert!(database.store().get(&note.id).unwrap().reminder.is_none());
        assert!(!store.set_reminder_result_if_current(&stale, "scheduled", None).unwrap());
        store.set_thought_reminder_intent(&note.id, "2099-02-04T16:15:00Z").unwrap();
        store.finish_reminder_cancellation(&note.id, None).unwrap();
        assert!(store.get(&note.id).unwrap().reminder.is_some());
    }

    #[test]
    fn accepted_note_reminders_become_overdue_without_rewriting_the_stored_state() {
        let database = TestDatabase::new();
        let store = database.store();
        let note = store.capture("A note", "mac-library", &[]).unwrap();
        store.set_thought_reminder_intent(&note.id, "2099-02-03T16:15:00Z").unwrap();
        let record = store.list_reminder_records().unwrap().remove(0);
        store.set_reminder_result_if_current(&record, "scheduled", None).unwrap();
        store.connection().unwrap().execute(
            "UPDATE thought_reminders SET scheduled_for = '2020-01-01T00:00:00.000Z' WHERE thought_id = ?1", [&note.id],
        ).unwrap();
        assert_eq!(store.get(&note.id).unwrap().reminder.unwrap().state, "overdue");
        assert_eq!(store.update_body(&note.id, "Edited after delivery").unwrap().reminder.unwrap().state, "overdue");
        assert_eq!(store.list_reminder_records().unwrap()[0].state, "scheduled");
    }

    #[test]
    fn reminder_intent_is_durable_and_visible_only_after_item_validation() {
        let database = TestDatabase::new();
        let store = database.store();
        let item = checklist_item("Call Sam");
        let captured = store
            .capture_checklist(std::slice::from_ref(&item), "mac-library", &[], &[])
            .unwrap();

        let pending = store
            .set_reminder_intent(&captured.id, &item.id, "2099-02-03T10:15:00-06:00")
            .unwrap();
        assert_eq!(
            pending.checklist_items[0].reminder,
            Some(ChecklistReminder {
                scheduled_for: "2099-02-03T16:15:00.000Z".into(),
                state: "pending".into(),
                last_error: None,
            })
        );

        store
            .set_reminder_result(&item.id, "scheduled", None)
            .unwrap();
        assert_eq!(
            database.store().list().unwrap()[0].checklist_items[0]
                .reminder
                .as_ref()
                .unwrap()
                .state,
            "scheduled"
        );
        assert_eq!(
            store
                .set_reminder_intent(&captured.id, "missing", "2099-02-03T16:15:00Z")
                .unwrap_err(),
            "Reminders can only be set on active, incomplete checklist items."
        );
        assert_eq!(
            store
                .set_reminder_intent(&captured.id, &item.id, "2020-01-01T00:00:00Z")
                .unwrap_err(),
            "Choose a reminder time in the future."
        );
    }

    #[test]
    fn rescheduling_upserts_one_intent_and_resets_failure_state() {
        let database = TestDatabase::new();
        let store = database.store();
        let item = checklist_item("Call Sam");
        let captured = store
            .capture_checklist(std::slice::from_ref(&item), "mac-library", &[], &[])
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &item.id, "2099-02-03T16:15:00Z")
            .unwrap();
        store
            .set_reminder_result(&item.id, "scheduling-failed", Some("Adapter unavailable"))
            .unwrap();

        let rescheduled = store
            .set_reminder_intent(&captured.id, &item.id, "2099-02-04T10:30:00-06:00")
            .unwrap();
        assert_eq!(
            rescheduled.checklist_items[0].reminder,
            Some(ChecklistReminder {
                scheduled_for: "2099-02-04T16:30:00.000Z".into(),
                state: "pending".into(),
                last_error: None,
            })
        );
        assert_eq!(
            store.list_reminder_records().unwrap(),
            vec![ReminderRecord {
                item_id: Some(item.id),
                thought_id: captured.id,
                item_text: "Call Sam".into(),
                scheduled_for: "2099-02-04T16:30:00.000Z".into(),
                state: "pending".into(),
                last_error: None,
            }]
        );
    }

    #[test]
    fn stale_scheduler_result_cannot_overwrite_a_renamed_item_intent() {
        let database = TestDatabase::new();
        let store = database.store();
        let item = checklist_item("Old notification text");
        let captured = store
            .capture_checklist(std::slice::from_ref(&item), "mac-library", &[], &[])
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &item.id, "2099-02-03T16:15:00Z")
            .unwrap();
        let stale_record = store.list_reminder_records().unwrap().remove(0);

        store
            .replace_checklist_items(
                &captured.id,
                &[ChecklistItem {
                    text: "Updated notification text".into(),
                    ..item
                }],
            )
            .unwrap();

        assert!(!store
            .set_reminder_result_if_current(&stale_record, "scheduled", None)
            .unwrap());
        let current = store.list_reminder_records().unwrap().remove(0);
        assert_eq!(current.item_text, "Updated notification text");
        assert_eq!(current.state, "pending");
        assert!(store
            .set_reminder_result_if_current(&current, "scheduled", None)
            .unwrap());
        assert_eq!(store.list_reminder_records().unwrap()[0].state, "scheduled");
    }

    #[test]
    fn checklist_mutations_leave_cancellation_tombstones_for_native_reconciliation() {
        let database = TestDatabase::new();
        let store = database.store();
        let one = checklist_item("One");
        let two = checklist_item("Two");
        let captured = store
            .capture_checklist(&[one.clone(), two.clone()], "mac-library", &[], &[])
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &one.id, "2099-02-03T16:15:00Z")
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &two.id, "2099-02-04T16:15:00Z")
            .unwrap();
        store
            .set_reminder_result(&one.id, "scheduled", None)
            .unwrap();

        let updated = store
            .replace_checklist_items(
                &captured.id,
                &[
                    ChecklistItem {
                        text: "One renamed".into(),
                        ..one.clone()
                    },
                    ChecklistItem {
                        completed: true,
                        ..two.clone()
                    },
                ],
            )
            .unwrap();
        assert_eq!(
            updated.checklist_items[0].reminder.as_ref().unwrap().state,
            "pending"
        );
        assert!(updated.checklist_items[1].reminder.is_none());
        let records = store.list_reminder_records().unwrap();
        let renamed = records
            .iter()
            .find(|record| record.item_id.as_deref() == Some(one.id.as_str()))
            .unwrap();
        let completed = records
            .iter()
            .find(|record| record.item_id.as_deref() == Some(two.id.as_str()))
            .unwrap();
        assert_eq!(renamed.item_text, "One renamed");
        assert_eq!(renamed.state, "pending");
        assert_eq!(completed.state, "cancel-pending");

        store.finish_reminder_cancellation(&captured.id, Some(&two.id)).unwrap();
        store.set_archived(&captured.id, true).unwrap();
        let records = store.list_reminder_records().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].state, "cancel-pending");
    }

    #[test]
    fn removing_an_item_leaves_only_its_reminder_as_a_cancellation_tombstone() {
        let database = TestDatabase::new();
        let store = database.store();
        let kept = checklist_item("Keep");
        let removed = checklist_item("Remove");
        let captured = store
            .capture_checklist(&[kept.clone(), removed.clone()], "mac-library", &[], &[])
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &kept.id, "2099-02-03T16:15:00Z")
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &removed.id, "2099-02-04T16:15:00Z")
            .unwrap();

        let updated = store
            .replace_checklist_items(&captured.id, std::slice::from_ref(&kept))
            .unwrap();
        assert_eq!(updated.checklist_items.len(), 1);
        assert_eq!(updated.checklist_items[0].id, kept.id);
        assert_eq!(
            updated.checklist_items[0].reminder.as_ref().unwrap().state,
            "pending"
        );
        let records = store.list_reminder_records().unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(
            records
                .iter()
                .find(|record| record.item_id.as_deref() == Some(kept.id.as_str()))
                .unwrap()
                .state,
            "pending"
        );
        assert_eq!(
            records
                .iter()
                .find(|record| record.item_id.as_deref() == Some(removed.id.as_str()))
                .unwrap()
                .state,
            "cancel-pending"
        );
    }

    #[test]
    fn clearing_a_reminder_hides_it_before_native_cancellation_finishes() {
        let database = TestDatabase::new();
        let store = database.store();
        let item = checklist_item("Pack bags");
        let captured = store
            .capture_checklist(std::slice::from_ref(&item), "mac-library", &[], &[])
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &item.id, "2099-02-03T16:15:00Z")
            .unwrap();

        let thought = store
            .request_reminder_cancellation(&captured.id, &item.id)
            .unwrap();
        assert!(thought.checklist_items[0].reminder.is_none());
        assert_eq!(
            store.list_reminder_records().unwrap()[0].state,
            "cancel-pending"
        );
    }

    #[test]
    fn result_updates_preserve_cancellation_and_overdue_is_a_read_time_projection() {
        let database = TestDatabase::new();
        let store = database.store();
        let cancelled_item = checklist_item("Cancelled");
        let overdue_item = checklist_item("Overdue");
        let captured = store
            .capture_checklist(
                &[cancelled_item.clone(), overdue_item.clone()],
                "mac-library",
                &[],
                &[],
            )
            .unwrap();
        store
            .set_reminder_intent(&captured.id, &cancelled_item.id, "2099-02-03T16:15:00Z")
            .unwrap();
        store
            .request_reminder_cancellation(&captured.id, &cancelled_item.id)
            .unwrap();
        store
            .set_reminder_result(&cancelled_item.id, "scheduled", None)
            .unwrap();
        assert_eq!(
            store.list_reminder_records().unwrap()[0].state,
            "cancel-pending"
        );
        assert_eq!(
            store
                .set_reminder_result(&cancelled_item.id, "overdue", None)
                .unwrap_err(),
            "Unsupported reminder state."
        );

        store
            .set_reminder_intent(&captured.id, &overdue_item.id, "2099-02-04T16:15:00Z")
            .unwrap();
        store
            .set_reminder_result(&overdue_item.id, "scheduled", None)
            .unwrap();
        Connection::open(&database.path)
            .unwrap()
            .execute(
                "UPDATE checklist_reminders SET scheduled_for = '2020-01-01T00:00:00.000Z'
                 WHERE item_id = ?1",
                [&overdue_item.id],
            )
            .unwrap();

        let reopened = store.get(&captured.id).unwrap();
        assert_eq!(
            reopened.checklist_items[1].reminder,
            Some(ChecklistReminder {
                scheduled_for: "2020-01-01T00:00:00.000Z".into(),
                state: "overdue".into(),
                last_error: None,
            })
        );
        assert_eq!(
            store
                .list_reminder_records()
                .unwrap()
                .into_iter()
                .find(|record| record.item_id.as_deref() == Some(overdue_item.id.as_str()))
                .unwrap()
                .state,
            "scheduled"
        );
    }

    #[test]
    fn invalid_checklists_leave_storage_unchanged() {
        let database = TestDatabase::new();
        let store = database.store();
        assert_eq!(
            store
                .capture_checklist(&[], "mac-capture", &[], &[])
                .unwrap_err(),
            "A checklist needs at least one item."
        );
        let duplicate_id = Uuid::new_v4().to_string();
        assert_eq!(
            store
                .capture_checklist(
                    &[
                        ChecklistItem {
                            id: duplicate_id.clone(),
                            text: "One".into(),
                            completed: false,
                            reminder: None,
                        },
                        ChecklistItem {
                            id: duplicate_id,
                            text: "Two".into(),
                            completed: false,
                            reminder: None,
                        },
                    ],
                    "mac-capture",
                    &[],
                    &[],
                )
                .unwrap_err(),
            "Checklist item IDs must be unique."
        );
        assert_eq!(
            store
                .capture_checklist(
                    &[ChecklistItem {
                        id: Uuid::new_v4().to_string(),
                        text: "two\nlines".into(),
                        completed: false,
                        reminder: None,
                    }],
                    "mac-capture",
                    &[],
                    &[],
                )
                .unwrap_err(),
            "Checklist items must stay on one line."
        );
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn add_reuses_canonical_identity_and_remove_cleans_orphan_vocabulary() {
        let database = TestDatabase::new();
        let store = database.store();
        let captured = store
            .capture("Remember this", "mac-library", &["work".into()])
            .expect("capture should succeed");

        let duplicate = store
            .add_tag(&captured.id, " WORK ")
            .expect("duplicate add should succeed");
        let added = store
            .add_tag(&captured.id, "Design")
            .expect("new tag should succeed");
        let removed = store
            .remove_tag(&captured.id, "work")
            .expect("remove should succeed");

        assert_eq!(duplicate.tags, vec!["work"]);
        assert_eq!(added.tags, vec!["design", "work"]);
        assert_eq!(removed.tags, vec!["design"]);
        assert_eq!(removed.id, captured.id);
        assert_eq!(removed.body, captured.body);
        assert_eq!(removed.created_at, captured.created_at);
        assert_eq!(removed.source, captured.source);
        assert_eq!(removed.archived, captured.archived);
        assert_eq!(store.list_tags().expect("tags should list"), vec!["design"]);
    }

    #[test]
    fn shared_relationship_survives_until_the_final_assignment_is_removed() {
        let database = TestDatabase::new();
        let store = database.store();
        let first = store
            .capture("first", "mac-library", &["shared".into()])
            .expect("first capture should succeed");
        let second = store
            .capture("second", "mac-capture", &["shared".into()])
            .expect("second capture should succeed");

        let first_without_tag = store
            .remove_tag(&first.id, "shared")
            .expect("first removal should succeed");
        assert!(first_without_tag.tags.is_empty());
        assert_eq!(first_without_tag.id, first.id);
        assert_eq!(first_without_tag.body, first.body);
        assert_eq!(first_without_tag.created_at, first.created_at);
        assert_eq!(first_without_tag.archived, first.archived);
        assert_eq!(first_without_tag.source, first.source);
        assert_eq!(store.list_tags().unwrap(), vec!["shared"]);
        assert_eq!(
            store
                .list()
                .unwrap()
                .into_iter()
                .find(|thought| thought.id == second.id)
                .unwrap()
                .tags,
            vec!["shared"]
        );

        store
            .remove_tag(&second.id, "shared")
            .expect("final removal should succeed");
        assert!(store.list_tags().unwrap().is_empty());
    }

    #[test]
    fn archived_assignments_remain_in_suggestions() {
        let database = TestDatabase::new();
        let store = database.store();
        let captured = store
            .capture("old thought", "mac-library", &["history".into()])
            .expect("capture should succeed");
        store
            .set_archived(&captured.id, true)
            .expect("archive should succeed");

        assert_eq!(
            store.list_tags().expect("tags should list"),
            vec!["history"]
        );
    }

    #[test]
    fn archive_updates_and_returns_tags_with_the_persisted_record() {
        let database = TestDatabase::new();
        let store = database.store();
        let captured = store
            .capture("Remember this", "mac-library", &["work".into()])
            .expect("capture should succeed");

        let archived = store
            .set_archived(&captured.id, true)
            .expect("archive should succeed");

        assert!(archived.archived);
        assert_eq!(archived.tags, vec!["work"]);
        assert_eq!(
            database.store().list().expect("list should succeed")[0],
            archived
        );
    }

    #[test]
    fn body_update_is_transactional_and_preserves_identity_metadata_and_tags() {
        let database = TestDatabase::new();
        let store = database.store();
        let captured = store
            .capture("Original body", "mac-library", &["work".into()])
            .expect("capture should succeed");

        let updated = store
            .update_body(&captured.id, "  Revised body\r\nwith detail  ")
            .expect("body update should succeed");

        assert_eq!(updated.body, "Revised body\nwith detail");
        assert_eq!(updated.id, captured.id);
        assert_eq!(updated.created_at, captured.created_at);
        assert_eq!(updated.archived, captured.archived);
        assert_eq!(updated.source, captured.source);
        assert_eq!(updated.tags, captured.tags);
        assert_eq!(database.store().list().unwrap()[0], updated);
        assert_eq!(
            store.update_body(&captured.id, " \n ").unwrap_err(),
            "Give Blob something to remember."
        );
        assert_eq!(
            store.update_body("missing", "valid").unwrap_err(),
            "That thought is no longer in the cache."
        );
    }

    #[test]
    fn invalid_tags_abort_capture_and_missing_mutations_leave_no_vocabulary() {
        let database = TestDatabase::new();
        let store = database.store();

        assert_eq!(
            store
                .capture("valid body", "mac-capture", &["bad\ntag".into()])
                .unwrap_err(),
            "Tags cannot contain line breaks or control characters."
        );
        assert!(store.list().expect("list should succeed").is_empty());
        assert_eq!(
            store.add_tag("missing", "work").unwrap_err(),
            "That thought is no longer in the cache."
        );
        assert!(store.list_tags().expect("tags should list").is_empty());
    }

    #[test]
    fn sql_failure_inside_capture_transaction_rolls_back_thought_and_vocabulary() {
        let database = TestDatabase::new();
        let store = database.store();
        Connection::open(&database.path)
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER fail_tag_relationship
                 BEFORE INSERT ON thought_tags
                 BEGIN
                   SELECT RAISE(FAIL, 'forced tag relationship failure');
                 END;",
            )
            .unwrap();

        let error = store
            .capture("must roll back", "mac-capture", &["work".into()])
            .unwrap_err();

        assert!(error.contains("forced tag relationship failure"));
        assert!(store.list().unwrap().is_empty());
        assert!(store.list_tags().unwrap().is_empty());
    }

    #[test]
    fn tag_validation_matches_the_shared_contract() {
        assert_eq!(normalize_tag(" CAFÉ ").unwrap(), "café");
        assert_eq!(normalize_tag("\u{2003}WORK\u{2003}").unwrap(), "work");
        assert_eq!(
            normalize_tag("Project:  North Star").unwrap(),
            "project:  north star"
        );
        assert!(normalize_tag(" \u{2003} ").is_err());
        assert!(normalize_tag("one\ttwo").is_err());
        assert!(normalize_tag("\nwork\n").is_err());
        assert!(normalize_tag("one\u{2028}two").is_err());
        assert!(normalize_tag("one\u{2029}two").is_err());
        assert!(normalize_tag(&"x".repeat(33)).is_err());
        assert!(normalize_tag(&"😀".repeat(32)).is_ok());
        assert!(normalize_tag(&"😀".repeat(33)).is_err());
    }

    #[test]
    fn tag_colors_are_optional_canonical_and_persist_across_reopen() {
        let database = TestDatabase::new();
        let store = database.store();
        let captured = store
            .capture_with_tag_definitions(
                "colored thought",
                "mac-library",
                &["work".into(), "design".into()],
                &[
                    TagDefinition {
                        name: " WORK ".into(),
                        color: Some("moss".into()),
                    },
                    TagDefinition {
                        name: "work".into(),
                        color: Some("rose".into()),
                    },
                ],
            )
            .expect("colored capture should succeed");

        assert_eq!(
            store.list_tag_definitions().unwrap(),
            vec![
                TagDefinition {
                    name: "design".into(),
                    color: None,
                },
                TagDefinition {
                    name: "work".into(),
                    color: Some("rose".into()),
                },
            ]
        );
        let neutral = store
            .set_tag_color(" WORK ", None)
            .expect("color removal should succeed");
        assert_eq!(neutral.color, None);

        store
            .capture("canonical reuse", "mac-capture", &["work".into()])
            .expect("reuse should succeed");
        assert_eq!(database.store().list_tag_definitions().unwrap()[1], neutral);
        assert_eq!(store.list().unwrap()[1], captured);
    }

    #[test]
    fn tag_color_validation_and_missing_targets_leave_storage_unchanged() {
        let database = TestDatabase::new();
        let store = database.store();

        assert_eq!(
            store
                .capture_with_tag_definitions(
                    "invalid color",
                    "mac-library",
                    &["work".into()],
                    &[TagDefinition {
                        name: "work".into(),
                        color: Some("signal".into()),
                    }],
                )
                .unwrap_err(),
            "Choose a color from the Brain Cache tag palette."
        );
        assert_eq!(
            store
                .capture_with_tag_definitions(
                    "unattached color",
                    "mac-library",
                    &["work".into()],
                    &[TagDefinition {
                        name: "design".into(),
                        color: Some("moss".into()),
                    }],
                )
                .unwrap_err(),
            "Tag colors can only be saved for tags attached to this thought."
        );
        assert_eq!(
            store.set_tag_color("missing", Some("clay")).unwrap_err(),
            "That tag is no longer assigned in the cache."
        );
        assert!(store.list().unwrap().is_empty());
        assert!(store.list_tag_definitions().unwrap().is_empty());
    }

    #[test]
    fn tag_color_migration_preserves_existing_assignments_as_neutral() {
        let database = TestDatabase::new();
        database.create_legacy_schema();
        let connection = Connection::open(&database.path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE tags (name TEXT PRIMARY KEY NOT NULL);
                 CREATE TABLE thought_tags (
                    thought_id TEXT NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
                    tag_name TEXT NOT NULL REFERENCES tags(name) ON DELETE CASCADE,
                    PRIMARY KEY (thought_id, tag_name)
                 );
                 INSERT INTO tags (name) VALUES ('work');
                 INSERT INTO thought_tags (thought_id, tag_name) VALUES ('legacy-id', 'work');",
            )
            .unwrap();
        drop(connection);

        let store = database.store();
        assert_eq!(
            store.list_tag_definitions().unwrap(),
            vec![TagDefinition {
                name: "work".into(),
                color: None,
            }]
        );
        assert_eq!(store.list().unwrap()[1].tags, vec!["work"]);
        assert_eq!(
            store.set_tag_color("work", Some("sky")).unwrap().color,
            Some("sky".into())
        );
        assert_eq!(
            database.store().list_tag_definitions().unwrap()[0].color,
            Some("sky".into())
        );
    }

    #[test]
    fn legacy_migration_is_additive_idempotent_and_preserves_exact_fields() {
        let database = TestDatabase::new();
        database.create_legacy_schema();

        let first = Thought {
            id: "legacy-id".into(),
            body: "  legacy body\r\nkeeps exact bytes  ".into(),
            created_at: "2026-08-30T11:22:33.444Z".into(),
            archived: true,
            completed: false,
            rich_document: None,
            pinned: false,
            source: "mac-capture".into(),
            tags: vec![],
            kind: "text".into(),
            checklist_items: vec![],
            reminder: None,
            task_completions: vec![],
            attachments: vec![],
            document: None,
        };
        let second = Thought {
            id: "legacy-second".into(),
            body: "second row keeps insertion order".into(),
            created_at: "2026-08-30T11:22:33.444Z".into(),
            archived: false,
            completed: false,
            rich_document: None,
            pinned: false,
            source: "mac-library".into(),
            tags: vec![],
            kind: "text".into(),
            checklist_items: vec![],
            reminder: None,
            task_completions: vec![],
            attachments: vec![],
            document: None,
        };
        let expected = vec![second, first];
        let first_open = database.store();
        assert_eq!(first_open.list().unwrap(), expected);
        drop(first_open);

        let second_open = database.store();
        assert_eq!(second_open.list().unwrap(), expected);
        assert!(second_open.list_tags().unwrap().is_empty());

        let connection = Connection::open(&database.path).unwrap();
        let row_count: i64 = connection
            .query_row("SELECT count(*) FROM thoughts", [], |row| row.get(0))
            .unwrap();
        let relationship_count: i64 = connection
            .query_row("SELECT count(*) FROM thought_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(row_count, 2);
        assert_eq!(relationship_count, 0);
    }

    #[test]
    fn pins_survive_reopening_and_do_not_replace_thought_content() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let database = TestDatabase::new();
        let store = database.store();
        let item = checklist_item("One task");
        let thought = store.capture_checklist(&[item.clone()], "mac-capture", &["work".into()], &[]).unwrap();
        assert!(!thought.pinned);
        let file = AttachmentDraft {
            id: Uuid::new_v4().to_string(),
            name: "notes.pdf".into(),
            data: STANDARD.encode(b"pdf bytes"),
        };
        store.add_attachments(&thought.id, &[file.clone()]).unwrap();
        let before = store.set_reminder_intent(&thought.id, &item.id, "2099-02-03T16:15:00Z").unwrap();
        let pinned = store.set_pinned(&thought.id, true).unwrap();
        assert_eq!(pinned, Thought { pinned: true, ..before });
        assert_eq!(database.store().get(&thought.id).unwrap(), pinned);
        assert!(database.store().list().unwrap()[0].pinned);
        assert_eq!(store.read_attachment(&file.id).unwrap().1, b"pdf bytes");
        assert!(store.add_tag(&thought.id, "later").unwrap().pinned);
        assert!(store.replace_checklist_items(&thought.id, &[ChecklistItem { text: "Edited task".into(), ..item }]).unwrap().pinned);
        assert!(store.set_archived(&thought.id, true).unwrap().pinned);
        assert!(store.set_archived(&thought.id, false).unwrap().pinned);
        let unpinned = store.set_pinned(&thought.id, false).unwrap();
        assert!(!database.store().get(&thought.id).unwrap().pinned);
        assert_eq!(unpinned.created_at, thought.created_at);
        assert_eq!(unpinned.body, "Edited task");
        assert!(store.set_pinned("missing", true).is_err());
    }

    #[test]
    fn pin_migration_defaults_legacy_rows_to_unpinned_and_keeps_saved_pins() {
        let database = TestDatabase::new();
        database.create_legacy_schema();
        let store = database.store();
        let original = store.get("legacy-id").unwrap();
        assert!(!original.pinned);
        let pinned = store.set_pinned("legacy-id", true).unwrap();
        assert_eq!(pinned, Thought { pinned: true, ..original });
        assert_eq!(database.store().get("legacy-id").unwrap(), pinned);
        assert!(!database.store().get("legacy-second").unwrap().pinned);
        let connection = Connection::open(&database.path).unwrap();
        connection.execute_batch("CREATE TRIGGER reject_pin BEFORE UPDATE OF pinned ON thoughts BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END;").unwrap();
        assert!(store.set_pinned("legacy-id", false).is_err());
        assert!(store.get("legacy-id").unwrap().pinned);
    }

    #[test]
    fn invalid_capture_and_missing_archive_are_rejected() {
        let database = TestDatabase::new();
        let store = database.store();

        assert_eq!(
            store.capture(" \n ", "mac-capture", &[]).unwrap_err(),
            "Give Blob something to remember."
        );
        assert!(store.capture("Hello", "email", &[]).is_err());
        assert_eq!(
            store.set_archived("missing", true).unwrap_err(),
            "That thought is no longer in the cache."
        );
    }
    #[test]
    fn attachment_bytes_survive_original_deletion_and_database_reopen() {
        let database = TestDatabase::new();
        let source = database.path.with_extension("png");
        let bytes = b"local image bytes\0\xff";
        fs::write(&source, bytes).unwrap();
        let files = attachments::read_selected_files(vec![source.clone()]).unwrap();
        let store = ThoughtStore::open(&database.path).unwrap();
        let thought = store
            .capture_with_attachments("", "mac-capture", &["photos".into()], &[], &files)
            .unwrap();
        assert_eq!(thought.body, files[0].name);
        assert_eq!(thought.attachments[0].size, bytes.len());
        fs::remove_file(&source).unwrap();
        let reopened = ThoughtStore::open(&database.path).unwrap();
        assert_eq!(reopened.list().unwrap()[0].attachments, thought.attachments);
        assert_eq!(reopened.read_attachment(&files[0].id).unwrap().1, bytes);
        assert_eq!(reopened.get(&thought.id).unwrap().tags, vec!["photos"]);
    }

    #[test]
    fn attachments_survive_body_tag_checklist_and_archive_edits_and_remove_by_owner() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let database = TestDatabase::new();
        let store = ThoughtStore::open(&database.path).unwrap();
        let thought = store.capture("Thought", "mac-library", &[]).unwrap();
        let other = store.capture("Other", "mac-library", &[]).unwrap();
        let file = AttachmentDraft {
            id: Uuid::new_v4().to_string(),
            name: "notes.pdf".into(),
            data: STANDARD.encode(b"pdf bytes"),
        };
        let updated = store.add_attachments(&thought.id, &[file.clone()]).unwrap();
        assert_eq!(updated.created_at, thought.created_at);
        assert_eq!(
            store
                .update_body(&thought.id, "Edited")
                .unwrap()
                .attachments,
            updated.attachments
        );
        assert_eq!(
            store.add_tag(&thought.id, "work").unwrap().attachments,
            updated.attachments
        );
        assert_eq!(
            store.set_archived(&thought.id, true).unwrap().attachments,
            updated.attachments
        );
        assert!(store.remove_attachment(&other.id, &file.id).is_err());
        assert!(store.read_attachment(&file.id).is_ok());
        assert!(store
            .remove_attachment(&thought.id, &file.id)
            .unwrap()
            .attachments
            .is_empty());
        assert!(store.read_attachment(&file.id).is_err());
        let item = ChecklistItem {
            id: Uuid::new_v4().to_string(),
            text: "Read PDF".into(),
            completed: false,
            reminder: None,
        };
        let checklist = store
            .capture_checklist_with_attachments(&[item.clone()], "mac-capture", &[], &[], &[file])
            .unwrap();
        let changed = ChecklistItem {
            text: "Read it again".into(),
            ..item
        };
        assert_eq!(
            store
                .replace_checklist_items(&checklist.id, &[changed])
                .unwrap()
                .attachments,
            checklist.attachments
        );
    }

    #[test]
    fn failed_file_transaction_does_not_leave_a_partial_capture_or_attachment_batch() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let database = TestDatabase::new();
        let store = ThoughtStore::open(&database.path).unwrap();
        let thought = store.capture("Existing", "mac-library", &[]).unwrap();
        let first = AttachmentDraft {
            id: Uuid::new_v4().to_string(),
            name: "ok.txt".into(),
            data: STANDARD.encode(b"first"),
        };
        let second = AttachmentDraft {
            id: Uuid::new_v4().to_string(),
            name: "fail.txt".into(),
            data: STANDARD.encode(b"second"),
        };
        let connection = store.connection().unwrap();
        connection.execute_batch("CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments WHEN NEW.name = 'fail.txt' BEGIN SELECT RAISE(ABORT, 'disk failure'); END;").unwrap();
        assert!(store
            .capture_with_attachments(
                "New",
                "mac-capture",
                &["new-tag".into()],
                &[],
                &[first.clone(), second.clone()]
            )
            .is_err());
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.list_tags().unwrap().is_empty());
        assert!(store
            .add_attachments(&thought.id, &[first, second])
            .is_err());
        assert!(store.get(&thought.id).unwrap().attachments.is_empty());
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM attachments", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn attachment_migration_preserves_legacy_thoughts_and_enforces_limits() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let database = TestDatabase::new();
        database.create_legacy_schema();
        let store = ThoughtStore::open(&database.path).unwrap();
        let thought = store.capture("Legacy", "mac-library", &[]).unwrap();
        let files: Vec<_> = (0..20)
            .map(|_| AttachmentDraft {
                id: Uuid::new_v4().to_string(),
                name: "file.txt".into(),
                data: STANDARD.encode(b"file"),
            })
            .collect();
        store.add_attachments(&thought.id, &files).unwrap();
        assert!(store
            .add_attachments(
                &thought.id,
                &[AttachmentDraft {
                    id: Uuid::new_v4().to_string(),
                    ..files[0].clone()
                }]
            )
            .unwrap_err()
            .contains("20 files"));
        assert_eq!(
            ThoughtStore::open(&database.path)
                .unwrap()
                .get(&thought.id)
                .unwrap()
                .attachments
                .len(),
            20
        );
    }
    #[test]
    fn document_images_keep_their_order_after_reopen_edit_and_archive() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let database = TestDatabase::new();
        database.create_legacy_schema();
        let store = database.store();
        assert!(store.get("legacy-id").unwrap().document.is_none());
        let file = AttachmentDraft { id: Uuid::new_v4().to_string(), name: "Screenshot.png".into(), data: STANDARD.encode(b"image bytes") };
        let mut blocks = vec![
            DocumentBlock::Text { id: "before".into(), text: "Before".into() },
            DocumentBlock::Image { id: "image".into(), attachment_id: file.id.clone() },
            DocumentBlock::Text { id: "after".into(), text: "After".into() },
        ];
        let thought = store.capture_document("ignored", "mac-capture", &["photos".into()], &[], &[file.clone()], Some(&blocks)).unwrap();
        assert_eq!(thought.body, "Before\nAfter");
        assert_eq!(database.store().get(&thought.id).unwrap().document, Some(blocks.clone()));
        assert_eq!(database.store().list().unwrap()[0].document, Some(blocks.clone()));
        blocks[2] = DocumentBlock::Text { id: "after".into(), text: "Edited after".into() };
        let edited = store.update_document(&thought.id, "", Some(&blocks), &[]).unwrap();
        assert_eq!(edited.body, "Before\nEdited after");
        assert_eq!(store.set_archived(&thought.id, true).unwrap().document, Some(blocks.clone()));
        assert!(store.update_body(&thought.id, "flattened").is_err());
        assert_eq!(store.read_attachment(&file.id).unwrap().1, b"image bytes");
        blocks.remove(1);
        let removed = store.update_document(&thought.id, "", Some(&blocks), &[]).unwrap();
        assert!(removed.attachments.is_empty());
        assert!(store.read_attachment(&file.id).is_err());
    }

    #[test]
    fn invalid_document_rolls_back_both_new_files_and_text_and_cannot_reference_another_thought() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let database = TestDatabase::new();
        let store = database.store();
        let file = AttachmentDraft { id: Uuid::new_v4().to_string(), name: "Screenshot.png".into(), data: STANDARD.encode(b"image bytes") };
        let image = DocumentBlock::Image { id: "image".into(), attachment_id: file.id.clone() };
        let original = store.capture("Original", "mac-library", &[]).unwrap();
        let invalid = vec![image.clone(), DocumentBlock::Image { id: "missing".into(), attachment_id: Uuid::new_v4().to_string() }];
        assert!(store.update_document(&original.id, "Changed", Some(&invalid), &[file.clone()]).is_err());
        assert_eq!(store.get(&original.id).unwrap(), original);
        assert!(store.read_attachment(&file.id).is_err());
        let image_only = store.capture_document("", "mac-capture", &[], &[], &[file.clone()], Some(&[image.clone()])).unwrap();
        assert_eq!(image_only.body, "Screenshot.png");
        assert!(store.update_document(&original.id, "", Some(&[image]), &[]).is_err());
        assert_eq!(store.get(&original.id).unwrap(), original);
        assert!(store.read_attachment(&file.id).is_ok());
    }

}
