// Model catalog shared by Council of AI and Council Network (keep both copies identical).
// Users type part of a model name, pick it, and paste a key: the provider, endpoint
// and exact model ID come from here. A live list (OpenRouter's public catalog) adds
// newer models; the server then checks the ID against the provider's own model list.

export type CatalogKind = "openai" | "anthropic" | "glm" | "compatible";

export interface CatalogProvider {
  id: string;
  name: string;
  kind: CatalogKind;
  baseUrl: string;
  /** Where users create a key. */
  keyUrl: string;
  /** OpenRouter model-id prefix for this provider's models. */
  openrouterPrefix?: string;
}

export const CATALOG_PROVIDERS: CatalogProvider[] = [
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", openrouterPrefix: "openai" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", keyUrl: "https://console.anthropic.com/settings/keys", openrouterPrefix: "anthropic" },
  { id: "deepseek", name: "DeepSeek", kind: "compatible", baseUrl: "https://api.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys", openrouterPrefix: "deepseek" },
  { id: "zai", name: "Z.ai (GLM)", kind: "glm", baseUrl: "https://api.z.ai/api/paas/v4", keyUrl: "https://z.ai/manage-apikey/apikey-list", openrouterPrefix: "z-ai" },
  { id: "google", name: "Google Gemini", kind: "compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", openrouterPrefix: "google" },
  { id: "xai", name: "xAI (Grok)", kind: "compatible", baseUrl: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", openrouterPrefix: "x-ai" },
  { id: "mistral", name: "Mistral", kind: "compatible", baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys", openrouterPrefix: "mistralai" },
  { id: "moonshot", name: "Moonshot (Kimi)", kind: "compatible", baseUrl: "https://api.moonshot.ai/v1", keyUrl: "https://platform.moonshot.ai/console/api-keys", openrouterPrefix: "moonshotai" },
  { id: "qwen", name: "Qwen (Alibaba Cloud)", kind: "compatible", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyUrl: "https://modelstudio.console.alibabacloud.com", openrouterPrefix: "qwen" },
  { id: "openrouter", name: "OpenRouter (any model, one key)", kind: "compatible", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys" },
];

export interface CatalogModel {
  /** The provider's own model ID. */
  id: string;
  name: string;
  provider: string;
  efforts?: string[];
  defaultEffort?: string;
  note?: string;
  /** Curated, well-known models are listed first. */
  popular?: boolean;
  vision?: boolean;
  source?: "curated" | "live";
}

/** Curated models with known-good IDs (kept in step with Council's earlier shortcuts). */
export const CURATED_MODELS: CatalogModel[] = [
  { id: "gpt-6-luna", name: "GPT-6 Luna", provider: "openai", efforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultEffort: "low", popular: true, vision: true },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "openai", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium", popular: true, vision: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "openai", defaultEffort: "medium", popular: true, vision: true },
  { id: "gpt-5.5", name: "GPT-5.5", provider: "openai", efforts: ["none", "low", "medium", "high", "xhigh"], defaultEffort: "high", popular: true, vision: true },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "openai", note: "Older Codex model." },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", vision: true },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", provider: "anthropic", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium", popular: true, vision: true },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "anthropic", popular: true, vision: true },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", provider: "anthropic", popular: true, vision: true },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic", vision: true },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", provider: "deepseek", efforts: ["low", "high", "max"], defaultEffort: "high", popular: true },
  { id: "deepseek-chat", name: "DeepSeek Chat", provider: "deepseek" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner", provider: "deepseek" },
  { id: "glm-5.3", name: "GLM 5.3", provider: "zai", efforts: ["low", "high", "max"], defaultEffort: "max", popular: true },
];

export function catalogProvider(id: string) {
  return CATALOG_PROVIDERS.find((p) => p.id === id);
}

/** Lower-cased ID with punctuation unified, for loose matching ("Claude-Sonnet-4.5" ~ "claude-sonnet-4-5"). */
export function normalizeModelId(id: string) {
  return id.toLowerCase().replace(/^[a-z0-9-]+\//, "").replace(/[\s._:]+/g, "-");
}

/** The provider's ID closest to what was asked for, or undefined when nothing is close. */
export function bestModelMatch(wanted: string, available: string[]) {
  if (available.includes(wanted)) return wanted;
  const target = normalizeModelId(wanted);
  const exact = available.find((a) => normalizeModelId(a) === target);
  if (exact) return exact;
  // Only a dated or "latest" release of the same model ("claude-haiku-4-5" -> "claude-haiku-4-5-20251001"),
  // never a different model that merely shares a prefix ("gpt-4o" must not become "gpt-4o-transcribe").
  const release = new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d{8}|\\d{4}-\\d{2}-\\d{2}|latest|\\d{3,4})$`);
  const releases = available.filter((a) => release.test(normalizeModelId(a))).sort((a, b) => b.localeCompare(a));
  return releases[0];
}

/** Maps a model from OpenRouter's public list to its own provider, or null if unsupported. */
export function fromOpenRouter(model: { id: string; name?: string }): CatalogModel | null {
  if (!model?.id || model.id.includes(":")) return null; // ":free" and other variants
  const [prefix, rest] = model.id.split("/");
  if (!rest) return null;
  const provider = CATALOG_PROVIDERS.find((p) => p.openrouterPrefix === prefix);
  if (!provider) return null;
  // Anthropic's own IDs use dashes where OpenRouter uses dots ("claude-sonnet-4.5" -> "claude-sonnet-4-5").
  const id = provider.id === "anthropic" ? rest.replace(/(\d)\.(\d)/g, "$1-$2") : rest;
  const name = String(model.name || rest).replace(/^[^:]+:\s*/, "").slice(0, 80);
  return { id, name, provider: provider.id, source: "live" };
}

export interface CatalogEntry extends CatalogModel {
  key: string;
  providerName: string;
  kind: CatalogKind;
  baseUrl: string;
  keyUrl: string;
  /** The same model through OpenRouter, for people with one OpenRouter key. */
  openrouterId?: string;
}

export function toEntry(model: CatalogModel): CatalogEntry | null {
  const provider = catalogProvider(model.provider);
  if (!provider) return null;
  const openrouterId = provider.openrouterPrefix
    ? `${provider.openrouterPrefix}/${provider.id === "anthropic" ? model.id.replace(/-(\d+)-(\d+)(?=$|-\d{8}$)/, "-$1.$2").replace(/-\d{8}$/, "") : model.id}`
    : undefined;
  return {
    ...model,
    key: `${model.provider}:${model.id}`,
    providerName: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    keyUrl: provider.keyUrl,
    openrouterId,
  };
}

/** Merges curated and live models (curated first, no duplicates). */
export function mergeCatalog(live: CatalogModel[]) {
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const model of [...CURATED_MODELS.map((m) => ({ ...m, source: "curated" as const })), ...live]) {
    // Dated snapshots and their alias are the same model ("claude-haiku-4-5-20251001" ~ "claude-haiku-4-5").
    const key = `${model.provider}:${normalizeModelId(model.id).replace(/-\d{8}$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = toEntry(model);
    if (entry) out.push(entry);
  }
  return out;
}

/** Ranks entries for what the user typed: name/ID prefix matches first, popular models first. */
export function searchCatalog(entries: CatalogEntry[], query: string, limit = 12) {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const scored = entries
    .map((e, index) => {
      const hay = `${e.name} ${e.id} ${e.providerName}`.toLowerCase();
      if (words.some((w) => !hay.includes(w))) return null;
      let score = e.popular ? 50 : 0;
      if (!q) return { e, score, index };
      if (e.name.toLowerCase().startsWith(q) || e.id.toLowerCase().startsWith(q)) score += 100;
      else if (e.providerName.toLowerCase().startsWith(q)) score += 60;
      if (e.source === "curated") score += 10;
      return { e, score, index };
    })
    .filter((x): x is { e: CatalogEntry; score: number; index: number } => !!x)
    // Ties keep catalog order: curated first, then the live list's own order (newest first).
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((x) => x.e);
}
