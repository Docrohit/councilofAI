import { test } from "node:test";
import assert from "node:assert/strict";
import { Communication } from "../server/communication.ts";
import { parseResponse } from "../server/orchestrator.ts";

test("broadcast history is shared, direct contents and votes are participant scoped", () => {
  const c = new Communication(() => {});
  const post = c.broadcast("a", "Established evidence");
  const t = c.open("a", "b", "Check the domain");
  c.message("a", t.id, "Participant-only draft");
  assert.equal(c.context("new-agent").board[0].id, post.id);
  assert.equal("messages" in c.context("outsider").conversations[0], false);
  assert.equal("messages" in c.context("b").conversations[0], true);
  assert.throws(() => c.get("outsider", t.id));
  assert.throws(() => c.review("outsider", t.id, 1, true, "pretend"));
  assert.throws(() => c.broadcast("a", "reply", "missing"));
  assert.throws(() => c.open("a", "a"));
});
test("both peers must accept the same evidence revision; publication is idempotent and survives recovery", () => {
  const events: string[] = [];
  const c = new Communication((type) => events.push(type));
  const t = c.open("a", "b", "Roots");
  c.propose("a", t.id, "x = 2", ["Substitution"]);
  assert.throws(() => c.publish("a", t.id));
  c.review("a", t.id, 1, true, "checked");
  c.review("b", t.id, 1, false, "also -2");
  assert.equal(c.unresolved().length, 1);
  c.propose("b", t.id, "x = ±2", ["Both substitutions verified"]);
  assert.deepEqual(t.proposal?.reviews, {});
  assert.throws(() => c.review("a", t.id, 1, true, "stale"));
  c.review("a", t.id, 2, true, "checked both");
  assert.throws(() => c.publish("a", t.id));
  c.review("b", t.id, 2, true, "complete domain");
  const post = c.publish("b", t.id);
  assert.equal(c.publish("a", t.id).id, post.id);
  assert.equal(c.board.length, 1);
  assert.deepEqual(post.coauthors, ["a", "b"]);
  assert.equal(c.unresolved().length, 0);
  assert.throws(() =>
    c.review("a", t.id, 2, false, "cannot mutate published agreement"),
  );
  const restored = new Communication(() => {}, c.snapshot());
  assert.equal(restored.get("b", t.id).proposal?.publishedPostId, post.id);
  restored.propose("a", t.id, "New doubt", ["Counterexample"]);
  assert.equal(restored.unresolved().length, 1);
  assert.equal(c.unresolved().length, 0);
  assert.equal(events.filter((e) => e === "board.post").length, 1);
});
test("communication control blocks validate their structure", () => {
  const result = parseResponse(
    '```council\n{"broadcasts":[{"content":"check"}],"conversations":[{"to":"b","topic":"roots","message":"check both"}],"tools":[{"name":"read_board"}]}\n```',
  );
  assert.equal(result.error, undefined);
  assert.equal(result.commands[0].conversations?.[0].to, "b");
});
