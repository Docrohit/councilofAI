import { randomInt, randomUUID } from "node:crypto";
import type { DB } from "./db.ts";
import { billingPeriodMonths, paymentSatoshis } from "./billing.ts";
import {
  decodeBolt11,
  preimageMatches,
  queryRelays,
  validateBitcoinAddress,
  zapReceiptFor,
  zapRequest,
} from "./lightning.ts";

/**
 * Automatic payment verification for quarterly access, shared in design with
 * Council Network: Lightning invoices with zap receipts (NIP-57) or a pasted
 * preimage, and one static on-chain address with a unique amount per order.
 * Every payment (an on-chain output or a Lightning payment hash) is recorded in
 * payment_claims and unlocks at most one order.
 */

export class PaymentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Council Network uses offsets 1..1999 on the same address; Council uses its own
// range so one payment can never match orders in both apps.
const OFFSET_MIN = () => Math.max(1, Math.floor(Number(process.env.ONCHAIN_OFFSET_MIN) || 2001));
const OFFSET_MAX = () => Math.min(OFFSET_MIN() + 1998, Math.max(OFFSET_MIN(), Math.floor(Number(process.env.ONCHAIN_OFFSET_MAX) || 3999)));
/**
 * Amounts the other app on the same address may use (Council Network: 100,001-101,999 and
 * 300,001-301,999 by default). Council never hands these out, whatever its price is.
 */
const reservedBands = () =>
  (process.env.ONCHAIN_RESERVED_BANDS || "100001-101999,300001-301999")
    .split(",")
    .map((b) => b.split("-").map(Number))
    .filter(([lo, hi]) => Number.isFinite(lo) && Number.isFinite(hi));
const inReservedBand = (amount: number) => reservedBands().some(([lo, hi]) => amount >= lo && amount <= hi);
const BLOCK_TIME_SLACK_SECONDS = 2 * 3600;

export const paymentsConfig = () => {
  const lightning = (process.env.LIGHTNING_ADDRESS || process.env.LIGHTNING_WALLET || "").trim();
  return {
    lightningAddress: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lightning) ? lightning : "",
    onchainAddress: (process.env.ONCHAIN_ADDRESS || "").trim(),
    mempoolApi: (process.env.MEMPOOL_API || "https://mempool.space/api").replace(/\/$/, ""),
    confirmations: Math.max(1, Number(process.env.ONCHAIN_CONFIRMATIONS || 1)),
    relays: (process.env.NOSTR_RELAYS || "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
    allowHttp: process.env.NODE_ENV === "test",
  };
};

const now = () => new Date().toISOString();

async function fetchJson(url: string, timeoutMs = 15_000) {
  // Provider-supplied URLs (LNURL callback, verify links) must be https and are not followed elsewhere.
  if (!url.startsWith("https://") && !(paymentsConfig().allowHttp && url.startsWith("http://127.0.0.1"))) throw new Error("Only https payment endpoints are used.");
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!response.ok) throw new Error(`${new URL(url).host} returned ${response.status}`);
  return response.json() as Promise<any>;
}

async function tipHeight() {
  const response = await fetch(`${paymentsConfig().mempoolApi}/blocks/tip/height`, { signal: AbortSignal.timeout(15_000) });
  const height = Number(await response.text());
  return response.ok && Number.isInteger(height) && height > 0 ? height : 0;
}

type OrderRow = {
  id: string;
  user_id: string;
  chain: "lightning" | "onchain";
  amount_sats: number;
  months: number;
  status: "pending" | "review" | "paid" | "expired" | "rejected";
  invoice: string | null;
  payment_hash: string | null;
  verify_url: string | null;
  zap_request_id: string | null;
  zap_recipient: string | null;
  zap_provider_pubkey: string | null;
  address: string | null;
  tx_reference: string | null;
  proof_check: string | null;
  confirmations: number;
  admin_note: string | null;
  proof_note: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
};

export function publicOrder(row: OrderRow) {
  return {
    id: row.id,
    chain: row.chain,
    amountSats: row.amount_sats,
    months: row.months,
    status: row.status,
    invoice: row.invoice,
    autoVerify: row.chain === "onchain" || !!row.verify_url || !!row.zap_request_id,
    exactAmount: row.chain === "onchain",
    address: row.address,
    bip21: row.address ? `bitcoin:${row.address}?amount=${(row.amount_sats / 1e8).toFixed(8)}` : null,
    confirmations: row.confirmations,
    txReference: row.tx_reference,
    proofCheck: row.proof_check ? JSON.parse(row.proof_check) : null,
    proofNote: row.proof_note,
    adminNote: row.admin_note,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

const getRow = (db: DB, id: string) => db.prepare("SELECT * FROM payment_orders WHERE id=?").get(id) as OrderRow | undefined;

/** Runs work inside one SQLite write transaction. */
function tx<T>(db: DB, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function lightningInvoice(sats: number, comment: string) {
  const config = paymentsConfig();
  const [user, domain] = config.lightningAddress.split("@");
  const scheme = config.allowHttp && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain) ? "http" : "https";
  const lnurlpUrl = `${scheme}://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
  const meta = await fetchJson(lnurlpUrl);
  if (meta?.tag !== "payRequest" || !meta.callback) throw new Error("The Lightning address did not return a pay request.");
  const msat = sats * 1000;
  if (msat < Number(meta.minSendable) || msat > Number(meta.maxSendable))
    throw new PaymentError("This amount is outside the Lightning address's limits. Pay on-chain instead.");
  const providerPubkey = typeof meta.nostrPubkey === "string" ? meta.nostrPubkey.toLowerCase() : "";
  const zap =
    meta.allowsNostr === true && /^[0-9a-f]{64}$/.test(providerPubkey) && config.relays.length
      ? zapRequest({ amountMsat: msat, lnurlpUrl, relays: config.relays, content: comment })
      : null;
  const request = async (withZap: boolean) => {
    const url = new URL(meta.callback);
    url.searchParams.set("amount", String(msat));
    if (withZap && zap) url.searchParams.set("nostr", JSON.stringify(zap.event));
    else if (Number(meta.commentAllowed) > 0) url.searchParams.set("comment", comment.slice(0, Number(meta.commentAllowed)));
    return fetchJson(url.toString()).catch(() => null);
  };
  let invoice = await request(true);
  let zapped = !!zap;
  if (zap && (invoice?.status === "ERROR" || !invoice?.pr)) {
    invoice = await request(false);
    zapped = false;
  }
  if (invoice?.status === "ERROR" || !invoice?.pr) throw new Error("The Lightning address did not return an invoice.");
  const pr = String(invoice.pr);
  const decoded = decodeBolt11(pr);
  if (decoded.network !== "bc") throw new Error("The Lightning address returned a non-mainnet invoice.");
  if (decoded.msat !== msat) throw new Error("The Lightning address returned an invoice for the wrong amount.");
  // The order lives as long as its invoice can be paid (at least 10 minutes, at most 2 days).
  const expires = Math.min(Date.now() + 2 * 86_400_000, Math.max(Date.now() + 10 * 60_000, decoded.expiresAt.getTime()));
  return {
    invoice: pr,
    paymentHash: decoded.paymentHash,
    verifyUrl: typeof invoice.verify === "string" ? invoice.verify : null,
    zap: zap && zapped ? { requestId: zap.event.id, recipient: zap.recipient, providerPubkey } : null,
    expiresAt: new Date(expires).toISOString(),
  };
}

export async function createOrder(db: DB, userId: string, chain: "lightning" | "onchain") {
  const config = paymentsConfig();
  if (chain === "lightning" && !config.lightningAddress) throw new PaymentError("Lightning payments are not configured yet.", 503);
  if (chain === "onchain" && !config.onchainAddress) throw new PaymentError("On-chain payments are not configured yet.", 503);
  const price = paymentSatoshis();
  const months = billingPeriodMonths();
  const id = randomUUID();
  tx(db, () => {
    const open = db
      .prepare("SELECT count(*) AS n FROM payment_orders WHERE user_id=? AND status IN ('pending','review')")
      .get(userId) as { n: number };
    if (open.n >= 3) throw new PaymentError("You have too many open payments. Pay or let one expire first.");
    if (chain === "lightning") {
      db.prepare(
        "INSERT INTO payment_orders(id,user_id,chain,amount_sats,months,status,expires_at,created_at) VALUES(?,?,?,?,?,'pending',?,?)",
      ).run(id, userId, "lightning", price, months, new Date(Date.now() + 2 * 86_400_000).toISOString(), now());
      return;
    }
    const address = validateBitcoinAddress(config.onchainAddress);
    // The exact amount identifies the order. Amounts stay reserved for 15 days
    // whatever the status, and while an order can still be matched.
    const since = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const used = new Set(
      (
        db
          .prepare("SELECT amount_sats FROM payment_orders WHERE chain='onchain' AND (created_at > ? OR status IN ('pending','review'))")
          .all(since) as { amount_sats: number }[]
      ).map((r) => Number(r.amount_sats)),
    );
    const free: number[] = [];
    for (let offset = OFFSET_MIN(); offset <= OFFSET_MAX(); offset++)
      if (!used.has(price + offset) && !inReservedBand(price + offset)) free.push(price + offset);
    if (!free.length) throw new PaymentError("Too many open on-chain payments right now. Use Lightning or try again later.", 503);
    db.prepare(
      "INSERT INTO payment_orders(id,user_id,chain,amount_sats,months,status,address,expires_at,created_at) VALUES(?,?,?,?,?,'pending',?,?,?)",
    ).run(id, userId, "onchain", free[randomInt(free.length)], months, address, new Date(Date.now() + 7 * 86_400_000).toISOString(), now());
  });
  if (chain === "lightning") {
    try {
      const ln = await lightningInvoice(price, `Council of AI access ${id.slice(0, 8)}`);
      db.prepare(
        "UPDATE payment_orders SET invoice=?,payment_hash=?,verify_url=?,zap_request_id=?,zap_recipient=?,zap_provider_pubkey=?,expires_at=? WHERE id=?",
      ).run(ln.invoice, ln.paymentHash, ln.verifyUrl, ln.zap?.requestId || null, ln.zap?.recipient || null, ln.zap?.providerPubkey || null, ln.expiresAt, id);
    } catch (error) {
      db.prepare("DELETE FROM payment_orders WHERE id=?").run(id);
      throw error instanceof PaymentError ? error : new PaymentError(`Could not create a Lightning invoice: ${(error as Error).message}`, 502);
    }
  }
  return publicOrder(getRow(db, id)!);
}

export function userOrders(db: DB, userId: string) {
  return (db.prepare("SELECT * FROM payment_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20").all(userId) as OrderRow[]).map(publicOrder);
}

export function userOrder(db: DB, userId: string, orderId: string) {
  const row = getRow(db, orderId);
  if (!row || row.user_id !== userId) throw new PaymentError("Payment not found.", 404);
  return publicOrder(row);
}

/** Adds the paid period to the account, starting from today or from the end of current access. */
export function extendAccess(db: DB, userId: string, months: number) {
  const row = db.prepare("SELECT access_until FROM users WHERE id=?").get(userId) as { access_until: string | null } | undefined;
  const start = new Date(Math.max(Date.now(), row?.access_until ? new Date(row.access_until).getTime() : 0));
  start.setUTCMonth(start.getUTCMonth() + months);
  db.prepare("UPDATE users SET access_until=? WHERE id=?").run(start.toISOString(), userId);
  return start.toISOString();
}

/** Marks an order paid exactly once and extends the account. A payment already claimed elsewhere unlocks nothing. */
export function markPaid(db: DB, orderId: string, reference: string | null, claim?: string, note?: string) {
  return tx(db, () => {
    const row = getRow(db, orderId);
    if (!row || !["pending", "review", "expired"].includes(row.status)) return false;
    if (claim) {
      const inserted = db
        .prepare("INSERT OR IGNORE INTO payment_claims(reference,order_id,created_at) VALUES(?,?,?)")
        .run(claim, orderId, now());
      if (!inserted.changes) return false;
    }
    db.prepare(
      "UPDATE payment_orders SET status='paid',paid_at=?,tx_reference=COALESCE(?,tx_reference),admin_note=COALESCE(?,admin_note) WHERE id=?",
    ).run(now(), reference, note ?? null, orderId);
    extendAccess(db, row.user_id, row.months);
    console.log(`Payment ${orderId} paid${claim ? ` (${claim})` : ""}.`);
    return true;
  });
}

const claimedBy = (db: DB, reference: string) =>
  (db.prepare("SELECT order_id FROM payment_claims WHERE reference=?").get(reference) as { order_id: string } | undefined)?.order_id || null;

const outputsTo = (tx: any, address: string): { n: number; value: number }[] =>
  (Array.isArray(tx?.vout) ? tx.vout : [])
    .map((o: any, n: number) => ({ n, value: Number(o?.value || 0), address: String(o?.scriptpubkey_address || "").toLowerCase() }))
    .filter((o: any) => o.address === address.toLowerCase());

/** -1: confirmed before the order existed (never matches); otherwise confirmations (0 when unconfirmed or unknown). */
function confirmationsFor(row: OrderRow, tx: any, tip: number) {
  if (!tx?.status?.confirmed) return 0;
  const blockTime = Number(tx.status.block_time);
  if (!Number.isFinite(blockTime) || blockTime < new Date(row.created_at).getTime() / 1000 - BLOCK_TIME_SLACK_SECONDS) return -1;
  const height = Number(tx.status.block_height);
  return tip && Number.isFinite(height) ? Math.max(0, tip - height + 1) : 0;
}

function settleExactOutput(db: DB, row: OrderRow, tx: any, n: number, tip: number) {
  const confirmations = confirmationsFor(row, tx, tip);
  if (confirmations >= paymentsConfig().confirmations) markPaid(db, row.id, tx.txid, `onchain:${tx.txid}:${n}`);
  else if (confirmations > 0) db.prepare("UPDATE payment_orders SET confirmations=? WHERE id=?").run(confirmations, row.id);
  return confirmations;
}

async function addressTxs(address: string, sinceUnix: number) {
  const api = paymentsConfig().mempoolApi;
  const all: any[] = [];
  let path = `/address/${address}/txs`;
  for (let page = 0; page < 20; page++) {
    const txs = await fetchJson(`${api}${path}`);
    if (!Array.isArray(txs) || !txs.length) break;
    all.push(...txs);
    const confirmed = txs.filter((t) => t.status?.confirmed);
    const last = confirmed.at(-1);
    if (!last || confirmed.length < 25 || Number(last.status.block_time) < sinceUnix) break;
    path = `/address/${address}/txs/chain/${last.txid}`;
  }
  return all;
}

const verifiedTxid = (row: OrderRow) => {
  const txid = row.proof_check ? JSON.parse(row.proof_check).txid : null;
  return typeof txid === "string" && /^[0-9a-f]{64}$/.test(txid) ? txid : null;
};

/** Checks open orders: Lightning verify links and zap receipts, and the on-chain address. Each source fails on its own. */
export async function checkPayments(db: DB) {
  const report = (label: string, error: unknown) => {
    if (process.env.NODE_ENV !== "test") console.error(`Payment check ${label}: ${(error as Error).message}`);
  };
  db.prepare("UPDATE payment_orders SET status='expired' WHERE status='pending' AND expires_at < ?").run(now());
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const fortnight = new Date(Date.now() - 14 * 86_400_000).toISOString();
  // Lightning: a payment just before expiry is still recognised for an hour.
  const lightning = db
    .prepare("SELECT * FROM payment_orders WHERE chain='lightning' AND (status='pending' OR (status='expired' AND expires_at > ?))")
    .all(hourAgo) as OrderRow[];
  for (const row of lightning.filter((r) => r.verify_url))
    try {
      const status = await fetchJson(row.verify_url!);
      if (status?.settled === true) markPaid(db, row.id, "lightning", row.payment_hash ? `ln:${row.payment_hash}` : undefined);
    } catch (error) {
      report(row.id, error);
    }
  const zaps = lightning.filter((r) => r.zap_request_id && r.zap_recipient);
  const relays = paymentsConfig().relays;
  for (let i = 0; relays.length && i < zaps.length; i += 50) {
    const chunk = zaps.slice(i, i + 50);
    try {
      const since = Math.floor(Math.min(...chunk.map((r) => new Date(r.created_at).getTime())) / 1000) - 600;
      const events = await queryRelays(relays, { kinds: [9735], "#p": chunk.map((r) => r.zap_recipient), since, limit: 500 });
      for (const row of chunk)
        try {
          const receipt = events.find(
            (event) => zapReceiptFor(event, { providerPubkey: row.zap_provider_pubkey!, invoice: row.invoice! }) === row.zap_request_id,
          );
          if (receipt) markPaid(db, row.id, `zap:${receipt.id}`, `ln:${row.payment_hash}`);
        } catch (error) {
          report(row.id, error);
        }
    } catch (error) {
      report("zaps", error);
    }
  }
  const onchain = db
    .prepare("SELECT * FROM payment_orders WHERE chain='onchain' AND (status='pending' OR (status IN ('expired','review') AND created_at > ?)) ORDER BY created_at DESC LIMIT 2000")
    .all(fortnight) as OrderRow[];
  if (!onchain.length) return;
  try {
    const tip = await tipHeight();
    if (!tip) return;
    const byAddress = new Map<string, OrderRow[]>();
    for (const row of onchain) if (row.address) byAddress.set(row.address, [...(byAddress.get(row.address) || []), row]);
    for (const [address, rows] of byAddress) {
      const oldest = Math.min(...rows.map((r) => new Date(r.created_at).getTime() / 1000)) - BLOCK_TIME_SLACK_SECONDS;
      const txs = await addressTxs(address, oldest);
      const known = new Set(txs.map((t) => t.txid));
      for (const row of rows.filter((r) => verifiedTxid(r) && !known.has(verifiedTxid(r)!)).slice(0, 20)) {
        known.add(verifiedTxid(row)!);
        txs.push(await fetchJson(`${paymentsConfig().mempoolApi}/tx/${verifiedTxid(row)}`).catch(() => null));
      }
      const byAmount = new Map(rows.map((r) => [r.amount_sats, r]));
      for (const tx of txs)
        for (const output of outputsTo(tx, address)) {
          const row = byAmount.get(output.value);
          try {
            if (row && row.status !== "paid" && settleExactOutput(db, row, tx, output.n, tip) >= paymentsConfig().confirmations)
              row.status = "paid";
          } catch (error) {
            report(row?.id || "on-chain", error);
          }
        }
    }
  } catch (error) {
    report("on-chain", error);
  }
}

export function parseTxid(reference: string) {
  const match = /(?:^|\/tx\/)([0-9a-f]{64})(?:$|[/?#])/i.exec(reference.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Buyer proof: a Lightning preimage, or a txid paying the exact amount, is verified
 * automatically; anything else goes to admin review with the server's own check
 * stored apart from the buyer's note.
 */
export async function submitProof(db: DB, userId: string, orderId: string, input: { reference?: string; note?: string }) {
  const row = getRow(db, orderId);
  if (!row || row.user_id !== userId) throw new PaymentError("Payment not found.", 404);
  const reference = input.reference?.trim() || "";
  const open = ["pending", "expired", "review"].includes(row.status);
  if (!open) throw new PaymentError("This payment cannot take a proof.", 409);
  // Past the 14-day matching window its amount may belong to someone else's new order.
  if (row.chain === "onchain" && row.status !== "pending" && new Date(row.created_at).getTime() < Date.now() - 14 * 86_400_000)
    throw new PaymentError("This payment request is too old to match a transaction. Start a new one, or ask an admin.", 409);
  if (reference && row.chain === "lightning" && row.payment_hash && /^[0-9a-f]{64}$/i.test(reference)) {
    if (reference.toLowerCase() === row.payment_hash) throw new PaymentError("That is the payment hash. Paste the payment preimage from your wallet.");
    if (!preimageMatches(reference, row.payment_hash))
      throw new PaymentError("This preimage does not match the invoice. Copy the payment preimage (proof of payment) from your wallet.");
    if (!markPaid(db, row.id, "preimage", `ln:${row.payment_hash}`)) throw new PaymentError("This payment already unlocked another order.", 409);
    return userOrder(db, userId, orderId);
  }
  const txid = row.chain === "onchain" ? parseTxid(reference) : null;
  if (row.chain === "onchain" && reference && !txid)
    throw new PaymentError("Paste a transaction id or a mempool.space transaction link. Use the note for anything else.");
  let check: Record<string, unknown> | null = null;
  if (txid) {
    const tx = await fetchJson(`${paymentsConfig().mempoolApi}/tx/${txid}`).catch(() => null);
    if (!tx?.txid) throw new PaymentError("That transaction is not on mempool.space yet. Try again in a minute.", 404);
    const outputs = outputsTo(tx, row.address!);
    if (!outputs.length) throw new PaymentError("That transaction does not pay the Council address.");
    const claims = outputs.map((o) => claimedBy(db, `onchain:${txid}:${o.n}`));
    if (claims.every(Boolean)) throw new PaymentError("This transaction already unlocked another payment.", 409);
    const exact = outputs.find((o, i) => o.value === row.amount_sats && !claims[i]);
    const tip = tx.status?.confirmed ? await tipHeight().catch(() => 0) : 0;
    const confirmations = confirmationsFor(row, tx, tip);
    check = {
      txid,
      paysSats: outputs.reduce((s, o) => s + o.value, 0),
      orderSats: row.amount_sats,
      exact: !!exact && confirmations >= 0,
      confirmed: !!tx.status?.confirmed,
      beforeOrder: confirmations < 0,
      // Whether part of it was already used, without revealing other people's orders.
      claimedBy: claims.some(Boolean) ? ["another payment"] : [],
      checkedAt: now(),
    };
    if (check.exact) {
      db.prepare("UPDATE payment_orders SET tx_reference=?,proof_check=? WHERE id=?").run(txid, JSON.stringify(check), row.id);
      settleExactOutput(db, { ...row, tx_reference: txid }, tx, exact!.n, tip);
      return userOrder(db, userId, orderId);
    }
  }
  const updated = db
    .prepare(
      "UPDATE payment_orders SET status='review',tx_reference=COALESCE(?,tx_reference),proof_note=COALESCE(?,proof_note),proof_check=COALESCE(?,proof_check) WHERE id=? AND status IN ('pending','expired','review')",
    )
    .run(txid || reference.slice(0, 200) || null, input.note?.slice(0, 1000) || null, check ? JSON.stringify(check) : null, row.id);
  if (!updated.changes && row.status !== "review") throw new PaymentError("This payment cannot take a proof.", 409);
  return userOrder(db, userId, orderId);
}

export function adminOrders(db: DB) {
  return (
    db
      .prepare(
        `SELECT o.*, u.email, u.name FROM payment_orders o JOIN users u ON u.id=o.user_id
         WHERE o.status IN ('review','pending') OR o.created_at > ? ORDER BY o.created_at DESC LIMIT 200`,
      )
      .all(new Date(Date.now() - 30 * 86_400_000).toISOString()) as (OrderRow & { email: string; name: string })[]
  ).map((r) => ({ ...publicOrder(r), email: r.email, name: r.name }));
}

/**
 * Admin approval records the payment it relies on. An on-chain payment must be a
 * verified, confirmed transaction made after the order, paying the full amount and
 * not another open order's amount; `force` overrides a failed check and is logged.
 */
export async function approveOrder(db: DB, orderId: string, input: { note?: string; force?: boolean }, adminEmail: string) {
  const row = getRow(db, orderId);
  if (!row) throw new PaymentError("Payment not found.", 404);
  if (!["pending", "review", "expired"].includes(row.status)) throw new PaymentError("Payment is already settled.", 409);
  let claim: string | undefined;
  let reference = input.force ? "manual-force" : "manual";
  const txid = verifiedTxid(row);
  if (row.chain === "lightning" && row.payment_hash) claim = `ln:${row.payment_hash}`;
  else if (row.chain === "onchain" && !txid && !input.force)
    throw new PaymentError("No verified transaction for this payment. Approve anyway only if you checked the payment yourself.", 409);
  else if (row.chain === "onchain" && txid) {
    const tx = await fetchJson(`${paymentsConfig().mempoolApi}/tx/${txid}`).catch(() => null);
    if (!tx?.txid) throw new PaymentError("Could not load the transaction from mempool.space. Try again.", 502);
    const tip = tx.status?.confirmed ? await tipHeight().catch(() => 0) : 0;
    const confirmations = confirmationsFor(row, tx, tip);
    // An output paying another order's reserved amount (open, or paid in the last 15 days) belongs to that order.
    const reserved = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const taken = new Set(
      (
        db
          .prepare(
            "SELECT amount_sats FROM payment_orders WHERE chain='onchain' AND id<>? AND (status='pending' OR (status IN ('expired','review','paid') AND created_at > ?))",
          )
          .all(row.id, reserved) as { amount_sats: number }[]
      ).map((r) => r.amount_sats),
    );
    const usable = outputsTo(tx, row.address!).filter((o) => !taken.has(o.value) && !claimedBy(db, `onchain:${txid}:${o.n}`));
    const output = usable.find((o) => o.value === row.amount_sats) || usable.sort((a, b) => b.value - a.value)[0];
    const problem =
      confirmations < 0
        ? "This transaction was confirmed before the payment was created."
        : confirmations < paymentsConfig().confirmations
          ? "This transaction is not confirmed yet."
          : !output
            ? "This transaction has no output that is free to use: it pays another payment or already unlocked one."
            : output.value !== row.amount_sats
              ? // On a shared address only the exact amount shows whose payment it is (Council Network uses the same address).
                `This transaction pays ${output.value.toLocaleString("en-US")} sats, not this payment's exact ${row.amount_sats.toLocaleString("en-US")}.`
              : "";
    if (problem && !input.force) throw new PaymentError(`${problem} Approve anyway only if you checked the payment yourself.`, 409);
    // Even an override claims the output it relies on, so that payment cannot unlock another order.
    if (output) {
      claim = `onchain:${txid}:${output.n}`;
      reference = `${txid} (${output.value} sats)`;
    }
  }
  const adminNote = [input.force ? `Approved anyway by ${adminEmail}.` : "", input.note || ""].filter(Boolean).join(" ") || undefined;
  if (!markPaid(db, row.id, reference, claim, adminNote))
    throw new PaymentError("Payment is already settled, or its payment already unlocked another order.", 409);
}

export function rejectOrder(db: DB, orderId: string, note?: string) {
  const result = db
    .prepare("UPDATE payment_orders SET status='rejected',admin_note=? WHERE id=? AND status IN ('pending','review','expired')")
    .run(note || null, orderId);
  if (!result.changes) throw new PaymentError("Payment not found or already settled.", 404);
}
