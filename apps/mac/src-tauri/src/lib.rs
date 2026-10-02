mod attachments;
mod document;
mod rich_document;
use document::DocumentBlock;
mod reminders;
mod storage;

use std::{
    fs,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use attachments::AttachmentDraft;
use base64::{engine::general_purpose::STANDARD, Engine};
use reminders::{
    install_notification_delegate, open_notification_settings as open_macos_notification_settings,
    reconcile as reconcile_reminders, take_pending_target, ReminderOpenState, ReminderTarget,
};
use serde::Serialize;
use storage::{ChecklistItem, FontSize, TagDefinition, Thought, ThoughtStore};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, State, Theme,
    WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const CAPTURE_WINDOW_LABEL: &str = "capture";
const LIBRARY_WINDOW_LABEL: &str = "main";
const CAPTURE_WINDOW_WIDTH: f64 = 488.0;
const CAPTURE_WINDOW_RESTING_HEIGHT: f64 = 74.0;
const CAPTURE_WINDOW_INSET: f64 = 16.0;
const CAPTURE_RESIZE_MAX_DURATION_MS: u64 = 180;
const MENU_NUMBERED_LIST: &str = "capture-numbered-list";
const MENU_BULLETED_LIST: &str = "capture-bulleted-list";
const MENU_CHECKLIST: &str = "capture-checklist";
const MENU_ADD_TAGS: &str = "capture-add-tags";
const MENU_SHORTCUT_DRAWER: &str = "capture-shortcut-drawer";
const MENU_SHOW_SHORTCUT_BUTTON: &str = "show-shortcut-button";

struct CaptureWindowState {
    desired_height: Mutex<f64>,
    animation_generation: AtomicU64,
    file_picker_active: AtomicBool,
}

impl Default for CaptureWindowState {
    fn default() -> Self {
        Self {
            desired_height: Mutex::new(CAPTURE_WINDOW_RESTING_HEIGHT),
            animation_generation: AtomicU64::new(0),
            file_picker_active: AtomicBool::new(false),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureResizeResult {
    applied_height: f64,
    max_height: f64,
    constrained: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PixelRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct CapturePlacement {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

#[tauri::command]
fn list_thoughts(store: State<'_, ThoughtStore>) -> Result<Vec<Thought>, String> {
    store.list()
}

#[tauri::command]
fn list_tags(store: State<'_, ThoughtStore>) -> Result<Vec<String>, String> {
    store.list_tags()
}

#[tauri::command]
fn list_tag_definitions(store: State<'_, ThoughtStore>) -> Result<Vec<TagDefinition>, String> {
    store.list_tag_definitions()
}

#[tauri::command]
async fn capture_thought(
    app: AppHandle,
    store: State<'_, ThoughtStore>,
    body: String,
    source: String,
    tags: Vec<String>,
    tag_definitions: Option<Vec<TagDefinition>>,
    attachments: Option<Vec<AttachmentDraft>>,
    document: Option<Vec<DocumentBlock>>,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    let thought = tauri::async_runtime::spawn_blocking(move || {
        store.capture_document(
            &body,
            &source,
            &tags,
            tag_definitions.as_deref().unwrap_or_default(),
            attachments.as_deref().unwrap_or_default(),
            document.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Err(error) = app.emit("thought-created", &thought) {
        eprintln!("Brain Cache saved a thought but could not notify the library: {error}");
    }
    Ok(thought)
}

#[tauri::command]
async fn capture_checklist(
    app: AppHandle,
    store: State<'_, ThoughtStore>,
    items: Vec<ChecklistItem>,
    source: String,
    tags: Vec<String>,
    tag_definitions: Option<Vec<TagDefinition>>,
    attachments: Option<Vec<AttachmentDraft>>,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    let thought = tauri::async_runtime::spawn_blocking(move || {
        store.capture_checklist_with_attachments(
            &items,
            &source,
            &tags,
            tag_definitions.as_deref().unwrap_or_default(),
            attachments.as_deref().unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Err(error) = app.emit("thought-created", &thought) {
        eprintln!("Brain Cache saved a checklist but could not notify the library: {error}");
    }
    Ok(thought)
}

#[tauri::command]
async fn choose_attachment_files(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<AttachmentDraft>, String> {
    let state = app.state::<CaptureWindowState>();
    if state.file_picker_active.swap(true, Ordering::SeqCst) {
        return Err("The file picker is already open.".into());
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let picker_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        let result = attachments::choose_files();
        #[cfg(not(target_os = "macos"))]
        let result = Err::<Vec<std::path::PathBuf>, String>(
            "File selection is not supported on this platform.".into(),
        );
        let _ = window.set_focus();
        picker_app
            .state::<CaptureWindowState>()
            .file_picker_active
            .store(false, Ordering::SeqCst);
        let _ = sender.send(result);
    }) {
        state.file_picker_active.store(false, Ordering::SeqCst);
        return Err(error.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let paths = receiver.recv().map_err(|e| e.to_string())??;
        attachments::read_selected_files(paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn add_thought_attachments(
    store: State<'_, ThoughtStore>,
    id: String,
    attachments: Vec<AttachmentDraft>,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.add_attachments(&id, &attachments))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_thought_attachment(
    store: State<'_, ThoughtStore>,
    thought_id: String,
    attachment_id: String,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.remove_attachment(&thought_id, &attachment_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_attachment_data(
    store: State<'_, ThoughtStore>,
    id: String,
) -> Result<String, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .read_attachment(&id)
            .map(|(_, bytes)| STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_attachment(
    app: AppHandle,
    store: State<'_, ThoughtStore>,
    id: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("attachments");
    tauri::async_runtime::spawn_blocking(move || {
        let (attachment, bytes) = store.read_attachment(&id)?;
        let directory = cache.join(&attachment.id);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join(attachments::safe_name(&attachment.name));
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
            let status = std::process::Command::new("/usr/bin/open")
                .arg(&path)
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("Could not open this file in its default app.".into());
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn add_thought_tag(
    store: State<'_, ThoughtStore>,
    id: String,
    tag: String,
) -> Result<Thought, String> {
    store.add_tag(&id, &tag)
}

#[tauri::command]
fn remove_thought_tag(
    store: State<'_, ThoughtStore>,
    id: String,
    tag: String,
) -> Result<Thought, String> {
    store.remove_tag(&id, &tag)
}

#[tauri::command]
fn set_tag_color(
    store: State<'_, ThoughtStore>,
    name: String,
    color: Option<String>,
) -> Result<TagDefinition, String> {
    store.set_tag_color(&name, color.as_deref())
}

#[tauri::command]
async fn set_thought_completed(
    store: State<'_, ThoughtStore>,
    id: String,
    completed: bool,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let thought = store.set_completed(&id, completed)?;
        if completed { reconcile_reminders_or_log(&store, "completing a thought"); }
        Ok(thought)
    }).await.map_err(|error| format!("Brain Cache could not finish the completion change: {error}"))?
}

#[tauri::command]
async fn set_thought_archived(
    store: State<'_, ThoughtStore>,
    id: String,
    archived: bool,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let thought = store.set_archived(&id, archived)?;
        if archived {
            reconcile_reminders_or_log(&store, "archiving a thought");
        }
        Ok(thought)
    })
    .await
    .map_err(|error| format!("Brain Cache could not finish the archive change: {error}"))?
}

#[tauri::command]
fn set_thought_pinned(
    store: State<'_, ThoughtStore>,
    id: String,
    pinned: bool,
) -> Result<Thought, String> {
    store.set_pinned(&id, pinned)
}

#[tauri::command]
async fn update_rich_document(store: State<'_, ThoughtStore>, id: String, document: serde_json::Value, attachments: Option<Vec<AttachmentDraft>>) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.update_rich_document(&id, &document, &attachments.unwrap_or_default())?;
        reconcile_reminders_or_log(&store, "editing a document");
        store.get(&id)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_thought_body(
    store: State<'_, ThoughtStore>,
    id: String,
    body: String,
    document: Option<Vec<DocumentBlock>>,
    attachments: Option<Vec<AttachmentDraft>>,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let thought = store.update_document(&id, &body, document.as_deref(), attachments.as_deref().unwrap_or_default())?;
        if thought.reminder.is_some() { reconcile_reminders_or_log(&store, "updating a thought"); }
        store.get(&id)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn replace_checklist_items(
    store: State<'_, ThoughtStore>,
    id: String,
    items: Vec<ChecklistItem>,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let thought = store.replace_checklist_items(&id, &items)?;
        reconcile_reminders_or_log(&store, "updating checklist items");
        store.get(&thought.id)
    })
    .await
    .map_err(|error| format!("Brain Cache could not finish the checklist update: {error}"))?
}

#[tauri::command]
async fn set_checklist_reminder(
    store: State<'_, ThoughtStore>,
    thought_id: String,
    item_id: String,
    scheduled_for: String,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.set_reminder_intent(&thought_id, &item_id, &scheduled_for)?;
        let intent = store
            .list_reminder_records()?
            .into_iter()
            .find(|record| record.item_id.as_deref() == Some(item_id.as_str()) && record.thought_id == thought_id)
            .ok_or_else(|| "The reminder intent could not be read back.".to_string())?;
        if let Err(error) = reconcile_reminders(&store, true) {
            store.set_reminder_result_if_current(&intent, "scheduling-failed", Some(&error))?;
        }
        store.get(&thought_id)
    })
    .await
    .map_err(|error| format!("Brain Cache could not finish scheduling the reminder: {error}"))?
}

#[tauri::command]
async fn set_thought_reminder(
    store: State<'_, ThoughtStore>, thought_id: String, scheduled_for: String,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.set_thought_reminder_intent(&thought_id, &scheduled_for)?;
        let intent = store.list_reminder_records()?.into_iter()
            .find(|record| record.item_id.is_none() && record.thought_id == thought_id)
            .ok_or("The reminder intent could not be read back.")?;
        if let Err(error) = reconcile_reminders(&store, true) {
            store.set_reminder_result_if_current(&intent, "scheduling-failed", Some(&error))?;
        }
        store.get(&thought_id)
    }).await.map_err(|error| format!("Brain Cache could not finish scheduling the reminder: {error}"))?
}

#[tauri::command]
async fn clear_thought_reminder(
    store: State<'_, ThoughtStore>, thought_id: String,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.request_thought_reminder_cancellation(&thought_id)?;
        reconcile_reminders(&store, false)?;
        store.get(&thought_id)
    }).await.map_err(|error| format!("Brain Cache could not finish clearing the reminder: {error}"))?
}

#[tauri::command]
async fn clear_checklist_reminder(
    store: State<'_, ThoughtStore>,
    thought_id: String,
    item_id: String,
) -> Result<Thought, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.request_reminder_cancellation(&thought_id, &item_id)?;
        reconcile_reminders(&store, false)?;
        store.get(&thought_id)
    })
    .await
    .map_err(|error| format!("Brain Cache could not finish clearing the reminder: {error}"))?
}

#[tauri::command]
fn take_pending_reminder_target(
    state: State<'_, ReminderOpenState>,
) -> Result<Option<ReminderTarget>, String> {
    take_pending_target(&state)
}

#[tauri::command]
fn open_notification_settings() -> Result<(), String> {
    open_macos_notification_settings()
}

fn reconcile_reminders_or_log(store: &ThoughtStore, context: &str) {
    if let Err(error) = reconcile_reminders(store, false) {
        eprintln!("Brain Cache could not reconcile reminders after {context}: {error}");
    }
}

fn reconcile_reminders_and_notify(app: AppHandle, store: ThoughtStore, context: &'static str) {
    match reconcile_reminders(&store, false) {
        Ok(()) => {
            if let Err(error) = app.emit("reminders-reconciled", ()) {
                eprintln!(
                    "Brain Cache reconciled reminders but could not refresh the library: {error}"
                );
            }
        }
        Err(error) => {
            eprintln!("Brain Cache could not reconcile reminders after {context}: {error}")
        }
    }
}

#[tauri::command]
fn get_shortcut_button_visible(store: State<'_, ThoughtStore>) -> Result<bool, String> {
    store.shortcut_button_visible()
}

#[tauri::command]
fn set_shortcut_button_visible(
    app: AppHandle,
    store: State<'_, ThoughtStore>,
    visible: bool,
) -> Result<bool, String> {
    save_shortcut_button_visibility(&app, &store, visible)
}

fn save_shortcut_button_visibility<R: Runtime>(
    app: &AppHandle<R>,
    store: &ThoughtStore,
    visible: bool,
) -> Result<bool, String> {
    let saved = store.set_shortcut_button_visible(visible)?;
    // Both Settings and capture stay in sync after the local write succeeds.
    if let Err(error) = app.emit("shortcut-button-visibility", saved) {
        eprintln!("Brain Cache saved the shortcut preference but could not notify its windows: {error}");
    }
    Ok(saved)
}

#[tauri::command]
fn get_light_mode(store: State<'_, ThoughtStore>) -> Result<bool, String> {
    store.light_mode()
}

#[tauri::command]
fn set_light_mode(
    app: AppHandle,
    store: State<'_, ThoughtStore>,
    enabled: bool,
) -> Result<bool, String> {
    let saved = store.set_light_mode(enabled)?;
    apply_light_mode(&app, saved);
    if let Err(error) = app.emit("light-mode-changed", saved) {
        eprintln!("Brain Cache saved the appearance preference but could not notify its windows: {error}");
    }
    Ok(saved)
}

fn apply_light_mode<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    // macOS appearance is app-wide, including the native window chrome and menus.
    app.set_theme(Some(if enabled { Theme::Light } else { Theme::Dark }));
}

#[tauri::command]
fn get_font_size(store: State<'_, ThoughtStore>) -> Result<FontSize, String> {
    store.font_size()
}

#[tauri::command]
fn set_font_size(
    app: AppHandle,
    store: State<'_, ThoughtStore>,
    size: FontSize,
) -> Result<FontSize, String> {
    let saved = store.set_font_size(size)?;
    if let Err(error) = app.emit("font-size-changed", saved) {
        eprintln!("Brain Cache saved the font size but could not notify its windows: {error}");
    }
    Ok(saved)
}

#[tauri::command]
fn show_capture(app: AppHandle) -> Result<(), String> {
    reveal_capture(&app)
}

#[tauri::command]
fn hide_capture(app: AppHandle) -> Result<(), String> {
    capture_window(&app)?.hide().map_err(window_error)
}

#[tauri::command]
fn resize_capture(
    app: AppHandle,
    state: State<'_, CaptureWindowState>,
    height: f64,
    duration_ms: u64,
) -> Result<CaptureResizeResult, String> {
    let window = capture_window(&app)?;
    let monitor = capture_resize_monitor(&app, &window)?;
    let work_area = monitor.work_area();
    let scale_factor = valid_scale_factor(monitor.scale_factor());
    let position = window.outer_position().map_err(window_error)?;
    let requested_height = normalized_capture_height(height);
    let result = constrained_capture_height(
        PixelRect {
            x: work_area.position.x,
            y: work_area.position.y,
            width: work_area.size.width,
            height: work_area.size.height,
        },
        scale_factor,
        position.y,
        requested_height,
    );
    let target_size = PhysicalSize::new(
        (CAPTURE_WINDOW_WIDTH * scale_factor).round() as u32,
        (result.applied_height * scale_factor).round().max(1.0) as u32,
    );

    *state
        .desired_height
        .lock()
        .map_err(|_| "Brain Cache could not update capture size state.".to_string())? =
        requested_height;
    let generation = state.animation_generation.fetch_add(1, Ordering::SeqCst) + 1;
    animate_capture_resize(
        app,
        window,
        target_size,
        duration_ms.min(CAPTURE_RESIZE_MAX_DURATION_MS),
        generation,
    )?;
    Ok(result)
}

fn capture_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window(CAPTURE_WINDOW_LABEL)
        .ok_or_else(|| "The capture window is unavailable.".to_string())
}

fn reveal_capture<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = capture_window(app)?;
    let state = app.state::<CaptureWindowState>();
    let desired_height = *state
        .desired_height
        .lock()
        .map_err(|_| "Brain Cache could not read capture size state.".to_string())?;
    state.animation_generation.fetch_add(1, Ordering::SeqCst);
    let placement = capture_window_placement(app, &window, desired_height)?;
    let geometry_matches = capture_window_geometry_matches(&window, placement);
    let show_window = window.clone();
    prepare_capture_reveal(
        geometry_matches,
        || apply_capture_placement(&window, placement),
        || {
            schedule_capture_show(app, show_window);
            Ok(())
        },
    )
}

fn prepare_capture_reveal<E>(
    geometry_matches: bool,
    apply_placement: impl FnOnce() -> Result<(), E>,
    schedule_show: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    if !geometry_matches {
        apply_placement()?;
    }
    schedule_show()
}

fn schedule_capture_show<R: Runtime>(app: &AppHandle<R>, window: WebviewWindow<R>) {
    let worker_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let focus_app = worker_app.clone();
        if let Err(error) = worker_app.run_on_main_thread(move || {
            let focus_window = window.clone();
            if let Err(error) = show_capture_then_schedule_focus(
                || window.show().map_err(window_error),
                || {
                    schedule_capture_focus(&focus_app, focus_window);
                    Ok::<(), String>(())
                },
            ) {
                eprintln!("Brain Cache could not show capture: {error}");
            }
        }) {
            eprintln!("Brain Cache could not schedule capture show: {error}");
        }
    });
}

fn show_capture_then_schedule_focus<E>(
    show: impl FnOnce() -> Result<(), E>,
    schedule_focus: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    show()?;
    schedule_focus()
}

fn schedule_capture_focus<R: Runtime>(app: &AppHandle<R>, window: WebviewWindow<R>) {
    let worker_app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = worker_app.run_on_main_thread(move || {
            if let Err(error) = focus_capture_then_notify(
                || window.set_focus().map_err(window_error),
                || {
                    window
                        .emit("capture-focus", ())
                        .map_err(|error| format!("Could not focus capture: {error}"))
                },
            ) {
                eprintln!("Brain Cache could not focus capture: {error}");
            }
        }) {
            eprintln!("Brain Cache could not schedule capture focus: {error}");
        }
    });
}

fn focus_capture_then_notify<E>(
    focus: impl FnOnce() -> Result<(), E>,
    notify: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    focus()?;
    notify()
}

fn schedule_capture_dismissal_check<R: Runtime>(window: tauri::Window<R>) {
    let worker_window = window.clone();
    tauri::async_runtime::spawn(async move {
        let check_window = worker_window.clone();
        if let Err(error) = worker_window.run_on_main_thread(move || {
            if check_window
                .app_handle()
                .state::<CaptureWindowState>()
                .file_picker_active
                .load(Ordering::SeqCst)
            {
                return;
            }
            if let Err(error) = hide_capture_if_still_unfocused(
                || {
                    check_window
                        .is_focused()
                        .map_err(|error| format!("Could not check capture focus: {error}"))
                },
                || {
                    check_window.hide().map_err(|error| {
                        format!("Could not hide capture after focus loss: {error}")
                    })
                },
            ) {
                eprintln!("Brain Cache could not finish the capture focus-loss check: {error}");
            }
        }) {
            eprintln!("Brain Cache could not schedule the capture focus-loss check: {error}");
        }
    });
}

fn hide_capture_if_still_unfocused<E>(
    is_focused: impl FnOnce() -> Result<bool, E>,
    hide: impl FnOnce() -> Result<(), E>,
) -> Result<bool, E> {
    if is_focused()? {
        return Ok(false);
    }
    hide()?;
    Ok(true)
}

fn reveal_capture_or_log<R: Runtime>(app: &AppHandle<R>, source: &str) {
    if let Err(error) = reveal_capture(app) {
        eprintln!("Brain Cache could not prepare capture from {source}: {error}");
    }
}

fn capture_window_placement<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    desired_height: f64,
) -> Result<CapturePlacement, String> {
    let monitor = capture_monitor(app, window)?;
    let work_area = monitor.work_area();
    Ok(capture_placement(
        PixelRect {
            x: work_area.position.x,
            y: work_area.position.y,
            width: work_area.size.width,
            height: work_area.size.height,
        },
        monitor.scale_factor(),
        desired_height,
    ))
}

fn capture_window_geometry_matches<R: Runtime>(
    window: &WebviewWindow<R>,
    placement: CapturePlacement,
) -> bool {
    window.outer_position().ok() == Some(placement.position)
        && window.outer_size().ok() == Some(placement.size)
}

fn apply_capture_placement<R: Runtime>(
    window: &WebviewWindow<R>,
    placement: CapturePlacement,
) -> Result<(), String> {
    window.set_size(placement.size).map_err(window_error)?;
    window
        .set_position(placement.position)
        .map_err(window_error)
}

fn capture_monitor<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<Monitor, String> {
    let cursor = app.cursor_position().ok();
    if let Some(cursor) = cursor {
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            return Ok(monitor);
        }
    }

    let monitors = app.available_monitors().unwrap_or_default();
    if let Some(cursor) = cursor {
        let bounds = monitors
            .iter()
            .map(|monitor| PixelRect {
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
            })
            .collect::<Vec<_>>();
        if let Some(index) = nearest_rect_index(cursor, &bounds) {
            return Ok(monitors[index].clone());
        }
    }

    if let Ok(Some(monitor)) = app.primary_monitor() {
        return Ok(monitor);
    }
    if let Ok(Some(monitor)) = window.current_monitor() {
        return Ok(monitor);
    }
    monitors
        .into_iter()
        .next()
        .ok_or_else(|| "Brain Cache could not find a display for capture.".to_string())
}

fn capture_resize_monitor<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<Monitor, String> {
    if let Ok(Some(monitor)) = window.current_monitor() {
        return Ok(monitor);
    }
    if let Ok(Some(monitor)) = app.primary_monitor() {
        return Ok(monitor);
    }
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .next()
        .ok_or_else(|| "Brain Cache could not find the active display for capture.".to_string())
}

fn capture_placement(
    work_area: PixelRect,
    scale_factor: f64,
    desired_height: f64,
) -> CapturePlacement {
    let scale_factor = valid_scale_factor(scale_factor);
    let width = (CAPTURE_WINDOW_WIDTH * scale_factor).round() as u32;
    let inset = (CAPTURE_WINDOW_INSET * scale_factor).round() as i64;
    let x = clamped_axis_origin(work_area.x, work_area.width, width, inset);
    let y = inset_axis_origin(work_area.y, work_area.height, inset);
    let height = constrained_capture_height(
        work_area,
        scale_factor,
        y,
        normalized_capture_height(desired_height),
    );
    CapturePlacement {
        position: PhysicalPosition::new(x, y),
        size: PhysicalSize::new(
            width,
            (height.applied_height * scale_factor).round().max(1.0) as u32,
        ),
    }
}

fn valid_scale_factor(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

fn normalized_capture_height(height: f64) -> f64 {
    if height.is_finite() {
        height.max(CAPTURE_WINDOW_RESTING_HEIGHT)
    } else {
        CAPTURE_WINDOW_RESTING_HEIGHT
    }
}

fn constrained_capture_height(
    work_area: PixelRect,
    scale_factor: f64,
    anchor_y: i32,
    requested_height: f64,
) -> CaptureResizeResult {
    let scale_factor = valid_scale_factor(scale_factor);
    let inset = (CAPTURE_WINDOW_INSET * scale_factor).round() as i64;
    let work_area_bottom = i64::from(work_area.y) + i64::from(work_area.height);
    let available_physical_height = (work_area_bottom - i64::from(anchor_y) - inset).max(1);
    let max_height = available_physical_height as f64 / scale_factor;
    let applied_height = requested_height.min(max_height);
    CaptureResizeResult {
        applied_height,
        max_height,
        constrained: applied_height + f64::EPSILON < requested_height,
    }
}

fn inset_axis_origin(area_start: i32, area_length: u32, inset: i64) -> i32 {
    let usable_inset = if i64::from(area_length) > inset * 2 {
        inset
    } else {
        0
    };
    (i64::from(area_start) + usable_inset) as i32
}

fn animate_capture_resize<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    target_size: PhysicalSize<u32>,
    duration_ms: u64,
    generation: u64,
) -> Result<(), String> {
    let start_size = window.outer_size().map_err(window_error)?;
    if start_size == target_size {
        return Ok(());
    }
    if duration_ms == 0 {
        return window.set_size(target_size).map_err(window_error);
    }

    let steps = (duration_ms / 15).max(1);
    thread::spawn(move || {
        for step in 1..=steps {
            if app
                .state::<CaptureWindowState>()
                .animation_generation
                .load(Ordering::SeqCst)
                != generation
            {
                return;
            }
            let progress = step as f64 / steps as f64;
            let eased = ease_in_out(progress);
            let frame_height = interpolate_dimension(start_size.height, target_size.height, eased);
            let frame_size = PhysicalSize::new(target_size.width, frame_height);
            let frame_window = window.clone();
            let frame_app = app.clone();
            if let Err(error) = app.run_on_main_thread(move || {
                let state = frame_app.state::<CaptureWindowState>();
                if let Err(error) = apply_capture_resize_frame_if_current(
                    &state.animation_generation,
                    generation,
                    || frame_window.set_size(frame_size),
                ) {
                    eprintln!("Brain Cache could not animate capture resize: {error}");
                }
            }) {
                eprintln!("Brain Cache could not schedule capture resize: {error}");
                return;
            }
            if step < steps {
                thread::sleep(Duration::from_millis(duration_ms / steps));
            }
        }
    });
    Ok(())
}

fn apply_capture_resize_frame_if_current<E>(
    animation_generation: &AtomicU64,
    generation: u64,
    apply: impl FnOnce() -> Result<(), E>,
) -> Result<bool, E> {
    if animation_generation.load(Ordering::SeqCst) != generation {
        return Ok(false);
    }
    apply()?;
    Ok(true)
}

fn ease_in_out(progress: f64) -> f64 {
    if progress < 0.5 {
        2.0 * progress * progress
    } else {
        1.0 - (-2.0 * progress + 2.0).powi(2) / 2.0
    }
}

fn interpolate_dimension(start: u32, end: u32, progress: f64) -> u32 {
    (f64::from(start) + (f64::from(end) - f64::from(start)) * progress).round() as u32
}

fn clamped_axis_origin(area_start: i32, area_length: u32, frame_length: u32, inset: i64) -> i32 {
    let area_start = i64::from(area_start);
    let area_end = area_start + i64::from(area_length);
    let frame_length = i64::from(frame_length);
    let latest_origin = area_end - frame_length;
    let desired_origin = area_start + inset;

    if latest_origin < area_start {
        area_start as i32
    } else {
        desired_origin.clamp(area_start, latest_origin) as i32
    }
}

fn nearest_rect_index(cursor: PhysicalPosition<f64>, rects: &[PixelRect]) -> Option<usize> {
    rects
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            squared_distance_to_rect(cursor, **left)
                .total_cmp(&squared_distance_to_rect(cursor, **right))
        })
        .map(|(index, _)| index)
}

fn squared_distance_to_rect(cursor: PhysicalPosition<f64>, rect: PixelRect) -> f64 {
    let left = f64::from(rect.x);
    let top = f64::from(rect.y);
    let right = left + f64::from(rect.width);
    let bottom = top + f64::from(rect.height);
    let dx = if cursor.x < left {
        left - cursor.x
    } else if cursor.x > right {
        cursor.x - right
    } else {
        0.0
    };
    let dy = if cursor.y < top {
        top - cursor.y
    } else if cursor.y > bottom {
        cursor.y - bottom
    } else {
        0.0
    };
    dx * dx + dy * dy
}

fn reveal_library<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window(LIBRARY_WINDOW_LABEL)
        .ok_or_else(|| "The library window is unavailable.".to_string())?;
    window.unminimize().map_err(window_error)?;
    window.show().map_err(window_error)?;
    window.set_focus().map_err(window_error)
}

fn window_error(error: tauri::Error) -> String {
    format!("Brain Cache window error: {error}")
}

fn configure_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let capture = MenuItem::with_id(app, "capture", "Capture Thought", true, Some("Alt+Space"))?;
    let library = MenuItem::with_id(app, "library", "Show Library", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Brain Cache", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture, &library, &quit])?;

    let mut tray = TrayIconBuilder::with_id("brain-cache-tray")
        .tooltip("Brain Cache")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                reveal_capture_or_log(app, "the tray menu");
            }
            "library" => {
                let _ = reveal_library(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_capture_or_log(tray.app_handle(), "the tray icon");
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ApplicationMenuAction {
    CaptureCommand(&'static str),
    ShowShortcutButton,
}

fn application_menu_action(id: &str) -> Option<ApplicationMenuAction> {
    match id {
        MENU_NUMBERED_LIST => Some(ApplicationMenuAction::CaptureCommand("numbered-list")),
        MENU_BULLETED_LIST => Some(ApplicationMenuAction::CaptureCommand("bulleted-list")),
        MENU_CHECKLIST => Some(ApplicationMenuAction::CaptureCommand("checklist")),
        MENU_ADD_TAGS => Some(ApplicationMenuAction::CaptureCommand("add-tags")),
        MENU_SHORTCUT_DRAWER => Some(ApplicationMenuAction::CaptureCommand("open-shortcuts")),
        MENU_SHOW_SHORTCUT_BUTTON => Some(ApplicationMenuAction::ShowShortcutButton),
        _ => None,
    }
}

fn build_application_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let numbered = MenuItem::with_id(
        app,
        MENU_NUMBERED_LIST,
        "Numbered List",
        true,
        Some("CmdOrCtrl+Shift+7"),
    )?;
    let bulleted = MenuItem::with_id(
        app,
        MENU_BULLETED_LIST,
        "Bulleted List",
        true,
        Some("CmdOrCtrl+Shift+8"),
    )?;
    let checklist = MenuItem::with_id(
        app,
        MENU_CHECKLIST,
        "Checklist",
        true,
        Some("CmdOrCtrl+Shift+9"),
    )?;
    let add_tags = MenuItem::with_id(app, MENU_ADD_TAGS, "Add Tags", true, Some("CmdOrCtrl+T"))?;
    let shortcuts = MenuItem::with_id(
        app,
        MENU_SHORTCUT_DRAWER,
        "Open Shortcut Drawer",
        true,
        Some("CmdOrCtrl+Shift+/"),
    )?;
    let capture = Submenu::with_items(
        app,
        "Capture",
        true,
        &[&numbered, &bulleted, &checklist, &add_tags, &shortcuts],
    )?;
    let show_shortcut_button = MenuItem::with_id(
        app,
        MENU_SHOW_SHORTCUT_BUTTON,
        "Show Shortcut Button",
        true,
        None::<&str>,
    )?;

    let menu = Menu::default(app)?;
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            if submenu.text()?.as_str() == "View" {
                submenu.append(&show_shortcut_button)?;
                break;
            }
        }
    }
    let position = menu.items()?.len().saturating_sub(2);
    menu.insert(&capture, position)?;
    Ok(menu)
}

fn emit_capture_command<R: Runtime>(app: &AppHandle<R>, command: &str) {
    reveal_capture_or_log(app, "the application menu");
    match capture_window(app) {
        Ok(window) => {
            if let Err(error) = window.emit("capture-command", command) {
                eprintln!("Brain Cache could not deliver a capture command: {error}");
            }
        }
        Err(error) => eprintln!("Brain Cache could not find capture for a menu command: {error}"),
    }
}

fn handle_application_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match application_menu_action(id) {
        Some(ApplicationMenuAction::CaptureCommand(command)) => {
            emit_capture_command(app, command);
        }
        Some(ApplicationMenuAction::ShowShortcutButton) => {
            if let Err(error) = save_shortcut_button_visibility(app, &app.state::<ThoughtStore>(), true) {
                eprintln!("Brain Cache could not restore the shortcut button: {error}");
            }
        }
        None => {}
    }
}

pub fn run() {
    let capture_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let shortcut_for_handler = capture_shortcut;

    tauri::Builder::default()
        .menu(build_application_menu)
        .on_menu_event(|app, event| handle_application_menu(app, event.id.as_ref()))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|argument| argument == "--capture") {
                reveal_capture_or_log(app, "a second launch");
            } else if !args.iter().any(|argument| argument == "--background") {
                let _ = reveal_library(app);
            }
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &shortcut_for_handler && event.state() == ShortcutState::Pressed
                    {
                        reveal_capture_or_log(app, "Option+Space");
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            list_thoughts,
            choose_attachment_files,
            add_thought_attachments,
            remove_thought_attachment,
            read_attachment_data,
            open_attachment,
            list_tags,
            list_tag_definitions,
            capture_thought,
            capture_checklist,
            add_thought_tag,
            remove_thought_tag,
            set_tag_color,
            set_thought_archived,
            set_thought_completed,
            set_thought_pinned,
            update_thought_body,
            update_rich_document,
            replace_checklist_items,
            set_checklist_reminder,
            set_thought_reminder,
            clear_thought_reminder,
            clear_checklist_reminder,
            take_pending_reminder_target,
            open_notification_settings,
            get_shortcut_button_visible,
            set_shortcut_button_visible,
            get_light_mode,
            set_light_mode,
            get_font_size,
            set_font_size,
            show_capture,
            hide_capture,
            resize_capture
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let data_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&data_directory)?;
            let store = ThoughtStore::open(data_directory.join("brain-cache.sqlite3"))
                .map_err(std::io::Error::other)?;
            let light_mode = store.light_mode().unwrap_or_else(|error| {
                eprintln!("Brain Cache could not load its appearance preference: {error}");
                false
            });
            apply_light_mode(app.handle(), light_mode);
            let reminder_store = store.clone();
            app.manage(store);
            app.manage(CaptureWindowState::default());
            app.manage(ReminderOpenState::default());
            let notification_delegate = install_notification_delegate(app.handle());
            app.manage(notification_delegate);
            let reminder_app = app.handle().clone();
            thread::spawn(move || {
                reconcile_reminders_and_notify(reminder_app, reminder_store, "launch")
            });

            if let Err(error) = app.global_shortcut().register(capture_shortcut) {
                eprintln!("Brain Cache could not register Option+Space: {error}");
            }
            configure_tray(app)?;

            let arguments = std::env::args().collect::<Vec<_>>();
            if arguments.iter().any(|argument| argument == "--capture") {
                if let Some(window) = app.get_webview_window(LIBRARY_WINDOW_LABEL) {
                    window.hide()?;
                }
                reveal_capture(app.handle()).map_err(std::io::Error::other)?;
            } else if arguments.iter().any(|argument| argument == "--background") {
                if let Some(window) = app.get_webview_window(LIBRARY_WINDOW_LABEL) {
                    window.hide()?;
                }
            } else {
                reveal_library(app.handle()).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == LIBRARY_WINDOW_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                if matches!(event, tauri::WindowEvent::Focused(true)) {
                    let app = window.app_handle().clone();
                    let store = app.state::<ThoughtStore>().inner().clone();
                    thread::spawn(move || {
                        reconcile_reminders_and_notify(app, store, "library focus")
                    });
                }
            }
            if window.label() == CAPTURE_WINDOW_LABEL
                && matches!(event, tauri::WindowEvent::Focused(false))
            {
                schedule_capture_dismissal_check(window.clone());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Brain Cache")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if matches!(_event, tauri::RunEvent::Reopen { .. }) {
                if let Err(error) = reveal_library(_app) {
                    eprintln!("Brain Cache could not reopen the library: {error}");
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        application_menu_action, apply_capture_resize_frame_if_current, capture_placement,
        constrained_capture_height, ease_in_out, focus_capture_then_notify,
        hide_capture_if_still_unfocused, interpolate_dimension, nearest_rect_index,
        prepare_capture_reveal, show_capture_then_schedule_focus, ApplicationMenuAction, PixelRect,
        CAPTURE_WINDOW_RESTING_HEIGHT, CAPTURE_WINDOW_WIDTH,
    };
    use std::{
        cell::{Cell, RefCell},
        sync::atomic::{AtomicU64, Ordering},
    };
    use tauri::PhysicalPosition;

    #[test]
    fn application_menu_routes_only_owned_capture_commands() {
        assert_eq!(
            application_menu_action("capture-numbered-list"),
            Some(ApplicationMenuAction::CaptureCommand("numbered-list"))
        );
        assert_eq!(
            application_menu_action("capture-bulleted-list"),
            Some(ApplicationMenuAction::CaptureCommand("bulleted-list"))
        );
        assert_eq!(
            application_menu_action("capture-checklist"),
            Some(ApplicationMenuAction::CaptureCommand("checklist"))
        );
        assert_eq!(
            application_menu_action("capture-add-tags"),
            Some(ApplicationMenuAction::CaptureCommand("add-tags"))
        );
        assert_eq!(
            application_menu_action("capture-shortcut-drawer"),
            Some(ApplicationMenuAction::CaptureCommand("open-shortcuts"))
        );
        assert_eq!(
            application_menu_action("show-shortcut-button"),
            Some(ApplicationMenuAction::ShowShortcutButton)
        );
        assert_eq!(application_menu_action("quit"), None);
    }

    #[test]
    fn capture_geometry_is_compact_and_inset_from_the_usable_upper_left() {
        let placement = capture_placement(
            PixelRect {
                x: 0,
                y: 24,
                width: 1440,
                height: 876,
            },
            1.0,
            CAPTURE_WINDOW_RESTING_HEIGHT,
        );

        assert_eq!(CAPTURE_WINDOW_WIDTH, 488.0);
        assert_eq!(CAPTURE_WINDOW_RESTING_HEIGHT, 74.0);
        assert_eq!(placement.size.width, 488);
        assert_eq!(placement.size.height, 74);
        assert_eq!(placement.position, PhysicalPosition::new(16, 40));
    }

    #[test]
    fn capture_geometry_scales_on_a_negative_origin_display() {
        let placement = capture_placement(
            PixelRect {
                x: -3840,
                y: -120,
                width: 3840,
                height: 2048,
            },
            2.0,
            CAPTURE_WINDOW_RESTING_HEIGHT,
        );

        assert_eq!(placement.size.width, 976);
        assert_eq!(placement.size.height, 148);
        assert_eq!(placement.position, PhysicalPosition::new(-3808, -88));
    }

    #[test]
    fn capture_geometry_clamps_inside_a_small_offset_work_area() {
        let work_area = PixelRect {
            x: 1200,
            y: -900,
            width: 500,
            height: 200,
        };
        let placement = capture_placement(work_area, 1.0, CAPTURE_WINDOW_RESTING_HEIGHT);

        assert_eq!(placement.position, PhysicalPosition::new(1212, -884));
        assert!(placement.position.x >= work_area.x);
        assert!(placement.position.y >= work_area.y);
        assert!(
            i64::from(placement.position.x) + i64::from(placement.size.width)
                <= i64::from(work_area.x) + i64::from(work_area.width)
        );
        assert!(
            i64::from(placement.position.y) + i64::from(placement.size.height)
                <= i64::from(work_area.y) + i64::from(work_area.height)
        );
    }

    #[test]
    fn capture_geometry_anchors_at_the_usable_origin_when_the_frame_cannot_fit() {
        let placement = capture_placement(
            PixelRect {
                x: -200,
                y: 300,
                width: 320,
                height: 140,
            },
            1.0,
            CAPTURE_WINDOW_RESTING_HEIGHT,
        );

        assert_eq!(placement.size.width, 488);
        assert_eq!(placement.size.height, 74);
        assert_eq!(placement.position, PhysicalPosition::new(-200, 316));
    }

    #[test]
    fn invalid_scale_falls_back_to_one() {
        let placement = capture_placement(
            PixelRect {
                x: 100,
                y: 200,
                width: 1000,
                height: 800,
            },
            f64::NAN,
            CAPTURE_WINDOW_RESTING_HEIGHT,
        );

        assert_eq!(placement.size.width, 488);
        assert_eq!(placement.size.height, 74);
        assert_eq!(placement.position, PhysicalPosition::new(116, 216));
    }

    #[test]
    fn adaptive_height_grows_downward_from_the_existing_anchor() {
        let work_area = PixelRect {
            x: -1920,
            y: 24,
            width: 1920,
            height: 1056,
        };
        let resting = capture_placement(work_area, 1.0, CAPTURE_WINDOW_RESTING_HEIGHT);
        let expanded = capture_placement(work_area, 1.0, 254.0);

        assert_eq!(resting.position, PhysicalPosition::new(-1904, 40));
        assert_eq!(expanded.position, resting.position);
        assert_eq!(expanded.size.height, 254);
    }

    #[test]
    fn adaptive_height_stops_at_the_active_work_area_bottom_inset() {
        let result = constrained_capture_height(
            PixelRect {
                x: 1200,
                y: -900,
                width: 900,
                height: 300,
            },
            1.0,
            -884,
            500.0,
        );

        assert_eq!(result.applied_height, 268.0);
        assert_eq!(result.max_height, 268.0);
        assert!(result.constrained);
    }

    #[test]
    fn adaptive_height_constraint_respects_display_scale() {
        let result = constrained_capture_height(
            PixelRect {
                x: -3840,
                y: -120,
                width: 3840,
                height: 800,
            },
            2.0,
            -88,
            500.0,
        );

        assert_eq!(result.max_height, 368.0);
        assert_eq!(result.applied_height, 368.0);
        assert!(result.constrained);
    }

    #[test]
    fn resize_animation_reaches_exact_endpoints_within_the_motion_curve() {
        assert_eq!(ease_in_out(0.0), 0.0);
        assert_eq!(ease_in_out(1.0), 1.0);
        assert_eq!(interpolate_dimension(74, 254, ease_in_out(0.5)), 164);
        assert_eq!(interpolate_dimension(74, 254, ease_in_out(1.0)), 254);
    }

    #[test]
    fn superseded_queued_resize_frame_is_rejected_before_apply() {
        let animation_generation = AtomicU64::new(7);
        let worker_precheck_passed = animation_generation.load(Ordering::SeqCst) == 7;
        let frame_applied = Cell::new(false);

        animation_generation.store(8, Ordering::SeqCst);
        let accepted = apply_capture_resize_frame_if_current(&animation_generation, 7, || {
            frame_applied.set(true);
            Ok::<(), ()>(())
        })
        .expect("generation check should not fail");

        assert!(worker_precheck_passed);
        assert!(!accepted);
        assert!(!frame_applied.get());
    }

    #[test]
    fn nearest_display_fallback_handles_gaps_and_negative_origins() {
        let displays = [
            PixelRect {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1080,
            },
            PixelRect {
                x: 320,
                y: -1200,
                width: 2560,
                height: 1440,
            },
        ];

        assert_eq!(
            nearest_rect_index(PhysicalPosition::new(200.0, -400.0), &displays),
            Some(1)
        );
        assert_eq!(
            nearest_rect_index(PhysicalPosition::new(-40.0, 500.0), &displays),
            Some(0)
        );
        assert_eq!(
            nearest_rect_index(PhysicalPosition::new(0.0, 0.0), &[]),
            None
        );
    }

    #[test]
    fn reveal_stages_preserve_placement_show_focus_and_notification_order() {
        let steps = RefCell::new(Vec::new());

        prepare_capture_reveal(
            false,
            || {
                steps.borrow_mut().push("place");
                Ok::<(), &str>(())
            },
            || {
                steps.borrow_mut().push("schedule show");
                Ok(())
            },
        )
        .expect("reveal preparation should succeed");

        show_capture_then_schedule_focus(
            || {
                steps.borrow_mut().push("show");
                Ok::<(), &str>(())
            },
            || {
                steps.borrow_mut().push("schedule focus");
                Ok(())
            },
        )
        .expect("show stage should succeed");

        focus_capture_then_notify(
            || {
                steps.borrow_mut().push("focus");
                Ok::<(), &str>(())
            },
            || {
                steps.borrow_mut().push("emit focus");
                Ok(())
            },
        )
        .expect("focus stage should succeed");

        assert_eq!(
            steps.into_inner(),
            vec![
                "place",
                "schedule show",
                "show",
                "schedule focus",
                "focus",
                "emit focus"
            ]
        );
    }

    #[test]
    fn reveal_preparation_keeps_matching_geometry_visible_and_only_schedules_show() {
        let steps = RefCell::new(Vec::new());

        prepare_capture_reveal(
            true,
            || {
                steps.borrow_mut().push("place");
                Ok::<(), &str>(())
            },
            || {
                steps.borrow_mut().push("schedule show");
                Ok(())
            },
        )
        .expect("matching geometry should activate without mutation");

        assert_eq!(steps.into_inner(), vec!["schedule show"]);
    }

    #[test]
    fn reveal_preparation_does_not_schedule_when_placement_fails() {
        let steps = RefCell::new(Vec::new());

        let result = prepare_capture_reveal(
            false,
            || {
                steps.borrow_mut().push("place");
                Err("placement failed")
            },
            || {
                steps.borrow_mut().push("schedule show");
                Ok(())
            },
        );

        assert_eq!(result, Err("placement failed"));
        assert_eq!(steps.into_inner(), vec!["place"]);
    }

    #[test]
    fn show_failure_does_not_schedule_focus() {
        let steps = RefCell::new(Vec::new());

        let result = show_capture_then_schedule_focus(
            || {
                steps.borrow_mut().push("show");
                Err("show failed")
            },
            || {
                steps.borrow_mut().push("schedule focus");
                Ok(())
            },
        );

        assert_eq!(result, Err("show failed"));
        assert_eq!(steps.into_inner(), vec!["show"]);
    }

    #[test]
    fn focus_failure_does_not_emit_focus_notification() {
        let steps = RefCell::new(Vec::new());

        let result = focus_capture_then_notify(
            || {
                steps.borrow_mut().push("focus");
                Err("focus failed")
            },
            || {
                steps.borrow_mut().push("emit focus");
                Ok(())
            },
        );

        assert_eq!(result, Err("focus failed"));
        assert_eq!(steps.into_inner(), vec!["focus"]);
    }

    #[test]
    fn deferred_focus_loss_keeps_capture_when_focus_has_returned() {
        let steps = RefCell::new(Vec::new());

        let did_hide = hide_capture_if_still_unfocused(
            || {
                steps.borrow_mut().push("check focus");
                Ok::<bool, &str>(true)
            },
            || {
                steps.borrow_mut().push("hide");
                Ok(())
            },
        )
        .expect("a successful focus check should resolve dismissal");

        assert!(!did_hide);
        assert_eq!(steps.into_inner(), vec!["check focus"]);
    }

    #[test]
    fn deferred_focus_loss_hides_capture_when_it_remains_unfocused() {
        let steps = RefCell::new(Vec::new());

        let did_hide = hide_capture_if_still_unfocused(
            || {
                steps.borrow_mut().push("check focus");
                Ok::<bool, &str>(false)
            },
            || {
                steps.borrow_mut().push("hide");
                Ok(())
            },
        )
        .expect("an unfocused capture should be dismissed");

        assert!(did_hide);
        assert_eq!(steps.into_inner(), vec!["check focus", "hide"]);
    }

    #[test]
    fn deferred_focus_loss_does_not_hide_when_the_focus_check_fails() {
        let steps = RefCell::new(Vec::new());

        let result = hide_capture_if_still_unfocused(
            || {
                steps.borrow_mut().push("check focus");
                Err("focus check failed")
            },
            || {
                steps.borrow_mut().push("hide");
                Ok(())
            },
        );

        assert_eq!(result, Err("focus check failed"));
        assert_eq!(steps.into_inner(), vec!["check focus"]);
    }
}
