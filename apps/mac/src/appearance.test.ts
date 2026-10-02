import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  getFontSize: vi.fn(),
  setFontSize: vi.fn(),
  listenForFontSize: vi.fn(),
  getLightMode: vi.fn(),
  setLightMode: vi.fn(),
  listenForLightMode: vi.fn(),
}));
vi.mock("./bridge", () => bridge);

import { saveFontSize, saveLightMode, startAppearance } from "./appearance";

describe("shared window appearance", () => {
  let stop: (() => void) | undefined;
  let notify: (enabled: boolean) => void;
  let notifyFont: (size: "default" | "large" | "extra-large") => void;
  let unlisten: ReturnType<typeof vi.fn>;
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-font-size");
    bridge.getFontSize.mockReset().mockResolvedValue("default");
    bridge.setFontSize.mockReset().mockImplementation(async (size: string) => size);
    bridge.listenForFontSize.mockReset().mockImplementation(async (callback) => { notifyFont = callback; return () => undefined; });
    document.documentElement.removeAttribute("data-theme");
    unlisten = vi.fn();
    bridge.getLightMode.mockReset().mockResolvedValue(false);
    bridge.setLightMode.mockReset().mockImplementation(async (enabled: boolean) => enabled);
    bridge.listenForLightMode.mockReset().mockImplementation(async (callback) => {
      notify = callback;
      return unlisten;
    });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("capture-mode");
    document.documentElement.removeAttribute("data-font-size");
  });

  it("uses the last saved appearance before async startup and reconciles with durable storage", async () => {
    localStorage.setItem("brain-cache.appearance.light-mode", "true");
    let resolve!: (enabled: boolean) => void;
    bridge.getLightMode.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
    stop = startAppearance();
    expect(document.documentElement.dataset.theme).toBe("light");
    await flush();
    resolve(false);
    await flush();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies live changes in capture without changing its mode, focus, or current draft", async () => {
    document.documentElement.classList.add("capture-mode");
    const draft = document.createElement("textarea");
    draft.value = "An unfinished thought";
    document.body.append(draft);
    draft.focus();
    draft.setSelectionRange(3, 3);
    try {
      stop = startAppearance();
      await flush();
      notify(true);
      expect(document.documentElement.dataset.theme).toBe("light");
      expect(document.documentElement.classList.contains("capture-mode")).toBe(true);
      expect(document.activeElement).toBe(draft);
      expect(draft.value).toBe("An unfinished thought");
      expect(draft.selectionStart).toBe(3);
      notify(false);
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally { draft.remove(); }
  });

  it("does not let an older startup read overwrite a newer change from another window", async () => {
    let resolve!: (enabled: boolean) => void;
    bridge.getLightMode.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
    stop = startAppearance();
    await flush();
    notify(true);
    resolve(false);
    await flush();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("retains appearance on failed persistence and caches only successful changes for relaunch", async () => {
    stop = startAppearance();
    await flush();
    bridge.setLightMode.mockRejectedValueOnce(new Error("Disk full"));
    await expect(saveLightMode(true)).rejects.toThrow("Disk full");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await saveLightMode(true);
    stop();
    stop = startAppearance();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps a successful local change when an older read finishes without a change event", async () => {
    let resolve!: (enabled: boolean) => void;
    bridge.getLightMode.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; }));
    stop = startAppearance();
    await flush();
    await saveLightMode(true);
    resolve(false);
    await flush();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps rendering available when preference reads or the appearance cache fail", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
    bridge.getLightMode.mockRejectedValue(new Error("Unavailable"));
    expect(() => { stop = startAppearance(); }).not.toThrow();
    await flush();
    expect(document.documentElement.dataset.theme).toBe("dark");
    notify(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("refreshes on focus if event registration fails and stops listening after cleanup", async () => {
    bridge.listenForLightMode.mockRejectedValueOnce(new Error("Unavailable"));
    stop = startAppearance();
    await flush();
    bridge.getLightMode.mockResolvedValue(true);
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(document.documentElement.dataset.theme).toBe("light");
    stop();
    bridge.getLightMode.mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(bridge.getLightMode).not.toHaveBeenCalled();
  });

  it("cleans up a listener that finishes registering after its window is disposed", async () => {
    let registered!: (stop: () => void) => void;
    bridge.listenForLightMode.mockImplementationOnce(() => new Promise<() => void>((done) => { registered = done; }));
    stop = startAppearance();
    stop();
    registered(unlisten);
    await flush();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(bridge.getLightMode).not.toHaveBeenCalled();
  });

  it("restores font size before rendering and reconciles independently of a failed theme read", async () => {
    localStorage.setItem("brain-cache.appearance.font-size", "extra-large");
    bridge.getLightMode.mockRejectedValue(new Error("Theme unavailable"));
    bridge.getFontSize.mockResolvedValue("large");
    stop = startAppearance();
    expect(document.documentElement.dataset.fontSize).toBe("extra-large");
    await flush();
    expect(document.documentElement.dataset.fontSize).toBe("large");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies font events without replacing the draft, focus, or selection and signals remeasurement", async () => {
    const draft = document.createElement("textarea");
    draft.value = "Still writing this thought";
    document.body.append(draft);
    draft.focus();
    draft.setSelectionRange(3, 7);
    const measured: string[] = [];
    const remeasure = () => measured.push(document.documentElement.dataset.fontSize!);
    try {
      stop = startAppearance();
      await flush();
      window.addEventListener("brain-cache:font-size-applied", remeasure);
      notifyFont("extra-large");
      expect(document.documentElement.dataset.fontSize).toBe("extra-large");
      expect(measured).toEqual(["extra-large"]);
      expect(document.activeElement).toBe(draft);
      expect(draft.value).toBe("Still writing this thought");
      expect([draft.selectionStart, draft.selectionEnd]).toEqual([3, 7]);
    } finally {
      window.removeEventListener("brain-cache:font-size-applied", remeasure);
      draft.remove();
    }
  });

  it("retains the saved font size on failure and prevents stale reads from undoing a local save", async () => {
    let resolve!: (size: string) => void;
    bridge.getFontSize.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
    stop = startAppearance();
    await flush();
    bridge.setFontSize.mockRejectedValueOnce(new Error("Disk full"));
    await expect(saveFontSize("large")).rejects.toThrow("Disk full");
    expect(document.documentElement.dataset.fontSize).toBe("default");
    await saveFontSize("large");
    resolve("default");
    await flush();
    expect(document.documentElement.dataset.fontSize).toBe("large");
    expect(localStorage.getItem("brain-cache.appearance.font-size")).toBe("large");
    stop();
    stop = startAppearance();
    expect(document.documentElement.dataset.fontSize).toBe("large");
  });

  it("refreshes font size on focus after a missed event and cleans up on disposal", async () => {
    const stopFont = vi.fn();
    bridge.listenForFontSize.mockResolvedValueOnce(stopFont);
    stop = startAppearance();
    await flush();
    bridge.getFontSize.mockResolvedValue("extra-large");
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(document.documentElement.dataset.fontSize).toBe("extra-large");
    stop();
    expect(stopFont).toHaveBeenCalledOnce();
    bridge.getFontSize.mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(bridge.getFontSize).not.toHaveBeenCalled();
  });
});
