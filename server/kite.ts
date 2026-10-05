import type { DB } from "./db.ts";
import type { Store } from "./store.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface KiteConfig {
  enabled: boolean;
  apiKey?: string;
  lastError?: string;
  kiteUserId?: string;
  kiteUserName?: string;
  connectState?: string;
  connectStateExpiresAt?: number;
}

interface KiteSecrets {
  accessToken?: string;
  accessTokenUpdatedAt?: string;
  apiSecret?: string;
}

export const KITE_EXCHANGES = [
  "NSE",
  "BSE",
  "NFO",
  "BFO",
  "CDS",
  "BCD",
  "MCX",
] as const;
export type KiteExchange = (typeof KITE_EXCHANGES)[number];
export const KITE_INTERVALS = [
  "minute",
  "3minute",
  "5minute",
  "10minute",
  "15minute",
  "30minute",
  "60minute",
  "day",
] as const;
export type KiteInterval = (typeof KITE_INTERVALS)[number];

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;
const CONNECT_STATE_TTL_MS = 15 * 60_000;
const READ_ONLY_NOTE =
  "Read-only Kite market data. Council never places, modifies or cancels orders.";
const CREDENTIAL_PATTERN = /^[A-Za-z0-9]{6,128}$/;

/** The most recent 06:00 IST, when Kite invalidates every access token. */
export function lastKiteReset(now = Date.now()) {
  const ist = now + IST_OFFSET_MS;
  let reset = Math.floor(ist / DAY_MS) * DAY_MS + 6 * 3_600_000;
  if (ist < reset) reset -= DAY_MS;
  return reset - IST_OFFSET_MS;
}

export function kiteTokenExpired(updatedAt?: string, now = Date.now()) {
  if (!updatedAt) return true;
  const issued = Date.parse(updatedAt);
  return !Number.isFinite(issued) || issued < lastKiteReset(now);
}

function istDay(ms: number) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function kiteStatus(
  db: DB,
  store: Store,
  userId: string,
  appOrigin?: string,
) {
  const callbackUrl = appOrigin
    ? `${appOrigin.replace(/\/$/, "")}/api/integrations/kite/callback`
    : undefined;
  const row = rowFor(db, userId);
  if (!row)
    return {
      enabled: false,
      connected: false,
      hasApiKey: false,
      hasApiSecret: false,
      hasAccessToken: false,
      tokenExpired: false,
      canConnect: false,
      callbackUrl,
    };
  const config = JSON.parse(row.config) as KiteConfig;
  const secrets = readSecrets(store, row);
  const tokenExpired =
    !!secrets.accessToken && kiteTokenExpired(secrets.accessTokenUpdatedAt);
  return {
    enabled: !!config.enabled,
    connected: !!config.enabled && !!secrets.accessToken && !tokenExpired,
    hasApiKey: !!config.apiKey,
    hasApiSecret: !!secrets.apiSecret,
    hasAccessToken: !!secrets.accessToken,
    accessTokenUpdatedAt: secrets.accessTokenUpdatedAt,
    tokenExpired,
    canConnect: !!config.apiKey && !!secrets.apiSecret,
    kiteUserId: config.kiteUserId,
    kiteUserName: config.kiteUserName,
    callbackUrl,
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
  const apiKey = input.apiKey?.trim();
  const apiSecret = input.apiSecret?.trim();
  if (apiKey && !CREDENTIAL_PATTERN.test(apiKey))
    throw new Error(
      "That does not look like a Kite API key. Copy the api_key shown for your app on developers.kite.trade.",
    );
  if (apiSecret && !CREDENTIAL_PATTERN.test(apiSecret))
    throw new Error(
      "That does not look like a Kite API secret. Copy the api_secret shown for your app on developers.kite.trade.",
    );
  if (apiKey || apiSecret) {
    delete secrets.accessToken;
    delete secrets.accessTokenUpdatedAt;
    delete config.kiteUserId;
    delete config.kiteUserName;
    delete config.connectState;
    delete config.connectStateExpiresAt;
  }
  if (apiKey) config.apiKey = apiKey;
  if (apiSecret) secrets.apiSecret = apiSecret;
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

/**
 * Starts a Kite login. The returned URL carries a single-use state value in
 * redirect_params so the public callback can identify the account without
 * relying on the SameSite=strict session cookie.
 */
export function startKiteConnect(db: DB, store: Store, userId: string) {
  const row = rowFor(db, userId);
  const config = row ? (JSON.parse(row.config) as KiteConfig) : undefined;
  if (!row || !config?.apiKey || !readSecrets(store, row).apiSecret)
    throw new Error("Save the Kite API key and API secret first.");
  const state = randomBytes(24).toString("base64url");
  config.connectState = hashState(state);
  config.connectStateExpiresAt = Date.now() + CONNECT_STATE_TTL_MS;
  db.prepare("UPDATE integrations SET config=? WHERE id=?").run(
    JSON.stringify(config),
    row.id,
  );
  const params = new URLSearchParams({
    v: "3",
    api_key: config.apiKey,
    redirect_params: new URLSearchParams({ state }).toString(),
  });
  return { loginUrl: `https://kite.zerodha.com/connect/login?${params}` };
}

/** Completes a Kite login from the public redirect using the single-use state. */
export async function completeKiteConnect(
  db: DB,
  store: Store,
  state: string,
  requestToken: string,
) {
  const row = db
    .prepare(
      "SELECT * FROM integrations WHERE kind='kite' AND json_extract(config,'$.connectState')=?",
    )
    .get(hashState(state)) as any;
  if (!row)
    throw new Error(
      "This Kite login link is invalid or was already used. Start again with Connect Kite in Council.",
    );
  const config = JSON.parse(row.config) as KiteConfig;
  const expired =
    !config.connectStateExpiresAt || config.connectStateExpiresAt < Date.now();
  delete config.connectState;
  delete config.connectStateExpiresAt;
  db.prepare("UPDATE integrations SET config=? WHERE id=?").run(
    JSON.stringify(config),
    row.id,
  );
  if (expired)
    throw new Error(
      "This Kite login link expired. Start again with Connect Kite in Council.",
    );
  return {
    userId: row.user_id as string,
    status: await refreshKiteAccessToken(db, store, row.user_id, requestToken),
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
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  // Re-read after the network call so concurrent edits are not overwritten.
  const latest = rowFor(db, userId);
  const latestConfig = latest
    ? (JSON.parse(latest.config) as KiteConfig)
    : undefined;
  const latestSecrets = latest ? readSecrets(store, latest) : {};
  const sameApp =
    !!latestConfig &&
    latestConfig.apiKey === config.apiKey &&
    latestSecrets.apiSecret === secrets.apiSecret;
  if (!response.ok || payload?.status === "error") {
    const message = kiteErrorText(
      payload,
      `Kite token refresh failed (${response.status}).`,
    );
    if (sameApp) {
      latestConfig!.lastError = message;
      saveRaw(db, store, latest, latestConfig!, latestSecrets);
    }
    throw new Error(message);
  }
  const accessToken = payload?.data?.access_token;
  if (!accessToken) throw new Error("Kite did not return an access_token.");
  if (!sameApp)
    throw new Error(
      "The Kite app credentials changed during sign-in. Click Connect Kite again.",
    );
  latestSecrets.accessToken = accessToken;
  latestSecrets.accessTokenUpdatedAt = new Date().toISOString();
  latestConfig!.enabled = true;
  latestConfig!.lastError = undefined;
  latestConfig!.kiteUserId = cleanLabel(payload?.data?.user_id);
  latestConfig!.kiteUserName = cleanLabel(payload?.data?.user_name);
  saveRaw(db, store, latest, latestConfig!, latestSecrets);
  return kiteStatus(db, store, userId);
}

/** Confirms the saved session against Kite's profile endpoint. */
export async function testKiteConnection(
  db: DB,
  store: Store,
  userId: string,
  signal: AbortSignal,
) {
  const payload = await kiteGet(db, store, userId, "/user/profile", signal);
  const row = rowFor(db, userId);
  if (row) {
    const config = JSON.parse(row.config) as KiteConfig;
    config.kiteUserId = cleanLabel(payload?.data?.user_id) || config.kiteUserId;
    config.kiteUserName =
      cleanLabel(payload?.data?.user_name) || config.kiteUserName;
    config.lastError = undefined;
    db.prepare("UPDATE integrations SET config=? WHERE id=?").run(
      JSON.stringify(config),
      row.id,
    );
  }
  return kiteStatus(db, store, userId);
}

/** Text added to agent prompts so peers know whether Kite tools will work. */
export function kitePromptGuide(db: DB, store: Store, userId: string) {
  let status: ReturnType<typeof kiteStatus>;
  try {
    status = kiteStatus(db, store, userId);
  } catch {
    return "";
  }
  if (!status.hasApiKey) return "";
  if (!status.connected)
    return "\nZerodha Kite is configured but not connected for today (Kite sessions expire at 6 AM IST). Do not call kite_* tools; tell the user to click Connect Kite in Connections if live Indian market data is needed.";
  return `\nRead-only Zerodha Kite market data tools are connected for this user. Use them for Indian stock, index, futures and options questions instead of guessing prices:
{"tools":[{"name":"kite_instruments","query":"RELIANCE","exchange":"NSE"}]} finds tradingsymbols, instrument tokens, expiries and lot sizes (exchanges: NSE, BSE, NFO, BFO, CDS, BCD, MCX).
{"tools":[{"name":"kite_quote","instruments":["NSE:INFY","NSE:NIFTY 50"],"mode":"full"}]} returns compact live quotes (mode full|ohlc|ltp, up to 100 instruments).
{"tools":[{"name":"kite_historical","instrument":"NSE:INFY","interval":"day","from":"2026-01-01","to":"2026-03-31"}]} returns OHLCV candles plus summary statistics (intervals minute, 3minute, 5minute, 10minute, 15minute, 30minute, 60minute, day; set "oi":true for futures/options open interest).
{"tools":[{"name":"kite_option_chain","underlying":"NIFTY","maxStrikes":15}]} returns strikes around spot with CE/PE LTP, bid/ask, OI, volume, Council-estimated IV and delta, ATM strike, put-call ratio and max pain for the returned strikes (optional expiry YYYY-MM-DD; indices NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50, SENSEX, BANKEX; stocks use their NSE symbol).
Cite the returned timestamps. Quote requests are rate-limited, so batch instruments into one call. IV and delta are Black-Scholes estimates, not Kite data. You must never place, modify, cancel or imply execution of trades; frame strategies as analysis with risks, not instructions.`;
}

// ---------------------------------------------------------------------------
// Authenticated requests

const throttleSlots = new Map<string, number>();
const THROTTLE_GAP_MS = { quote: 1_050, historical: 350, other: 110 };

async function throttle(
  key: string,
  gap: number,
  signal: AbortSignal,
): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, throttleSlots.get(key) || 0);
  throttleSlots.set(key, at + gap);
  if (at > now) await sleep(at - now, signal);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function kiteSession(db: DB, store: Store, userId: string) {
  const row = rowFor(db, userId);
  const config = row ? (JSON.parse(row.config) as KiteConfig) : undefined;
  if (!row || !config?.apiKey)
    throw new Error(
      "Kite is not set up for this account. Ask the user to add their Kite app in Connections.",
    );
  const secrets = readSecrets(store, row);
  if (!config.enabled || !secrets.accessToken)
    throw new Error(
      "Kite is not connected for today. Ask the user to click Connect Kite in Connections.",
    );
  if (kiteTokenExpired(secrets.accessTokenUpdatedAt))
    throw new Error(
      "Today's Kite session has expired (Kite sessions end at 6 AM IST). Ask the user to click Connect Kite in Connections.",
    );
  return { row, config, accessToken: secrets.accessToken };
}

async function kiteGet(
  db: DB,
  store: Store,
  userId: string,
  path: string,
  signal: AbortSignal,
  kind: keyof typeof THROTTLE_GAP_MS = "other",
): Promise<any> {
  const { config, accessToken } = kiteSession(db, store, userId);
  const headers = {
    "X-Kite-Version": "3",
    Authorization: `token ${config.apiKey}:${accessToken}`,
  };
  for (let attempt = 0; ; attempt++) {
    await throttle(`${userId}:${kind}`, THROTTLE_GAP_MS[kind], signal);
    const response = await fetch(`https://api.kite.trade${path}`, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    if (response.status === 429 && attempt < 2) {
      await response.body?.cancel();
      await sleep(1_000 * (attempt + 1), signal);
      continue;
    }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();
    const failed =
      !response.ok ||
      (typeof payload === "object" && payload?.status === "error");
    if (!failed) return payload;
    if (
      typeof payload === "object" &&
      payload?.error_type === "TokenException"
    ) {
      invalidateAccessToken(
        db,
        store,
        userId,
        accessToken,
        "Kite ended the saved session (expired or logged out). Click Connect Kite to sign in again.",
      );
      throw new Error(
        "The Kite session is no longer valid. Ask the user to click Connect Kite in Connections.",
      );
    }
    throw new Error(
      `Kite request failed: ${kiteErrorText(payload, `HTTP ${response.status}`)}`,
    );
  }
}

function invalidateAccessToken(
  db: DB,
  store: Store,
  userId: string,
  rejectedToken: string,
  message: string,
) {
  const row = rowFor(db, userId);
  if (!row) return;
  const config = JSON.parse(row.config) as KiteConfig;
  const secrets = readSecrets(store, row);
  // A newer token from a reconnect must survive an older request's failure.
  if (secrets.accessToken !== rejectedToken) return;
  delete secrets.accessToken;
  delete secrets.accessTokenUpdatedAt;
  config.lastError = message;
  saveRaw(db, store, row, config, secrets);
}

// ---------------------------------------------------------------------------
// Instruments

export interface KiteInstrument {
  instrumentToken: string;
  exchange: string;
  tradingsymbol: string;
  name: string;
  expiry: string;
  strike: number;
  lotSize: number;
  tickSize: number;
  type: string;
  segment: string;
}

const instrumentCache = new Map<
  string,
  { day: string; promise: Promise<KiteInstrument[]> }
>();

/** Kite publishes the instrument dump daily around 08:30 IST. */
function instrumentDay(now = Date.now()) {
  return istDay(now - 8.5 * 3_600_000);
}

export function clearKiteInstrumentCache() {
  instrumentCache.clear();
  throttleSlots.clear();
}

async function instruments(
  db: DB,
  store: Store,
  userId: string,
  exchange: KiteExchange,
  signal: AbortSignal,
) {
  if (!KITE_EXCHANGES.includes(exchange))
    throw new Error(`Unsupported Kite exchange ${exchange}.`);
  // Each account must have its own working session, even on a cache hit.
  kiteSession(db, store, userId);
  const day = instrumentDay();
  const cached = instrumentCache.get(exchange);
  if (cached?.day === day) return withAbort(cached.promise, signal);
  // The shared download is not tied to one caller's abort signal.
  const promise = kiteGet(
    db,
    store,
    userId,
    `/instruments/${exchange}`,
    AbortSignal.timeout(90_000),
  ).then((text) => {
    if (typeof text !== "string")
      throw new Error("Kite instruments response was not CSV.");
    return parseCsv(text).map((r): KiteInstrument => ({
      instrumentToken: r.instrument_token,
      exchange: r.exchange || exchange,
      tradingsymbol: r.tradingsymbol,
      name: r.name || "",
      expiry: r.expiry || "",
      strike: Number(r.strike) || 0,
      lotSize: Number(r.lot_size) || 0,
      tickSize: Number(r.tick_size) || 0,
      type: r.instrument_type || "",
      segment: r.segment || "",
    }));
  });
  instrumentCache.set(exchange, { day, promise });
  promise.catch(() => {
    if (instrumentCache.get(exchange)?.promise === promise)
      instrumentCache.delete(exchange);
  });
  return withAbort(promise, signal);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizeInstrument(value: string) {
  const { exchange, tradingsymbol } = parseInstrument(value);
  return `${exchange}:${tradingsymbol.toUpperCase()}`;
}

function parseInstrument(value: string) {
  const index = value.indexOf(":");
  const exchange = value.slice(0, index).trim().toUpperCase() as KiteExchange;
  const tradingsymbol = value.slice(index + 1).trim();
  if (index < 1 || !tradingsymbol || !KITE_EXCHANGES.includes(exchange))
    throw new Error(
      `Use EXCHANGE:TRADINGSYMBOL such as NSE:INFY (exchanges ${KITE_EXCHANGES.join(", ")}); got "${value.slice(0, 80)}".`,
    );
  return { exchange, tradingsymbol };
}

function compactInstrument(r: KiteInstrument) {
  return {
    instrument: `${r.exchange}:${r.tradingsymbol}`,
    instrumentToken: r.instrumentToken,
    name: r.name || undefined,
    type: r.type,
    segment: r.segment,
    expiry: r.expiry || undefined,
    strike: r.strike || undefined,
    lotSize: r.lotSize || undefined,
  };
}

export async function kiteInstrumentSearch(
  db: DB,
  store: Store,
  userId: string,
  input: { query: string; exchange?: KiteExchange; limit?: number },
  signal: AbortSignal,
) {
  const exchange = input.exchange || "NSE";
  const query = input.query.trim().toUpperCase();
  if (!query) throw new Error("Provide a symbol or company name to search.");
  const rows = await instruments(db, store, userId, exchange, signal);
  const rank = (r: KiteInstrument) => {
    const symbol = r.tradingsymbol.toUpperCase();
    const name = r.name.toUpperCase();
    if (symbol === query) return 0;
    if (name === query) return 1;
    if (symbol.startsWith(query)) return 2;
    if (name.startsWith(query)) return 3;
    if (name.includes(query)) return 4;
    if (symbol.includes(query)) return 5;
    return -1;
  };
  const matches = rows
    .map((r) => ({ r, score: rank(r) }))
    .filter((m) => m.score >= 0)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.r.expiry.localeCompare(b.r.expiry) ||
        a.r.strike - b.r.strike ||
        a.r.tradingsymbol.localeCompare(b.r.tradingsymbol),
    );
  const limit = Math.max(1, Math.min(input.limit || 10, 25));
  return {
    exchange,
    query: input.query,
    totalMatches: matches.length,
    matches: matches.slice(0, limit).map((m) => compactInstrument(m.r)),
    note: READ_ONLY_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Quotes

async function rawQuotes(
  db: DB,
  store: Store,
  userId: string,
  instrumentList: string[],
  mode: "full" | "ohlc" | "ltp",
  signal: AbortSignal,
): Promise<Record<string, any>> {
  if (!instrumentList.length || instrumentList.length > 500)
    throw new Error("Request between 1 and 500 Kite instruments.");
  const params = new URLSearchParams();
  for (const item of instrumentList)
    params.append("i", normalizeInstrument(item));
  const path = mode === "full" ? "/quote" : `/quote/${mode}`;
  const payload = await kiteGet(
    db,
    store,
    userId,
    `${path}?${params}`,
    signal,
    "quote",
  );
  return payload?.data || {};
}

function round(value: unknown, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function positive(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function compactQuote(q: any) {
  if (!q || typeof q !== "object") return undefined;
  const close = Number(q.ohlc?.close);
  const last = Number(q.last_price);
  const change =
    Number.isFinite(close) && close > 0 && Number.isFinite(last)
      ? last - close
      : undefined;
  return {
    lastPrice: q.last_price,
    change: round(change),
    changePct: change === undefined ? undefined : round((change / close) * 100),
    open: q.ohlc?.open,
    high: q.ohlc?.high,
    low: q.ohlc?.low,
    previousClose: q.ohlc?.close,
    volume: q.volume,
    averagePrice: q.average_price,
    bid: positive(q.depth?.buy?.[0]?.price),
    ask: positive(q.depth?.sell?.[0]?.price),
    buyQuantity: q.buy_quantity,
    sellQuantity: q.sell_quantity,
    oi: q.oi || undefined,
    oiDayHigh: q.oi_day_high || undefined,
    oiDayLow: q.oi_day_low || undefined,
    lowerCircuit: q.lower_circuit_limit,
    upperCircuit: q.upper_circuit_limit,
    lastTradeTime: q.last_trade_time,
    timestamp: q.timestamp,
    instrumentToken: q.instrument_token,
  };
}

export async function kiteQuote(
  db: DB,
  store: Store,
  userId: string,
  instrumentList: string[],
  signal: AbortSignal,
  mode: "full" | "ohlc" | "ltp" = "full",
) {
  if (!instrumentList.length || instrumentList.length > 100)
    throw new Error("Request between 1 and 100 Kite instruments.");
  const requested = [...new Set(instrumentList.map(normalizeInstrument))];
  const data = await rawQuotes(db, store, userId, requested, mode, signal);
  const quotes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data))
    quotes[key] = compactQuote(value);
  return {
    mode,
    quotes,
    missing: requested.filter((i) => !(i in data)),
    note: READ_ONLY_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Historical candles

function normalizeKiteTime(value: string, end: boolean) {
  const v = value.trim().replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(v))
    return `${v} ${end ? "23:59:59" : "00:00:00"}`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return `${v}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return v;
  throw new Error(
    `Use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (IST) for Kite dates; got "${value.slice(0, 40)}".`,
  );
}

function sma(values: number[], period: number) {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  return round(slice.reduce((a, b) => a + b, 0) / period);
}

export async function kiteHistorical(
  db: DB,
  store: Store,
  userId: string,
  input: {
    instrument?: string;
    instrumentToken?: string;
    from: string;
    to: string;
    interval: KiteInterval;
    oi?: boolean;
    continuous?: boolean;
    maxCandles?: number;
  },
  signal: AbortSignal,
) {
  if (!KITE_INTERVALS.includes(input.interval))
    throw new Error(
      `Kite interval must be one of ${KITE_INTERVALS.join(", ")}.`,
    );
  let token = input.instrumentToken?.trim();
  let label = input.instrument?.trim();
  if (!token) {
    if (!label)
      throw new Error(
        "Provide instrument (such as NSE:INFY) or instrumentToken.",
      );
    const { exchange, tradingsymbol } = parseInstrument(label);
    const rows = await instruments(db, store, userId, exchange, signal);
    const match = rows.find(
      (r) => r.tradingsymbol.toUpperCase() === tradingsymbol.toUpperCase(),
    );
    if (!match)
      throw new Error(
        `Kite has no ${exchange} instrument named ${tradingsymbol}. Use kite_instruments to search.`,
      );
    token = match.instrumentToken;
    label = `${match.exchange}:${match.tradingsymbol}`;
  }
  if (!/^\d{1,20}$/.test(token))
    throw new Error(
      "instrumentToken must be the numeric Kite instrument token.",
    );
  const from = normalizeKiteTime(input.from, false);
  const to = normalizeKiteTime(input.to, true);
  const params = new URLSearchParams({ from, to });
  if (input.oi) params.set("oi", "1");
  if (input.continuous) params.set("continuous", "1");
  const payload = await kiteGet(
    db,
    store,
    userId,
    `/instruments/historical/${token}/${input.interval}?${params}`,
    signal,
    "historical",
  );
  const candles: any[][] = Array.isArray(payload?.data?.candles)
    ? payload.data.candles
    : [];
  const closes = candles.map((c) => Number(c[4])).filter(Number.isFinite);
  const highs = candles.map((c) => Number(c[2])).filter(Number.isFinite);
  const lows = candles.map((c) => Number(c[3])).filter(Number.isFinite);
  const volumes = candles.map((c) => Number(c[5])).filter(Number.isFinite);
  const first = candles[0];
  const last = candles[candles.length - 1];
  // Keep the newest candles and stay well inside the 20k tool-result budget,
  // which truncates from the end.
  const limit = Math.max(10, Math.min(input.maxCandles || 120, 250));
  let kept = candles.slice(-limit);
  while (kept.length > 10 && JSON.stringify(kept).length > 14_000)
    kept = kept.slice(Math.ceil(kept.length / 10));
  return {
    instrument: label,
    instrumentToken: token,
    interval: input.interval,
    from,
    to,
    columns: input.oi
      ? ["time", "open", "high", "low", "close", "volume", "oi"]
      : ["time", "open", "high", "low", "close", "volume"],
    summary: candles.length
      ? {
          candles: candles.length,
          firstTime: first[0],
          lastTime: last[0],
          firstOpen: first[1],
          lastClose: last[4],
          changePct: round(((last[4] - first[1]) / first[1]) * 100),
          periodHigh: highs.reduce((a, b) => Math.max(a, b), -Infinity),
          periodLow: lows.reduce((a, b) => Math.min(a, b), Infinity),
          averageVolume: volumes.length
            ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length)
            : undefined,
          sma20: sma(closes, 20),
          sma50: sma(closes, 50),
          computedBy: "Council from all returned candles",
        }
      : { candles: 0 },
    candlesOmitted: candles.length - kept.length,
    candles: kept,
    note: READ_ONLY_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Option chain

const INDEX_SPOT: Record<string, string> = {
  NIFTY: "NSE:NIFTY 50",
  BANKNIFTY: "NSE:NIFTY BANK",
  FINNIFTY: "NSE:NIFTY FIN SERVICE",
  MIDCPNIFTY: "NSE:NIFTY MID SELECT",
  NIFTYNXT50: "NSE:NIFTY NEXT 50",
  SENSEX: "BSE:SENSEX",
  BANKEX: "BSE:BANKEX",
};
const BFO_UNDERLYINGS = new Set(["SENSEX", "BANKEX", "SENSEX50"]);

function erf(x: number) {
  // Abramowitz and Stegun 7.1.26, absolute error below 1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

export function blackScholes(
  type: "CE" | "PE",
  spot: number,
  strike: number,
  years: number,
  rate: number,
  sigma: number,
) {
  const sq = sigma * Math.sqrt(years);
  const d1 =
    (Math.log(spot / strike) + (rate + (sigma * sigma) / 2) * years) / sq;
  const d2 = d1 - sq;
  const discounted = strike * Math.exp(-rate * years);
  return type === "CE"
    ? {
        price: spot * normCdf(d1) - discounted * normCdf(d2),
        delta: normCdf(d1),
      }
    : {
        price: discounted * normCdf(-d2) - spot * normCdf(-d1),
        delta: normCdf(d1) - 1,
      };
}

export function impliedVolatility(
  type: "CE" | "PE",
  price: number,
  spot: number,
  strike: number,
  years: number,
  rate: number,
) {
  if (!(price > 0 && spot > 0 && strike > 0 && years > 0)) return undefined;
  let lo = 1e-4,
    hi = 5;
  if (
    price < blackScholes(type, spot, strike, years, rate, lo).price ||
    price > blackScholes(type, spot, strike, years, rate, hi).price
  )
    return undefined;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (blackScholes(type, spot, strike, years, rate, mid).price > price)
      hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export async function kiteOptionChain(
  db: DB,
  store: Store,
  userId: string,
  input: {
    underlying: string;
    expiry?: string;
    exchange?: KiteExchange;
    spotInstrument?: string;
    maxStrikes?: number;
    riskFreeRate?: number;
  },
  signal: AbortSignal,
) {
  const upper = input.underlying.trim().toUpperCase();
  const exchange: KiteExchange =
    input.exchange || (BFO_UNDERLYINGS.has(upper) ? "BFO" : "NFO");
  const rows = await instruments(db, store, userId, exchange, signal);
  const allOptions = rows.filter((r) => r.type === "CE" || r.type === "PE");
  const options = allOptions.filter((r) => r.name.toUpperCase() === upper);
  if (!options.length) {
    const suggestions = [
      ...new Set(
        allOptions
          .map((r) => r.name)
          .filter((name) => name.toUpperCase().includes(upper)),
      ),
    ].slice(0, 10);
    throw new Error(
      `No ${exchange} options found for underlying ${upper}.${suggestions.length ? ` Similar underlyings: ${suggestions.join(", ")}.` : " Use kite_instruments to find the exact underlying name."}`,
    );
  }
  const now = Date.now();
  const expiries = [
    ...new Set(
      options
        .map((r) => r.expiry)
        .filter((e) => e && Date.parse(`${e}T15:30:00+05:30`) > now),
    ),
  ].sort();
  if (!expiries.length) throw new Error(`No live ${upper} option expiries.`);
  if (input.expiry && !expiries.includes(input.expiry))
    throw new Error(
      `${upper} has no ${input.expiry} expiry. Available: ${expiries.slice(0, 8).join(", ")}.`,
    );
  const expiry = input.expiry || expiries[0];
  const chain = options.filter((r) => r.expiry === expiry);
  const allStrikes = [...new Set(chain.map((r) => r.strike))]
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const spotInstrument = normalizeInstrument(
    input.spotInstrument?.trim() ||
      INDEX_SPOT[upper] ||
      `${exchange === "BFO" ? "BSE" : "NSE"}:${upper}`,
  );
  const warnings: string[] = [];
  let spot: number | undefined;
  try {
    const spotData = await rawQuotes(
      db,
      store,
      userId,
      [spotInstrument],
      "ltp",
      signal,
    );
    spot = positive(spotData[spotInstrument]?.last_price);
  } catch (error) {
    if (signal.aborted) throw error;
  }
  if (!spot)
    warnings.push(
      `Spot price for ${spotInstrument} was unavailable; strikes are centred on the middle of the listed range and IV/delta are omitted. Pass spotInstrument explicitly.`,
    );
  const count = Math.max(2, Math.min(input.maxStrikes || 15, 40));
  const centre = spot ?? allStrikes[Math.floor(allStrikes.length / 2)];
  const strikes = [...allStrikes]
    .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))
    .slice(0, count)
    .sort((a, b) => a - b);
  if (!strikes.length)
    throw new Error(`No ${upper} strikes are listed for ${expiry}.`);
  const keep = new Set(strikes);
  const legs = chain.filter((r) => keep.has(r.strike));
  const quotes = await rawQuotes(
    db,
    store,
    userId,
    legs.map((r) => `${r.exchange}:${r.tradingsymbol}`),
    "full",
    signal,
  );
  const years = Math.max(
    0,
    (Date.parse(`${expiry}T15:30:00+05:30`) - now) / (365 * DAY_MS),
  );
  const rate = input.riskFreeRate ?? 0.065;
  const leg = (r: KiteInstrument | undefined) => {
    if (!r) return undefined;
    const q = quotes[`${r.exchange}:${r.tradingsymbol}`];
    const bid = positive(q?.depth?.buy?.[0]?.price);
    const ask = positive(q?.depth?.sell?.[0]?.price);
    const ltp = positive(q?.last_price);
    const price = bid && ask && ask >= bid ? (bid + ask) / 2 : ltp;
    const type = r.type as "CE" | "PE";
    const iv =
      spot && price
        ? impliedVolatility(type, price, spot, r.strike, years, rate)
        : undefined;
    return {
      symbol: r.tradingsymbol,
      ltp: q?.last_price,
      bid,
      ask,
      volume: q?.volume,
      oi: q?.oi,
      iv: iv === undefined ? undefined : round(iv * 100, 1),
      delta:
        iv === undefined || !spot
          ? undefined
          : round(blackScholes(type, spot, r.strike, years, rate, iv).delta, 2),
    };
  };
  const table = strikes.map((strike) => ({
    strike,
    ce: leg(legs.find((r) => r.strike === strike && r.type === "CE")),
    pe: leg(legs.find((r) => r.strike === strike && r.type === "PE")),
  }));
  const ceOi = table.reduce((sum, row) => sum + (Number(row.ce?.oi) || 0), 0);
  const peOi = table.reduce((sum, row) => sum + (Number(row.pe?.oi) || 0), 0);
  const maxBy = (side: "ce" | "pe") =>
    table.reduce<{ strike?: number; oi: number }>(
      (best, row) =>
        (Number(row[side]?.oi) || 0) > best.oi
          ? { strike: row.strike, oi: Number(row[side]?.oi) }
          : best,
      { oi: 0 },
    ).strike;
  const pain = (settle: number) =>
    table.reduce(
      (sum, row) =>
        sum +
        (Number(row.ce?.oi) || 0) * Math.max(0, settle - row.strike) +
        (Number(row.pe?.oi) || 0) * Math.max(0, row.strike - settle),
      0,
    );
  const maxPain =
    ceOi + peOi > 0
      ? strikes.reduce((best, s) => (pain(s) < pain(best) ? s : best))
      : undefined;
  if (!Object.keys(quotes).length)
    warnings.push("Kite returned no quotes for these contracts.");
  return {
    underlying: upper,
    exchange,
    expiry,
    upcomingExpiries: expiries.slice(0, 8),
    daysToExpiry: round(years * 365, 2),
    spotInstrument,
    spot,
    atmStrike: spot
      ? strikes.reduce((best, s) =>
          Math.abs(s - spot!) < Math.abs(best - spot!) ? s : best,
        )
      : undefined,
    lotSize: legs[0]?.lotSize || undefined,
    strikesListed: allStrikes.length,
    summary: {
      putCallOiRatio: ceOi ? round(peOi / ceOi, 2) : undefined,
      totalCallOi: ceOi,
      totalPutOi: peOi,
      highestCallOiStrike: maxBy("ce"),
      highestPutOiStrike: maxBy("pe"),
      maxPain,
      scope: `Computed by Council from the ${strikes.length} returned strikes only.`,
    },
    strikes: table,
    assumptions: `iv (annualised %) and delta are Black-Scholes estimates by Council from bid/ask mid (or LTP), spot, ${round(rate * 100, 2)}% risk-free rate, no dividends and expiry at 15:30 IST. They are not Kite data.`,
    warnings: warnings.length ? warnings : undefined,
    note: READ_ONLY_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Storage helpers

function hashState(state: string) {
  return createHash("sha256").update(`kite-connect:${state}`).digest("hex");
}

function cleanLabel(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : undefined;
}

function kiteErrorText(payload: unknown, fallback: string) {
  const message =
    payload && typeof payload === "object"
      ? (payload as any).message
      : undefined;
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 300)
    : fallback;
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
