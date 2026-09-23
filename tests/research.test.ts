import test from "node:test";
import assert from "node:assert/strict";
import {
  publicAddress,
  publicUrl,
  resolvePublic,
  fetchPage,
  extractPage,
  searchConnection,
  searchWeb,
} from "../server/research.ts";
import type { Provider } from "../shared/types.ts";
const signal = () => new AbortController().signal;
const provider: Provider = {
  id: "search",
  name: "Search fixture",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  apiKey: "fixture-private-token",
  transport: "direct",
  reasoning: false,
};

test("research rejects private/reserved addresses, credentials, alternate ports and DNS rebinding", async () => {
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.2",
    "192.168.1.2",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "192.0.2.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "file:///etc/passwd",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://127.1",
    "https://2130706433",
    "https://[::ffff:127.0.0.1]",
    "https://localhost",
    "https://test.internal",
  ])
    assert.throws(() => publicUrl(url), Error, url);
  const mixed = (async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ]) as any;
  await assert.rejects(
    resolvePublic(publicUrl("https://example.com"), mixed),
    /private or reserved/,
  );
  const publicOnly = (async () => [{ address: "8.8.8.8", family: 4 }]) as any;
  assert.equal(
    (await resolvePublic(publicUrl("https://example.com"), publicOnly)).address,
    "8.8.8.8",
  );
});
test("research revalidates redirects, strips executable markup and preserves provenance and truncation", async () => {
  let calls = 0;
  await assert.rejects(
    fetchPage("https://example.com", signal(), async () => {
      calls++;
      return {
        status: 302,
        location: "https://169.254.169.254/latest",
        type: "",
        body: "",
      };
    }),
    /blocked/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    fetchPage("https://example.com", signal(), async () => ({
      status: 302,
      location: "/again",
      type: "",
      body: "",
    })),
    /redirect limit/,
  );
  const result = await fetchPage(
    "https://example.com/old",
    signal(),
    async (url) =>
      url.pathname === "/old"
        ? { status: 302, location: "/docs", type: "", body: "" }
        : {
            status: 200,
            type: "text/html",
            body: '<title>Test &amp; docs</title><script>stealSecrets()</script><main><h1>Verified page</h1><p>Hello <a href="/source">source</a></p></main>',
          },
  );
  assert.equal(result.url, "https://example.com/docs");
  assert.equal(result.title, "Test & docs");
  assert.match(result.text, /https:\/\/example.com\/source/);
  assert.doesNotMatch(result.text, /stealSecrets/);
  assert.ok(Date.parse(result.fetchedAt));
  const long = extractPage(
    "https://example.com",
    "text/plain",
    "x".repeat(14000),
  );
  assert.equal(long.text.length, 12000);
  assert.equal(long.truncated, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchPage("https://example.com", controller.signal, async () => {
      throw new Error("must not run");
    }),
    { name: "AbortError" },
  );
});
test("web search uses only the selected OpenAI account, bounded requests and recorded citation metadata", async () => {
  assert.equal(
    searchConnection([
      { ...provider, kind: "vllm" },
      { ...provider, transport: "bridge" },
    ]),
    undefined,
  );
  assert.equal(
    searchConnection([
      { ...provider, baseUrl: "https://api.openai.com.evil.org/v1" },
    ]),
    undefined,
  );
  let sent: any;
  const result = await searchWeb(
    provider,
    "official test query",
    signal(),
    (async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      sent = JSON.parse(String(options?.body));
      return Response.json({
        status: "completed",
        output: [
          {
            type: "web_search_call",
            status: "completed",
            action: {
              sources: [
                { url: "https://example.com/docs", title: "Primary source" },
              ],
            },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Fact. [cite]",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/docs",
                    title: "Primary source",
                    start_index: 6,
                    end_index: 12,
                  },
                ],
              },
            ],
          },
        ],
        usage: { input_tokens: 21, output_tokens: 7 },
      });
    }) as typeof fetch,
  );
  assert.equal(sent.model, provider.model);
  assert.equal(sent.max_tool_calls, 1);
  assert.equal(sent.store, false);
  assert.equal(sent.tool_choice, "required");
  assert.equal(result.searches, 1);
  assert.equal(result.inputTokens, 21);
  assert.equal(result.sources[0].url, "https://example.com/docs");
  assert.match(
    result.text,
    /\[Primary source\]\(https:\/\/example.com\/docs\)/,
  );
  await assert.rejects(
    searchWeb(provider, "query", signal(), (async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Invented answer" }],
          },
        ],
      })) as typeof fetch),
    /no completed web search/,
  );
  await assert.rejects(
    searchWeb(provider, "query", signal(), (async () =>
      Response.json(
        { error: { message: provider.apiKey } },
        { status: 401 },
      )) as typeof fetch),
    (error: Error) =>
      error.message.includes("401") &&
      !error.message.includes(provider.apiKey!),
  );
});
