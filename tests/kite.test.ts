import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../server/db.ts";
import { Store } from "../server/store.ts";
import {
  kiteStatus,
  refreshKiteAccessToken,
  saveKite,
} from "../server/kite.ts";

test("kite stores api secret encrypted and refreshes access token from request token", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-kite-test-"));
  const db = openDb(dir);
  const store = new Store(db, dir);
  const userId = "kite-user";
  db.prepare(
    "INSERT INTO users(id,email,name,password,created_at,email_verified,access_approved) VALUES(?,?,?,?,?,?,?)",
  ).run(
    userId,
    "kite@example.test",
    "Kite",
    "hash",
    new Date().toISOString(),
    1,
    1,
  );
  try {
    const saved = saveKite(db, store, userId, {
      enabled: false,
      apiKey: "kite-key",
      apiSecret: "kite-secret",
    });
    assert.equal(saved.hasApiKey, true);
    assert.equal(saved.hasApiSecret, true);
    assert.equal(saved.hasAccessToken, false);
    const row = db
      .prepare("SELECT config,secret FROM integrations WHERE user_id=?")
      .get(userId) as any;
    assert(!row.secret.includes("kite-secret"));
    assert(!row.secret.includes("kite-key"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://api.kite.trade/session/token");
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("api_key"), "kite-key");
      assert.equal(body.get("request_token"), "request-token");
      assert.equal(
        body.get("checksum"),
        createHash("sha256")
          .update("kite-keyrequest-tokenkite-secret")
          .digest("hex"),
      );
      return new Response(
        JSON.stringify({
          status: "success",
          data: { access_token: "today-access-token" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const refreshed = await refreshKiteAccessToken(
        db,
        store,
        userId,
        "request-token",
      );
      assert.equal(refreshed.enabled, true);
      assert.equal(refreshed.hasAccessToken, true);
      assert.match(refreshed.accessTokenUpdatedAt || "", /^\d{4}-/);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const status = kiteStatus(db, store, userId, "https://council.example");
    assert.equal(status.callbackUrl, "https://council.example/api/integrations/kite/callback");
    assert.match(status.loginUrl || "", /kite\.zerodha\.com/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
