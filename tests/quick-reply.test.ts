import test from "node:test";
import assert from "node:assert/strict";
import { quickReply } from "../server/quick-reply.ts";
test("standalone greetings get a short reply; substantive or resumed work never matches", () => {
  for (const prompt of [
    "hello",
    "Hi!",
    "Hello Council.",
    "Good morning",
    "नमस्ते",
    "👋",
  ])
    assert.match(quickReply({ prompt })!, /Hello!/);
  assert.match(quickReply({ prompt: "Thank you!" })!, /welcome/);
  for (const prompt of [
    "hello, debug my code",
    "hi solve 2+2",
    "hello\nreview the repo",
    "thank you, now continue",
    "check hello.ts",
    "hello world in Python",
    "yes",
    "continue",
    "hello? find the bug",
  ])
    assert.equal(quickReply({ prompt }), undefined);
  assert.match(
    quickReply({
      prompt: "Previous goal: solve x\nCurrent followup: hello",
      userMessage: "hello",
    })!,
    /Hello!/,
  );
  assert.equal(
    quickReply({ prompt: "hello", resumeState: {} as any }),
    undefined,
  );
  assert.equal(
    quickReply({ prompt: "hello", attachments: [{} as any] }),
    undefined,
  );
});
