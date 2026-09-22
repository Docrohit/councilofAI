import assert from "node:assert/strict";
import { handle } from "../deploy/sandbox-broker.mjs";
const owner = `fixture-${Date.now()}`,
  other = `other-${Date.now()}`;
const request = (action, values = {}) => handle({ owner, action, ...values });
try {
  assert.equal((await request("status")).active, false);
  await request("create");
  await request("write", {
    path: "math.js",
    content: "exports.square = x => x * x;\n",
    sha: null,
  });
  await request("write", {
    path: "math.test.js",
    content:
      "const { test } = require('node:test'); const assert = require('node:assert/strict'); const { square } = require('./math'); test('square',()=>assert.equal(square(-3),9));\n",
    sha: null,
  });
  const read = await request("read", { path: "math.js" });
  assert.match(read.sha, /^[a-f0-9]{64}$/);
  await assert.rejects(
    request("write", { path: "math.js", content: "lost update", sha: null }),
    /changed/,
  );
  await assert.rejects(request("read", { path: "../etc/passwd" }), /Invalid/);
  const result = await request("exec", { command: "node --test" });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.match(result.stdout, /pass 1/);
  const denial = await request("exec", { command: "touch /no-host-write" });
  assert.notEqual(denial.exitCode, 0);
  const network = await request("exec", {
    command:
      "node -e \"require('net').connect({host:'1.1.1.1',port:443}).on('error',()=>process.exit(12))\"",
  });
  assert.equal(network.exitCode, 12);
  await request("exec", { command: "ln -s /etc/passwd link" });
  await assert.rejects(request("read", { path: "link" }), /Symbolic/);
  assert.equal(
    (await handle({ owner: other, action: "status" })).active,
    false,
  );
  await assert.rejects(
    handle({ owner: other, action: "read", path: "math.js" }),
    /Create/,
  );
  const exported = await request("export");
  assert.equal(exported.files.length, 2);
  const running = request("exec", { command: "sleep 0.2" });
  await assert.rejects(
    request("write", { path: "race.js", content: "x", sha: null }),
    /busy/,
  );
  await running;
  console.log(
    "Verified actual Docker multi-file project, Node tests, conflict checks, tenant separation, path and symlink rejection, read-only root, no network, and serialized operations.",
  );
} finally {
  await request("destroy").catch(() => {});
}
