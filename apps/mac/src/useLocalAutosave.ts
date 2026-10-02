import { useEffect, useRef, useState } from "react";

export function useLocalAutosave<T>(
  key: string,
  initial: T,
  isDraft: (value: unknown) => value is T,
  persist: (value: T) => Promise<void>,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const recovered: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      return isDraft(recovered) ? recovered : initial;
    } catch {
      return initial;
    }
  });
  const [status, setStatus] = useState<"saved" | "saving" | "error">(value === initial ? "saved" : "saving");
  const [error, setError] = useState<string | null>(null);
  const state = useRef({
    value,
    revision: value === initial ? 0 : 1,
    savedRevision: 0,
    pending: null as Promise<boolean> | null,
    error: null as string | null,
    mounted: true,
    persist,
  });
  state.current.persist = persist;

  function flush(): Promise<boolean> {
    const current = state.current;
    if (current.pending) return current.pending;
    current.pending = Promise.resolve().then(async () => {
      while (current.savedRevision !== current.revision) {
        const revision = current.revision;
        const snapshot = current.value;
        current.error = null;
        if (current.mounted) {
          setStatus("saving");
          setError(null);
        }
        try {
          await current.persist(snapshot);
          current.savedRevision = revision;
        } catch (cause) {
          // A newer edit may have corrected a temporarily invalid draft.
          if (revision !== current.revision) continue;
          current.error = cause instanceof Error ? cause.message : "Could not save changes locally.";
          if (current.mounted) {
            setStatus("error");
            setError(current.error);
          }
          return false;
        }
      }
      try {
        if (localStorage.getItem(key) === JSON.stringify(current.value)) localStorage.removeItem(key);
      } catch { /* SQLite is the authoritative store. */ }
      if (current.mounted) setStatus("saved");
      return true;
    }).finally(() => {
      current.pending = null;
      if (!current.error && current.savedRevision !== current.revision) void flush();
    });
    return current.pending;
  }

  function change(next: T) {
    const current = state.current;
    current.value = next;
    current.revision += 1;
    current.error = null;
    // Retain the latest draft across a failed write or an interrupted app session.
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Still attempt the local write. */ }
    setValue(next);
    setStatus("saving");
    setError(null);
    void flush();
  }

  useEffect(() => {
    state.current.mounted = true;
    void flush();
    return () => { state.current.mounted = false; };
  }, []);

  return { value, change, flush, status, error, current: () => state.current.value };
}
