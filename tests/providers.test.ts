import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { complete, streamJson } from "../server/providers.ts";
import { validateEndpoint } from "../server/security.ts";
import type { Provider } from "../shared/types.ts";
async function fixture(
  handler: (
    body: any,
    url: string,
  ) => { frames: any[]; ndjson?: boolean; status?: number },
  work: (base: string) => Promise<void>,
) {
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const result = handler(JSON.parse(text), req.url!);
    res.writeHead(result.status || 200, {
      "content-type": result.ndjson
        ? "application/x-ndjson"
        : "text/event-stream",
    });
    const wire = result.frames
      .map((f) =>
        result.ndjson
          ? JSON.stringify(f) + "\n"
          : "data: " + (f === "[DONE]" ? f : JSON.stringify(f)) + "\n\n",
      )
      .join("");
    for (let i = 0; i < wire.length; i += 7) res.write(wire.slice(i, i + 7));
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as any;
  try {
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const request = {
  messages: [
    { role: "system" as const, content: "Be useful" },
    { role: "user" as const, content: "hello" },
  ],
  maxTokens: 1000,
  signal: AbortSignal.timeout(5000),
};
for (const kind of ["ollama", "vllm", "openai", "anthropic", "glm"] as const)
  test(`${kind}: request mapping, fragmented streams, reasoning, usage`, async () => {
    await fixture(
      (body, url) => {
        assert.equal(body.model, "fixture-model");
        assert.equal(body.stream, true);
        if (kind === "ollama") {
          assert.equal(url, "/api/chat");
          assert.equal(body.think, true);
          return {
            ndjson: true,
            frames: [
              { message: { content: "hello", thinking: "summary" } },
              { done: true, prompt_eval_count: 8, eval_count: 2 },
            ],
          };
        }
        if (kind === "openai") {
          assert.equal(url, "/responses");
          assert.equal(body.store, false);
          assert.equal(body.reasoning.summary, "auto");
          return {
            frames: [
              {
                type: "response.reasoning_summary_text.delta",
                delta: "summary",
              },
              { type: "response.output_text.delta", delta: "hello" },
              {
                type: "response.completed",
                response: { usage: { input_tokens: 8, output_tokens: 2 } },
              },
            ],
          };
        }
        if (kind === "anthropic") {
          assert.equal(url, "/messages");
          assert.equal(body.system, "Be useful");
          assert.equal(body.thinking.type, "adaptive");
          return {
            frames: [
              {
                type: "content_block_delta",
                delta: { type: "thinking_delta", thinking: "summary" },
              },
              {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "hello" },
              },
              {
                type: "message_delta",
                usage: { output_tokens: 2 },
                delta: { stop_reason: "end_turn" },
              },
              { type: "message_stop" },
            ],
          };
        }
        assert.equal(url, "/chat/completions");
        return {
          frames: [
            {
              choices: [
                { delta: { content: "hello", reasoning_content: "summary" } },
              ],
            },
            {
              choices: [{ finish_reason: "stop", delta: {} }],
              usage: { prompt_tokens: 8, completion_tokens: 2 },
            },
            "[DONE]",
          ],
        };
      },
      async (base) => {
        const chunks = [];
        const p: Provider = {
          id: "p",
          name: "Fixture",
          kind,
          baseUrl: base,
          model: "fixture-model",
          transport: "direct",
          reasoning: true,
        };
        for await (const c of complete(p, request)) chunks.push(c);
        assert.equal(
          chunks
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(""),
          "hello",
        );
        assert.equal(
          chunks
            .filter((c) => c.type === "reasoning")
            .map((c) => c.text)
            .join(""),
          "summary",
        );
        assert(chunks.some((c) => c.output === 2));
      },
    );
  });
test("truncated streams and provider length limits do not become success", async () => {
  for (const frames of [
    [{ choices: [{ delta: { content: "half" } }] }],
    [{ choices: [{ delta: { content: "half" }, finish_reason: "length" }] }],
  ])
    await fixture(
      () => ({ frames }),
      async (base) => {
        await assert.rejects(async () => {
          for await (const _ of complete(
            {
              id: "p",
              name: "Fixture",
              kind: "vllm",
              baseUrl: base,
              model: "m",
              transport: "direct",
              reasoning: false,
            },
            request,
          )) {
          }
        }, /before completion|token limit/);
      },
    );
});
test("SSE handles multiline events and CRLF", async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(
        new TextEncoder().encode(
          'event: test\r\ndata: {"a":\r\ndata: 1}\r\n\r\n',
        ),
      );
      c.close();
    },
  });
  const values = [];
  for await (const item of streamJson(body)) values.push(item);
  assert.deepEqual(values, [{ a: 1 }]);
});
test("hosted connections use exact allowlisted origins and local URLs cannot embed credentials", () => {
  assert.throws(
    () => validateEndpoint("http://127.0.0.1:11434", true),
    /does not allow/,
  );
  assert.throws(
    () => validateEndpoint("https://api.openai.com.evil.example/v1", true),
    /does not allow/,
  );
  assert.equal(
    validateEndpoint("https://api.openai.com/v1/", true),
    "https://api.openai.com/v1",
  );
  assert.throws(
    () => validateEndpoint("http://user:secret@localhost:1234", false),
    /credentials/,
  );
});
