import { reminderStatus, nextHourValue, localDateTimeValue, reminderIsoFromLocalValue } from "./reminderTime";
export { reminderIsoFromLocalValue } from "./reminderTime";
import { useEffect, useRef, useState, type RefObject } from "react";
import { normalizeChecklistItemText } from "./domain";
import type { ChecklistItem } from "./types";
import { ChecklistProgress } from "./ChecklistProgress";

interface ChecklistEditorProps {
  items: ChecklistItem[];
  newItem: string;
  onNewItemChange: (text: string) => void;
  onAddItem: () => Promise<void>;
  onChange: (items: ChecklistItem[]) => Promise<void>;
  onSetReminder: (itemId: string, scheduledFor: string) => Promise<void>;
  onClearReminder: (itemId: string) => Promise<void>;
  onOpenNotificationSettings: () => Promise<void>;
  primaryInputRef?: RefObject<HTMLInputElement | null>;
  focusItemId?: string | null;
}

export function ChecklistEditor({
  items,
  newItem,
  onNewItemChange,
  onAddItem,
  onChange,
  onSetReminder,
  onClearReminder,
  onOpenNotificationSettings,
  primaryInputRef,
  focusItemId,
}: ChecklistEditorProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminderEditorId, setReminderEditorId] = useState<string | null>(null);
  const [reminderDraft, setReminderDraft] = useState("");
  const [reminderPending, setReminderPending] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<{
    itemId: string;
    message: string;
  } | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const itemInputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (!focusItemId) return;
    requestAnimationFrame(() => {
      const input = itemInputRefs.current.get(focusItemId);
      input?.focus();
      input?.scrollIntoView?.({ block: "center" });
    });
  }, [focusItemId]);

  async function persist(label: string, nextItems: ChecklistItem[]) {
    setPending(label);
    setError(null);
    try {
      await onChange(nextItems);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update that checklist.");
      return false;
    } finally {
      setPending(null);
    }
  }

  async function addItem() {
    if (pending || reminderPending) return;
    try {
      normalizeChecklistItemText(newItem);
      setPending("add");
      setError(null);
      await onAddItem();
      requestAnimationFrame(() => addInputRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that checklist item.");
    } finally {
      setPending(null);
    }
  }

  function editReminder(item: ChecklistItem) {
    setReminderEditorId(item.id);
    setReminderDraft(
      item.reminder ? localDateTimeValue(new Date(item.reminder.scheduledFor)) : nextHourValue(),
    );
    setReminderError(null);
  }

  async function saveReminder(item: ChecklistItem) {
    let scheduledFor: string;
    try {
      scheduledFor = reminderIsoFromLocalValue(reminderDraft);
    } catch (cause) {
      setReminderError({
        itemId: item.id,
        message: cause instanceof Error ? cause.message : "Choose a valid reminder date and time.",
      });
      return;
    }
    setReminderPending(item.id);
    setReminderError(null);
    try {
      await onSetReminder(item.id, scheduledFor);
      setReminderEditorId(null);
    } catch (cause) {
      setReminderError({
        itemId: item.id,
        message: cause instanceof Error ? cause.message : "Could not schedule that reminder.",
      });
    } finally {
      setReminderPending(null);
    }
  }

  async function clearReminder(item: ChecklistItem) {
    setReminderPending(item.id);
    setReminderError(null);
    try {
      await onClearReminder(item.id);
      setReminderEditorId(null);
    } catch (cause) {
      setReminderError({
        itemId: item.id,
        message: cause instanceof Error ? cause.message : "Could not clear that reminder.",
      });
    } finally {
      setReminderPending(null);
    }
  }

  async function openNotificationSettingsForItem(item: ChecklistItem) {
    setReminderPending(item.id);
    setReminderError(null);
    try {
      await onOpenNotificationSettings();
    } catch (cause) {
      setReminderError({
        itemId: item.id,
        message:
          cause instanceof Error ? cause.message : "Could not open macOS Notification Settings.",
      });
    } finally {
      setReminderPending(null);
    }
  }

  return (
    <section className="checklist-editor" aria-label="Checklist items" aria-busy={Boolean(pending)}>
      <div className="checklist-editor__heading">
        <p className="eyebrow">checklist</p>
        <ChecklistProgress items={items} newItem={newItem} />
      </div>
      <ol className="checklist-editor__items">
        {items.map((item, index) => (
          <li className={item.completed ? "checklist-editor__item is-complete" : "checklist-editor__item"} key={item.id}>
            <input
              type="checkbox"
              aria-label={`Mark ${item.text} ${item.completed ? "incomplete" : "complete"}`}
              checked={item.completed}
              disabled={Boolean(pending) || Boolean(reminderPending)}
              onChange={() =>
                void persist(
                  `complete-${item.id}`,
                  items.map((candidate) =>
                    candidate.id === item.id
                      ? { ...candidate, completed: !candidate.completed }
                      : candidate,
                  ),
                )
              }
            />
            <input
              ref={(node) => {
                if (node) itemInputRefs.current.set(item.id, node);
                else itemInputRefs.current.delete(item.id);
                if (index === 0 && primaryInputRef) primaryInputRef.current = node;
              }}
              className="checklist-editor__text"
              aria-label={`Checklist item ${index + 1}`}
              value={item.text}
              disabled={Boolean(reminderPending)}
              onChange={(event) => {
                const text = event.target.value;
                setError(null);
                void onChange(items.map((candidate) => candidate.id === item.id
                  ? { ...candidate, text } : candidate)).catch(() => undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (itemInputRefs.current.get(items[index + 1]?.id) ?? addInputRef.current)?.focus();
                }
              }}
            />
            <div className="checklist-editor__actions">
              {!item.completed && (
                <button
                  type="button"
                  className={item.reminder ? "checklist-editor__remind is-active" : "checklist-editor__remind"}
                  aria-label={`${item.reminder ? "Edit" : "Set"} reminder for ${item.text}`}
                  aria-expanded={reminderEditorId === item.id}
                  disabled={Boolean(pending) || Boolean(reminderPending)}
                  onClick={() =>
                    reminderEditorId === item.id ? setReminderEditorId(null) : editReminder(item)
                  }
                >
                  ◷
                </button>
              )}
              <button
                type="button"
                aria-label={`Move ${item.text} up`}
                disabled={Boolean(pending) || Boolean(reminderPending) || index === 0}
                onClick={() => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  void persist(`move-${item.id}`, next);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${item.text} down`}
                disabled={Boolean(pending) || Boolean(reminderPending) || index === items.length - 1}
                onClick={() => {
                  const next = [...items];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  void persist(`move-${item.id}`, next);
                }}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                disabled={Boolean(pending) || Boolean(reminderPending) || items.length === 1}
                onClick={() => void persist(`remove-${item.id}`, items.filter((candidate) => candidate.id !== item.id))}
              >
                ×
              </button>
            </div>
            {item.reminder && !item.completed && (
              <div className={`checklist-editor__reminder-state checklist-editor__reminder-state--${item.reminder.state}`}>
                <span>{reminderStatus(item.reminder)}</span>
                {item.reminder.state === "permission-denied" && (
                  <button
                    type="button"
                    disabled={Boolean(reminderPending)}
                    onClick={() => void openNotificationSettingsForItem(item)}
                  >
                    open settings
                  </button>
                )}
                {item.reminder.state === "scheduling-failed" && (
                  <button type="button" onClick={() => editReminder(item)}>
                    retry
                  </button>
                )}
                <button
                  type="button"
                  disabled={Boolean(reminderPending)}
                  onClick={() => void clearReminder(item)}
                >
                  clear
                </button>
                {reminderError?.itemId === item.id && reminderEditorId !== item.id && (
                  <span className="checklist-editor__reminder-error" role="alert">
                    {reminderError.message}
                  </span>
                )}
              </div>
            )}
            {reminderEditorId === item.id && !item.completed && (
              <div className="checklist-editor__reminder-editor">
                <label>
                  <span>local date &amp; time</span>
                  <input
                    type="datetime-local"
                    aria-label={`Reminder date and time for ${item.text}`}
                    value={reminderDraft}
                    min={localDateTimeValue(new Date())}
                    disabled={Boolean(reminderPending)}
                    onChange={(event) => {
                      setReminderDraft(event.target.value);
                      setReminderError(null);
                    }}
                  />
                </label>
                <span className="checklist-editor__timezone">
                  {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll("_", " ")}
                </span>
                <button
                  type="button"
                  className="primary-button"
                  disabled={Boolean(reminderPending)}
                  onClick={() => void saveReminder(item)}
                >
                  {reminderPending === item.id
                    ? "scheduling…"
                    : item.reminder
                      ? "update reminder"
                      : "set reminder"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(reminderPending)}
                  onClick={() => {
                    setReminderEditorId(null);
                    setReminderError(null);
                  }}
                >
                  cancel
                </button>
                {reminderError?.itemId === item.id && (
                  <span className="checklist-editor__reminder-error" role="alert">
                    {reminderError.message}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="checklist-editor__add">
        <label className="visually-hidden" htmlFor="new-checklist-item">
          Add checklist item
        </label>
        <input
          id="new-checklist-item"
          ref={addInputRef}
          aria-label="Add checklist item"
          value={newItem}
          placeholder="add an item"
          disabled={Boolean(pending) || Boolean(reminderPending)}
          onChange={(event) => {
            onNewItemChange(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void addItem();
            }
          }}
        />
        <button type="button" disabled={Boolean(pending) || Boolean(reminderPending)} onClick={() => void addItem()}>
          add
        </button>
      </div>
      {error && <span className="checklist-editor__status" role="alert">{error}</span>}
    </section>
  );
}
