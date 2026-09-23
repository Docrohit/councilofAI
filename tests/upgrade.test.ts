import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { upgrade } from "../cli/upgrade.ts";
const exec = promisify(execFile);
test("upgrade help is read-only and preflight rejects forks, branches and dirty installs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "council-upgrade-"));
  try {
    const git = (...args: string[]) => exec("git", args, { cwd: root });
    await git("init", "-b", "main");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.invalid");
    await writeFile(path.join(root, "README.md"), "fixture");
    await git("add", "README.md");
    await git("commit", "-m", "fixture");
    await git("remote", "add", "origin", "https://example.invalid/fork.git");
    await assert.rejects(upgrade({}, root), /official/);
    await git(
      "remote",
      "set-url",
      "origin",
      "git@github.com:Docrohit/councilofAI.git",
    );
    await git("switch", "-c", "work");
    await assert.rejects(upgrade({}, root), /requires main/);
    await git("switch", "main");
    await writeFile(path.join(root, "README.md"), "preserve me");
    await assert.rejects(upgrade({}, root), /local changes/);
    assert.equal(
      await readFile(path.join(root, "README.md"), "utf8"),
      "preserve me",
    );
    const help = await exec(
      process.execPath,
      ["--import", "tsx", path.resolve("cli/index.ts"), "upgrade", "--help"],
      { cwd: process.cwd(), timeout: 10000 },
    );
    assert.match(help.stdout, /Council CLI/);
    assert.match(help.stdout, /upgrade/);
    assert.equal(help.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
