import { useEffect, useRef, useState } from "react";
import {
  getLaunchAtLogin,
  getFontSize,
  getLightMode,
  getShortcutButtonVisible,
  listenForShortcutButtonVisibility,
  listenForLightMode,
  listenForFontSize,
  setLaunchAtLogin,
  setShortcutButtonVisible,
  type FontSize,
} from "./bridge";
import { saveFontSize, saveLightMode } from "./appearance";
import "./SettingsPanel.css";

type Preference<T> = ReturnType<typeof usePreference<T>>;
type Subscribe<T> = (callback: (value: T) => void) => Promise<() => void>;

function usePreference<T>(
  read: () => Promise<T>,
  write: (value: T) => Promise<unknown>,
  subscribe?: Subscribe<T>,
) {
  const [value, setValue] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<() => void>(() => undefined);
  const pending = useRef(false);
  const revision = useRef(0);

  async function load() {
    const current = ++revision.current;
    setError(null);
    try {
      const saved = await read();
      if (current === revision.current) setValue(saved);
    } catch (cause) {
      if (current !== revision.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load this preference.");
      retryRef.current = () => void load();
    }
  }

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Subscribe before reading so an older read cannot overwrite a live change.
    void (async () => {
      if (subscribe) {
        try {
          const stop = await subscribe((saved) => {
            if (disposed) return;
            revision.current++;
            setValue(saved);
          });
          if (disposed) { stop(); return; }
          unlisten = stop;
        } catch { /* Reopening Settings still reloads the saved preference. */ }
      }
      if (!disposed) await load();
    })();
    return () => { disposed = true; revision.current++; unlisten?.(); };
  }, [read, subscribe]);

  async function save(next: T) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    revision.current++;
    try {
      await write(next);
      setValue(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this preference.");
      retryRef.current = () => void save(next);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return { value, busy, error, save, retry: () => retryRef.current() };
}

function PreferenceStatus({ id, title, preference }: {
  id: string;
  title: string;
  preference: Pick<Preference<unknown>, "value" | "error" | "retry">;
}) {
  return preference.error ? (
    <div className="settings-preference__error" id={`${id}-error`} role="alert">
      <span>{preference.error}</span>
      <button type="button" onClick={preference.retry} aria-label={`Retry ${title.toLowerCase()}`}>Retry</button>
    </div>
  ) : preference.value === null ? <p className="settings-preference__loading" role="status">Loading…</p> : null;
}

function PreferenceRow({ id, title, preference }: {
  id: string;
  title: string;
  preference: Preference<boolean>;
}) {
  return (
    <div className="settings-preference">
      <label className="settings-preference__row" htmlFor={id}>
        <span className="settings-preference__title">{title}</span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={title}
          aria-describedby={preference.error ? `${id}-error` : undefined}
          checked={preference.value ?? false}
          disabled={preference.value === null || preference.busy}
          onChange={() => void preference.save(!preference.value)}
        />
      </label>
      <PreferenceStatus id={id} title={title} preference={preference} />
    </div>
  );
}

export function SettingsPanel({ readSidebarVisible, onSidebarVisibleChange, onClose }: {
  readSidebarVisible: () => Promise<boolean>;
  onSidebarVisibleChange: (visible: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const launch = usePreference(getLaunchAtLogin, setLaunchAtLogin);
  const shortcuts = usePreference(getShortcutButtonVisible, setShortcutButtonVisible, listenForShortcutButtonVisibility);
  const sidebar = usePreference(readSidebarVisible, onSidebarVisibleChange);
  const lightMode = usePreference(getLightMode, saveLightMode, listenForLightMode);
  const fontSize = usePreference(getFontSize, saveFontSize, listenForFontSize);
  const saving = launch.busy || shortcuts.busy || sidebar.busy || lightMode.busy || fontSize.busy;
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);

  return (
    <div
      className="thought-detail-layer thought-detail-layer--focus settings-layer"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!saving) onClose();
        }
        if (event.key === "Tab") {
          const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']") ?? []);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
            event.preventDefault(); first?.focus();
          }
        }
      }}
    >
      <article ref={panelRef} className="settings-panel" id="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-panel__heading">
          <h2 id="settings-title">Settings</h2>
          <span className="settings-panel__status" role="status">{saving ? "Saving…" : ""}</span>
          <button ref={closeRef} type="button" aria-label="Close settings" title="Close settings" disabled={saving} onClick={onClose}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div className="settings-panel__body" tabIndex={0} aria-label="Settings preferences">
          <section aria-labelledby="settings-appearance">
            <h3 className="eyebrow" id="settings-appearance">Appearance</h3>
            <PreferenceRow id="settings-light-mode" title="Light mode" preference={lightMode} />
            <div className="settings-preference">
              <label className="settings-preference__row" htmlFor="settings-font-size">
                <span className="settings-preference__title">Font size</span>
                <select
                  id="settings-font-size"
                  aria-label="Font size"
                  aria-describedby={fontSize.error ? "settings-font-size-error" : undefined}
                  value={fontSize.value ?? "default"}
                  disabled={fontSize.value === null || fontSize.busy}
                  onChange={(event) => void fontSize.save(event.target.value as FontSize)}
                >
                  <option value="default">Default</option>
                  <option value="large">Large</option>
                  <option value="extra-large">Extra large</option>
                </select>
              </label>
              <PreferenceStatus id="settings-font-size" title="Font size" preference={fontSize} />
            </div>
          </section>
          <section aria-labelledby="settings-general">
            <h3 className="eyebrow" id="settings-general">General</h3>
            <PreferenceRow id="settings-launch" title="Launch at login" preference={launch} />
            <PreferenceRow id="settings-sidebar" title="Show sidebar" preference={sidebar} />
          </section>
          <section aria-labelledby="settings-capture">
            <h3 className="eyebrow" id="settings-capture">Capture</h3>
            <div className="settings-shortcut"><span>Quick capture</span><kbd>⌥ Space</kbd></div>
            <PreferenceRow id="settings-shortcuts" title="Shortcut button" preference={shortcuts} />
          </section>
        </div>
      </article>
    </div>
  );
}
