import { useEffect, useRef, useState } from "react";
import { TagColorPicker } from "./TagEditor";
import { colorForTag } from "./TagColor";
import type { TagColor, TagDefinition } from "./types";

export function TagColors({ tags, definitions, activeTag, onChange }: {
  tags: string[];
  definitions: TagDefinition[];
  activeTag: string | null;
  onChange: (tag: string, color: TagColor | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const tag = tags.includes(selectedTag) ? selectedTag : (tags[0] ?? "");

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: MouseEvent) {
      if (shellRef.current?.contains(event.target as Node)) return;
      const focusable = event.target instanceof Element && event.target.closest("button, input, select, textarea, a[href], [tabindex]");
      close(!focusable);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  async function changeColor(color: TagColor | null) {
    if (pending || !tag) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await onChange(tag, color);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that tag color.");
    } finally {
      setPending(false);
      requestAnimationFrame(() => selectRef.current?.focus());
    }
  }

  return (
    <div ref={shellRef} className="tag-colors">
      <button ref={triggerRef} className="tag-rail__more tag-colors__trigger" type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => {
        if (open) close();
        else {
          setSelectedTag(activeTag ?? tags[0] ?? "");
          setError(null);
          setSaved(false);
          setOpen(true);
          requestAnimationFrame(() => selectRef.current?.focus());
        }
      }}>Tag colors</button>
      {open && <div className="tag-colors__popover" role="dialog" aria-label="Tag colors" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      }} onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !shellRef.current?.contains(event.relatedTarget)) close(false);
      }}>
        <div className="tag-colors__heading"><strong>Tag colors</strong><button type="button" aria-label="Close tag colors" onClick={() => close()}>×</button></div>
        <label className="tag-colors__select">Tag
          <select ref={selectRef} aria-label="Tag to recolor" value={tag} disabled={pending} onChange={(event) => {
            setSelectedTag(event.target.value); setError(null); setSaved(false);
          }}>{tags.map((name) => <option key={name} value={name}>#{name}</option>)}</select>
        </label>
        <TagColorPicker tag={tag} color={colorForTag(definitions, tag)} disabled={pending} onChoose={(color) => void changeColor(color)} onClose={() => close()} />
        <p className="tag-colors__hint">Applies everywhere this tag is used.</p>
        <p className="tag-colors__status" role="status">{pending ? "Saving color…" : saved ? "Color saved locally" : ""}</p>
        {error && <p className="tag-colors__error" role="alert">{error} Choose a color to retry.</p>}
      </div>}
    </div>
  );
}
