import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { NativeCouncil, saveModel, applyTeamProfile } from "../cli/native.ts";

const profileFile = (dir: string, name: string, profile: unknown) => {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(profile));
  return file;
};

test("team profiles set global and per-agent output limits, roles and instructions", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-team-")),
    configDir = path.join(dir, "config"),
    data = path.join(dir, "data"),
    project = path.join(dir, "project");
  mkdirSync(configDir);
  mkdirSync(project);
  const previous = process.env.COUNCIL_CONFIG_DIR;
  process.env.COUNCIL_CONFIG_DIR = configDir;
  try {
    saveModel({
      id: "fixture",
      kind: "vllm",
      model: "fixture",
      baseUrl: "http://127.0.0.1:9",
    });
    const council = new NativeCouncil(project, async () => false, data);
    const config = council.config(["fixture"], 3);
    assert.equal(config.maxOutputTokens, 8192);
    const file = profileFile(dir, "team.json", {
      maxOutputTokens: 4096,
      agents: [
        {
          name: "atlas",
          systemPrompt: "Think step by step.",
          maxOutputTokens: 16384,
        },
        { name: "Sage", role: "Skeptic and verifier" },
        { name: "Not On This Team", systemPrompt: "ignored" },
      ],
    });
    applyTeamProfile(config, file);
    assert.equal(config.maxOutputTokens, 4096);
    const atlas = config.members.find((m) => m.name === "Atlas")!;
    assert.equal(atlas.systemPrompt, "Think step by step.");
    assert.equal(atlas.maxOutputTokens, 16384);
    assert.equal(atlas.role, "Choose a useful specialization for the user's goal");
    const sage = config.members.find((m) => m.name === "Sage")!;
    assert.equal(sage.role, "Skeptic and verifier");
    assert.equal(sage.systemPrompt, undefined);
    const echo = config.members.find((m) => m.name === "Echo")!;
    assert.equal(echo.systemPrompt, undefined);
    assert.throws(() =>
      applyTeamProfile(
        config,
        profileFile(dir, "too-small.json", {
          agents: [{ name: "Atlas", maxOutputTokens: 100 }],
        }),
      ),
    );
    assert.throws(() =>
      applyTeamProfile(
        config,
        profileFile(dir, "too-big.json", {
          agents: [{ name: "Atlas", maxOutputTokens: 20000 }],
        }),
      ),
    );
    // The stored team file is reapplied whenever config() rebuilds the team.
    council.teamFile = file;
    const rebuilt = council.config(["fixture"], 2);
    assert.equal(rebuilt.maxOutputTokens, 4096);
    assert.equal(
      rebuilt.members.find((m) => m.name === "Atlas")!.maxOutputTokens,
      16384,
    );
    assert.equal(
      rebuilt.members.find((m) => m.name === "Sage")!.role,
      "Skeptic and verifier",
    );
    // Out-of-range per-agent caps are rejected before a run starts.
    const bad = council.config(["fixture"], 2);
    bad.members[0].maxOutputTokens = 100;
    await assert.rejects(
      () => council.run("Compare two approaches.", bad, () => {}),
      /agent output tokens/i,
    );
    await council.close();
  } finally {
    if (previous) process.env.COUNCIL_CONFIG_DIR = previous;
    else delete process.env.COUNCIL_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("per-agent token limits and instructions reach the provider request", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-team-e2e-")),
    configDir = path.join(dir, "config"),
    data = path.join(dir, "data"),
    project = path.join(dir, "project");
  mkdirSync(configDir);
  mkdirSync(project);
  const requests: { maxTokens: number; system: string; name: string }[] = [];
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      system = body.messages[0].content,
      user = body.messages[1].content;
    requests.push({
      maxTokens: body.max_tokens,
      system,
      name: /NAME: ([^\n]+)/.exec(system)?.[1] || "Peer",
    });
    let commands: any = {};
    if (user.includes("LIVE SHARED BOARD")) {
      const board = JSON.parse(
        user
          .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
          .split("\n\n")[0],
      );
      commands = board.candidate
        ? {
            review: {
              candidateId: board.candidate.id,
              agree: true,
              reason: "Fixture review.",
            },
          }
        : {
            proposal: {
              answer: "Fixture answer.",
              rationale: "Fixture rationale.",
            },
          };
    }
    const text = "Fixture text.\n```council\n" + JSON.stringify(commands) + "\n```";
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({ choices: [{ delta: { content: text } }] }) +
        "\n\ndata: " +
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
  const previous = process.env.COUNCIL_CONFIG_DIR;
  process.env.COUNCIL_CONFIG_DIR = configDir;
  try {
    saveModel({
      id: "fixture",
      kind: "vllm",
      model: "fixture",
      baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
    });
    const council = new NativeCouncil(project, async () => false, data);
    council.teamFile = profileFile(dir, "team.json", {
      maxOutputTokens: 4096,
      agents: [
        {
          name: "Atlas",
          systemPrompt: "Think deeply before answering.",
          maxOutputTokens: 16384,
        },
      ],
    });
    const config = council.config(["fixture"], 2);
    const run = await council.run("Explain one trade-off.", config, () => {});
    assert.equal(run.status, "completed");
    const atlas = requests.filter((r) => r.name === "Atlas");
    const sage = requests.filter((r) => r.name === "Sage");
    assert.ok(atlas.length >= 1, "Atlas was never called");
    assert.ok(sage.length >= 1, "Sage was never called");
    assert.ok(
      atlas.every((r) => r.maxTokens === 16384),
      `Atlas calls should use the 16384 cap, saw ${atlas.map((r) => r.maxTokens)}`,
    );
    assert.ok(
      sage.every((r) => r.maxTokens === 4096),
      `Sage calls should use the 4096 run cap, saw ${sage.map((r) => r.maxTokens)}`,
    );
    assert.ok(
      atlas.every((r) =>
        r.system.includes("AGENT INSTRUCTIONS: Think deeply before answering."),
      ),
      "Atlas system prompt should include the profile instructions",
    );
    assert.ok(
      sage.every((r) => !r.system.includes("AGENT INSTRUCTIONS:")),
      "Sage system prompt should not include profile instructions",
    );
    await council.close();
  } finally {
    if (previous) process.env.COUNCIL_CONFIG_DIR = previous;
    else delete process.env.COUNCIL_CONFIG_DIR;
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});
