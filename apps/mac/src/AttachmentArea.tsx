import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { chooseAttachmentFiles, isTauriRuntime, openAttachment, readAttachmentData } from "./bridge";
import { fileSize, readAttachmentFiles, validateAttachments } from "./attachments";
import type { Attachment, AttachmentDraft } from "./types";

export interface AttachmentAreaHandle {
  addFiles: (files: File[], onAdd?: (files: AttachmentDraft[]) => Promise<void>) => Promise<boolean>;
  flush: () => Promise<boolean>;
  retry: () => Promise<boolean>;
}

interface Props {
  files: Attachment[];
  drafts?: AttachmentDraft[];
  compact?: boolean;
  filesOnly?: boolean;
  inlineIds?: Set<string>;
  disabled?: boolean;
  onAdd: (files: AttachmentDraft[]) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

export const AttachmentArea = forwardRef<AttachmentAreaHandle, Props>(function AttachmentArea(props, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const pending = useRef<Promise<boolean> | null>(null);
  const queue = useRef<Array<() => Promise<void>>>([]);
  const failed = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function run(action: () => Promise<void>): Promise<boolean> {
    if (latest.current.disabled) return Promise.resolve(false);
    queue.current.push(action);
    return start();
  }

  function start(): Promise<boolean> {
    if (pending.current) return pending.current;
    failed.current = false;
    setError(null);
    setBusy(true);
    latest.current.onBusyChange?.(true);
    pending.current = Promise.resolve().then(async () => {
      while (queue.current.length) {
        await queue.current[0]();
        queue.current.shift();
      }
    }).then(() => true).catch((cause: unknown) => {
      failed.current = true;
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not save the attachment locally.");
      return false;
    }).finally(() => {
      pending.current = null;
      if (mounted.current) {
        setBusy(false);
        latest.current.onBusyChange?.(false);
      }
    });
    return pending.current;
  }

  function add(load: () => Promise<AttachmentDraft[]>, onAdd?: (files: AttachmentDraft[]) => Promise<void>): Promise<boolean> {
    let prepared: AttachmentDraft[] | null = null;
    return run(async () => {
      prepared ??= await load();
      if (!prepared.length) return;
      const newFiles = prepared.filter((file) => !latest.current.files.some((saved) => saved.id === file.id));
      validateAttachments(newFiles, latest.current.files);
      await (onAdd ?? latest.current.onAdd)(prepared);
    });
  }

  useImperativeHandle(ref, () => ({
    addFiles: (files, onAdd) => add(() => readAttachmentFiles(files), onAdd),
    flush: () => pending.current ?? Promise.resolve(!failed.current),
    retry: () => pending.current ?? (failed.current ? start() : Promise.resolve(true)),
  }));

  const disabled = busy || props.disabled;
  const visibleFiles = props.files.filter((file) => !props.inlineIds?.has(file.id)
    && (!props.filesOnly || !file.mimeType.startsWith("image/")));
  return (
    <section className={`attachment-area${props.compact ? " attachment-area--compact capture-optional-shelf" : ""}`} aria-label="Attachments" aria-busy={busy}>
      <div className="attachment-area__heading">
        {!props.compact && <span className="eyebrow">files</span>}
        <button type="button" className="attachment-add" disabled={disabled} onClick={() => {
          if (isTauriRuntime()) void add(chooseAttachmentFiles);
          else inputRef.current?.click();
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 11-9 9a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9-9" /></svg>
          {busy ? "saving files…" : "add files"}
        </button>
        <input ref={inputRef} type="file" multiple hidden tabIndex={-1} aria-label="Choose attachments" disabled={disabled} onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) void add(() => readAttachmentFiles(files));
        }} />
        {props.compact && !props.files.length && <span className="attachment-area__hint">or drop / paste</span>}
      </div>
      {visibleFiles.length > 0 && <ul className="attachment-list">
        {visibleFiles.map((file) => (
          <li className="attachment-file" key={file.id}>
            {props.filesOnly ? <span className="attachment-preview attachment-preview--file" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 13h8M8 17h6" />
              </svg>
            </span> : <AttachmentPreview file={file} draft={props.drafts?.find((draft) => draft.id === file.id)} />}
            <div className="attachment-file__info">
              {props.drafts ? <span title={file.name}>{file.name}</span> : <button type="button" title={`Open ${file.name}`} onClick={() => {
                setOpenError(null);
                void openAttachment(file).catch((cause: unknown) => setOpenError(cause instanceof Error ? cause.message : "Could not open the attachment."));
              }}>{file.name}</button>}
              <small>{fileSize(file.size)}</small>
            </div>
            <button className="attachment-remove" type="button" disabled={disabled} aria-label={`Remove attachment ${file.name}`} title="Remove attachment" onClick={() => void run(() => latest.current.onRemove(file.id))}>×</button>
          </li>
        ))}
      </ul>}
      {!props.compact && <p className="attachment-area__hint">Drop files here · up to 20 MB each · saved locally</p>}
      {error && <div className="attachment-error" role="alert">
        <span>{error}</span>
        <button type="button" disabled={busy} onClick={() => void start()}>retry</button>
        <button type="button" disabled={busy} onClick={() => { queue.current = []; failed.current = false; setError(null); }}>dismiss</button>
      </div>}
      {openError && <p className="attachment-error" role="alert">{openError}</p>}
    </section>
  );
});

export function AttachmentPreview({ file, draft, card = false }: { file: Attachment; draft?: AttachmentDraft; card?: boolean }) {
  const image = file.mimeType.startsWith("image/");
  const previewRef = useRef<HTMLElement | null>(null);
  const [load, setLoad] = useState(!card);
  const [data, setData] = useState<string | null>(draft?.data ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (load || !image) return;
    if (typeof IntersectionObserver === "undefined") { setLoad(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px" });
    if (previewRef.current) observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [image, load]);
  useEffect(() => {
    if (!image || draft || !load) return;
    let active = true;
    void readAttachmentData(file.id).then((value) => { if (active) setData(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [file.id, image, draft, load]);
  const className = `attachment-preview${card ? " attachment-preview--card" : ""}`;
  return image && data && !failed
    ? <img ref={(node) => { previewRef.current = node; }} className={className} src={`data:${file.mimeType};base64,${data}`} alt={`Preview of ${file.name}`} decoding="async" onError={() => setFailed(true)} />
    : <span ref={(node) => { previewRef.current = node; }} className={`${className} attachment-preview--file`} aria-hidden={card ? undefined : true}>
        {card ? `${failed ? "Preview unavailable · " : ""}${file.name}` : file.name.split(".").at(-1)?.slice(0, 5).toUpperCase() || "FILE"}
      </span>;
}
