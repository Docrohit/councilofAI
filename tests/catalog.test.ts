import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { modelCatalog, resolveModelId } from "../server/catalog.ts";

process.env.NODE_ENV = "test";

test("the catalog lists curated models with endpoints, limited to allowed providers when hosted", async () => {
  const local = await modelCatalog();
  const luna = local.models.find((m) => m.id === "gpt-6-luna")!;
  assert.deepEqual([luna.kind, luna.baseUrl, luna.providerName], ["openai", "https://api.openai.com/v1", "OpenAI"]);
  const saved = { ...process.env };
  process.env.DEPLOYMENT_MODE = "hosted";
  process.env.ALLOWED_PROVIDER_ORIGINS = "https://api.openai.com,https://api.z.ai";
  try {
    const hosted = await modelCatalog();
    assert(hosted.models.length > 0);
    assert(hosted.models.every((m) => ["openai", "zai"].includes(m.provider)), "only providers this server may call");
    assert.deepEqual(hosted.providers.map((p) => p.id).sort(), ["openai", "zai"]);
  } finally {
    process.env = saved;
  }
});

test("a saved connection uses the provider's exact model ID", async () => {
  const server = createServer((req, res) => {
    res.writeHead(req.headers.authorization === "Bearer sk-good" ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/v4`;
  try {
    assert.equal(await resolveModelId("glm", base, "sk-good", "GLM 5.3"), "glm-5.3");
    assert.equal(await resolveModelId("glm", base, "sk-bad", "GLM 5.3"), "GLM 5.3", "failures keep the requested ID");
    assert.equal(await resolveModelId("ollama", base, "sk-good", "llama"), "llama", "only hosted API kinds are checked");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
