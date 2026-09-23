import { useEffect, useRef, useState } from "react";
import { Paperclip, X, LoaderCircle } from "lucide-react";
import { api } from "./api";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  type Attachment,
} from "../shared/attachments";

export function AttachmentPreview({ item }: { item: Attachment }) {
  return (
    <details className="attachment-preview">
      <summary>
        {item.name}{" "}
        <span>
          {item.size < 1024
            ? `${item.size} B`
            : `${(item.size / 1024).toFixed(0)} KB`}{" "}
          · {item.kind === "apk" ? "Package report" : "Extracted text"}
        </span>
      </summary>
      {item.warnings.map((w) => (
        <p className="attachment-warning" key={w}>
          {w}
        </p>
      ))}
      <pre>{item.text}</pre>
    </details>
  );
}
export function ChatAttachments({
  disabled,
  inherited = 0,
  onChange,
  onBusy,
}: {
  disabled: boolean;
  inherited?: number;
  onChange: (items: Attachment[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const current = useRef<Attachment[]>([]);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    onChange([]);
    onBusy(false);
    return () => {
      alive.current = false;
      controller.current?.abort();
      for (const item of current.current)
        void api(`/attachments/${item.id}`, "DELETE").catch(() => {});
    };
  }, []);
  function update(next: Attachment[]) {
    current.current = next;
    setItems(next);
    onChange(next);
  }
  async function choose(files: File[]) {
    if (disabled || controller.current) return;
    setError("");
    if (
      files.length + current.current.length + inherited >
      ATTACHMENT_MAX_FILES
    ) {
      setError(
        "Up to four files per conversation. Start a new session for additional files.",
      );
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    onBusy(true);
    try {
      for (const file of files) {
        if (
          !/\.(md|txt|pdf|docx|apk)$/i.test(file.name) ||
          file.size === 0 ||
          file.size > ATTACHMENT_MAX_BYTES
        ) {
          throw new Error(
            "Choose a nonempty MD, TXT, PDF, DOCX or APK file up to 20 MB.",
          );
        }
        setProgress(`Reading ${file.name}…`);
        const response = await fetch("/api/attachments", {
          method: "POST",
          credentials: "same-origin",
          signal: abort.signal,
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Council-Request": "1",
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            result.error || `Upload failed (${response.status}).`,
          );
        if (!alive.current) {
          void api(`/attachments/${result.id}`, "DELETE").catch(() => {});
          return;
        }
        update([...current.current, result]);
      }
    } catch (e) {
      if (alive.current && !abort.signal.aborted)
        setError((e as Error).message);
    } finally {
      if (alive.current) {
        setProgress("");
        onBusy(false);
        controller.current = null;
      }
    }
  }
  return (
    <div className="chat-attachments">
      <input
        ref={input}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        hidden
        aria-label="Choose attachments"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          void choose(files);
        }}
      />
      <button
        className="attach-button"
        type="button"
        disabled={disabled || !!progress}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={16} /> Attach files
      </button>
      <span className="attachment-help">
        MD, TXT, PDF, DOCX, APK · 20 MB each · 4 files
      </span>
      {inherited > 0 && (
        <p className="attachment-help">
          {inherited} file(s) from this conversation remain shared with the
          team.
        </p>
      )}
      {progress && (
        <p role="status">
          <LoaderCircle size={14} className="spin" /> {progress}
        </p>
      )}
      {error && (
        <p role="alert" className="attachment-warning">
          {error}
        </p>
      )}
      {items.map((item) => (
        <div className="attachment-item" key={item.id}>
          <AttachmentPreview item={item} />
          <button
            type="button"
            disabled={disabled || !!progress}
            aria-label={`Remove ${item.name}`}
            onClick={() => {
              update(current.current.filter((a) => a.id !== item.id));
              void api(`/attachments/${item.id}`, "DELETE").catch(() => {});
            }}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      {!!items.length && (
        <p className="attachment-help">
          Preview the extracted content above. Sending shares it with every
          model in your team. Original files are not retained.
        </p>
      )}
    </div>
  );
}
