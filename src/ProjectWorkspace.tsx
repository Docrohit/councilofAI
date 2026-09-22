import { useEffect, useRef, useState } from "react";
import { api } from "./api";
export function ProjectWorkspace({
  close,
  enabled,
  enable,
  running,
}: {
  close: () => void;
  enabled: boolean;
  enable: (value: boolean) => Promise<void>;
  running: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<any>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [files, setFiles] = useState<{ path: string; size: number }[]>([]);
  const [path, setPath] = useState("main.js"),
    [content, setContent] = useState(""),
    [sha, setSha] = useState<string | null>(null);
  const [saved, setSaved] = useState(""),
    [loadedPath, setLoadedPath] = useState("main.js");
  const [command, setCommand] = useState("node --test"),
    [output, setOutput] = useState("");
  const dirty = content !== saved || path !== loadedPath;
  function dismiss() {
    if (dirty)
      setError("Save or discard your edits before closing the project.");
    else close();
  }
  async function request(body: unknown) {
    return api("/sandbox", "POST", body);
  }
  async function refresh() {
    const s = await api("/sandbox");
    setStatus(s);
    if (s.active) setFiles((await request({ action: "tree" })).files);
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    void perform(refresh);
  }, []);
  async function read(selected: string) {
    if (dirty)
      throw new Error("Save your edits before selecting another file.");
    const file = await request({ action: "read", path: selected });
    setPath(selected);
    setLoadedPath(selected);
    setContent(file.content);
    setSaved(file.content);
    setSha(file.sha);
  }
  function download(data: unknown) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "council-project.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <dialog
      ref={dialog}
      className="modal wide project-modal"
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <div className="modal-head">
        <h2>Hosted coding project</h2>
        <button
          className="icon-button"
          onClick={dismiss}
          aria-label="Close project"
        >
          ×
        </button>
      </div>
      <p className="modal-intro">
        A temporary Node.js workspace for files, code and tests. Export before
        leaving: projects expire after 30 minutes idle, two hours total, or a
        service restart. No network or package downloads. Limits: 64 MB project,
        256 MB RAM, 30 seconds per command.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!status ? (
        <p>Checking project service…</p>
      ) : !status.available ? (
        <p className="notice">
          Hosted projects are not enabled on this installation. Connect an
          OpenCode worker for an existing project.
        </p>
      ) : !status.active ? (
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await request({ action: "create" });
              await refresh();
            })
          }
        >
          Create isolated project
        </button>
      ) : (
        <>
          <label className="project-enable">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy || running}
              onChange={(e) => void perform(() => enable(e.target.checked))}
            />{" "}
            Allow agents to edit and run commands in this project for new
            councils
          </label>
          {running && (
            <p className="notice">
              The council is working. You can read and export; stop it before
              editing or running manual commands.
            </p>
          )}
          <div className="project-toolbar">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void perform(refresh)}
            >
              Refresh files
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void perform(async () =>
                  download(await request({ action: "export" })),
                )
              }
            >
              Export project
            </button>
            <label className="button secondary">
              Import export
              <input
                type="file"
                accept="application/json,.json"
                disabled={busy || running}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void perform(async () => {
                      if (dirty)
                        throw new Error("Save your edits before importing.");
                      if (file.size > 300000)
                        throw new Error("Import exceeds 300 KB.");
                      const data = JSON.parse(await file.text());
                      if (!Array.isArray(data.files) || data.files.length > 500)
                        throw new Error("Invalid project export.");
                      const existing = (await request({ action: "tree" }))
                        .files;
                      if (existing.length)
                        throw new Error(
                          "Import into an empty project to avoid overwriting files.",
                        );
                      for (const f of data.files) {
                        if (
                          typeof f.path !== "string" ||
                          typeof f.content !== "string"
                        )
                          throw new Error("Invalid exported file.");
                        await request({
                          action: "write",
                          path: f.path,
                          content: f.content,
                          sha: null,
                        });
                      }
                      await refresh();
                    });
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="project-editor-layout">
            <nav aria-label="Project files">
              {files.map((f) => (
                <button
                  key={f.path}
                  className={f.path === loadedPath ? "selected" : ""}
                  disabled={busy}
                  onClick={() => void perform(() => read(f.path))}
                >
                  {f.path}
                </button>
              ))}
              {!files.length && (
                <p>No files yet. Create your first file in the editor.</p>
              )}
            </nav>
            <div className="project-editor">
              <label>
                File path
                <input
                  aria-label="Project file path"
                  value={path}
                  disabled={busy || running}
                  onChange={(e) => setPath(e.target.value)}
                />
              </label>
              <textarea
                aria-label="Project code editor"
                spellCheck={false}
                value={content}
                disabled={busy || running}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const el = e.currentTarget,
                      start = el.selectionStart,
                      end = el.selectionEnd;
                    setContent(
                      content.slice(0, start) + "  " + content.slice(end),
                    );
                    requestAnimationFrame(() => {
                      el.selectionStart = el.selectionEnd = start + 2;
                    });
                  }
                }}
              />
              <div className="project-toolbar">
                <span>
                  {content.split("\n").length} lines ·{" "}
                  {dirty ? "Unsaved changes" : "Saved"}
                </span>
                <button
                  className="button primary"
                  disabled={busy || running}
                  onClick={() =>
                    void perform(async () => {
                      const f = await request({
                        action: "write",
                        path,
                        content,
                        sha: path === loadedPath ? sha : null,
                      });
                      setSha(f.sha);
                      setSaved(f.content);
                      setLoadedPath(path);
                      await refresh();
                    })
                  }
                >
                  Save file
                </button>
                <button
                  className="button secondary"
                  disabled={busy || running}
                  onClick={() => {
                    setContent(saved);
                    setPath(loadedPath);
                  }}
                >
                  Discard edits
                </button>
              </div>
            </div>
          </div>
          <section className="project-terminal">
            <h3>Command terminal</h3>
            <p>
              Each command starts in /workspace. Use “cd folder &amp;&amp;
              command” within one invocation; interactive programs are not
              supported.
            </p>
            <pre aria-label="Terminal output" tabIndex={0}>
              {output || "Ready. Save files, then run a command."}
            </pre>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  const result = await request({ action: "exec", command });
                  setOutput((previous) =>
                    (
                      previous +
                      `\n$ ${command}\n${result.stdout}${result.stderr}\n[exit ${result.exitCode}${result.timedOut ? " · timed out" : ""}]\n`
                    ).slice(-64000),
                  );
                  await refresh();
                });
              }}
            >
              <input
                aria-label="Terminal command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={busy || running}
              />
              <button
                className="button primary"
                disabled={busy || running || !command.trim()}
              >
                {busy ? "Working…" : "Run command"}
              </button>
            </form>
          </section>
          <details className="project-reset">
            <summary>Delete this temporary project</summary>
            <p>Export any files you want to keep first.</p>
            <button
              className="button secondary"
              disabled={busy || running}
              onClick={() =>
                void perform(async () => {
                  await request({ action: "destroy" });
                  await enable(false);
                  setContent("");
                  setSaved("");
                  setSha(null);
                  await refresh();
                })
              }
            >
              Delete project and its files
            </button>
          </details>
        </>
      )}
    </dialog>
  );
}
