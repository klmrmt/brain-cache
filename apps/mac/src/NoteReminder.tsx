import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./NoteReminder.css";
import type { ChecklistReminder } from "./types";
import { localDateTimeValue, nextHourValue, reminderIsoFromLocalValue, reminderStatus } from "./reminderTime";

interface Props {
  label?: "note" | "item";
  compact?: boolean;
  reminder: ChecklistReminder | null;
  onSet: (scheduledFor: string) => Promise<void>;
  onClear: () => Promise<void>;
  onOpenSettings: () => Promise<void>;
}

export function NoteReminder(props: Props) {
  return props.compact ? <CompactNoteReminder {...props} /> : <FullNoteReminder {...props} />;
}

function CompactNoteReminder({ reminder, onSet, onClear, onOpenSettings, label = "note" }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const id = useId();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const failed = reminder?.state === "permission-denied" || reminder?.state === "scheduling-failed";
  const time = reminder ? new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(reminder.scheduledFor)) : "remind me";
  const status = error ? "needs attention" : reminder?.state === "permission-denied" ? "notifications off"
    : reminder?.state === "scheduling-failed" ? "retry needed" : reminder?.state === "overdue" ? "overdue"
      : pending || reminder?.state === "pending" ? "scheduling…" : null;

  function edit() {
    // Retain the attempted value and error after dismissing a failed operation.
    if (!error) setDraft(reminder ? localDateTimeValue(new Date(reminder.scheduledFor)) : nextHourValue());
    setEditing(true);
  }
  function close(restoreFocus = true) {
    restoreFocusRef.current = restoreFocus;
    setEditing(false);
  }
  async function run(action: () => Promise<void>, dismiss = true) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      if (dismiss) close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this reminder. Try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  useLayoutEffect(() => {
    if (!editing && !pending && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [editing, pending]);

  useLayoutEffect(() => {
    if (!editing) return;
    function reposition() {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const popup = popoverRef.current?.getBoundingClientRect();
      if (!anchor || !popup) return;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const below = anchor.bottom + 8;
      const top = below + popup.height <= topEdge + height - 8 ? below : anchor.top - popup.height - 8;
      setPosition({
        left: Math.max(leftEdge + 8, Math.min(anchor.right - popup.width, leftEdge + width - popup.width - 8)),
        top: Math.max(topEdge + 8, Math.min(top, topEdge + height - popup.height - 8)),
      });
    }
    reposition();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(reposition) : null;
    if (popoverRef.current) observer?.observe(popoverRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
    };
  }, [editing, error, reminder?.state]);

  useEffect(() => {
    if (!editing) return;
    function outside(event: MouseEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      if (pendingRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const focusable = target instanceof Element && target.closest("button, a[href], input, textarea, select, [tabindex], [contenteditable=true]");
      close(!focusable);
    }
    function blockPendingClick(event: MouseEvent) {
      if (pendingRef.current && !popoverRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!pendingRef.current) close();
      } else if (pendingRef.current && event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    // Capture before card/backdrop actions so pending writes cannot lose their feedback.
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("click", blockPendingClick, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("click", blockPendingClick, true);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, [editing]);

  return <section className="note-reminder-compact" aria-label={label === "note" ? "Note reminder" : "Item reminder"} aria-busy={pending}>
    <button ref={triggerRef} type="button" className={`note-reminder__pill${error || failed ? " is-error" : reminder?.state === "overdue" ? " is-overdue" : ""}`}
      aria-label={`${reminder ? "Edit" : "Set"} ${label} reminder`} aria-haspopup="dialog" aria-expanded={editing}
      aria-controls={editing ? id : undefined} aria-describedby={`${id}-time${status ? ` ${id}-status` : ""}`}
      title={error ?? (reminder ? reminderStatus(reminder) : "Set a reminder for this note")}
      disabled={pending} onClick={() => editing ? close() : edit()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      <span id={`${id}-time`}>{time}</span>
      {status && <span id={`${id}-status`} className="note-reminder__pill-status">{status}</span>}
    </button>
    {editing && createPortal(<div ref={popoverRef} id={id} className="note-reminder__popover" role="dialog"
      aria-label={`${reminder ? "Edit" : "Set"} ${label} reminder`} aria-busy={pending} style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          if (!pendingRef.current) close();
        } else if (event.key === "Tab") {
          event.stopPropagation();
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
          const first = controls[0], last = controls.at(-1);
          if (!first) event.preventDefault();
          else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div className="note-reminder__popover-heading">{reminder ? "Edit reminder" : "Remind me"}</div>
      <label>date &amp; time
        <input type="datetime-local" aria-label={`${label === "note" ? "Note" : "Item"} reminder date and time`} autoFocus value={draft}
          min={localDateTimeValue(new Date())} disabled={pending}
          onChange={(event) => { setDraft(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); void run(() => onSet(reminderIsoFromLocalValue(draft))); }
          }} />
      </label>
      <p className="note-reminder__timezone">{timeZone}</p>
      {reminder && <div className={`note-reminder__recovery${failed ? " is-error" : reminder.state === "overdue" ? " is-overdue" : ""}`}>
        <span role="status">{reminderStatus(reminder)}</span>
        {reminder.state === "permission-denied" && <button type="button" disabled={pending} onClick={() => void run(onOpenSettings, false)}>open settings</button>}
        {reminder.state === "scheduling-failed" && <button type="button" disabled={pending}
          onClick={() => void run(() => onSet(reminderIsoFromLocalValue(draft)))}>retry</button>}
      </div>}
      {error && <p className="note-reminder__error" role="alert">{error}</p>}
      <div className="note-reminder__popover-actions">
        {reminder && <button className="note-reminder__clear" type="button" aria-label={`Clear ${label} reminder`} disabled={pending} onClick={() => void run(onClear)}>clear</button>}
        <button type="button" disabled={pending} onClick={() => close()}>cancel</button>
        <button type="button" className="note-reminder__save" disabled={pending} onClick={() => void run(() => onSet(reminderIsoFromLocalValue(draft)))}>
          {pending ? "saving…" : reminder ? "update reminder" : "set reminder"}
        </button>
      </div>
    </div>, document.body)}
  </section>;
}

function FullNoteReminder({ reminder, onSet, onClear, onOpenSettings, label = "note" }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function edit() {
    setDraft(reminder ? localDateTimeValue(new Date(reminder.scheduledFor)) : nextHourValue());
    setError(null);
    setEditing(true);
  }
  function close() {
    setEditing(false);
    setError(null);
    actionRef.current?.focus();
    requestAnimationFrame(() => actionRef.current?.focus());
  }
  async function run(action: () => Promise<void>, dismiss = true) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
      if (dismiss) close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this reminder. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <section className="note-reminder" aria-label={label === "note" ? "Note reminder" : "Item reminder"} aria-busy={pending}
    onKeyDown={(event) => {
      if (event.key === "Escape" && editing) {
        event.preventDefault();
        event.stopPropagation();
        if (!pending) close();
      }
    }}>
    <div className="note-reminder__heading">
      <button ref={actionRef} type="button" aria-label={`${reminder ? "Edit" : "Set"} ${label} reminder`}
        aria-expanded={editing} disabled={pending} onClick={() => editing ? close() : edit()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {reminder ? "edit reminder" : "remind me"}
      </button>
      {reminder && <div className={`checklist-editor__reminder-state checklist-editor__reminder-state--${reminder.state}`}>
        <span role="status">{reminderStatus(reminder)}</span>
        {reminder.state === "permission-denied" && <button type="button" disabled={pending}
          onClick={() => void run(onOpenSettings, false)}>open settings</button>}
        {reminder.state === "scheduling-failed" && <button type="button" disabled={pending} onClick={edit}>retry</button>}
        <button type="button" aria-label={`Clear ${label} reminder`} disabled={pending} onClick={() => void run(onClear)}>clear</button>
      </div>}
    </div>
    {editing && <div className="checklist-editor__reminder-editor">
      <label>date &amp; time
        <input type="datetime-local" aria-label={`${label === "note" ? "Note" : "Item"} reminder date and time`} autoFocus value={draft}
          min={localDateTimeValue(new Date())} disabled={pending}
          onChange={(event) => { setDraft(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void run(() => onSet(reminderIsoFromLocalValue(draft)));
            }
          }} />
      </label>
      <span className="checklist-editor__timezone">{timeZone}</span>
      <button type="button" className="primary-button" disabled={pending}
        onClick={() => void run(() => onSet(reminderIsoFromLocalValue(draft)))}>
        {pending ? "scheduling…" : reminder ? "update reminder" : "set reminder"}
      </button>
      <button type="button" disabled={pending} onClick={close}>cancel</button>
    </div>}
    {error && <p className="checklist-editor__reminder-error" role="alert">{error}</p>}
  </section>;
}
