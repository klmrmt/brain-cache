import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturePanel } from "./CapturePanel";
import type { Thought } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const bridge = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  chooseAttachmentFiles: vi.fn(),
  readAttachmentData: vi.fn(),
  openAttachment: vi.fn(),
  addThoughtAttachments: vi.fn(),
  removeThoughtAttachment: vi.fn(),
  captureChecklist: vi.fn(),
  captureThought: vi.fn(),
  getShortcutButtonVisible: vi.fn(),
  hideCapture: vi.fn(),
  listenForCaptureCommand: vi.fn(),
  listenForCaptureFocus: vi.fn(),
  listenForShortcutButtonVisibility: vi.fn(),
  listTagDefinitions: vi.fn(),
  resizeCapture: vi.fn(),
  setShortcutButtonVisible: vi.fn(),
}));

vi.mock("./bridge", () => bridge);

const savedThought: Thought = {
  id: "saved",
  body: "A tagged thought",
  createdAt: "2026-09-01T12:00:00.000Z",
  archived: false,
  source: "mac-capture",
  tags: [],
  kind: "text",
  checklistItems: [],
};

let captureCommand: ((command: string) => void) | undefined;
let shortcutButtonVisibility: ((visible: boolean) => void) | undefined;

describe("quick capture tagging", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    bridge.isTauriRuntime.mockReset().mockReturnValue(false);
    bridge.chooseAttachmentFiles.mockReset();
    bridge.captureThought.mockReset().mockImplementation(
      async (body: string, source: Thought["source"], tags: string[]) => ({
        ...savedThought,
        body,
        source,
        tags,
      }),
    );
    bridge.captureChecklist.mockReset().mockImplementation(
      async (items: string[], source: Thought["source"], tags: string[]) => ({
        ...savedThought,
        body: items.join("\n"),
        source,
        tags,
        kind: "checklist",
        checklistItems: items.map((text, index) => ({
          id: `item-${index}`,
          text,
          completed: false,
        })),
      }),
    );
    bridge.hideCapture.mockReset().mockResolvedValue(undefined);
    bridge.getShortcutButtonVisible.mockReset().mockResolvedValue(true);
    bridge.setShortcutButtonVisible
      .mockReset()
      .mockImplementation(async (visible: boolean) => visible);
    captureCommand = undefined;
    shortcutButtonVisibility = undefined;
    bridge.listenForCaptureCommand.mockReset().mockImplementation(
      async (callback: (command: string) => void) => {
        captureCommand = callback;
        return () => undefined;
      },
    );
    bridge.listenForCaptureFocus.mockReset().mockResolvedValue(() => undefined);
    bridge.listenForShortcutButtonVisibility.mockReset().mockImplementation(
      async (callback: (visible: boolean) => void) => {
        shortcutButtonVisibility = callback;
        return () => undefined;
      },
    );
    bridge.listTagDefinitions.mockReset().mockResolvedValue([
      { name: "homework", color: null },
      { name: "work", color: "moss" },
    ]);
    bridge.resizeCapture.mockReset().mockImplementation(async (height: number) => ({
      appliedHeight: height,
      maxHeight: height,
      constrained: false,
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<CapturePanel />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps selected files after failed capture and saves them atomically without requiring text", async () => {
    const file = { id: crypto.randomUUID(), name: "photo.png", data: btoa("image") };
    bridge.isTauriRuntime.mockReturnValue(true);
    bridge.chooseAttachmentFiles.mockResolvedValue([file]);
    await click(container.querySelector('.attachment-add')!);
    expect(container.querySelector('.attachment-list')?.textContent).toContain("photo.png");
    bridge.captureThought.mockRejectedValueOnce(new Error("Disk full"));
    await click(container.querySelector('[aria-label="Save thought"]')!);
    expect(container.querySelector('.attachment-list')?.textContent).toContain("photo.png");
    expect(bridge.hideCapture).not.toHaveBeenCalled();
    await click(container.querySelector('[aria-label="Save thought"]')!);
    expect(bridge.captureThought).toHaveBeenLastCalledWith("", "mac-capture", [], [], [file]);
    expect(container.querySelector('.attachment-list')).toBeNull();
  });

  it("blocks capture while file selection is pending and handles picker cancellation", async () => {
    bridge.isTauriRuntime.mockReturnValue(true);
    let resolve!: (files: []) => void;
    bridge.chooseAttachmentFiles.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await click(container.querySelector('.attachment-add')!);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Save thought"]')?.disabled).toBe(true);
    await press(textarea(), { key: "Enter", metaKey: true });
    expect(bridge.captureThought).not.toHaveBeenCalled();
    await act(async () => resolve([]));
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Save thought"]')?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps both files when a second drop arrives during the first import", async () => {
    const transfer = (name: string) => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files: [new File([name], name)] } });
      return event;
    };
    await act(async () => {
      textarea().dispatchEvent(transfer("first.txt"));
      textarea().dispatchEvent(transfer("second.txt"));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.querySelector('.attachment-list')?.textContent).toContain("first.txt");
    expect(container.querySelector('.attachment-list')?.textContent).toContain("second.txt");
    await click(container.querySelector('[aria-label="Save thought"]')!);
    expect(bridge.captureThought.mock.calls.at(-1)?.[4].map((file: { name: string }) => file.name)).toEqual(["first.txt", "second.txt"]);
  });

  it("accepts pasted image bytes and can remove the draft before capture", async () => {
    const image = new File([new Uint8Array([0, 255, 17])], "pasted.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [], items: [{ kind: "file", getAsFile: () => image }] } });
    await act(async () => {
      textarea().dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(container.querySelector('.document-image img')?.getAttribute("alt")).toBe("Preview of pasted.png");
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AP8R');
    await click(container.querySelector('[aria-label="Remove inline image pasted.png"]')!);
    expect(container.querySelector('.attachment-list')).toBeNull();
  });

  it("keeps screenshots at the insertion point and saves text-image-text order", async () => {
    await typeInto(textarea(), "BeforeAfter");
    textarea().setSelectionRange(6, 6);
    const file = new File(["image"], "screenshot.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file], items: [] } });
    await act(async () => {
      textarea().dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect([...container.querySelector('.document-editor')!.children].map((node) => node.tagName)).toEqual(["TEXTAREA", "FIGURE", "TEXTAREA"]);
    const after = container.querySelectorAll<HTMLTextAreaElement>('.document-editor textarea')[1];
    await typeInto(after, "After the screenshot");
    await press(after, { key: "Enter", metaKey: true });
    const saved = bridge.captureThought.mock.calls.at(-1)!;
    expect(saved[0]).toBe("Before\nAfter the screenshot");
    expect(saved[4]).toEqual([expect.objectContaining({ name: "screenshot.png" })]);
    expect(saved[5].map((block: { type: string; text?: string }) => block.type === "text" ? block.text : block.type)).toEqual(["Before", "image", "After the screenshot"]);
  });

  it("remeasures an image draft before resizing capture when font size changes", async () => {
    await typeInto(textarea(), "BeforeAfter");
    textarea().setSelectionRange(6, 6);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [new File(["image"], "screenshot.png", { type: "image/png" })], items: [] },
    });
    await act(async () => {
      textarea().dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await nextFrame();
    const editor = container.querySelector<HTMLElement>(".capture-document")!;
    const inputs = [...editor.querySelectorAll<HTMLTextAreaElement>("textarea")];
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(inputs[0], "scrollHeight", { configurable: true, value: 72 });
    Object.defineProperty(inputs[1], "scrollHeight", { configurable: true, value: 88 });
    Object.defineProperty(editor, "scrollHeight", {
      configurable: true,
      get: () => inputs.reduce((height, input) => height + Number.parseFloat(input.style.height), 64),
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => Number.parseFloat(editor.style.height) + 16,
    });
    inputs[0].focus();
    inputs[0].setSelectionRange(1, 4);
    editor.scrollTop = 35;
    bridge.resizeCapture.mockClear();

    await act(async () => window.dispatchEvent(new Event("brain-cache:font-size-applied")));
    await nextFrame();

    expect(inputs.map((input) => input.style.height)).toEqual(["72px", "88px"]);
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(264, 150);
    expect([...editor.querySelectorAll("textarea")]).toEqual(inputs);
    expect(inputs.map((input) => input.value)).toEqual(["Before", "After"]);
    expect(editor.querySelector(".document-image")).not.toBeNull();
    expect(document.activeElement).toBe(inputs[0]);
    expect(inputs[0].selectionStart).toBe(1);
    expect(inputs[0].selectionEnd).toBe(4);
    expect(editor.scrollTop).toBe(35);
    expect(bridge.captureThought).not.toHaveBeenCalled();
    expect(bridge.captureChecklist).not.toHaveBeenCalled();
  });

  it("keeps body focus until the explicit shortcut and saves untagged normally", async () => {
    const body = textarea();
    expect(document.activeElement).toBe(body);
    expect(container.querySelector('[role="combobox"]')).toBeNull();

    await typeInto(body, "ordinary capture");
    await press(body, { key: "Enter", metaKey: true });

    expect(bridge.captureThought).toHaveBeenCalledWith("ordinary capture", "mac-capture", []);
  });

  it("offers Add tags on initial capture and returns the invitation when editing closes", async () => {
    const body = textarea();
    const addTags = () => container.querySelector<HTMLButtonElement>('[aria-label="Add tags"]');
    expect(document.activeElement).toBe(body);
    expect(addTags()?.textContent).toContain("add tags");
    expect(addTags()?.getAttribute("aria-keyshortcuts")).toBe("Meta+T");
    expect(container.textContent).toContain("Find it faster later");

    await typeInto(body, "organize this later");
    await click(addTags()!);
    await nextFrame();
    expect(document.activeElement).toBe(combobox());
    expect(body.value).toBe("organize this later");
    expect(addTags()).toBeNull();

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Close tag shelf"]')!);
    await nextFrame();
    expect(addTags()).not.toBeNull();
    expect(document.activeElement).toBe(body);
    await press(body, { key: "Enter", metaKey: true });
    expect(bridge.captureThought).toHaveBeenCalledWith("organize this later", "mac-capture", []);
    expect(addTags()).not.toBeNull();
  });

  it("selects suggestions, creates multiple tags, and commits a valid draft before saving", async () => {
    const body = textarea();
    await typeInto(body, "A tagged thought");
    await press(body, { key: "t", metaKey: true });

    const tagInput = combobox();
    expect(document.activeElement).toBe(tagInput);
    await typeInto(tagInput, "wor");
    expect(optionLabels()).toEqual(["work", "homework", "wor"]);
    await press(tagInput, { key: "ArrowDown" });
    await press(tagInput, { key: "Enter" });
    expect(container.textContent).toContain("#homework");

    await typeInto(tagInput, "work");
    expect(optionLabels()).toEqual(["work"]);
    await press(tagInput, { key: "Enter" });
    expect(container.textContent).toContain("#work");

    await typeInto(tagInput, "Design");
    await press(tagInput, { key: "Enter" });
    expect(container.textContent).toContain("#design");

    await typeInto(tagInput, " Focus ");
    await press(tagInput, { key: "Enter", ctrlKey: true });

    expect(bridge.captureThought).toHaveBeenCalledWith("A tagged thought", "mac-capture", [
      "design",
      "focus",
      "homework",
      "work",
    ]);
  });

  it("layers Escape across suggestions, tag mode, and capture dismissal", async () => {
    const body = textarea();
    await press(body, { key: "t", ctrlKey: true });
    const tagInput = combobox();
    await typeInto(tagInput, "w");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    await press(tagInput, { key: "Escape" });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();

    await press(tagInput, { key: "Escape" });
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(body);

    await press(body, { key: "Escape" });
    expect(bridge.hideCapture).toHaveBeenCalledTimes(1);
  });

  it("commits a visible valid draft when the save shortcut comes from the body", async () => {
    const body = textarea();
    await typeInto(body, "body-side save");
    await press(body, { key: "t", metaKey: true });
    await typeInto(combobox(), " Focus ");
    await act(async () => body.focus());
    await press(body, { key: "Enter", metaKey: true });

    expect(bridge.captureThought).toHaveBeenCalledWith("body-side save", "mac-capture", ["focus"]);
  });

  it("moves focus to the last remove control on empty Backspace without deleting", async () => {
    const body = textarea();
    await press(body, { key: "t", metaKey: true });
    const tagInput = combobox();
    await typeInto(tagInput, "work");
    await press(tagInput, { key: "Enter" });
    // Finish the tag commit's deferred input focus before the next interaction.
    await nextFrame();
    await press(tagInput, { key: "Backspace" });

    const remove = container.querySelector(
      'button[aria-label="Remove tag work"]',
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(remove);
    expect(container.textContent).toContain("#work");
  });

  it("never exposes or attaches an unrelated option for an invalid whitespace draft", async () => {
    bridge.listTagDefinitions.mockReset().mockResolvedValue([{ name: "ideas", color: null }]);
    await remount();
    const body = textarea();
    await press(body, { key: "t", metaKey: true });
    const tagInput = combobox();
    await typeInto(tagInput, "     ");

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await press(tagInput, { key: "Enter" });

    expect(container.textContent).not.toContain("#ideas");
    expect(combobox().value).toBe("     ");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("visible character");
  });

  it("keeps attached tags visible while typing and reopens tagging from the pet panel", async () => {
    const body = textarea();
    await press(body, { key: "t", metaKey: true });
    const tagInput = combobox();
    await typeInto(tagInput, "work");
    await press(tagInput, { key: "Enter" });
    await press(tagInput, { key: "Escape" });
    await press(tagInput, { key: "Escape" });
    await nextFrame();

    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector('[aria-label="Attached tags"]')?.textContent).toContain("#work");
    expect(container.querySelector('.tag-chip')?.className).toContain("tag-color--moss");
    expect(container.querySelector('[aria-label="Add tags"]')).toBeNull();
    expect(document.activeElement).toBe(body);

    await typeInto(body, "keep tags in sight");
    await press(body, { key: "Meta", code: "MetaLeft", metaKey: true });
    expect(container.querySelector('.capture-shortcut-drawer')).not.toBeNull();
    expect(container.textContent).toContain("#work");
    expect(document.activeElement).toBe(body);
    await act(async () => body.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Meta", metaKey: false, bubbles: true,
    })));

    await click(container.querySelector<HTMLButtonElement>('[aria-label="Edit tags"]')!);
    await nextFrame();

    expect(container.textContent).toContain("#work");
    expect(document.activeElement).toBe(combobox());
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Close tag shelf"]')!);
    await nextFrame();
    await press(body, { key: "Enter", metaKey: true });
    expect(bridge.captureThought).toHaveBeenCalledWith("keep tags in sight", "mac-capture", ["work"]);
    expect(container.querySelector('[aria-label="Attached tags"]')).toBeNull();
    expect(container.querySelector('.capture-tag-shelf')).toBeNull();
  });

  it("returns to compact capture and body focus after removing the last visible tag", async () => {
    const body = textarea();
    await press(body, { key: "t", metaKey: true });
    await typeInto(combobox(), "work");
    await press(combobox(), { key: "Enter" });
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Close tag shelf"]')!);
    await nextFrame();
    await click(container.querySelector<HTMLButtonElement>('[aria-label="Remove tag work"]')!);
    await nextFrame();

    expect(container.querySelector('.capture-tag-shelf')).toBeNull();
    expect(document.activeElement).toBe(body);
    expect(container.querySelector('[aria-label="Add tags"]')).not.toBeNull();
    await typeInto(body, "no attached tags");
    await press(body, { key: "Enter", metaKey: true });
    expect(bridge.captureThought).toHaveBeenCalledWith("no attached tags", "mac-capture", []);
  });

  it("surfaces suggestion-load failure without blocking ordinary capture", async () => {
    bridge.listTagDefinitions.mockReset().mockRejectedValue(new Error("read failed"));
    await remount();

    expect(container.querySelector("#capture-status")?.textContent).toContain(
      "tag suggestions unavailable · capture still works",
    );
    await typeInto(textarea(), "still durable");
    await press(textarea(), { key: "Enter", metaKey: true });
    expect(bridge.captureThought).toHaveBeenCalledWith("still durable", "mac-capture", []);
  });

  it("retains body, committed tags, and draft when persistence fails", async () => {
    bridge.captureThought.mockRejectedValueOnce(new Error("Disk is unavailable."));
    const body = textarea();
    await typeInto(body, "do not lose me");
    await press(body, { key: "t", metaKey: true });
    const tagInput = combobox();
    await typeInto(tagInput, "work");
    await press(tagInput, { key: "Enter" });
    await typeInto(tagInput, "draft");
    await press(tagInput, { key: "Enter", metaKey: true });

    expect(textarea().value).toBe("do not lose me");
    expect(combobox().value).toBe("draft");
    expect(container.textContent).toContain("#work");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk is unavailable.");

    await press(tagInput, { key: "Escape" });
    await press(tagInput, { key: "Escape" });
    await nextFrame();

    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(textarea().value).toBe("do not lose me");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk is unavailable.");
  });

  it("keeps color optional while saving an explicit color for a newly created tag", async () => {
    const body = textarea();
    await typeInto(body, "colored capture");
    await press(body, { key: "t", metaKey: true });
    const tagInput = combobox();
    await typeInto(tagInput, "Design");
    await press(tagInput, { key: "Enter" });
    // Finish the tag commit's deferred input focus before opening the color picker.
    await nextFrame();

    const colorButton = container.querySelector(
      'button[aria-label="Set color for tag design"]',
    ) as HTMLButtonElement;
    expect(colorButton.closest(".tag-chip")?.className).toContain("tag-color--graphite");
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    await act(async () => { colorButton.closest(".tag-chip")!.querySelector(".tag-chip__label")!.dispatchEvent(contextMenu); });
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      "Color for tag design",
    );
    expect(document.activeElement).toBe(
      container.querySelector(
        'button[aria-label="Remove color from tag design"]',
      ) as HTMLButtonElement,
    );
    await click(
      container.querySelector(
        'button[aria-label="Set Sky color for tag design"]',
      ) as HTMLButtonElement,
    );
    await nextFrame();

    expect(
      container
        .querySelector('button[aria-label="Set color for tag design"]')
        ?.closest(".tag-chip")?.className,
    ).toContain("tag-color--sky");
    await press(tagInput, { key: "Enter", metaKey: true });

    expect(bridge.captureThought).toHaveBeenCalledWith(
      "colored capture",
      "mac-capture",
      ["design"],
      [{ name: "design", color: "sky" }],
    );
  });

  it("toggles checklist mode with Command Shift 9 and saves one item per line", async () => {
    const body = textarea();
    await press(body, { key: "(", code: "Digit9", metaKey: true, shiftKey: true });

    expect(container.querySelector('[aria-label="Checklist mode"]')?.textContent).toBe("checklist");
    expect(body.placeholder).toBe("Add checklist items, one per line");
    await typeInto(body, "  Buy milk  \n\nCall Sam\nShip build ");
    await press(body, { key: "Enter", metaKey: true });

    expect(bridge.captureChecklist).toHaveBeenCalledWith(
      ["Buy milk", "Call Sam", "Ship build"],
      "mac-capture",
      [],
      [],
    );
    expect(bridge.captureThought).not.toHaveBeenCalled();
  });

  it("toggles numbered and bulleted lines and continues or exits lists with Return", async () => {
    const body = textarea();
    await typeInto(body, "Alpha\nBeta");
    body.setSelectionRange(0, body.value.length);
    await press(body, { key: "&", code: "Digit7", metaKey: true, shiftKey: true });

    expect(body.value).toBe("1. Alpha\n2. Beta");
    expect(document.activeElement).toBe(body);
    body.setSelectionRange(0, body.value.length);
    await press(body, { key: "*", code: "Digit8", metaKey: true, shiftKey: true });
    expect(body.value).toBe("- Alpha\n- Beta");

    body.setSelectionRange(body.value.length, body.value.length);
    await press(body, { key: "Enter" });
    expect(body.value).toBe("- Alpha\n- Beta\n- ");
    await press(body, { key: "Enter" });
    expect(body.value).toBe("- Alpha\n- Beta\n");
    expect(document.activeElement).toBe(body);
  });

  it("opens the shortcut drawer, hides its glyph durably, and recovers without the glyph", async () => {
    const body = textarea();
    await press(body, { key: "?", code: "Slash", metaKey: true, shiftKey: true });

    expect(container.querySelector('[aria-label="Keyboard shortcuts"]')).not.toBeNull();
    expect(container.textContent).toContain("Numbered list");
    expect(container.textContent).not.toContain("Attach image");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Numbered list, ⌘⇧7");

    await click(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("hide the ⌘ button"),
      )!,
    );
    expect(bridge.setShortcutButtonVisible).toHaveBeenCalledWith(false);
    expect(container.querySelector('.capture-shortcut-trigger')).toBeNull();
    expect(container.querySelector('.capture-shortcut-drawer')).toBeNull();

    await act(async () => captureCommand?.("open-shortcuts"));
    expect(container.querySelector('.capture-shortcut-drawer')).not.toBeNull();
    await act(async () => shortcutButtonVisibility?.(true));
    expect(container.querySelector('.capture-shortcut-trigger')).not.toBeNull();
  });

  it("runs list shortcuts while Command help is held without moving the selection", async () => {
    const body = textarea();
    await typeInto(body, "Alpha\nBeta");
    body.setSelectionRange(0, body.value.length);
    await press(body, { key: "Meta", code: "MetaLeft", metaKey: true });
    await press(body, { key: "Shift", code: "ShiftLeft", metaKey: true, shiftKey: true });
    expect(container.querySelector('.capture-shortcut-drawer')).not.toBeNull();
    expect(document.activeElement).toBe(body);

    await press(document.activeElement as HTMLElement, {
      key: "&", code: "Digit7", metaKey: true, shiftKey: true,
    });
    await nextFrame();
    expect(body.value).toBe("1. Alpha\n2. Beta");
    expect(container.querySelector('.capture-shortcut-drawer')).not.toBeNull();

    await press(document.activeElement as HTMLElement, {
      key: "*", code: "Digit8", metaKey: true, shiftKey: true,
    });
    await nextFrame();
    expect(body.value).toBe("- Alpha\n- Beta");
    await press(document.activeElement as HTMLElement, {
      key: "(", code: "Digit9", metaKey: true, shiftKey: true,
    });
    expect(body.placeholder).toBe("Add checklist items, one per line");
    await act(async () => body.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Meta", code: "MetaLeft", metaKey: false, bubbles: true,
    })));
    expect(container.querySelector('.capture-shortcut-drawer')).toBeNull();
  });

  it.each([
    ["numbered", "Digit7", "&", "1. "],
    ["bulleted", "Digit8", "*", "- "],
  ])("starts a %s list from empty capture while holding shortcut help", async (_kind, code, key, marker) => {
    const body = textarea();
    await press(body, { key: "Meta", code: "MetaLeft", metaKey: true });
    await press(body, { key, code, metaKey: true, shiftKey: true });
    await nextFrame();
    expect(body.value).toBe(marker);
    expect(body.selectionStart).toBe(marker.length);
    expect(document.activeElement).toBe(body);
    expect(container.querySelector('.capture-shortcut-drawer')).not.toBeNull();

    await act(async () => body.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Meta", code: "MetaLeft", metaKey: false, bubbles: true,
    })));
    await typeInto(body, marker + "First item");
    await press(body, { key: "Enter", metaKey: true });
    expect(bridge.captureThought).toHaveBeenCalledWith(marker + "First item", "mac-capture", []);
  });

  function textarea(): HTMLTextAreaElement {
    return container.querySelector("textarea") as HTMLTextAreaElement;
  }

  function combobox(): HTMLInputElement {
    return container.querySelector('[role="combobox"]') as HTMLInputElement;
  }

  function optionLabels(): string[] {
    return Array.from(container.querySelectorAll('[role="option"] strong')).map(
      (node) => node.textContent ?? "",
    );
  }

  async function remount() {
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<CapturePanel />));
  }
});

async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(element: HTMLElement, init: KeyboardEventInit) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

async function nextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("CapturePanel", () => {
  let captureFocus: (() => void) | undefined;
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    captureFocus = undefined;
    bridge.getShortcutButtonVisible.mockResolvedValue(true);
    bridge.setShortcutButtonVisible.mockImplementation(async (visible: boolean) => visible);
    bridge.listenForCaptureCommand.mockResolvedValue(() => undefined);
    bridge.listenForShortcutButtonVisibility.mockResolvedValue(() => undefined);
    bridge.captureThought.mockResolvedValue(savedThought);
    bridge.hideCapture.mockResolvedValue(undefined);
    bridge.listTagDefinitions.mockResolvedValue([]);
    bridge.resizeCapture.mockImplementation(async (height: number) => ({
      appliedHeight: height,
      maxHeight: height,
      constrained: false,
    }));
    bridge.listenForCaptureFocus.mockImplementation(async (callback: () => void) => {
      captureFocus = callback;
      return () => undefined;
    });
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    root = undefined;
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  async function renderCapture() {
    await act(async () => {
      root = createRoot(container);
      root.render(<CapturePanel />);
    });
  }

  function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function pressKey(
    textarea: HTMLTextAreaElement,
    key: string,
    modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {},
  ) {
    const event = new KeyboardEvent("keydown", {
      key,
      ...modifiers,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => textarea.dispatchEvent(event));
    return event;
  }

  it("autofocuses the thought field and exposes compact capture semantics", async () => {
    await renderCapture();

    const panel = container.querySelector<HTMLElement>(".capture-panel")!;
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const button = container.querySelector<HTMLButtonElement>(".primary-button")!;
    const status = container.querySelector<HTMLElement>("#capture-status")!;
    const shortcutHint = container.querySelector<HTMLElement>(".primary-button kbd")!;

    expect(document.activeElement).toBe(textarea);
    expect(panel.getAttribute("aria-busy")).toBe("false");
    expect(textarea.getAttribute("aria-describedby")).toBe("capture-status");
    expect(textarea.getAttribute("aria-keyshortcuts")).toBe(
      "Meta+Enter Meta+T Meta+Shift+7 Meta+Shift+8 Meta+Shift+9 Meta+Shift+/",
    );
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
    expect(button.getAttribute("aria-label")).toBe("Save thought");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(shortcutHint.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".capture-panel__footer")).toBeNull();
    expect(container.querySelector(".capture-tag-shelf")).toBeNull();
    expect(bridge.resizeCapture).toHaveBeenCalledWith(74, 150);
  });

  it("keeps clicked hotkeys open through native focus and closes them on Escape", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const trigger = container.querySelector<HTMLButtonElement>(".capture-shortcut-trigger")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => (container.querySelector(".capture-shortcut-drawer") ? 212 : 50),
    });
    setTextareaValue(textarea, "keep this draft");
    await click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(236, 150);
    const firstCommand = container.querySelector<HTMLButtonElement>(
      '[aria-label="Numbered list, ⌘⇧7"]',
    )!;
    expect(document.activeElement).toBe(firstCommand);

    await act(async () => captureFocus?.());

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".capture-shortcut-drawer")).not.toBeNull();
    expect(document.activeElement).toBe(firstCommand);
    expect(textarea.value).toBe("keep this draft");
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(236, 150);
    expect(bridge.hideCapture).not.toHaveBeenCalled();

    await act(async () => firstCommand.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".capture-shortcut-drawer")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(74, 150);
    expect(textarea.value).toBe("keep this draft");
  });

  it("shows held Command hotkeys until release without moving the draft or caret", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => (container.querySelector(".capture-shortcut-drawer") ? 212 : 50),
    });
    setTextareaValue(textarea, "keep my selected draft");
    textarea.setSelectionRange(5, 7);

    const down = new KeyboardEvent("keydown", {
      key: "Meta", code: "MetaLeft", metaKey: true, bubbles: true, cancelable: true,
    });
    await act(async () => textarea.dispatchEvent(down));
    expect(container.querySelector(".capture-shortcut-drawer")).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(down.defaultPrevented).toBe(false);
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(236, 150);

    await act(async () => vi.advanceTimersByTime(10_000));
    expect(container.querySelector(".capture-shortcut-drawer")).not.toBeNull();
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(7);
    expect(textarea.value).toBe("keep my selected draft");

    await act(async () => textarea.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Meta", code: "MetaLeft", metaKey: false, bubbles: true,
    })));
    expect(container.querySelector(".capture-shortcut-drawer")).toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(74, 150);
    expect(bridge.hideCapture).not.toHaveBeenCalled();
  });

  it("keeps held Command hotkeys until both Command keys are released and clears on blur", async () => {
    await renderCapture();
    const key = async (type: string, metaKey: boolean) => {
      await act(async () => window.dispatchEvent(new KeyboardEvent(type, {
        key: "Meta", metaKey, repeat: type === "keydown",
      })));
    };
    await key("keydown", true);
    await key("keydown", true);
    await key("keyup", true);
    expect(container.querySelector(".capture-shortcut-drawer")).not.toBeNull();
    await key("keyup", false);
    expect(container.querySelector(".capture-shortcut-drawer")).toBeNull();

    await key("keydown", true);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(container.querySelector(".capture-shortcut-drawer")).toBeNull();
  });

  it("keeps explicitly opened hotkeys visible after held Command is released", async () => {
    await renderCapture();
    await click(container.querySelector<HTMLButtonElement>(".capture-shortcut-trigger")!);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", metaKey: false }));
    });
    expect(container.querySelector(".capture-shortcut-drawer")).not.toBeNull();
  });

  it("shows held Command hotkeys even when the on-screen glyph is hidden", async () => {
    bridge.getShortcutButtonVisible.mockResolvedValue(false);
    await renderCapture();
    expect(container.querySelector(".capture-shortcut-trigger")).toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Meta", metaKey: true,
    })));
    expect(container.querySelector(".capture-shortcut-drawer")).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector("#brain-dump"));
  });

  it("grows for wrapped text, contracts on deletion, and keeps body focus", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    let textHeight = 94;
    let stackHeight = 110;
    let renderedTextHeight = 94;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () =>
        textarea.style.transition === "none"
          ? textHeight
          : Math.max(textHeight, renderedTextHeight),
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () =>
        Math.max(stackHeight, (Number.parseFloat(textarea.style.height) || 34) + 16),
    });

    setTextareaValue(textarea, "a thought that wraps across several visual lines");
    await act(async () => Promise.resolve());

    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(134, 150);
    expect(textarea.style.height).toBe("94px");
    expect(document.activeElement).toBe(textarea);

    textHeight = 34;
    stackHeight = 50;
    setTextareaValue(textarea, "");
    await act(async () => Promise.resolve());
    renderedTextHeight = 34;

    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(74, 150);
    expect(textarea.style.height).toBe("34px");
    expect(document.activeElement).toBe(textarea);
  });

  it("does not request another native resize for same-line edits", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    expect(bridge.resizeCapture).toHaveBeenCalledTimes(1);
    bridge.resizeCapture.mockClear();

    setTextareaValue(textarea, "a");
    await act(async () => Promise.resolve());
    setTextareaValue(textarea, "ab");
    await act(async () => Promise.resolve());
    setTextareaValue(textarea, "abc");
    await act(async () => Promise.resolve());

    expect(bridge.resizeCapture).not.toHaveBeenCalled();
  });

  it("remeasures a selected unsaved draft when font size changes without moving focus", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    setTextareaValue(textarea, "keep this unsaved thought");
    textarea.setSelectionRange(5, 9);
    textarea.scrollTop = 12;
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 94 });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => Number.parseFloat(textarea.style.height) + 16,
    });
    bridge.resizeCapture.mockClear();

    await act(async () => window.dispatchEvent(new Event("brain-cache:font-size-applied")));

    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(134, 150);
    expect(textarea.style.height).toBe("94px");
    expect(container.querySelector("#brain-dump")).toBe(textarea);
    expect(textarea.value).toBe("keep this unsaved thought");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(9);
    expect(textarea.scrollTop).toBe(12);
    expect(bridge.captureThought).not.toHaveBeenCalled();
    expect(bridge.captureChecklist).not.toHaveBeenCalled();
  });

  it("retries a same-height resize after the prior request fails", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 94,
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      value: 110,
    });
    let rejectFirst: ((reason: Error) => void) | undefined;
    bridge.resizeCapture.mockReset();
    bridge.resizeCapture
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue({ appliedHeight: 134, maxHeight: 134, constrained: false });

    setTextareaValue(textarea, "first same-height attempt");
    await act(async () => Promise.resolve());
    await act(async () => {
      rejectFirst?.(new Error("window manager unavailable"));
      await Promise.resolve();
    });
    setTextareaValue(textarea, "second same-height attempt");
    await act(async () => Promise.resolve());

    expect(bridge.resizeCapture).toHaveBeenCalledTimes(2);
    expect(bridge.resizeCapture).toHaveBeenNthCalledWith(1, 134, 150);
    expect(bridge.resizeCapture).toHaveBeenNthCalledWith(2, 134, 150);
  });

  it("revalidates the same desired height after capture is revealed", async () => {
    await renderCapture();
    bridge.resizeCapture.mockClear();

    act(() => captureFocus?.());
    await act(async () => Promise.resolve());

    expect(bridge.resizeCapture).toHaveBeenCalledTimes(1);
    expect(bridge.resizeCapture).toHaveBeenCalledWith(74, 150);
  });

  it("ignores an older resize result that resolves after a newer height", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    let textHeight = 94;
    let stackHeight = 110;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => textHeight,
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => stackHeight,
    });
    const pending = new Map<number, (result: {
      appliedHeight: number;
      maxHeight: number;
      constrained: boolean;
    }) => void>();
    bridge.resizeCapture.mockReset().mockImplementation(
      (height: number) =>
        new Promise((resolve) => {
          pending.set(height, resolve);
        }),
    );

    setTextareaValue(textarea, "first height");
    await act(async () => Promise.resolve());
    textHeight = 114;
    stackHeight = 130;
    setTextareaValue(textarea, "newer taller height");
    await act(async () => Promise.resolve());

    expect(bridge.resizeCapture.mock.calls.map(([height]) => height)).toEqual([134, 154]);

    await act(async () => {
      pending.get(154)?.({ appliedHeight: 154, maxHeight: 154, constrained: false });
      await Promise.resolve();
    });
    expect(
      (container.querySelector(".capture-panel") as HTMLElement).style.getPropertyValue(
        "--capture-panel-height",
      ),
    ).toBe("130px");

    await act(async () => {
      pending.get(134)?.({ appliedHeight: 134, maxHeight: 134, constrained: false });
      await Promise.resolve();
    });
    expect(
      (container.querySelector(".capture-panel") as HTMLElement).style.getPropertyValue(
        "--capture-panel-height",
      ),
    ).toBe("130px");
  });

  it("expands for the tag shelf and contracts when keyboard dismissal closes it", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => (container.querySelector(".capture-tag-shelf") ? 96 : 50),
    });

    await pressKey(textarea, "t", { metaKey: true });
    await act(async () => Promise.resolve());

    const tagInput = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(tagInput).not.toBeNull();
    expect(document.activeElement).toBe(tagInput);
    expect(tagInput.getAttribute("autocomplete")).toBe("off");
    expect(tagInput.getAttribute("autocapitalize")).toBe("none");
    expect(tagInput.getAttribute("autocorrect")).toBe("off");
    expect(tagInput.getAttribute("spellcheck")).toBe("false");
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(120, 150);

    await act(async () => {
      tagInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(container.querySelector(".capture-tag-shelf")).toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(74, 150);
  });

  it("requests one new height when tag suggestions grow the shelf", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    let stackHeight = 96;
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => stackHeight,
    });

    await pressKey(textarea, "t", { metaKey: true });
    await act(async () => Promise.resolve());
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(120, 150);
    bridge.resizeCapture.mockClear();

    stackHeight = 140;
    await typeInto(container.querySelector<HTMLInputElement>('[role="combobox"]')!, "w");
    await act(async () => Promise.resolve());

    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(bridge.resizeCapture).toHaveBeenCalledTimes(1);
    expect(bridge.resizeCapture).toHaveBeenCalledWith(164, 150);
  });

  it("clears a shelf validation row when Escape returns to text-only capture", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => {
        const shelfOpen = Boolean(container.querySelector(".capture-tag-shelf"));
        const validationVisible = Boolean(container.querySelector('[role="alert"]'));
        if (shelfOpen) return validationVisible ? 115 : 96;
        return validationVisible ? 73 : 50;
      },
    });

    await pressKey(textarea, "t", { metaKey: true });
    const tagInput = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await typeInto(tagInput, "x".repeat(33));
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Save thought"]')!);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Tags must be 32 characters or fewer.",
    );
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(139, 150);

    await press(tagInput, { key: "Escape" });

    expect(container.querySelector(".capture-tag-shelf")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(74, 150);
  });

  it("caps expansion to the active display and scrolls the textarea internally", async () => {
    bridge.resizeCapture.mockImplementation(async (height: number) => ({
      appliedHeight: Math.min(height, 160),
      maxHeight: 160,
      constrained: height > 160,
    }));
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 250,
    });
    Object.defineProperty(textarea, "clientHeight", {
      configurable: true,
      value: 120,
    });
    let scrollTop = 0;
    Object.defineProperty(textarea, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      value: 266,
    });

    const body = "a very long thought that exceeds the active display work area";
    setTextareaValue(textarea, body);
    textarea.setSelectionRange(body.length, body.length);
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(290, 150);
    expect(container.querySelector(".capture-dock")?.classList).toContain(
      "capture-dock--constrained",
    );
    expect(textarea.style.overflowY).toBe("auto");
    expect(textarea.style.height).toBe("120px");
    expect(textarea.scrollTop).toBe(130);
    expect(
      (container.querySelector(".capture-panel") as HTMLElement).style.getPropertyValue(
        "--capture-panel-height",
      ),
    ).toBe("136px");
  });

  it("does not move a constrained textarea when the caret is before the end", async () => {
    bridge.resizeCapture.mockImplementation(async (height: number) => ({
      appliedHeight: Math.min(height, 160),
      maxHeight: 160,
      constrained: height > 160,
    }));
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 250,
    });
    Object.defineProperty(textarea, "clientHeight", {
      configurable: true,
      value: 120,
    });
    let scrollTop = 40;
    Object.defineProperty(textarea, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      value: 266,
    });

    const body = "edit near the beginning of a long constrained thought";
    setTextareaValue(textarea, body);
    textarea.setSelectionRange(4, 4);
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(textarea.style.overflowY).toBe("auto");
    expect(textarea.scrollTop).toBe(40);
  });

  it("scrolls an oversized tag shelf inside the constrained panel", async () => {
    bridge.resizeCapture.mockImplementation(async (height: number) => ({
      appliedHeight: Math.min(height, 100),
      maxHeight: 100,
      constrained: height > 100,
    }));
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      get: () => (container.querySelector(".capture-tag-shelf") ? 150 : 50),
    });

    await pressKey(textarea, "t", { metaKey: true });
    await act(async () => Promise.resolve());

    const shelf = container.querySelector<HTMLElement>(".capture-tag-shelf")!;
    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(174, 150);
    expect(shelf.style.maxHeight).toBe("38px");
    expect(shelf.style.overflowY).toBe("auto");
  });

  it("respects the extra-large font minimum when sharing constrained height with a shelf", async () => {
    bridge.resizeCapture.mockImplementation(async (height: number) => ({
      appliedHeight: Math.min(height, 160),
      maxHeight: 160,
      constrained: height > 160,
    }));
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    textarea.style.minHeight = "40px";
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 120 });
    Object.defineProperty(stack, "scrollHeight", { configurable: true, value: 236 });
    await pressKey(textarea, "t", { metaKey: true });
    const shelf = container.querySelector<HTMLElement>(".capture-tag-shelf")!;
    Object.defineProperty(shelf, "scrollHeight", { configurable: true, value: 100 });

    await act(async () => window.dispatchEvent(new Event("brain-cache:font-size-applied")));

    expect(bridge.resizeCapture).toHaveBeenLastCalledWith(260, 150);
    expect(textarea.style.height).toBe("40px");
    expect(textarea.style.maxHeight).toBe("40px");
    expect(shelf.style.maxHeight).toBe("80px");
    expect(shelf.style.overflowY).toBe("auto");
    const contentHeight = Number.parseFloat(textarea.style.height) + Number.parseFloat(shelf.style.maxHeight) + 16;
    expect(contentHeight).toBe(136);
    expect(container.querySelector<HTMLElement>(".capture-panel")!.style.getPropertyValue("--capture-panel-height")).toBe(`${contentHeight}px`);
  });

  it("requests immediate resizing when Reduce Motion is enabled", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    await renderCapture();

    expect(bridge.resizeCapture).toHaveBeenCalledWith(74, 0);
  });

  it("keeps plain Return for newlines and saves from the pointer affordance", async () => {
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const saveButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Save thought"]',
    )!;
    setTextareaValue(textarea, "two-line thought");

    const returnKey = await pressKey(textarea, "Enter");

    expect(returnKey.defaultPrevented).toBe(false);
    expect(bridge.captureThought).not.toHaveBeenCalled();

    await click(saveButton);

    expect(bridge.captureThought).toHaveBeenCalledWith(
      "two-line thought",
      "mac-capture",
      [],
    );
  });

  it("falls back to the last applied height on resize failure without affecting capture", async () => {
    bridge.resizeCapture.mockRejectedValue(new Error("window manager unavailable"));
    await renderCapture();
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const stack = container.querySelector<HTMLElement>(".capture-panel__stack")!;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 250,
    });
    Object.defineProperty(stack, "scrollHeight", {
      configurable: true,
      value: 266,
    });
    setTextareaValue(textarea, "still save this locally");
    await act(async () => Promise.resolve());

    expect(container.querySelector(".capture-dock")?.classList).toContain(
      "capture-dock--constrained",
    );
    expect(textarea.style.overflowY).toBe("auto");
    expect(textarea.style.height).toBe("34px");
    expect(
      (container.querySelector(".capture-panel") as HTMLElement).style.getPropertyValue(
        "--capture-panel-height",
      ),
    ).toBe("50px");

    await pressKey(textarea, "Enter", { metaKey: true });

    expect(bridge.captureThought).toHaveBeenCalledWith(
      "still save this locally",
      "mac-capture",
      [],
    );
    expect(container.querySelector("#capture-status")?.textContent).toBe("saved locally");
  });

  it("saves with Command Return, confirms locally, clears, and hides after 360ms", async () => {
    let finishCapture: ((value: Thought) => void) | undefined;
    bridge.captureThought.mockReturnValue(
      new Promise((resolve) => {
        finishCapture = resolve;
      }),
    );
    await renderCapture();

    const panel = container.querySelector<HTMLElement>(".capture-panel")!;
    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const button = container.querySelector<HTMLButtonElement>(".primary-button")!;
    setTextareaValue(textarea, "a compact local thought");

    const saveKey = await pressKey(textarea, "Enter", { metaKey: true });

    expect(saveKey.defaultPrevented).toBe(true);
    expect(bridge.captureThought).toHaveBeenCalledWith(
      "a compact local thought",
      "mac-capture",
      [],
    );
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    expect(container.querySelector("#capture-status")?.textContent).toBe("writing to cache…");

    await act(async () => finishCapture?.(savedThought));

    expect(textarea.value).toBe("");
    expect(panel.getAttribute("aria-busy")).toBe("false");
    expect(button.disabled).toBe(true);
    expect(container.querySelector("#capture-status")?.textContent).toBe("saved locally");
    expect(bridge.hideCapture).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(359));
    expect(bridge.hideCapture).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(bridge.hideCapture).toHaveBeenCalledTimes(1);
  });

  it("retains and refocuses text on save error, while Escape only dismisses", async () => {
    bridge.captureThought.mockRejectedValue(new Error("Local write failed."));
    await renderCapture();

    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    const button = container.querySelector<HTMLButtonElement>(".primary-button")!;
    setTextareaValue(textarea, "do not lose this");
    await pressKey(textarea, "Enter", { metaKey: true });

    expect(textarea.value).toBe("do not lose this");
    expect(document.activeElement).toBe(textarea);
    expect(button.disabled).toBe(false);
    expect(container.querySelector("#capture-status")?.textContent).toBe("Local write failed.");

    const escapeKey = await pressKey(textarea, "Escape");

    expect(escapeKey.defaultPrevented).toBe(true);
    expect(bridge.hideCapture).toHaveBeenCalledTimes(1);
    expect(bridge.captureThought).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("do not lose this");
  });

  it("keeps an escaped draft on reopen and cancels a stale post-save hide", async () => {
    await renderCapture();

    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    setTextareaValue(textarea, "return to this draft");
    await pressKey(textarea, "Escape");
    expect(bridge.hideCapture).toHaveBeenCalledTimes(1);

    act(() => captureFocus?.());
    expect(textarea.value).toBe("return to this draft");
    expect(document.activeElement).toBe(textarea);
    expect(container.querySelector("#capture-status")?.textContent).toBe(
      "local only · saved before sync",
    );

    await pressKey(textarea, "Enter", { metaKey: true });
    expect(textarea.value).toBe("");
    expect(container.querySelector("#capture-status")?.textContent).toBe("saved locally");

    act(() => captureFocus?.());
    await act(async () => vi.advanceTimersByTime(360));
    expect(bridge.hideCapture).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("");
    expect(container.querySelector("#capture-status")?.textContent).toBe(
      "local only · saved before sync",
    );
  });

  it("starts with an empty draft after a component relaunch", async () => {
    await renderCapture();

    const textarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    setTextareaValue(textarea, "process-local draft");

    await act(async () => root?.render(<CapturePanel key="relaunched" />));

    const relaunchedTextarea = container.querySelector<HTMLTextAreaElement>("#brain-dump")!;
    expect(relaunchedTextarea.value).toBe("");
    expect(document.activeElement).toBe(relaunchedTextarea);
    expect(container.querySelector("#capture-status")?.textContent).toBe(
      "local only · saved before sync",
    );
  });
});

describe("CapturePanel sizing cleanup", () => {
  it("cancels a queued native resize when the panel unmounts", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    bridge.captureThought.mockResolvedValue(savedThought);
    bridge.hideCapture.mockResolvedValue(undefined);
    bridge.listTagDefinitions.mockResolvedValue([]);
    bridge.listenForCaptureFocus.mockResolvedValue(() => undefined);
    bridge.getShortcutButtonVisible.mockResolvedValue(true);
    bridge.setShortcutButtonVisible.mockImplementation(async (visible: boolean) => visible);
    bridge.listenForCaptureCommand.mockResolvedValue(() => undefined);
    bridge.listenForShortcutButtonVisibility.mockResolvedValue(() => undefined);
    bridge.resizeCapture.mockReset().mockResolvedValue({
      appliedHeight: 74,
      maxHeight: 74,
      constrained: false,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<CapturePanel />));
    await act(async () => root.unmount());
    for (const callback of frames.values()) callback(0);

    expect(bridge.resizeCapture).not.toHaveBeenCalled();
    container.remove();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });
});
