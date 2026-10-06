import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { bech32, bech32m } from "@scure/base";

const encoder = new TextEncoder();
const MSAT_PER_BTC = 100_000_000_000;
const MULTIPLIERS: Record<string, number> = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 };

/** Reads the amount and payment hash of a BOLT11 invoice. Signatures are not checked: the invoice came from our own LNURL request. */
export function decodeBolt11(invoice: string) {
  const { prefix, words } = bech32.decode(invoice.toLowerCase() as `${string}1${string}`, 10_000);
  const hrp = /^ln([a-z]+?)(?:(\d+)([munp]?))?$/.exec(prefix);
  if (!hrp) throw new Error("Not a Lightning invoice.");
  let msat: number | null = null;
  if (hrp[2]) {
    const btc = Number(hrp[2]) * (hrp[3] ? MULTIPLIERS[hrp[3]] : 1);
    msat = Math.round(btc * MSAT_PER_BTC);
  }
  // 7 words of timestamp, then tagged fields, then a 104-word signature.
  const timestamp = words.slice(0, 7).reduce((n, w) => n * 32 + w, 0);
  const data = words.slice(7, words.length - 104);
  let paymentHash = "";
  let expirySeconds = 3600; // BOLT11 default when the invoice has no "x" field
  for (let i = 0; i + 3 <= data.length; ) {
    const type = data[i];
    const length = data[i + 1] * 32 + data[i + 2];
    const field = data.slice(i + 3, i + 3 + length);
    if (type === 1 && length === 52) paymentHash = bytesToHex(bech32.fromWords(field));
    if (type === 6) expirySeconds = field.reduce((n, w) => n * 32 + w, 0);
    i += 3 + length;
  }
  if (!paymentHash) throw new Error("The invoice has no payment hash.");
  return { network: hrp[1], msat, paymentHash, expiresAt: new Date((timestamp + expirySeconds) * 1000) };
}

/** True when the preimage (hex) hashes to the invoice's payment hash: proof that the invoice was paid. */
export function preimageMatches(preimage: string, paymentHash: string) {
  if (!/^[0-9a-f]{64}$/i.test(preimage)) return false;
  return bytesToHex(sha256(hexToBytes(preimage.toLowerCase()))) === paymentHash.toLowerCase();
}

/** Validates a mainnet SegWit v0 (bech32) or Taproot (bech32m) receive address. */
export function validateBitcoinAddress(address: string) {
  const trimmed = address.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed !== lower && trimmed !== trimmed.toUpperCase()) throw new Error("Bitcoin addresses cannot mix upper and lower case.");
  for (const codec of [bech32, bech32m]) {
    try {
      const { prefix, words } = codec.decode(lower as `${string}1${string}`);
      if (prefix !== "bc") continue;
      const version = words[0];
      const program = codec.fromWords(words.slice(1));
      if (version === 0 && codec === bech32 && (program.length === 20 || program.length === 32)) return lower;
      if (version === 1 && codec === bech32m && program.length === 32) return lower;
    } catch {
      /* try the next encoding */
    }
  }
  throw new Error("ONCHAIN_ADDRESS must be a mainnet bc1q… (SegWit) or bc1p… (Taproot) address.");
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

function eventId(event: Omit<NostrEvent, "id" | "sig">) {
  return bytesToHex(
    sha256(encoder.encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))),
  );
}

export function verifyEvent(event: NostrEvent) {
  try {
    if (!/^[0-9a-f]{64}$/.test(event.id) || !/^[0-9a-f]{64}$/.test(event.pubkey) || !/^[0-9a-f]{128}$/.test(event.sig)) return false;
    if (eventId(event) !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}

export function signEvent(event: Omit<NostrEvent, "id" | "sig" | "pubkey">, secretKey: Uint8Array): NostrEvent {
  const unsigned = { ...event, pubkey: bytesToHex(schnorr.getPublicKey(secretKey)) };
  const id = eventId(unsigned);
  return { ...unsigned, id, sig: bytesToHex(schnorr.sign(hexToBytes(id), secretKey)) };
}

export function encodeLnurl(url: string) {
  return bech32.encode("lnurl", bech32.toWords(encoder.encode(url)), 2000).toUpperCase();
}

/**
 * NIP-57 zap request for one order. A throwaway key signs it and is also the
 * recipient ("p"), so the receipt can be found by that key alone. No secret is kept.
 */
export function zapRequest(input: { amountMsat: number; lnurlpUrl: string; relays: string[]; content: string }) {
  const secretKey = schnorr.utils.randomSecretKey();
  const recipient = bytesToHex(schnorr.getPublicKey(secretKey));
  const event = signEvent(
    {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      content: input.content,
      tags: [
        ["relays", ...input.relays],
        ["amount", String(input.amountMsat)],
        ["lnurl", encodeLnurl(input.lnurlpUrl)],
        ["p", recipient],
      ],
    },
    secretKey,
  );
  return { event, recipient };
}

const tag = (event: NostrEvent, name: string) => {
  const found = event.tags.find((t) => Array.isArray(t) && t[0] === name)?.[1];
  return typeof found === "string" ? found : undefined;
};

/** Returns the zap request id a receipt confirms, if it is a valid receipt signed by the provider for exactly this invoice. */
export function zapReceiptFor(event: NostrEvent, expected: { providerPubkey: string; invoice: string }) {
  try {
    if (event?.kind !== 9735 || event.pubkey !== expected.providerPubkey.toLowerCase() || !Array.isArray(event.tags)) return null;
    if (tag(event, "bolt11")?.toLowerCase() !== expected.invoice.toLowerCase()) return null;
    if (!verifyEvent(event)) return null;
    const request = JSON.parse(tag(event, "description") || "") as NostrEvent;
    return request?.kind === 9734 && Array.isArray(request.tags) && verifyEvent(request) ? request.id : null;
  } catch {
    // Relays are untrusted: a malformed event is simply not a receipt.
    return null;
  }
}

export type RelayQuery = (relays: string[], filter: Record<string, unknown>) => Promise<NostrEvent[]>;

async function queryOne(relay: string, filter: Record<string, unknown>, timeoutMs: number) {
  return new Promise<NostrEvent[]>((resolve) => {
    const events: NostrEvent[] = [];
    const sub = `cn${Math.random().toString(36).slice(2, 10)}`;
    let socket: WebSocket;
    const finish = () => {
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      socket = new WebSocket(relay);
    } catch {
      return finish();
    }
    socket.onopen = () => socket.send(JSON.stringify(["REQ", sub, filter]));
    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data));
        if (data[0] === "EVENT" && data[1] === sub && events.length < 500) events.push(data[2]);
        else if (data[0] === "EOSE" && data[1] === sub) {
          socket.send(JSON.stringify(["CLOSE", sub]));
          finish();
        } else if (data[0] === "CLOSED") finish();
      } catch {
        /* ignore malformed relay messages */
      }
    };
    socket.onerror = finish;
    socket.onclose = finish;
  });
}

const defaultRelayQuery: RelayQuery = async (relays, filter) => {
  const results = await Promise.all(relays.map((relay) => queryOne(relay, filter, 10_000)));
  const seen = new Map<string, NostrEvent>();
  for (const event of results.flat()) if (event?.id && !seen.has(event.id)) seen.set(event.id, event);
  return [...seen.values()];
};

let relayQuery = defaultRelayQuery;
/** Tests replace the relay network with a stub. */
export function setRelayQuery(query?: RelayQuery) {
  relayQuery = query || defaultRelayQuery;
}
export function queryRelays(relays: string[], filter: Record<string, unknown>) {
  return relayQuery(relays, filter);
}
