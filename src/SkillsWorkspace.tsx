import { useEffect, useRef, useState } from "react";
import { Eye, FolderUp, Trash2, Upload } from "lucide-react";
import { api } from "./api";

interface Skill {
  name: string;
  description: string;
  source: "builtin" | "user";
  id?: string;
  enabled: boolean;
  resources: string[];
  updatedAt?: string;
}

interface SkillView {
  name: string;
  source: "builtin" | "user";
  content: string;
  resources: Record<string, string>;
}

// Match the server's per-file and per-skill limits.
const TEXT_LIMIT = 32_000;
const TOTAL_LIMIT = 200_000;
const REQUEST_BYTES_LIMIT = 480_000;

export function SkillsWorkspace() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [maxUserSkills, setMaxUserSkills] = useState(50);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [viewing, setViewing] = useState<SkillView | null>(null);
  const [resource, setResource] = useState("");
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const viewer = useRef<HTMLElement>(null);

  async function refresh() {
    const data = await api("/skills");
    setSkills(data.skills);
    setMaxUserSkills(data.maxUserSkills);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (viewing)
      viewer.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [viewing]);

  async function act(work: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await work());
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const skipped: string[] = [];
    const files: { path: string; content: string }[] = [];
    for (const file of Array.from(list)) {
      const path = file.webkitRelativePath || file.name;
      // Skip hidden files and folders such as .git or .DS_Store.
      if (path.split("/").some((part) => part.startsWith("."))) continue;
      if (file.size > TEXT_LIMIT * 4) {
        skipped.push(path);
        continue;
      }
      const content = await file.text();
      if (content.length > TEXT_LIMIT || content.includes("\u0000")) {
        skipped.push(path);
        continue;
      }
      files.push({ path, content });
    }
    await act(async () => {
      if (!files.length)
        throw new Error(
          "No usable text files were selected. Include SKILL.md (hidden, binary and files over 32,000 characters are skipped).",
        );
      const total = files.reduce((sum, f) => sum + f.content.length, 0);
      if (
        total > TOTAL_LIMIT ||
        new Blob([JSON.stringify({ files })]).size > REQUEST_BYTES_LIMIT
      )
        throw new Error(
          "This skill is too large to upload. Keep it under 200,000 characters (non-English text counts more) by removing or shortening reference files.",
        );
      const saved = await api("/skills", "POST", { files });
      return `${saved.replaced ? "Updated" : "Added"} skill ${saved.name}${saved.resources.length ? ` with ${saved.resources.length} resource file(s)` : ""}.${skipped.length ? ` Skipped non-text or large files: ${skipped.join(", ")}.` : ""}`;
    });
  }

  async function view(name: string) {
    setError("");
    try {
      setViewing(await api(`/skills/view/${encodeURIComponent(name)}`));
      setResource("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const builtin = skills.filter((s) => s.source === "builtin");
  const mine = skills.filter((s) => s.source === "user");
  const card = (s: Skill) => (
    <div className="skill-card" key={`${s.source}:${s.name}`}>
      <div className="skill-card-head">
        <strong>{s.name}</strong>
        <span className="tiny-tag">
          {s.source === "builtin" ? "Built-in" : s.enabled ? "On" : "Off"}
        </span>
      </div>
      <p className="field-help">{s.description}</p>
      <div className="modal-actions">
        <button
          className="quiet-button"
          disabled={busy}
          onClick={() => view(s.name)}
        >
          <Eye size={14} /> View
        </button>
        {s.source === "user" && s.id && (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={s.enabled}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.checked;
                  act(async () => {
                    await api(`/skills/${s.id}`, "PATCH", { enabled: next });
                    return `${s.name} ${next ? "enabled" : "disabled"}.`;
                  });
                }}
              />{" "}
              Available to agents
            </label>
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Delete skill ${s.name}?`)) return;
                act(async () => {
                  await api(`/skills/${s.id}`, "DELETE");
                  if (viewing?.name === s.name) setViewing(null);
                  return `Deleted ${s.name}.`;
                });
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="skills-workspace">
      <p className="modal-intro">
        Skills are reusable expert playbooks in the SKILL.md format used by
        Claude Code and other agents. Every agent sees each skill&apos;s name
        and description, loads the full instructions when your goal or message
        matches, and the Skills Agent checks the team applies them. Skills are
        text only: Council never runs their scripts, and they cannot grant tools
        or permissions.
      </p>
      {error && <div className="error">{error}</div>}
      {notice && <div className="success-note">{notice}</div>}
      <h3>Built-in skills</h3>
      <div className="skill-list">{builtin.map(card)}</div>
      <h3>
        Your skills{" "}
        <span className="tiny-tag">
          {mine.length}/{maxUserSkills}
        </span>
      </h3>
      {mine.length ? (
        <div className="skill-list">{mine.map(card)}</div>
      ) : (
        <p className="field-help">
          You have not added any skills yet. Upload one below.
        </p>
      )}
      <h3>Add a skill</h3>
      <p className="field-help">
        Upload a skill folder (SKILL.md plus references/, scripts/ or assets/),
        or pick SKILL.md with any reference files. SKILL.md needs frontmatter
        with a lowercase hyphenated <code>name</code> and a{" "}
        <code>description</code> that says when to use it. Uploading a skill
        with an existing name replaces it.
      </p>
      <div className="modal-actions skill-upload">
        <button
          className="quiet-button bordered"
          disabled={busy}
          onClick={() => folderInput.current?.click()}
        >
          <FolderUp size={14} /> Upload skill folder
        </button>
        <button
          className="quiet-button bordered"
          disabled={busy}
          onClick={() => filesInput.current?.click()}
        >
          <Upload size={14} /> Upload SKILL.md and files
        </button>
        <input
          ref={folderInput}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={filesInput}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <label>
        Or paste SKILL.md
        <textarea
          className="file-editor"
          value={paste}
          maxLength={TEXT_LIMIT}
          placeholder={
            "---\nname: my-skill\ndescription: When to use this skill and what it does.\n---\n\nStep-by-step instructions…"
          }
          onChange={(e) => setPaste(e.target.value)}
        />
      </label>
      <div className="modal-actions">
        <button
          className="primary"
          disabled={busy || !paste.trim()}
          onClick={() =>
            act(async () => {
              const saved = await api("/skills", "POST", {
                files: [{ path: "SKILL.md", content: paste }],
              });
              setPaste("");
              return `${saved.replaced ? "Updated" : "Added"} skill ${saved.name}.`;
            })
          }
        >
          Save skill
        </button>
      </div>
      {viewing && (
        <section className="skill-viewer" ref={viewer}>
          <div className="resource-heading">
            <h3>{viewing.name}</h3>
            <button className="quiet-button" onClick={() => setViewing(null)}>
              Close
            </button>
          </div>
          {Object.keys(viewing.resources).length > 0 && (
            <div className="file-pills">
              <button onClick={() => setResource("")}>SKILL.md</button>
              {Object.keys(viewing.resources).map((path) => (
                <button key={path} onClick={() => setResource(path)}>
                  {path}
                </button>
              ))}
            </div>
          )}
          <pre className="skill-source">
            {resource ? viewing.resources[resource] : viewing.content}
          </pre>
        </section>
      )}
    </div>
  );
}
