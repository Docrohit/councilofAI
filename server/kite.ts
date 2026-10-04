import type { DB } from "./db.ts";
import type { Store } from "./store.ts";
import { createHash, randomUUID } from "node:crypto";

export interface KiteConfig {
  enabled: boolean;
  apiKey?: string;
  lastError?: string;
}

interface KiteSecrets {
  accessToken?: string;
  accessTokenUpdatedAt?: string;
  apiSecret?: string;
}

export function kiteStatus(
  db: DB,
  store: Store,
  userId: string,
  appOrigin?: string,
) {
  const row = rowFor(db, userId);
  if (!row) return { enabled: false, hasApiKey: false, hasAccessToken: false };
  const config = JSON.parse(row.config) as KiteConfig;
  const secrets = readSecrets(store, row);
  const loginUrl =
    config.apiKey && secrets.apiSecret
      ? `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(config.apiKey)}`
      : undefined;
  return {
    enabled: !!config.enabled,
    hasApiKey: !!config.apiKey,
    hasApiSecret: !!secrets.apiSecret,
    hasAccessToken: !!secrets.accessToken,
    accessTokenUpdatedAt: secrets.accessTokenUpdatedAt,
    callbackUrl: appOrigin
      ? `${appOrigin.replace(/\/$/, "")}/api/integrations/kite/callback`
      : undefined,
    loginUrl,
    lastError: config.lastError,
  };
}

export function saveKite(
  db: DB,
  store: Store,
  userId: string,
  input: {
    enabled: boolean;
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
  },
) {
  const existing = rowFor(db, userId);
  const config: KiteConfig = existing
    ? JSON.parse(existing.config)
    : { enabled: false };
  const secrets = existing ? readSecrets(store, existing) : {};
  if (input.apiKey?.trim()) config.apiKey = input.apiKey.trim();
  if (input.apiSecret?.trim()) secrets.apiSecret = input.apiSecret.trim();
  if (input.accessToken?.trim()) {
    secrets.accessToken = input.accessToken.trim();
    secrets.accessTokenUpdatedAt = new Date().toISOString();
  }
  config.enabled = input.enabled;
  config.lastError = undefined;
  if (config.enabled && (!config.apiKey || !secrets.accessToken))
    throw new Error("Kite needs both api_key and today's access_token.");
  const secret = writeSecrets(store, secrets);
  db.prepare(
    "INSERT INTO integrations(id,user_id,kind,config,secret) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET config=excluded.config,secret=excluded.secret",
  ).run(
    existing?.id || randomUUID(),
    userId,
    "kite",
    JSON.stringify(config),
    secret,
  );
  return kiteStatus(db, store, userId);
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
  const accessToken = readSecrets(store, row).accessToken;
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

export async function refreshKiteAccessToken(
  db: DB,
  store: Store,
  userId: string,
  requestToken: string,
) {
  const row = rowFor(db, userId);
  if (!row) throw new Error("Save the Kite API key and API secret first.");
  const config = JSON.parse(row.config) as KiteConfig;
  const secrets = readSecrets(store, row);
  if (!config.apiKey || !secrets.apiSecret)
    throw new Error("Save the Kite API key and API secret first.");
  const checksum = createHash("sha256")
    .update(`${config.apiKey}${requestToken.trim()}${secrets.apiSecret}`)
    .digest("hex");
  const response = await fetch("https://api.kite.trade/session/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Kite-Version": "3",
    },
    body: new URLSearchParams({
      api_key: config.apiKey,
      request_token: requestToken.trim(),
      checksum,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.status === "error") {
    config.lastError =
      payload?.message || `Kite token refresh failed (${response.status}).`;
    saveRaw(db, store, row, config, secrets);
    throw new Error(config.lastError);
  }
  const accessToken = payload?.data?.access_token;
  if (!accessToken) throw new Error("Kite did not return an access_token.");
  secrets.accessToken = accessToken;
  secrets.accessTokenUpdatedAt = new Date().toISOString();
  config.enabled = true;
  config.lastError = undefined;
  saveRaw(db, store, row, config, secrets);
  return kiteStatus(db, store, userId);
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

function readSecrets(store: Store, row: any): KiteSecrets {
  if (!row?.secret) return {};
  const plaintext = store.secrets.decrypt(row.secret);
  if (!plaintext) return {};
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed && typeof parsed === "object") return parsed as KiteSecrets;
  } catch {
    // Older Council releases stored only the encrypted access token string.
  }
  return { accessToken: plaintext };
}

function writeSecrets(store: Store, secrets: KiteSecrets) {
  const compact = Object.fromEntries(
    Object.entries(secrets).filter(([, value]) => !!value),
  );
  return Object.keys(compact).length
    ? store.secrets.encrypt(JSON.stringify(compact))
    : "";
}

function saveRaw(
  db: DB,
  store: Store,
  row: any,
  config: KiteConfig,
  secrets: KiteSecrets,
) {
  db.prepare("UPDATE integrations SET config=?, secret=? WHERE id=?").run(
    JSON.stringify(config),
    writeSecrets(store, secrets),
    row.id,
  );
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
