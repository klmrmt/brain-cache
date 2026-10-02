import {
  getLightMode, listenForLightMode, setLightMode,
  getFontSize, listenForFontSize, setFontSize, type FontSize,
} from "./bridge";

// Each preference reconciles independently; loading never holds up typing or capture.
function windowPreference<T>({ key, fallback, parse, apply, read, write, listen }: {
  key: string;
  fallback: T;
  parse: (cached: string | null) => T;
  apply: (value: T) => void;
  read: () => Promise<T>;
  write: (value: T) => Promise<T>;
  listen: (callback: (value: T) => void) => Promise<() => void>;
}) {
  let revision = 0;
  const update = (value: T) => {
    revision++;
    apply(value);
    // The durable preference stays authoritative; caching only avoids startup flicker.
    try { localStorage.setItem(key, String(value)); } catch { /* Optional cache. */ }
  };
  return {
    async save(value: T): Promise<T> {
      const saved = await write(value);
      update(saved);
      return saved;
    },
    start(): () => void {
      let cached = fallback;
      try { cached = parse(localStorage.getItem(key)); } catch { /* Use the default. */ }
      apply(cached);
      let disposed = false;
      let request = 0;
      let unlisten: (() => void) | undefined;
      const refresh = () => {
        const current = ++request;
        const atRead = revision;
        void read().then((value) => {
          if (!disposed && current === request && atRead === revision) update(value);
        }).catch(() => { /* Keep the current appearance and let capture continue. */ });
      };
      void listen((value) => {
        if (disposed) return;
        request++;
        update(value);
      }).then((stop) => {
        if (disposed) { stop(); return; }
        unlisten = stop;
        refresh();
      }).catch(() => { if (!disposed) refresh(); });
      window.addEventListener("focus", refresh);
      return () => {
        disposed = true;
        request++;
        unlisten?.();
        window.removeEventListener("focus", refresh);
      };
    },
  };
}

const lightMode = windowPreference({
  key: "brain-cache.appearance.light-mode",
  fallback: false,
  parse: (cached) => cached === "true",
  apply: (enabled) => { document.documentElement.dataset.theme = enabled ? "light" : "dark"; },
  read: getLightMode,
  write: setLightMode,
  listen: listenForLightMode,
});

const fontSize = windowPreference<FontSize>({
  key: "brain-cache.appearance.font-size",
  fallback: "default",
  parse: (cached) => cached === "large" || cached === "extra-large" ? cached : "default",
  apply: (size) => {
    if (document.documentElement.dataset.fontSize === size) return;
    document.documentElement.dataset.fontSize = size;
    window.dispatchEvent(new Event("brain-cache:font-size-applied"));
  },
  read: getFontSize,
  write: setFontSize,
  listen: listenForFontSize,
});

export const saveLightMode = lightMode.save;
export const saveFontSize = fontSize.save;

export function startAppearance(): () => void {
  const stopLightMode = lightMode.start();
  const stopFontSize = fontSize.start();
  return () => { stopLightMode(); stopFontSize(); };
}
