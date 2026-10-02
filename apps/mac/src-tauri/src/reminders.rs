use std::{
    collections::BTreeSet,
    ptr::NonNull,
    sync::{mpsc, Mutex},
    time::Duration,
};

use block2::RcBlock;
use chrono::{DateTime, Utc};
use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, AnyThread, DefinedClass,
};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSString, NSURL};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNErrorCode, UNErrorDomain,
    UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSound,
    UNTimeIntervalNotificationTrigger, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::storage::{ReminderRecord, ThoughtStore};

const REQUEST_PREFIX: &str = "brain-cache";
const NOTIFICATIONS_OFF_MESSAGE: &str = "Notifications are off for Brain Cache in macOS Settings.";
const UNBUNDLED_NOTIFICATIONS_MESSAGE: &str =
    "Reminders are unavailable outside the Brain Cache application bundle. Build and open Brain Cache.app to use macOS notifications.";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(120);
static RECONCILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderTarget {
    pub thought_id: String,
    pub item_id: Option<String>,
}

#[derive(Default)]
pub struct ReminderOpenState(pub Mutex<Option<ReminderTarget>>);

pub struct NotificationDelegateState {
    _delegate: Option<Retained<NotificationDelegate>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PermissionStatus {
    NotDetermined,
    Denied,
    Authorized,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum SchedulingError {
    NotificationsNotAllowed,
    Other(String),
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and AppHandle is Send + Sync.
    #[unsafe(super = NSObject)]
    #[thread_kind = AnyThread]
    #[ivars = AppHandle]
    struct NotificationDelegate;

    // SAFETY: NSObjectProtocol has no additional safety requirements.
    unsafe impl NSObjectProtocol for NotificationDelegate {}

    // SAFETY: The method signatures match UNUserNotificationCenterDelegate.
    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let identifier = response.notification().request().identifier().to_string();
            if let Some(target) = parse_request_identifier(&identifier) {
                let app = self.ivars().clone();
                if let Ok(mut pending) = app.state::<ReminderOpenState>().0.lock() {
                    *pending = Some(target.clone());
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("reminder-opened", target);
                }
            }
            completion_handler.call(());
        }
    }
);

impl NotificationDelegate {
    fn new(app: AppHandle) -> Retained<Self> {
        let this = Self::alloc().set_ivars(app);
        // SAFETY: This invokes NSObject's designated initializer for the new subclass.
        unsafe { msg_send![super(this), init] }
    }
}

// UserNotifications raises an Objective-C exception for an unbundled executable.
// Check the actual host bundle before calling it, including in debug builds: a
// bundled debug app can use notifications, while an embedded identifier alone
// does not make the executable launched by `tauri dev` an application bundle.
fn notification_center_for_bundle<T>(
    bundle_extension: Option<&str>,
    bundle_identifier: Option<&str>,
    create_center: impl FnOnce() -> T,
) -> Result<T, String> {
    if bundle_extension != Some("app")
        || !bundle_identifier.is_some_and(|identifier| !identifier.trim().is_empty())
    {
        return Err(UNBUNDLED_NOTIFICATIONS_MESSAGE.into());
    }
    Ok(create_center())
}

fn notification_center() -> Result<Retained<UNUserNotificationCenter>, String> {
    let bundle = NSBundle::mainBundle();
    let extension = bundle
        .bundleURL()
        .pathExtension()
        .map(|value| value.to_string());
    let identifier = bundle.bundleIdentifier().map(|value| value.to_string());
    notification_center_for_bundle(
        extension.as_deref(),
        identifier.as_deref(),
        UNUserNotificationCenter::currentNotificationCenter,
    )
}

pub fn install_notification_delegate(app: &AppHandle) -> NotificationDelegateState {
    let Ok(center) = notification_center() else {
        return NotificationDelegateState { _delegate: None };
    };
    let delegate = NotificationDelegate::new(app.clone());
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    NotificationDelegateState {
        _delegate: Some(delegate),
    }
}

pub fn take_pending_target(state: &ReminderOpenState) -> Result<Option<ReminderTarget>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Brain Cache could not read the pending reminder target.".to_string())
        .map(|mut target| target.take())
}

pub fn open_notification_settings() -> Result<(), String> {
    let value =
        NSString::from_str("x-apple.systempreferences:com.apple.Notifications-Settings.extension");
    let url = NSURL::URLWithString(&value)
        .ok_or_else(|| "Brain Cache could not form the macOS Settings link.".to_string())?;
    if NSWorkspace::sharedWorkspace().openURL(&url) {
        Ok(())
    } else {
        Err("macOS could not open Notification Settings.".into())
    }
}

pub fn reconcile(store: &ThoughtStore, request_permission: bool) -> Result<(), String> {
    let _guard = RECONCILE_LOCK
        .lock()
        .map_err(|_| "Brain Cache could not lock reminder reconciliation.".to_string())?;
    let center = notification_center()?;
    let records = store.list_reminder_records()?;
    let pending = pending_request_identifiers(&center)?;
    let desired = records
        .iter()
        .filter(|record| record.state != "cancel-pending")
        .filter_map(|record| request_identifier(record).ok())
        .collect::<BTreeSet<_>>();

    for identifier in pending.iter().filter(|identifier| {
        is_brain_cache_identifier(identifier) && !desired.contains(*identifier)
    }) {
        remove_request(&center, identifier);
    }
    for record in records
        .iter()
        .filter(|record| record.state == "cancel-pending")
    {
        remove_requests_for_item(&center, &pending, record);
        store.finish_reminder_cancellation(&record.thought_id, record.item_id.as_deref())?;
    }

    let mut permission = current_permission(&center)?;
    if permission == PermissionStatus::NotDetermined && request_permission {
        permission = request_authorization(&center)?;
    }

    let active = records
        .iter()
        .filter(|record| record.state != "cancel-pending")
        .collect::<Vec<_>>();
    match permission {
        PermissionStatus::NotDetermined => return Ok(()),
        PermissionStatus::Denied => {
            for identifier in pending
                .iter()
                .filter(|identifier| is_brain_cache_identifier(identifier))
            {
                remove_request(&center, identifier);
            }
            for record in active {
                store.set_reminder_result_if_current(
                    record,
                    "permission-denied",
                    Some(NOTIFICATIONS_OFF_MESSAGE),
                )?;
            }
            return Ok(());
        }
        PermissionStatus::Authorized => {}
    }

    for record in active {
        let identifier = match request_identifier(record) {
            Ok(identifier) => identifier,
            Err(error) => {
                store.set_reminder_result_if_current(record, "scheduling-failed", Some(&error))?;
                continue;
            }
        };
        let scheduled = DateTime::parse_from_rfc3339(&record.scheduled_for)
            .map_err(|_| "The stored reminder time is invalid.".to_string())?
            .with_timezone(&Utc);
        if scheduled <= Utc::now() {
            if record.state != "scheduled" {
                store.set_reminder_result_if_current(
                    record,
                    "scheduling-failed",
                    Some("The reminder time passed before macOS accepted it."),
                )?;
            }
            continue;
        }
        if record.state == "scheduled" && pending.contains(&identifier) {
            continue;
        }
        match add_request(&center, record, &identifier) {
            Ok(()) => {
                if !store.set_reminder_result_if_current(record, "scheduled", None)? {
                    remove_request(&center, &identifier);
                }
            }
            Err(error) => {
                let latest_permission =
                    current_permission(&center).unwrap_or(PermissionStatus::Authorized);
                let (state, message) = scheduling_failure(latest_permission, error);
                store.set_reminder_result_if_current(record, state, Some(&message))?;
            }
        }
    }
    Ok(())
}

fn current_permission(center: &UNUserNotificationCenter) -> Result<PermissionStatus, String> {
    let (sender, receiver) = mpsc::channel();
    let completion = RcBlock::new(
        move |settings: NonNull<objc2_user_notifications::UNNotificationSettings>| {
            // SAFETY: UserNotifications guarantees a live settings object for the callback duration.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            let _ = sender.send(permission_status(status));
        },
    );
    center.getNotificationSettingsWithCompletionHandler(&completion);
    receiver
        .recv_timeout(CALLBACK_TIMEOUT)
        .map_err(|_| "macOS did not return notification settings.".to_string())
}

fn request_authorization(center: &UNUserNotificationCenter) -> Result<PermissionStatus, String> {
    let (sender, receiver) = mpsc::channel();
    let completion = RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
        let scheduling_error = (!error.is_null()).then(|| scheduling_error(error));
        let result = authorization_result(granted.as_bool(), scheduling_error);
        let _ = sender.send(result);
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &completion,
    );
    receiver
        .recv_timeout(CALLBACK_TIMEOUT)
        .map_err(|_| "macOS did not finish the notification permission request.".to_string())?
}

fn authorization_result(
    granted: bool,
    error: Option<SchedulingError>,
) -> Result<PermissionStatus, String> {
    match error {
        Some(SchedulingError::NotificationsNotAllowed) => Ok(PermissionStatus::Denied),
        Some(SchedulingError::Other(message)) => Err(message),
        None if granted => Ok(PermissionStatus::Authorized),
        None => Ok(PermissionStatus::Denied),
    }
}

fn pending_request_identifiers(
    center: &UNUserNotificationCenter,
) -> Result<BTreeSet<String>, String> {
    let (sender, receiver) = mpsc::channel();
    let completion = RcBlock::new(move |requests: NonNull<NSArray<UNNotificationRequest>>| {
        // SAFETY: UserNotifications guarantees a live array for the callback duration.
        let identifiers = unsafe { requests.as_ref() }
            .to_vec()
            .into_iter()
            .map(|request| request.identifier().to_string())
            .collect();
        let _ = sender.send(identifiers);
    });
    center.getPendingNotificationRequestsWithCompletionHandler(&completion);
    receiver
        .recv_timeout(CALLBACK_TIMEOUT)
        .map_err(|_| "macOS did not return pending notifications.".to_string())
}

fn add_request(
    center: &UNUserNotificationCenter,
    record: &ReminderRecord,
    identifier: &str,
) -> Result<(), SchedulingError> {
    let scheduled = DateTime::parse_from_rfc3339(&record.scheduled_for)
        .map_err(|_| SchedulingError::Other("The stored reminder time is invalid.".into()))?
        .with_timezone(&Utc);
    let interval = (scheduled - Utc::now()).num_milliseconds() as f64 / 1_000.0;
    if interval <= 0.0 {
        return Err(SchedulingError::Other(
            "The reminder time passed before macOS accepted it.".into(),
        ));
    }

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str("Brain Cache"));
    content.setBody(&NSString::from_str(&record.item_text));
    content.setThreadIdentifier(&NSString::from_str(&record.thought_id));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let trigger = UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(
        interval.max(1.0),
        false,
    );
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(identifier),
        &content,
        Some(&trigger),
    );
    let (sender, receiver) = mpsc::channel();
    let completion = RcBlock::new(move |error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            Err(scheduling_error(error))
        };
        let _ = sender.send(result);
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&completion));
    receiver.recv_timeout(CALLBACK_TIMEOUT).map_err(|_| {
        SchedulingError::Other("macOS did not finish scheduling the reminder.".to_string())
    })?
}

fn remove_requests_for_item(
    center: &UNUserNotificationCenter,
    pending: &BTreeSet<String>,
    record: &ReminderRecord,
) {
    // A delivered request is no longer in the pending list but still needs clearing.
    if let Ok(identifier) = request_identifier(record) {
        remove_request(center, &identifier);
    }
    let prefix = request_identifier_prefix(&record.thought_id, record.item_id.as_deref());
    for identifier in pending
        .iter()
        .filter(|identifier| identifier.starts_with(&prefix))
    {
        remove_request(center, identifier);
    }
}

fn remove_request(center: &UNUserNotificationCenter, identifier: &str) {
    let identifier = NSString::from_str(identifier);
    let identifiers = NSArray::arrayWithObject(&*identifier);
    center.removePendingNotificationRequestsWithIdentifiers(&identifiers);
    center.removeDeliveredNotificationsWithIdentifiers(&identifiers);
}

fn permission_status(status: UNAuthorizationStatus) -> PermissionStatus {
    match status {
        UNAuthorizationStatus::Denied => PermissionStatus::Denied,
        UNAuthorizationStatus::Authorized
        | UNAuthorizationStatus::Provisional
        | UNAuthorizationStatus::Ephemeral => PermissionStatus::Authorized,
        _ => PermissionStatus::NotDetermined,
    }
}

fn scheduling_failure(
    permission: PermissionStatus,
    error: SchedulingError,
) -> (&'static str, String) {
    if permission == PermissionStatus::Denied || error == SchedulingError::NotificationsNotAllowed {
        ("permission-denied", NOTIFICATIONS_OFF_MESSAGE.into())
    } else {
        let SchedulingError::Other(message) = error else {
            unreachable!("notification denial is handled above")
        };
        ("scheduling-failed", message)
    }
}

fn request_identifier(record: &ReminderRecord) -> Result<String, String> {
    let instant = DateTime::parse_from_rfc3339(&record.scheduled_for)
        .map_err(|_| "The stored reminder time is invalid.".to_string())?;
    Ok(format!(
        "{}{}",
        request_identifier_prefix(&record.thought_id, record.item_id.as_deref()),
        instant.timestamp_millis()
    ))
}

fn request_identifier_prefix(thought_id: &str, item_id: Option<&str>) -> String {
    match item_id {
        Some(item_id) => format!("{REQUEST_PREFIX}|{thought_id}|{item_id}|"),
        None => format!("brain-cache-note|{thought_id}|"),
    }
}

fn parse_request_identifier(identifier: &str) -> Option<ReminderTarget> {
    let mut parts = identifier.split('|');
    let prefix = parts.next()?;
    if prefix != REQUEST_PREFIX && prefix != "brain-cache-note" { return None; }
    let thought_id = parts.next()?.to_string();
    let item_id = if prefix == REQUEST_PREFIX {
        let id = parts.next()?;
        if id.is_empty() { return None; }
        Some(id.to_string())
    } else { None };
    parts.next()?.parse::<i64>().ok()?;
    if thought_id.is_empty() || parts.next().is_some() { return None; }
    Some(ReminderTarget {
        thought_id,
        item_id,
    })
}

fn is_brain_cache_identifier(identifier: &str) -> bool {
    parse_request_identifier(identifier).is_some()
}

fn scheduling_error(error: *mut NSError) -> SchedulingError {
    // SAFETY: Callers check for null, and the callback owns the NSError for its duration.
    let Some(error) = (unsafe { error.as_ref() }) else {
        return SchedulingError::Other("macOS rejected the notification request.".into());
    };
    // SAFETY: UNErrorDomain is an immutable framework constant available on supported macOS versions.
    let is_user_notifications_error =
        unsafe { UNErrorDomain }.is_some_and(|domain| error.domain().isEqualToString(domain));
    if is_user_notifications_error && error.code() == UNErrorCode::NotificationsNotAllowed.0 {
        SchedulingError::NotificationsNotAllowed
    } else {
        SchedulingError::Other(error.localizedDescription().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(scheduled_for: &str) -> ReminderRecord {
        ReminderRecord {
            item_id: Some("item-id".into()),
            thought_id: "thought-id".into(),
            item_text: "Call Sam".into(),
            scheduled_for: scheduled_for.into(),
            state: "pending".into(),
            last_error: None,
        }
    }

    #[test]
    fn unbundled_hosts_never_initialize_the_notification_framework() {
        for (extension, identifier) in [
            (None, None),
            (Some("debug"), Some("com.braincache.desktop")),
            (None, Some("com.braincache.desktop")),
            (Some("app"), None),
            (Some("app"), Some(" ")),
        ] {
            let result = notification_center_for_bundle(extension, identifier, || {
                panic!("An unsupported host must not call UserNotifications")
            });
            assert_eq!(result, Err::<(), _>(UNBUNDLED_NOTIFICATIONS_MESSAGE.into()));
        }
    }

    #[test]
    fn application_bundles_initialize_notifications_even_with_an_isolated_identifier() {
        let calls = std::cell::Cell::new(0);
        let center = notification_center_for_bundle(
            Some("app"),
            Some("com.braincache.releasecheck"),
            || {
                calls.set(calls.get() + 1);
                "notification center"
            },
        );
        assert_eq!(center, Ok("notification center"));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn unbundled_reconciliation_keeps_durable_reminder_intent_and_reports_unavailable() {
        let directory = std::env::temp_dir().join(format!(
            "brain-cache-reminder-host-{}",
            uuid::Uuid::new_v4()
        ));
        let store = ThoughtStore::open(directory.join("thoughts.sqlite3")).unwrap();
        let thought = store
            .capture("Synthetic reminder", "mac-library", &[])
            .unwrap();
        store
            .set_thought_reminder_intent(&thought.id, "2099-03-04T15:30:00Z")
            .unwrap();
        let before = store.list_reminder_records().unwrap();
        // Cargo's test process is unbundled, exercising the real NSBundle guard
        // without touching the crash-prone notification center API.
        assert_eq!(
            reconcile(&store, true),
            Err(UNBUNDLED_NOTIFICATIONS_MESSAGE.into())
        );
        assert_eq!(store.list_reminder_records().unwrap(), before);
        assert_eq!(
            store.get(&thought.id).unwrap().reminder.unwrap().state,
            "pending"
        );
        drop(store);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn request_identifiers_are_stable_for_an_absolute_instant() {
        let utc = request_identifier(&record("2099-03-04T15:30:00Z")).unwrap();
        let offset = request_identifier(&record("2099-03-04T09:30:00-06:00")).unwrap();
        assert_eq!(utc, offset);
        assert_eq!(
            parse_request_identifier(&utc),
            Some(ReminderTarget {
                thought_id: "thought-id".into(),
                item_id: Some("item-id".into()),
            })
        );
    }

    #[test]
    fn note_notification_targets_are_distinct_from_checklist_targets() {
        let mut note = record("2099-03-04T15:30:00Z");
        let checklist_identifier = request_identifier(&note).unwrap();
        note.item_id = None;
        let identifier = request_identifier(&note).unwrap();
        assert_ne!(identifier, checklist_identifier);
        assert_eq!(parse_request_identifier(&identifier), Some(ReminderTarget {
            thought_id: "thought-id".into(), item_id: None,
        }));
        assert!(is_brain_cache_identifier(&identifier));
        for invalid in ["brain-cache-note||1", "brain-cache-note|note|later", "brain-cache-note|note|1|extra"] {
            assert!(parse_request_identifier(invalid).is_none());
        }
    }

    #[test]
    fn unrelated_or_malformed_notification_ids_are_ignored() {
        assert!(parse_request_identifier("another-app|thought|item|1").is_none());
        assert!(parse_request_identifier("brain-cache|thought|item").is_none());
        assert!(parse_request_identifier("brain-cache||item|1").is_none());
        assert!(parse_request_identifier("brain-cache|thought|item|later").is_none());
        assert!(parse_request_identifier("brain-cache|thought|item|1|extra").is_none());
    }

    #[test]
    fn scheduler_rejection_after_permission_denial_uses_recovery_state() {
        assert_eq!(
            scheduling_failure(
                PermissionStatus::Denied,
                SchedulingError::Other("Notifications are not allowed for this application".into()),
            ),
            ("permission-denied", NOTIFICATIONS_OFF_MESSAGE.into())
        );
        assert_eq!(
            scheduling_failure(
                PermissionStatus::Authorized,
                SchedulingError::NotificationsNotAllowed,
            ),
            ("permission-denied", NOTIFICATIONS_OFF_MESSAGE.into())
        );
        assert_eq!(
            scheduling_failure(
                PermissionStatus::Authorized,
                SchedulingError::Other("Scheduling failed".into()),
            ),
            ("scheduling-failed", "Scheduling failed".into())
        );
        assert_eq!(
            authorization_result(false, Some(SchedulingError::NotificationsNotAllowed)),
            Ok(PermissionStatus::Denied)
        );
    }

    #[test]
    fn authorization_results_cover_granted_denied_and_adapter_error_paths() {
        assert_eq!(
            authorization_result(true, None),
            Ok(PermissionStatus::Authorized)
        );
        assert_eq!(
            authorization_result(false, None),
            Ok(PermissionStatus::Denied)
        );
        assert_eq!(
            authorization_result(
                false,
                Some(SchedulingError::Other(
                    "Authorization callback failed".into()
                )),
            ),
            Err("Authorization callback failed".into())
        );
    }

    #[test]
    fn macos_authorization_statuses_map_to_the_three_internal_states() {
        assert_eq!(
            permission_status(UNAuthorizationStatus::NotDetermined),
            PermissionStatus::NotDetermined
        );
        assert_eq!(
            permission_status(UNAuthorizationStatus::Denied),
            PermissionStatus::Denied
        );
        for status in [
            UNAuthorizationStatus::Authorized,
            UNAuthorizationStatus::Provisional,
            UNAuthorizationStatus::Ephemeral,
        ] {
            assert_eq!(permission_status(status), PermissionStatus::Authorized);
        }
    }
}
