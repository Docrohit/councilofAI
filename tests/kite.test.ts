import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../server/db.ts";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import {
  blackScholes,
  clearKiteInstrumentCache,
  completeKiteConnect,
  impliedVolatility,
  kiteHistorical,
  kiteInstrumentSearch,
  kiteOptionChain,
  kitePromptGuide,
  kiteQuote,
  kiteStatus,
  kiteTokenExpired,
  lastKiteReset,
  refreshKiteAccessToken,
  saveKite,
  startKiteConnect,
} from "../server/kite.ts";

type KiteHandler = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function withKite<T>(handler: KiteHandler, work: () => Promise<T>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === "api.kite.trade") return handler(url, init);
    return originalFetch(input, init);
  }) as typeof fetch;
  return work().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "council-kite-test-"));
  const db = openDb(dir);
  const store = new Store(db, dir);
  const userId = "kite-user";
  addUser(db, userId, "kite@example.test");
  clearKiteInstrumentCache();
  return {
    db,
    store,
    userId,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function addUser(db: any, id: string, email: string) {
  db.prepare(
    "INSERT INTO users(id,email,name,password,created_at,email_verified,access_approved) VALUES(?,?,?,?,?,?,?)",
  ).run(id, email, "Kite", "hash", new Date().toISOString(), 1, 1);
}

function connectedFixture() {
  const f = fixture();
  saveKite(f.db, f.store, f.userId, {
    enabled: true,
    apiKey: "kitekey123",
    apiSecret: "kitesecret123",
    accessToken: "today-token",
  });
  return f;
}

const istDate = (offsetDays: number) =>
  new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

test("kite stores api secret encrypted and refreshes access token from request token", async () => {
  const f = fixture();
  try {
    const saved = saveKite(f.db, f.store, f.userId, {
      enabled: false,
      apiKey: "kitekey123",
      apiSecret: "kitesecret123",
    });
    assert.equal(saved.hasApiKey, true);
    assert.equal(saved.hasApiSecret, true);
    assert.equal(saved.hasAccessToken, false);
    assert.equal(saved.canConnect, true);
    const row = f.db
      .prepare("SELECT config,secret FROM integrations WHERE user_id=?")
      .get(f.userId) as any;
    assert(!row.secret.includes("kitesecret123"));
    await withKite(
      (url, init) => {
        assert.equal(url.pathname, "/session/token");
        const body = init?.body as URLSearchParams;
        assert.equal(body.get("api_key"), "kitekey123");
        assert.equal(body.get("request_token"), "request-token");
        assert.equal(
          body.get("checksum"),
          createHash("sha256")
            .update("kitekey123request-tokenkitesecret123")
            .digest("hex"),
        );
        return json({
          status: "success",
          data: {
            access_token: "today-access-token",
            user_id: "AB1234",
            user_name: "Kite Tester",
          },
        });
      },
      async () => {
        const refreshed = await refreshKiteAccessToken(
          f.db,
          f.store,
          f.userId,
          "request-token",
        );
        assert.equal(refreshed.enabled, true);
        assert.equal(refreshed.connected, true);
        assert.equal(refreshed.kiteUserId, "AB1234");
        assert.equal(refreshed.kiteUserName, "Kite Tester");
      },
    );
    const status = kiteStatus(
      f.db,
      f.store,
      f.userId,
      "https://council.example",
    );
    assert.equal(
      status.callbackUrl,
      "https://council.example/api/integrations/kite/callback",
    );
    const changed = saveKite(f.db, f.store, f.userId, {
      enabled: false,
      apiKey: "newkitekey1",
      apiSecret: "newkitesecret1",
    });
    assert.equal(changed.hasAccessToken, false);
    assert.equal(changed.kiteUserId, undefined);
    assert.throws(
      () =>
        saveKite(f.db, f.store, f.userId, {
          enabled: false,
          apiKey: "https://kite.zerodha.com/connect/login?api_key=x",
        }),
      /does not look like a Kite API key/,
    );
  } finally {
    f.close();
  }
});

test("kite connect state is single-use, expires and identifies the account", async () => {
  const f = fixture();
  try {
    saveKite(f.db, f.store, f.userId, {
      enabled: false,
      apiKey: "kitekey123",
      apiSecret: "kitesecret123",
    });
    const { loginUrl } = startKiteConnect(f.db, f.store, f.userId);
    const url = new URL(loginUrl);
    assert.equal(url.origin, "https://kite.zerodha.com");
    assert.equal(url.searchParams.get("api_key"), "kitekey123");
    const state = new URLSearchParams(
      url.searchParams.get("redirect_params") || "",
    ).get("state");
    assert(state && state.length >= 16);
    const stored = f.db
      .prepare("SELECT config FROM integrations WHERE user_id=?")
      .get(f.userId) as any;
    assert(!stored.config.includes(state), "raw state must not be stored");
    await withKite(
      () =>
        json({
          status: "success",
          data: { access_token: "tok", user_id: "AB1" },
        }),
      async () => {
        const done = await completeKiteConnect(
          f.db,
          f.store,
          state,
          "request-token",
        );
        assert.equal(done.userId, f.userId);
        assert.equal(done.status.connected, true);
        await assert.rejects(
          completeKiteConnect(f.db, f.store, state, "request-token"),
          /invalid or was already used/,
        );
        const second = new URL(
          startKiteConnect(f.db, f.store, f.userId).loginUrl,
        );
        const secondState = new URLSearchParams(
          second.searchParams.get("redirect_params") || "",
        ).get("state")!;
        const row = f.db
          .prepare("SELECT id,config FROM integrations WHERE user_id=?")
          .get(f.userId) as any;
        const config = JSON.parse(row.config);
        config.connectStateExpiresAt = Date.now() - 1;
        f.db
          .prepare("UPDATE integrations SET config=? WHERE id=?")
          .run(JSON.stringify(config), row.id);
        await assert.rejects(
          completeKiteConnect(f.db, f.store, secondState, "request-token"),
          /expired/,
        );
      },
    );
  } finally {
    f.close();
  }
});

test("kite access tokens expire at the next 06:00 IST", () => {
  // 2026-10-05 05:59 IST and 06:01 IST.
  const before = Date.parse("2026-10-05T05:59:00+05:30");
  const after = Date.parse("2026-10-05T06:01:00+05:30");
  assert.equal(lastKiteReset(before), Date.parse("2026-10-04T06:00:00+05:30"));
  assert.equal(lastKiteReset(after), Date.parse("2026-10-05T06:00:00+05:30"));
  const issued = new Date(
    Date.parse("2026-10-04T09:15:00+05:30"),
  ).toISOString();
  assert.equal(kiteTokenExpired(issued, before), false);
  assert.equal(kiteTokenExpired(issued, after), true);
  const earlyMorning = new Date(
    Date.parse("2026-10-05T03:00:00+05:30"),
  ).toISOString();
  assert.equal(kiteTokenExpired(earlyMorning, before), false);
  assert.equal(kiteTokenExpired(earlyMorning, after), true);
  assert.equal(kiteTokenExpired(undefined, after), true);
});

test("kite token exceptions clear the saved session and prompt guidance follows status", async () => {
  const f = connectedFixture();
  try {
    assert.match(kitePromptGuide(f.db, f.store, f.userId), /kite_option_chain/);
    await withKite(
      () =>
        json(
          {
            status: "error",
            error_type: "TokenException",
            message: "Incorrect `api_key` or `access_token`.",
          },
          403,
        ),
      async () => {
        await assert.rejects(
          kiteQuote(
            f.db,
            f.store,
            f.userId,
            ["NSE:INFY"],
            new AbortController().signal,
          ),
          /no longer valid/,
        );
      },
    );
    const status = kiteStatus(f.db, f.store, f.userId);
    assert.equal(status.connected, false);
    assert.equal(status.hasAccessToken, false);
    assert.match(status.lastError || "", /Connect Kite/);
    assert.match(
      kitePromptGuide(f.db, f.store, f.userId),
      /Do not call kite_\* tools/,
    );
  } finally {
    f.close();
  }
});

const instrumentCsv = (expiry: string, later: string) =>
  [
    "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
    ...[24800, 24900, 25000, 25100, 25200].flatMap((strike, i) => [
      `${1000 + i},1,NIFTY${strike}CE,"NIFTY",0,${expiry},${strike},0.05,75,CE,NFO-OPT,NFO`,
      `${2000 + i},1,NIFTY${strike}PE,"NIFTY",0,${expiry},${strike},0.05,75,PE,NFO-OPT,NFO`,
    ]),
    `3000,1,NIFTY25000CELATER,"NIFTY",0,${later},25000,0.05,75,CE,NFO-OPT,NFO`,
    `4000,1,NIFTYNXT5025000CE,"NIFTYNXT50",0,${expiry},25000,0.05,25,CE,NFO-OPT,NFO`,
  ].join("\n");

test("kite option chain picks the exact underlying, nearest strikes and estimates IV", async () => {
  const f = connectedFixture();
  const expiry = istDate(7);
  const years =
    (Date.parse(`${expiry}T15:30:00+05:30`) - Date.now()) / (365 * 86_400_000);
  const spot = 25010;
  const premium = (type: "CE" | "PE", strike: number) =>
    Math.round(
      blackScholes(type, spot, strike, years, 0.065, 0.15).price * 20,
    ) / 20;
  let instrumentDownloads = 0;
  try {
    await withKite(
      (url) => {
        if (url.pathname === "/instruments/NFO") {
          instrumentDownloads++;
          return new Response(instrumentCsv(expiry, istDate(14)), {
            headers: { "content-type": "text/csv" },
          });
        }
        if (url.pathname === "/quote/ltp") {
          assert.deepEqual(url.searchParams.getAll("i"), ["NSE:NIFTY 50"]);
          return json({
            status: "success",
            data: { "NSE:NIFTY 50": { last_price: spot } },
          });
        }
        if (url.pathname === "/quote") {
          const data: Record<string, any> = {};
          for (const i of url.searchParams.getAll("i")) {
            const match = /NIFTY(\d+)(CE|PE)$/.exec(i)!;
            const strike = Number(match[1]);
            const type = match[2] as "CE" | "PE";
            const price = premium(type, strike);
            data[i] = {
              last_price: price,
              volume: 1000,
              oi: type === "CE" ? strike - 24000 : 26000 - strike,
              ohlc: { close: price },
              depth: {
                buy: [{ price: price - 0.05, quantity: 75 }],
                sell: [{ price: price + 0.05, quantity: 75 }],
              },
            };
          }
          return json({ status: "success", data });
        }
        throw new Error(`unexpected ${url}`);
      },
      async () => {
        const chain = await kiteOptionChain(
          f.db,
          f.store,
          f.userId,
          {
            underlying: "nifty",
            maxStrikes: 3,
            spotInstrument: "nse:Nifty 50",
          },
          new AbortController().signal,
        );
        assert.equal(chain.expiry, expiry);
        assert.deepEqual(chain.upcomingExpiries, [expiry, istDate(14)]);
        assert.equal(chain.spot, spot);
        assert.equal(chain.atmStrike, 25000);
        assert.equal(chain.lotSize, 75);
        assert.deepEqual(
          chain.strikes.map((row) => row.strike),
          [24900, 25000, 25100],
        );
        assert(
          chain.strikes.every((row) => row.ce?.symbol.startsWith("NIFTY2")),
        );
        const atm = chain.strikes[1];
        assert(Math.abs((atm.ce?.iv ?? 0) - 15) < 1, `CE IV ${atm.ce?.iv}`);
        assert(Math.abs((atm.pe?.iv ?? 0) - 15) < 1, `PE IV ${atm.pe?.iv}`);
        assert((atm.ce?.delta ?? 0) > 0.4 && (atm.ce?.delta ?? 0) < 0.65);
        assert((atm.pe?.delta ?? 0) < -0.35);
        assert.equal(chain.summary.totalCallOi, 900 + 1000 + 1100);
        assert.equal(chain.summary.totalPutOi, 1100 + 1000 + 900);
        assert.equal(chain.summary.putCallOiRatio, 1);
        assert.equal(chain.summary.highestCallOiStrike, 25100);
        assert.equal(chain.summary.highestPutOiStrike, 24900);
        assert.equal(chain.summary.maxPain, 25000);
        assert(JSON.stringify(chain).length < 6000, "fits the shared board");
        await assert.rejects(
          kiteOptionChain(
            f.db,
            f.store,
            f.userId,
            { underlying: "NIFTY", expiry: "2099-01-01" },
            new AbortController().signal,
          ),
          /no 2099-01-01 expiry/,
        );
        await assert.rejects(
          kiteOptionChain(
            f.db,
            f.store,
            f.userId,
            { underlying: "NIFT" },
            new AbortController().signal,
          ),
          /Similar underlyings: NIFTY, NIFTYNXT50/,
        );
        assert.equal(instrumentDownloads, 1, "instrument dump is cached");
      },
    );
  } finally {
    f.close();
  }
});

test("kite historical resolves exchange symbols and summarises candles", async () => {
  const f = connectedFixture();
  try {
    await withKite(
      (url) => {
        if (url.pathname === "/instruments/NSE")
          return new Response(
            [
              "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
              "408065,1594,INFY,INFOSYS,0,,0,0.05,1,EQ,NSE,NSE",
              "408066,1595,INFY-BE,INFOSYS,0,,0,0.05,1,EQ,NSE,NSE",
              "256265,0,NIFTY 50,NIFTY 50,0,,0,0,0,EQ,INDICES,NSE",
            ].join("\n"),
            { headers: { "content-type": "text/csv" } },
          );
        if (url.pathname === "/instruments/historical/408065/day") {
          assert.equal(url.searchParams.get("from"), "2026-01-01 00:00:00");
          assert.equal(url.searchParams.get("to"), "2026-01-31 23:59:59");
          return json({
            status: "success",
            data: {
              candles: Array.from({ length: 25 }, (_, i) => [
                `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00+0530`,
                100 + i,
                102 + i,
                99 + i,
                101 + i,
                1000,
              ]),
            },
          });
        }
        throw new Error(`unexpected ${url}`);
      },
      async () => {
        const result = await kiteHistorical(
          f.db,
          f.store,
          f.userId,
          {
            instrument: "nse:infy",
            interval: "day",
            from: "2026-01-01",
            to: "2026-01-31",
            maxCandles: 10,
          },
          new AbortController().signal,
        );
        assert.equal(result.instrument, "NSE:INFY");
        assert.equal(result.instrumentToken, "408065");
        assert.equal(result.candles.length, 10);
        assert.equal(result.candlesOmitted, 15);
        assert.equal(result.summary.candles, 25);
        assert.equal(result.summary.periodHigh, 126);
        assert.equal(result.summary.periodLow, 99);
        assert.equal(result.summary.sma20, 115.5);
        const search = await kiteInstrumentSearch(
          f.db,
          f.store,
          f.userId,
          { query: "infy" },
          new AbortController().signal,
        );
        assert.deepEqual(
          search.matches.map((m) => m.instrument),
          ["NSE:INFY", "NSE:INFY-BE"],
        );
        await assert.rejects(
          kiteHistorical(
            f.db,
            f.store,
            f.userId,
            {
              instrument: "INFY",
              interval: "day",
              from: "2026-01-01",
              to: "2026-01-02",
            },
            new AbortController().signal,
          ),
          /EXCHANGE:TRADINGSYMBOL/,
        );
      },
    );
  } finally {
    f.close();
  }
});

test("implied volatility inverts Black-Scholes and rejects impossible prices", () => {
  const price = blackScholes("CE", 100, 105, 0.25, 0.05, 0.3).price;
  assert(
    Math.abs(impliedVolatility("CE", price, 100, 105, 0.25, 0.05)! - 0.3) <
      1e-4,
  );
  assert.equal(
    impliedVolatility("PE", 0.0001, 100, 150, 0.25, 0.05),
    undefined,
  );
  assert.equal(impliedVolatility("CE", 5, 100, 105, 0, 0.05), undefined);
});

test("public kite callback connects the account without a session cookie", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-kite-app-"));
  const ctx = createApp(dir);
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    addUser(ctx.db, "callback-user", "callback@example.test");
    saveKite(ctx.db, ctx.store, "callback-user", {
      enabled: false,
      apiKey: "kitekey123",
      apiSecret: "kitesecret123",
    });
    const state = new URLSearchParams(
      new URL(
        startKiteConnect(ctx.db, ctx.store, "callback-user").loginUrl,
      ).searchParams.get("redirect_params") || "",
    ).get("state")!;
    await withKite(
      () =>
        json({
          status: "success",
          data: { access_token: "tok", user_id: "ZX9" },
        }),
      async () => {
        const ok = await fetch(
          `${base}/api/integrations/kite/callback?action=login&type=login&status=success&request_token=abcdefghijkl&state=${encodeURIComponent(state)}`,
        );
        assert.equal(ok.status, 200);
        const body = await ok.text();
        assert.match(body, /Kite connected/);
        assert.match(body, /ZX9/);
        assert.equal(
          kiteStatus(ctx.db, ctx.store, "callback-user").connected,
          true,
        );
        const replay = await fetch(
          `${base}/api/integrations/kite/callback?status=success&request_token=abcdefghijkl&state=${encodeURIComponent(state)}`,
        );
        assert.equal(replay.status, 400);
        const missing = await fetch(
          `${base}/api/integrations/kite/callback?request_token=abcdefghijkl`,
        );
        assert.equal(missing.status, 400);
      },
    );
  } finally {
    for (const a of ctx.engine.active.values())
      a.controller.abort(new Error("Stopped by user"));
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kite review regressions: normalised symbols, newer tokens survive, own session required", async () => {
  const f = connectedFixture();
  try {
    await withKite(
      (url) => {
        if (url.pathname === "/quote/ltp") {
          assert.deepEqual(url.searchParams.getAll("i"), ["NSE:INFY"]);
          return json({
            status: "success",
            data: { "NSE:INFY": { last_price: 1500 } },
          });
        }
        if (url.pathname === "/quote") {
          // Simulate the user reconnecting while this request is in flight.
          saveKite(f.db, f.store, f.userId, {
            enabled: true,
            accessToken: "newer-token",
          });
          return json(
            { status: "error", error_type: "TokenException", message: "old" },
            403,
          );
        }
        throw new Error(`unexpected ${url}`);
      },
      async () => {
        const quote = await kiteQuote(
          f.db,
          f.store,
          f.userId,
          ["nse:infy", "NSE:INFY"],
          new AbortController().signal,
          "ltp",
        );
        assert.deepEqual(quote.missing, []);
        assert.equal((quote.quotes["NSE:INFY"] as any).lastPrice, 1500);
        await assert.rejects(
          kiteQuote(
            f.db,
            f.store,
            f.userId,
            ["NSE:INFY"],
            new AbortController().signal,
          ),
          /no longer valid/,
        );
        assert.equal(kiteStatus(f.db, f.store, f.userId).connected, true);
      },
    );
    addUser(f.db, "other-user", "other@example.test");
    await assert.rejects(
      kiteInstrumentSearch(
        f.db,
        f.store,
        "other-user",
        { query: "INFY" },
        new AbortController().signal,
      ),
      /not set up/,
    );
  } finally {
    f.close();
  }
});
