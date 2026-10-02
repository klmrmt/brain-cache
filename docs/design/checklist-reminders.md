# Checklist Reminder Detail

## Product surface

Reminders belong to checklist items inside Focus Lens and Canvas Drill-In. Quick capture stays exactly as fast as ordinary capture: it never shows reminder controls and never asks for notification permission.

## Interaction

- Each incomplete item has a quiet `remind` action beside its move/remove controls.
- Activating it reveals one compact inline row beneath that item with a local date/time field, the current system time-zone label, and `set reminder` / `cancel` actions.
- The field defaults to the next whole hour. Editing an existing reminder preloads its current local date and time.
- Saving persists the intended absolute instant locally first. The row then reports `scheduling…`, `reminds …`, `overdue since …`, `notifications off`, or the exact scheduling failure.
- `notifications off` includes an `open settings` recovery action. Scheduling failures keep a `retry` action that reopens the same editor.
- Completing or removing an item, clearing its reminder, or archiving the thought removes the reminder from the visible item immediately while native cancellation reconciles.
- Selecting a delivered notification opens Focus Lens for its thought and moves keyboard focus to the identified checklist item.

## Visual treatment

- The reminder row is part of the checklist item, separated only by spacing and a fine left rule; it is not a card inside a card.
- Muted text and borders carry the default and upcoming states. Amber is limited to the small clock marker because the reminder is an attention signal.
- Successful persistence uses Saved green, permission and scheduling failures use Error red, and overdue text uses amber without filled warning panels.
- Controls remain compact on the 4 pt grid and preserve visible keyboard focus.

## Time behavior

The browser converts the selected local wall time to a UTC ISO instant before crossing the bridge. A nonexistent daylight-saving time is rejected. An ambiguous repeated hour follows the operating system/browser's earlier occurrence. Once saved, the reminder remains tied to that absolute instant even if the Mac changes time zones.

## Privacy

The notification body contains the checklist item text so it is useful when delivered. Brain Cache does not add its own preview preference; macOS Notification Settings control whether that body appears on a locked screen or in previews.
