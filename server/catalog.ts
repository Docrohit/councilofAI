import { bestModelMatch, CATALOG_PROVIDERS, fromOpenRouter, mergeCatalog, type CatalogModel } from "../shared/modelCatalog.ts";
import { validateEndpoint } from "./security.ts";

// OpenRouter's public model list (no key) keeps the catalog current; fetched at most
// once a day, with the curated list used whenever it is unavailable.
/** Reads at most `limit` bytes of a response body as text (throws when it is longer). */
async function readText(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

let cache: { at: number; live: CatalogModel[] } | undefined;
let failedAt = 0;
let inflight: Promise<void> | undefined;

async function refresh() {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
    const text = await readText(response, 8_000_000);
    const body: any = JSON.parse(text);
    const live = (Array.isArray(body?.data) ? body.data : []).map(fromOpenRouter).filter(Boolean) as CatalogModel[];
    if (live.length) cache = { at: Date.now(), live };
    else failedAt = Date.now();
  } catch {
    failedAt = Date.now();
  }
}

const allowed = (baseUrl: string) => {
  try {
    validateEndpoint(baseUrl);
    return true;
  } catch {
    return false;
  }
};

/** The model catalog, limited to providers this server may call. */
export async function modelCatalog() {
  const fresh = cache && Date.now() - cache.at < 24 * 3_600_000;
  if (!fresh && Date.now() - failedAt > 10 * 60_000 && process.env.NODE_ENV !== "test") {
    // One refresh at a time, however many people open the picker.
    inflight ||= refresh().finally(() => (inflight = undefined));
    await inflight;
  }
  return {
    providers: CATALOG_PROVIDERS.filter((p) => allowed(p.baseUrl)),
    models: mergeCatalog(cache?.live || []).filter((m) => allowed(m.baseUrl)),
  };
}

/**
 * Lists the provider's models with the user's key and returns the closest real ID.
 * Any failure keeps the requested ID; the connection test then reports the problem.
 */
export async function resolveModelId(kind: string, baseUrl: string, apiKey: string, model: string) {
  if (!apiKey || !model || !["openai", "anthropic", "glm", "compatible"].includes(kind)) return model;
  try {
    const headers: Record<string, string> =
      kind === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${apiKey}` };
    const url = `${validateEndpoint(baseUrl)}/models${kind === "anthropic" ? "?limit=1000" : ""}`;
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return model;
    // The endpoint is user-chosen: read at most 2 MB.
    const text = await readText(response, 2_000_000);
    const body: any = JSON.parse(text);
    const ids = (Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [])
      .map((m: any) => String(m?.id || m?.name || "").replace(/^models\//, ""))
      .filter(Boolean);
    return (ids.length && bestModelMatch(model, ids)) || model;
  } catch {
    return model;
  }
}
