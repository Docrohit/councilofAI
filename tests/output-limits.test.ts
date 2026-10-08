import { test } from "node:test";
import assert from "node:assert/strict";
import { complete, outputLimit } from "../server/providers.ts";
import type { Provider } from "../shared/types.ts";

const provider = (reasoningEffort?: Provider["reasoningEffort"]): Provider =>
  ({
    id: "p",
    name: "Reasoner",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-test",
    apiKey: "sk-test-key",
    reasoning: true,
    reasoningEffort,
  }) as Provider;

const done = () =>
  new Response(
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: {} })}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

async function run(p: Provider, maxTokens: number, reply: (limit: number) => Response) {
  const limits: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    const limit = JSON.parse(init.body).max_output_tokens;
    limits.push(limit);
    return reply(limit);
  }) as typeof fetch;
  try {
    let text = "";
    for await (const chunk of complete(p, {
      messages: [{ role: "user", content: "hi" }],
      maxTokens,
      signal: new AbortController().signal,
    }))
      text += chunk.text || "";
    return { limits, text };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("high reasoning effort raises the per-call output floor", () => {
  assert.equal(outputLimit(provider(), 8192), 8192);
  assert.equal(outputLimit(provider("medium"), 8192), 8192);
  assert.equal(outputLimit(provider("high"), 8192), 32_000);
  assert.equal(outputLimit(provider("xhigh"), 8192), 64_000);
  assert.equal(outputLimit(provider("max"), 16384), 64_000);
  assert.equal(outputLimit(provider("high"), 40_000), 40_000);
});

test("high effort requests the raised limit", async () => {
  const result = await run(provider("high"), 8192, () => done());
  assert.deepEqual(result.limits, [32_000]);
  assert.equal(result.text, "ok");
});

test("a model that rejects the raised limit is retried once with the configured one", async () => {
  const capped = { ...provider("max"), model: "capped-output-model" } as Provider;
  const result = await run(capped, 8192, (limit) =>
    limit > 8192
      ? new Response(
          JSON.stringify({
            error: { message: "max_output_tokens is too large for this model" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        )
      : done(),
  );
  assert.deepEqual(result.limits, [64_000, 8192]);
  assert.equal(result.text, "ok");
});

test("other provider errors are not retried", async () => {
  await assert.rejects(
    run(provider("high"), 8192, () =>
      new Response(JSON.stringify({ error: { message: "bad key", code: "invalid_api_key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ),
    /rejected this API key/,
  );
  const calls: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    calls.push(JSON.parse(init.body).max_output_tokens);
    return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      (async () => {
        for await (const _ of complete(provider("high"), {
          messages: [{ role: "user", content: "hi" }],
          maxTokens: 8192,
          signal: new AbortController().signal,
        }));
      })(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls, [32_000]);
});

test("a context-window rejection (HTTP 422) falls back, and the model is remembered", async () => {
  const small = { ...provider("high"), model: "small-context-model" } as Provider;
  const reject = (limit: number) =>
    limit > 8192
      ? new Response(
          JSON.stringify({
            error: { message: "This model's maximum context length is 32768 tokens." },
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        )
      : done();
  assert.deepEqual((await run(small, 8192, reject)).limits, [32_000, 8192]);
  // The next call goes straight to the configured limit.
  assert.deepEqual((await run(small, 8192, reject)).limits, [8192]);
});

test("providers that do not think keep the configured limit", () => {
  assert.equal(outputLimit({ ...provider("high"), kind: "ollama" } as Provider, 8192), 8192);
  assert.equal(
    outputLimit({ ...provider("high"), kind: "anthropic", reasoning: false } as Provider, 8192),
    8192,
  );
  assert.equal(
    outputLimit({ ...provider("high"), kind: "anthropic", reasoning: true } as Provider, 8192),
    32_000,
  );
});
