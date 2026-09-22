import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LocalProject } from "../cli/project.ts";
import { NativeCouncil, saveModel } from "../cli/native.ts";
import { cleanTerminal, wrapTerminal } from "../cli/tui.ts";
const exec = promisify(execFile),
  signal = () => new AbortController().signal;

test("native project respects instructions, patch hashes, symlinks, ignored files and permissions", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-native-"));
  const approvals: string[] = [];
  try {
    await exec("git", ["init", "-q", dir]);
    writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
    writeFileSync(path.join(dir, "ignored.txt"), "not indexed");
    writeFileSync(
      path.join(dir, "AGENTS.md"),
      "Use node --test. Root instruction.",
    );
    mkdirSync(path.join(dir, "src"));
    writeFileSync(
      path.join(dir, "src/AGENTS.md"),
      "Nested instruction: preserve exports.",
    );
    writeFileSync(
      path.join(dir, "src/calc.js"),
      "exports.add = (a,b) => a-b;\n",
    );
    writeFileSync(path.join(dir, ".env"), "SECRET=not-for-models");
    symlinkSync("/etc/passwd", path.join(dir, "escape"));
    const project = new LocalProject(dir, async (p) => {
      approvals.push(p.kind);
      return true;
    });
    assert.match(await project.instructions(), /Root instruction/);
    const read = await project.execute(
      { action: "read", path: "src/calc.js" },
      signal(),
    );
    assert.match(read.instructions, /Nested instruction/);
    const files = await project.files();
    assert(!files.includes("ignored.txt"));
    assert(!files.includes(".env"));
    await assert.rejects(project.read("../outside"));
    await assert.rejects(project.read("escape"), /Symbolic/);
    await assert.rejects(project.read(".env"), /Secret/);
    await project.execute(
      {
        action: "patch",
        path: "src/calc.js",
        search: "a-b",
        replacement: "a+b",
        sha: read.sha,
      },
      signal(),
    );
    assert.match(readFileSync(path.join(dir, "src/calc.js"), "utf8"), /a\+b/);
    await assert.rejects(
      project.execute(
        {
          action: "write",
          path: "src/calc.js",
          content: "stale",
          sha: read.sha,
        },
        signal(),
      ),
      /changed/,
    );
    const search = await project.execute(
      { action: "search", query: "a+b" },
      signal(),
    );
    assert.equal(search.matches[0].path, "src/calc.js");
    const no = new LocalProject(dir, async () => false);
    await assert.rejects(
      no.execute(
        { action: "write", path: "new.js", content: "x", sha: null },
        signal(),
      ),
      /rejected/,
    );
    await assert.rejects(
      no.execute({ action: "exec", command: "echo no" }, signal()),
      /rejected/,
    );
    assert.deepEqual(approvals, ["write"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native Git diff never returns excluded nested credentials", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-diff-"));
  try {
    await exec("git", ["init", "-q", dir]);
    mkdirSync(path.join(dir, "nested"));
    for (const name of ["nested/.env", "nested/private.pem", "code.js"])
      writeFileSync(path.join(dir, name), "before\n");
    await exec("git", ["add", "."], { cwd: dir });
    await exec(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: dir },
    );
    writeFileSync(path.join(dir, "nested/.env"), "SECRET_ENV_PAYLOAD\n");
    writeFileSync(path.join(dir, "nested/private.pem"), "SECRET_PEM_PAYLOAD\n");
    writeFileSync(path.join(dir, "code.js"), "safe change\n");
    const result = await new LocalProject(dir, async () => false).execute(
      { action: "diff" },
      signal(),
    );
    assert.match(result.diff, /safe change/);
    assert.doesNotMatch(result.diff, /SECRET_ENV_PAYLOAD|SECRET_PEM_PAYLOAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native commands run real tests, omit provider tokens and stop the process group", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-command-"));
  const previous = process.env.COUNCIL_TEST_SECRET;
  process.env.COUNCIL_TEST_SECRET = "must-not-reach-child";
  try {
    const project = new LocalProject(dir, async () => true);
    writeFileSync(
      path.join(dir, "calc.test.js"),
      "const {test}=require('node:test');test('works',()=>require('node:assert/strict').equal(2+2,4));",
    );
    const result = await project.execute(
      { action: "exec", command: `'${process.execPath}' --test` },
      signal(),
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /pass 1/);
    const env = await project.execute(
      { action: "exec", command: "printf '%s' \"$COUNCIL_TEST_SECRET\"" },
      signal(),
    );
    assert.equal(env.stdout, "");
    const controller = new AbortController();
    const running = project.execute(
      { action: "exec", command: "sleep 30 & wait" },
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error("Stopped by user")), 150);
    await assert.rejects(running, /Stopped by user/);
  } finally {
    if (previous) process.env.COUNCIL_TEST_SECRET = previous;
    else delete process.env.COUNCIL_TEST_SECRET;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Council's standalone CLI repairs and tests a repository without OpenCode or a web account", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-standalone-")),
    projectDir = path.join(dir, "repo"),
    configDir = path.join(dir, "config");
  mkdirSync(projectDir);
  mkdirSync(configDir);
  writeFileSync(
    path.join(projectDir, "AGENTS.md"),
    "NATIVE_FIXTURE_INSTRUCTION: Fix code and execute the existing test.",
  );
  writeFileSync(
    path.join(projectDir, "calc.js"),
    "exports.add = (a,b) => a-b;\n",
  );
  writeFileSync(
    path.join(projectDir, "calc.test.js"),
    "const{test}=require('node:test');const assert=require('node:assert/strict');test('addition',()=>assert.equal(require('./calc').add(2,3),5));\n",
  );
  let readInstruction = false,
    actualTest = false,
    patchCount = 0;
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      system = body.messages[0].content,
      user = body.messages[1].content;
    readInstruction ||= system.includes("NATIVE_FIXTURE_INSTRUCTION");
    const board = JSON.parse(
      user
        .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
        .split("\n\n")[0],
    );
    let commands: any = {};
    if (board.candidate)
      commands = {
        review: {
          candidateId: board.candidate.id,
          agree: true,
          reason: "The actual test result establishes the fix.",
        },
      };
    else if (system.includes("NAME: Atlas")) {
      const turn = Number(system.match(/TURN: (\d+)/)?.[1]);
      if (turn === 1)
        commands = { tools: [{ name: "project_read", path: "calc.js" }] };
      else if (turn === 2) {
        const inbox = JSON.parse(
          user.split("YOUR INBOX:\n")[1].split("\n\n")[0],
        );
        const read = JSON.parse(
          inbox.find((m: any) => m.from === "tools").content,
        );
        commands = {
          tools: [
            {
              name: "project_patch",
              path: "calc.js",
              search: "a-b",
              replacement: "a+b",
              sha: read.sha,
            },
          ],
        };
        patchCount++;
      } else if (turn === 3)
        commands = {
          tools: [
            { name: "project_exec", command: `'${process.execPath}' --test` },
          ],
        };
      else {
        actualTest = user.includes("pass 1");
        commands = {
          broadcasts: [
            { content: "The real Node test passes after the patch." },
          ],
          proposal: {
            answer: "Fixed calc.js; the existing Node test now passes.",
            rationale: "Verified actual command output.",
          },
        };
      }
    }
    const text =
      "Public fixture result.\n```council\n" +
      JSON.stringify(commands) +
      "\n```";
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
  writeFileSync(
    path.join(configDir, "native-models.json"),
    JSON.stringify([
      {
        id: "fixture",
        kind: "vllm",
        model: "fixture",
        baseUrl: `http://127.0.0.1:${(model.address() as any).port}`,
      },
    ]),
    { mode: 0o600 },
  );
  try {
    const cli = path.resolve("bin/council.mjs");
    const result = await exec(
      process.execPath,
      [
        cli,
        "local-run",
        "Fix addition and verify the repository tests.",
        "--agents",
        "2",
        "--max-calls",
        "14",
        "--allow-write",
        "--allow-exec",
      ],
      {
        cwd: projectDir,
        timeout: 30000,
        maxBuffer: 1_000_000,
        env: {
          ...process.env,
          PATH: "/usr/bin:/bin",
          COUNCIL_OPENCODE_BIN: "/nonexistent/opencode-must-not-run",
          COUNCIL_CONFIG_DIR: configDir,
          COUNCIL_DATA_HOME: path.join(dir, "data"),
          COUNCIL_TOKEN: "",
          COUNCIL_SERVER: "http://localhost:1",
        },
      },
    );
    assert.match(result.stdout, /completed/);
    assert.match(result.stdout, /COUNCIL CONCLUSION/);
    assert.equal(readInstruction, true);
    assert.equal(actualTest, true);
    assert.equal(patchCount, 1);
    assert.match(
      readFileSync(path.join(projectDir, "calc.js"), "utf8"),
      /a\+b/,
    );
  } finally {
    model.closeAllConnections();
    await new Promise<void>((r) => model.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local project history is persistent and a second session cannot steal its lock", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-lock-")),
    project = path.join(dir, "project"),
    data = path.join(dir, "data");
  mkdirSync(project);
  const previous = process.env.COUNCIL_CONFIG_DIR;
  process.env.COUNCIL_CONFIG_DIR = path.join(dir, "config");
  try {
    saveModel({
      id: "local",
      kind: "ollama",
      model: "fixture",
      baseUrl: "http://localhost:11434",
    });
    const one = new NativeCouncil(project, async () => false, data);
    assert.equal(one.config(["local"], 5).members.length, 5);
    assert.throws(
      () => new NativeCouncil(project, async () => false, data),
      /already/,
    );
    await one.close();
    const two = new NativeCouncil(project, async () => false, data);
    assert.equal(two.store.providers(two.userId).length, 1);
    await two.close();
  } finally {
    if (previous) process.env.COUNCIL_CONFIG_DIR = previous;
    else delete process.env.COUNCIL_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminal output cannot inject control sequences", () => {
  assert.equal(
    cleanTerminal("before\x1b[2Jafter\x1b]52;c;secret\x07"),
    "beforeafter",
  );
  assert.deepEqual(wrapTerminal("abcdefgh\n", 4), ["abcd", "efgh", ""]);
});

test("native moves and deletes require current hashes, approval and recoverable copies", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "council-file-ops-"));
  try {
    const projectDir = path.join(dir, "project"),
      recovery = path.join(dir, "recovery");
    mkdirSync(projectDir);
    writeFileSync(path.join(projectDir, "source.txt"), "preserve me");
    writeFileSync(path.join(projectDir, "existing.txt"), "keep target");
    const p = new LocalProject(projectDir, async () => true, recovery),
      read = await p.read("source.txt");
    await assert.rejects(
      p.execute(
        {
          action: "move",
          path: "source.txt",
          destination: "existing.txt",
          sha: read.sha!,
        },
        signal(),
      ),
      /exists/,
    );
    await assert.rejects(
      p.execute(
        { action: "delete", path: "source.txt", sha: "stale" },
        signal(),
      ),
      /changed/,
    );
    const denied = new LocalProject(projectDir, async () => false, recovery);
    await assert.rejects(
      denied.execute(
        { action: "delete", path: "source.txt", sha: read.sha! },
        signal(),
      ),
      /rejected/,
    );
    const moved = await p.execute(
      {
        action: "move",
        path: "source.txt",
        destination: "nested/moved.txt",
        sha: read.sha!,
      },
      signal(),
    );
    assert.equal((await p.read("source.txt")).sha, null);
    assert.equal((await p.read("nested/moved.txt")).content, "preserve me");
    assert.equal(
      JSON.parse(readFileSync(moved.recoveryPath, "utf8")).content,
      "preserve me",
    );
    const removed = await p.execute(
      { action: "delete", path: "nested/moved.txt", sha: read.sha! },
      signal(),
    );
    assert.equal((await p.read("nested/moved.txt")).sha, null);
    assert.equal(
      JSON.parse(readFileSync(removed.recoveryPath, "utf8")).content,
      "preserve me",
    );
    assert.equal(
      readFileSync(path.join(projectDir, "existing.txt"), "utf8"),
      "keep target",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
