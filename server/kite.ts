import type { DB } from "./db.ts";
import type { Store } from "./store.ts";
import { randomUUID } from "node:crypto";

export interface KiteConfig {
  enabled: boolean;
  apiKey?: string;
  lastError?: string;
}

export function kiteStatus(db: DB, userId: string) {
  const row = rowFor(db, userId);
  if (!row) return { enabled: false, hasApiKey: false, hasAccessToken: false };
  const config = JSON.parse(row.config) as KiteConfig;
  return {
    enabled: !!config.enabled,
    hasApiKey: !!config.apiKey,
    hasAccessToken: !!row.secret,
    lastError: config.lastError,
  };
}

export function saveKite(
  db: DB,
  store: Store,
  userId: string,
  input: { enabled: boolean; apiKey?: string; accessToken?: string },
) {
  const existing = rowFor(db, userId);
  const config: KiteConfig = existing
    ? JSON.parse(existing.config)
    : { enabled: false };
  if (input.apiKey?.trim()) config.apiKey = input.apiKey.trim();
  config.enabled = input.enabled;
  config.lastError = undefined;
  const secret = input.accessToken?.trim()
    ? store.secrets.encrypt(input.accessToken.trim())
    : existing?.secret || "";
  if (config.enabled && (!config.apiKey || !secret))
    throw new Error("Kite needs both api_key and today's access_token.");
  db.prepare(
    "INSERT INTO integrations(id,user_id,kind,config,secret) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET config=excluded.config,secret=excluded.secret",
  ).run(
    existing?.id || randomUUID(),
    userId,
    "kite",
    JSON.stringify(config),
    secret,
  );
  return kiteStatus(db, userId);
}

export function clearKite(db: DB, userId: string) {
  db.prepare("DELETE FROM integrations WHERE user_id=? AND kind='kite'").run(
    userId,
  );
}

export function kiteClient(db: DB, store: Store, userId: string) {
  const row = rowFor(db, userId);
  if (!row) throw new Error("Kite connection is not configured.");
  const config = JSON.parse(row.config) as KiteConfig;
  const accessToken = store.secrets.decrypt(row.secret);
  if (!config.enabled || !config.apiKey || !accessToken)
    throw new Error("Kite connection is disabled or missing today's token.");
  const headers = {
    "X-Kite-Version": "3",
    Authorization: `token ${config.apiKey}:${accessToken}`,
  };
  return {
    async get(path: string, signal: AbortSignal) {
      const response = await fetch(`https://api.kite.trade${path}`, {
        headers,
        signal,
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => ({}))
        : await response.text();
      if (!response.ok)
        throw new Error(
          `Kite ${path} failed: ${typeof payload === "string" ? response.status : payload?.message || response.status}`,
        );
      return payload;
    },
  };
}

export async function kiteQuote(
  db: DB,
  store: Store,
  userId: string,
  instruments: string[],
  signal: AbortSignal,
) {
  if (!instruments.length || instruments.length > 100)
    throw new Error("Request between 1 and 100 Kite instruments.");
  const params = new URLSearchParams();
  for (const item of instruments) params.append("i", item);
  return kiteClient(db, store, userId).get(`/quote?${params}`, signal);
}

export async function kiteOptionChain(
  db: DB,
  store: Store,
  userId: string,
  input: {
    underlying: string;
    expiry?: string;
    exchange?: string;
    spotInstrument?: string;
    maxStrikes?: number;
  },
  signal: AbortSignal,
) {
  const exchange = input.exchange || "NFO";
  const text = await kiteClient(db, store, userId).get(
    `/instruments/${encodeURIComponent(exchange)}`,
    signal,
  );
  if (typeof text !== "string")
    throw new Error("Kite instruments response was not CSV.");
  const rows = parseCsv(text);
  const upper = input.underlying.toUpperCase();
  const options = rows
    .filter(
      (r) =>
        ["CE", "PE"].includes(r.instrument_type) &&
        ((r.name || "").toUpperCase() === upper ||
          (r.tradingsymbol || "").toUpperCase().startsWith(upper)),
    )
    .filter((r) => !input.expiry || r.expiry === input.expiry);
  if (!options.length)
    throw new Error(
      "No Kite option instruments matched that underlying/expiry.",
    );
  const expiries = [
    ...new Set(options.map((r) => r.expiry).filter(Boolean)),
  ].sort();
  const expiry = input.expiry || expiries[0];
  let chain = options.filter((r) => r.expiry === expiry);
  let spot: number | undefined;
  if (input.spotInstrument) {
    const quote = await kiteQuote(
      db,
      store,
      userId,
      [input.spotInstrument],
      signal,
    );
    spot = Number(quote?.data?.[input.spotInstrument]?.last_price);
  }
  if (spot && Number.isFinite(spot)) {
    const strikes = [
      ...new Set(chain.map((r) => Number(r.strike)).filter(Number.isFinite)),
    ]
      .sort((a, b) => Math.abs(a - spot!) - Math.abs(b - spot!))
      .slice(0, Math.max(2, Math.min(input.maxStrikes || 12, 40)))
      .sort((a, b) => a - b);
    const keep = new Set(strikes);
    chain = chain.filter((r) => keep.has(Number(r.strike)));
  }
  const instruments = chain
    .map((r) => `${r.exchange}:${r.tradingsymbol}`)
    .slice(0, 100);
  const quote = await kiteQuote(db, store, userId, instruments, signal);
  return {
    underlying: input.underlying,
    exchange,
    expiry,
    expiries,
    spot,
    instruments: chain.slice(0, 100),
    quote: quote?.data || quote,
    note: "Read-only Kite market data. This tool never places, modifies or cancels orders.",
  };
}

export async function kiteHistorical(
  db: DB,
  store: Store,
  userId: string,
  input: {
    instrumentToken: string;
    from: string;
    to: string;
    interval: string;
  },
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    from: input.from,
    to: input.to,
  });
  return kiteClient(db, store, userId).get(
    `/instruments/historical/${encodeURIComponent(input.instrumentToken)}/${encodeURIComponent(input.interval)}?${params}`,
    signal,
  );
}

function rowFor(db: DB, userId: string) {
  return db
    .prepare("SELECT * FROM integrations WHERE user_id=? AND kind='kite'")
    .get(userId) as any;
}

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const header = splitCsv(lines.shift() || "");
  return lines.map((line) => {
    const cells = splitCsv(line);
    return Object.fromEntries(
      header.map((key, i) => [key, cells[i] || ""]),
    ) as Record<string, string>;
  });
}

function splitCsv(line: string) {
  const cells: string[] = [];
  let current = "";
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') quote = !quote;
    else if (char === "," && !quote) {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}
