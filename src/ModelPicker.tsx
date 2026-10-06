import { useEffect, useMemo, useRef, useState } from "react";
import { searchCatalog, type CatalogEntry } from "../shared/modelCatalog";

// Type part of a model name ("gpt", "glm", "deepseek"...), pick one: provider,
// endpoint and exact model ID come with it. Shared design with Council of AI.

let cached: Promise<CatalogEntry[]> | undefined;
export function loadCatalog(url: string, headers: Record<string, string> = {}) {
  cached ||= fetch(url, { credentials: "same-origin", headers })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((d) => (Array.isArray(d.models) ? d.models : []))
    .catch(() => {
      // Not cached: the next picker that opens tries again.
      cached = undefined;
      return [];
    });
  return cached;
}

const NONE: CatalogEntry[] = [];

export function useCatalog(url: string, extra: CatalogEntry[] = NONE, headers?: Record<string, string>) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  useEffect(() => {
    loadCatalog(url, headers).then(setEntries);
  }, [url]);
  return useMemo(() => [...extra, ...entries], [entries, extra]);
}

export function ModelPicker({
  entries,
  value,
  onSelect,
  label = "Model",
  placeholder = "Type a model: gpt, claude, glm, deepseek, gemini…",
  autoFocus,
}: {
  entries: CatalogEntry[];
  value: CatalogEntry | null;
  onSelect: (entry: CatalogEntry | null) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState(value?.name || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(value?.name || ""), [value?.key]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const results = useMemo(() => searchCatalog(entries, value && query === value.name ? "" : query, 10), [entries, query, value]);
  const choose = (entry: CatalogEntry) => {
    onSelect(entry);
    setQuery(entry.name);
    setOpen(false);
  };
  return (
    <div className="model-picker" ref={box}>
      <label>
        {label}
        <input
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={label}
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
            if (value) onSelect(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && open && results[active]) {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
      </label>
      {open && results.length > 0 && (
        <ul className="model-options" role="listbox">
          {results.map((entry, i) => (
            <li
              key={entry.key}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(entry);
              }}
            >
              <b>{entry.name}</b>
              <span>
                {entry.providerName} · <code>{entry.id}</code>
                {entry.popular ? " · popular" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The connection a picked model needs: provider kind, endpoint and exact ID (optionally through OpenRouter). */
export function connectionFor(entry: CatalogEntry, viaOpenRouter = false) {
  if (viaOpenRouter && entry.openrouterId)
    return { kind: "compatible", baseUrl: "https://openrouter.ai/api/v1", model: entry.openrouterId, label: `OpenRouter · ${entry.name}` };
  return { kind: entry.kind, baseUrl: entry.baseUrl, model: entry.id, label: entry.providerName };
}
