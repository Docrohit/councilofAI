import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bech32 } from "@scure/base";
import { createApp } from "../server/app.ts";
import { checkPayments } from "../server/payments.ts";
import { setRelayQuery, signEvent, type NostrEvent } from "../server/lightning.ts";

process.env.NODE_ENV = "test";
process.env.BTC_USD_PRICE = "85000";
const ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const sha = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

/** A structurally valid (unsigned) BOLT11 invoice for tests. */
function fakeBolt11(msat: number, paymentHashHex: string) {
  const base32 = (n: number, length: number) => Array.from({ length }, (_, i) => Math.floor(n / 32 ** (length - 1 - i)) % 32);
  const hash = bech32.toWords(Uint8Array.from(Buffer.from(paymentHashHex, "hex")));
  const words = [...base32(Math.floor(Date.now() / 1000), 7), 1, 1, 20, ...hash, 6, 0, 4, ...base32(86_400, 4), ...Array(104).fill(0)];
  return bech32.encode(`lnbc${msat * 10}p`, words, 10_000);
}

async function fakeServer(handler: (url: URL) => { status?: number; json?: unknown; text?: string }) {
  const server = createServer((req, res) => {
    const out = handler(new URL(req.url!, "http://x"));
    res.writeHead(out.status || 200, { "content-type": out.json !== undefined ? "application/json" : "text/plain" });
    res.end(out.json !== undefined ? JSON.stringify(out.json) : out.text || "");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    host: `127.0.0.1:${(server.address() as any).port}`,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}

async function harness(env: Record<string, string>, work: (ctx: any) => Promise<void>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const dir = mkdtempSync(path.join(tmpdir(), "council-pay-"));
  const ctx = createApp(dir);
  const server = ctx.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const api = async (url: string, body?: unknown, cookie = "") => {
    const response = await fetch(base + "/api" + url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-council-request": "1", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers.getSetCookie().map((s) => s.split(";")[0]).join("; "),
    };
  };
  const signup = async (email: string) =>
    (await api("/auth/signup", { name: email.split("@")[0], email, password: "long-password-123" })).cookie;
  try {
    await work({ ...ctx, api, signup });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
    process.env = saved;
  }
}

const monthsFromNow = (iso: string) => (new Date(iso).getTime() - Date.now()) / (30.44 * 86_400_000);

test("a zap receipt unlocks 3 months; paying again extends from the end of current access", async () => {
  const providerKey = schnorr.utils.randomSecretKey();
  const providerPubkey = Buffer.from(schnorr.getPublicKey(providerKey)).toString("hex");
  const invoices: string[] = [];
  const requests: NostrEvent[] = [];
  const ln = await fakeServer((url) => {
    if (url.pathname === "/.well-known/lnurlp/rohit")
      return { json: { tag: "payRequest", callback: `http://${ln.host}/cb`, minSendable: 1000, maxSendable: 1e12, allowsNostr: true, nostrPubkey: providerPubkey } };
    requests.push(JSON.parse(url.searchParams.get("nostr") || "null"));
    invoices.push(fakeBolt11(Number(url.searchParams.get("amount")), randomBytes(32).toString("hex")));
    return { json: { pr: invoices.at(-1) } };
  });
  let events: NostrEvent[] = [];
  setRelayQuery(async () => events);
  const receipt = (key: Uint8Array, bolt11: string, request: NostrEvent) =>
    signEvent({ kind: 9735, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["bolt11", bolt11], ["description", JSON.stringify(request)]] }, key);
  try {
    await harness({ LIGHTNING_ADDRESS: `rohit@${ln.host}` }, async ({ api, signup, db }) => {
      const cookie = await signup("payer@example.test");
      const billing = await api("/billing", undefined, cookie);
      assert.deepEqual(billing.data.payments, { lightning: true, onchain: false });
      const order = (await api("/billing/orders", { chain: "lightning" }, cookie)).data;
      assert.equal(order.amountSats, 100_000);
      assert.equal(order.months, 3);
      assert.equal(order.autoVerify, true);
      await checkPayments(db);
      assert.equal((await api("/me", undefined, cookie)).data.billing.accessApproved, false);
      // A receipt signed by anyone but the provider unlocks nothing on its own.
      events = [receipt(schnorr.utils.randomSecretKey(), invoices[0], requests[0])];
      await checkPayments(db);
      assert.equal((await api("/me", undefined, cookie)).data.billing.accessApproved, false);
      events = [receipt(providerKey, invoices[0], requests[0])];
      await checkPayments(db);
      await checkPayments(db);
      const me = (await api("/me", undefined, cookie)).data.billing;
      assert.equal(me.accessApproved, true);
      assert(Math.abs(monthsFromNow(me.accessUntil) - 3) < 0.2, me.accessUntil);
      // A second payment adds 3 more months on top.
      await api("/billing/orders", { chain: "lightning" }, cookie);
      events = [receipt(providerKey, invoices[1], requests[1])];
      await checkPayments(db);
      assert(Math.abs(monthsFromNow((await api("/me", undefined, cookie)).data.billing.accessUntil) - 6) < 0.3);
      // Expired access no longer counts.
      db.prepare("UPDATE users SET access_until=? WHERE email=?").run(new Date(Date.now() - 1000).toISOString(), "payer@example.test");
      assert.equal((await api("/me", undefined, cookie)).data.billing.accessApproved, false);
    });
  } finally {
    setRelayQuery();
    await ln.close();
  }
});

test("a preimage proves payment once; a payment never unlocks two orders", async () => {
  const preimage = "5a".repeat(32);
  const ln = await fakeServer((url) => {
    if (url.pathname === "/.well-known/lnurlp/rohit") return { json: { tag: "payRequest", callback: `http://${ln.host}/cb`, minSendable: 1000, maxSendable: 1e12 } };
    return { json: { pr: fakeBolt11(Number(url.searchParams.get("amount")), sha(preimage)) } };
  });
  try {
    await harness({ LIGHTNING_ADDRESS: `rohit@${ln.host}` }, async ({ api, signup }) => {
      const cookie = await signup("preimage@example.test");
      const first = (await api("/billing/orders", { chain: "lightning" }, cookie)).data;
      const second = (await api("/billing/orders", { chain: "lightning" }, cookie)).data;
      assert.equal(first.autoVerify, false);
      assert.equal((await api(`/billing/orders/${first.id}/proof`, { reference: "00".repeat(32) }, cookie)).status, 400);
      assert.match((await api(`/billing/orders/${first.id}/proof`, { reference: sha(preimage) }, cookie)).data.error, /payment hash/);
      assert.equal((await api(`/billing/orders/${first.id}/proof`, { reference: preimage }, cookie)).data.status, "paid");
      assert.equal((await api(`/billing/orders/${second.id}/proof`, { reference: preimage }, cookie)).status, 409);
      assert(Math.abs(monthsFromNow((await api("/me", undefined, cookie)).data.billing.accessUntil) - 3) < 0.2);
    });
  } finally {
    await ln.close();
  }
});

test("on-chain orders use Council's own amount range, match after confirmation, and admin approval is guarded", async () => {
  const txs: Record<string, any> = {};
  let listing: any[] = [];
  const mempool = await fakeServer((url) => {
    if (url.pathname === "/api/blocks/tip/height") return { text: "900000" };
    if (url.pathname === `/api/address/${ADDRESS}/txs`) return { json: listing };
    const m = /^\/api\/tx\/([0-9a-f]{64})$/.exec(url.pathname);
    if (m) return txs[m[1]] ? { json: txs[m[1]] } : { status: 404, text: "not found" };
    return { json: [] };
  });
  const pay = (txid: string, value: number, confirmed: boolean) => ({
    txid,
    status: confirmed ? { confirmed: true, block_height: 900_000, block_time: Math.floor(Date.now() / 1000) } : { confirmed: false },
    vout: [{ scriptpubkey_address: ADDRESS, value }],
  });
  try {
    await harness({ ONCHAIN_ADDRESS: ADDRESS, MEMPOOL_API: `http://${mempool.host}/api` }, async ({ api, signup, db }) => {
      const cookie = await signup("chain@example.test");
      const admin = await signup("cosmicwisdomyt@gmail.com");
      const a = (await api("/billing/orders", { chain: "onchain" }, cookie)).data;
      const b = (await api("/billing/orders", { chain: "onchain" }, cookie)).data;
      for (const o of [a, b]) {
        assert.equal(o.address, ADDRESS);
        assert(o.amountSats >= 102_001 && o.amountSats <= 103_999, "never overlaps Council Network's 100,001-101,999 range");
      }
      assert.notEqual(a.amountSats, b.amountSats);
      // Exact amount, confirmed: unlocks automatically.
      listing = [pay("a".repeat(64), a.amountSats, true)];
      await checkPayments(db);
      assert.equal((await api(`/billing/orders/${a.id}`, undefined, cookie)).data.status, "paid");
      // An unconfirmed exact payment for b, pasted by the buyer, then a note: admin approval waits for confirmation.
      txs["c".repeat(64)] = pay("c".repeat(64), b.amountSats, false);
      assert.equal((await api(`/billing/orders/${b.id}/proof`, { reference: "c".repeat(64) }, cookie)).data.proofCheck.exact, true);
      assert.equal((await api(`/billing/orders/${b.id}/proof`, { reference: "see screenshot" }, cookie)).status, 400);
      await api(`/billing/orders/${b.id}/proof`, { note: "please hurry" }, cookie);
      const refused = await api(`/billing/admin/orders/${b.id}`, { action: "approve" }, admin);
      assert.equal(refused.status, 409);
      assert.match(refused.data.error, /not confirmed/);
      assert.equal((await api(`/billing/admin/orders/${b.id}`, { action: "approve" }, cookie)).status, 404, "admins only");
      txs["c".repeat(64)] = pay("c".repeat(64), b.amountSats, true);
      assert.equal((await api(`/billing/admin/orders/${b.id}`, { action: "approve" }, admin)).status, 200);
      assert(db.prepare("SELECT 1 FROM payment_claims WHERE reference=?").get(`onchain:${"c".repeat(64)}:0`));
      assert(Math.abs(monthsFromNow((await api("/me", undefined, cookie)).data.billing.accessUntil) - 6) < 0.3, "two payments, six months");
    });
  } finally {
    await mempool.close();
  }
});

test("an approved payment screenshot buys one billing period", async () => {
  await harness({}, async ({ api, signup, db }) => {
    const cookie = await signup("shot@example.test");
    const admin = await signup("cosmicwisdomyt@gmail.com");
    const userId = (db.prepare("SELECT id FROM users WHERE email=?").get("shot@example.test") as any).id;
    db.prepare("INSERT INTO payment_submissions(id,user_id,file_name,mime,status,created_at,note,image) VALUES(?,?,?,?,?,?,?,?)").run(
      "shot-1", userId, "proof.png", "image/png", "submitted", new Date().toISOString(), "", Buffer.from("x"),
    );
    assert.equal((await api("/billing/admin/payments/shot-1/review", { status: "approved" }, admin)).status, 200);
    const billing = (await api("/me", undefined, cookie)).data.billing;
    assert.equal(billing.accessApproved, true);
    assert(Math.abs(monthsFromNow(billing.accessUntil) - 3) < 0.2);
  });
});

test("stale orders cannot take new payments; approval needs the exact amount; overrides still claim the output", async () => {
  const txs: Record<string, any> = {};
  const mempool = await fakeServer((url) => {
    if (url.pathname === "/api/blocks/tip/height") return { text: "900000" };
    const m = /^\/api\/tx\/([0-9a-f]{64})$/.exec(url.pathname);
    if (m) return txs[m[1]] ? { json: txs[m[1]] } : { status: 404, text: "nf" };
    return { json: [] };
  });
  const pay = (txid: string, value: number) => ({
    txid,
    status: { confirmed: true, block_height: 900_000, block_time: Math.floor(Date.now() / 1000) },
    vout: [{ scriptpubkey_address: ADDRESS, value }],
  });
  try {
    await harness({ ONCHAIN_ADDRESS: ADDRESS, MEMPOOL_API: `http://${mempool.host}/api` }, async ({ api, signup, db }) => {
      const attacker = await signup("old@example.test");
      const victim = await signup("new@example.test");
      const admin = await signup("cosmicwisdomyt@gmail.com");
      const old = (await api("/billing/orders", { chain: "onchain" }, attacker)).data;
      db.prepare("UPDATE payment_orders SET status='expired', created_at=? WHERE id=?").run(new Date(Date.now() - 20 * 86_400_000).toISOString(), old.id);
      txs["e".repeat(64)] = pay("e".repeat(64), old.amountSats);
      assert.equal((await api(`/billing/orders/${old.id}/proof`, { reference: "e".repeat(64) }, attacker)).status, 409, "a 20-day-old order cannot claim a payment");
      // A Council Network-sized payment on the shared address is not accepted without an override.
      const o = (await api("/billing/orders", { chain: "onchain" }, victim)).data;
      txs["f".repeat(64)] = pay("f".repeat(64), 300_777);
      await api(`/billing/orders/${o.id}/proof`, { reference: "f".repeat(64) }, victim);
      const refused = await api(`/billing/admin/orders/${o.id}`, { action: "approve" }, admin);
      assert.equal(refused.status, 409);
      assert.match(refused.data.error, /not this payment's exact/);
      assert.equal((await api(`/billing/admin/orders/${o.id}`, { action: "approve", force: true, note: "checked" }, admin)).status, 200);
      assert(db.prepare("SELECT 1 FROM payment_claims WHERE reference=?").get(`onchain:${"f".repeat(64)}:0`), "the override claims the output");
      const row = db.prepare("SELECT tx_reference, admin_note FROM payment_orders WHERE id=?").get(o.id) as any;
      assert.match(row.tx_reference, /^f{64}/);
      assert.match(row.admin_note, /Approved anyway by cosmicwisdomyt@gmail.com/);
    });
  } finally {
    await mempool.close();
  }
});

test("approving the same screenshot twice adds one period only", async () => {
  await harness({}, async ({ api, signup, db }) => {
    const cookie = await signup("twice@example.test");
    const admin = await signup("cosmicwisdomyt@gmail.com");
    const userId = (db.prepare("SELECT id FROM users WHERE email=?").get("twice@example.test") as any).id;
    db.prepare("INSERT INTO payment_submissions(id,user_id,file_name,mime,status,created_at,note,image) VALUES(?,?,?,?,?,?,?,?)").run(
      "twice-1", userId, "p.png", "image/png", "submitted", new Date().toISOString(), "", Buffer.from("x"),
    );
    await api("/billing/admin/payments/twice-1/review", { status: "approved" }, admin);
    await api("/billing/admin/payments/twice-1/review", { status: "approved" }, admin);
    assert(Math.abs(monthsFromNow((await api("/me", undefined, cookie)).data.billing.accessUntil) - 3) < 0.2);
  });
});

test("on-chain amounts never fall in Council Network's bands, whatever the price", async () => {
  await harness({ ONCHAIN_ADDRESS: ADDRESS, PAYMENT_SATOSHIS: "98000" }, async ({ api, signup }) => {
    const cookie = await signup("band@example.test");
    for (let i = 0; i < 3; i++) {
      const o = (await api("/billing/orders", { chain: "onchain" }, cookie)).data;
      assert(!(o.amountSats >= 100_001 && o.amountSats <= 101_999), `amount ${o.amountSats} is outside Network's band`);
    }
  });
});
