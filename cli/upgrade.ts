import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdir, rm, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
const exec = promisify(execFile);
const official = new Set([
  "https://github.com/Docrohit/councilofAI.git",
  "https://github.com/Docrohit/councilofAI",
  "git@github.com:Docrohit/councilofAI.git",
  "ssh://git@github.com/Docrohit/councilofAI.git",
]);
export async function upgrade(
  options: { check?: boolean; web?: boolean },
  installRoot = fileURLToPath(new URL("..", import.meta.url)),
) {
  const root = await realpath(installRoot);
  const git = async (...args: string[]) =>
    (
      await exec("git", ["-c", "core.fsmonitor=false", ...args], {
        cwd: root,
        timeout: 60000,
        maxBuffer: 2000000,
      })
    ).stdout.trim();
  if (root.includes("/releases/"))
    throw new Error(
      "Managed release installs must be upgraded through their deployment pipeline.",
    );
  if ((await git("rev-parse", "--show-toplevel")) !== root)
    throw new Error(
      "Upgrade requires the original Council Git installation checkout.",
    );
  if (!official.has(await git("remote", "get-url", "origin")))
    throw new Error(
      "Upgrade only accepts the official Docrohit/councilofAI origin. Update forks manually.",
    );
  if ((await git("branch", "--show-current")) !== "main")
    throw new Error(
      "Upgrade requires main. Preserve branch work and update it manually.",
    );
  if (await git("status", "--porcelain"))
    throw new Error(
      "Installation has local changes; preserve them before upgrading. Nothing was changed.",
    );
  const lock = path.resolve(
    root,
    await git("rev-parse", "--git-path", "council-upgrade.lock"),
  );
  try {
    await mkdir(lock);
  } catch {
    throw new Error(
      "Another upgrade owns the installation lock. Inspect it before retrying.",
    );
  }
  try {
    const before = await git("rev-parse", "HEAD");
    await git("fetch", "--no-tags", "origin", "main");
    const target = await git("rev-parse", "FETCH_HEAD");
    try {
      await git("merge-base", "--is-ancestor", before, target);
    } catch {
      throw new Error(
        "Local main has diverged; upgrade will not overwrite it.",
      );
    }
    if (options.check) {
      console.log(
        before === target
          ? `Council is current (${before.slice(0, 12)}).`
          : `Update available: ${before.slice(0, 12)} → ${target.slice(0, 12)}. Run council upgrade${options.web ? " --web" : ""} after stopping Council.`,
      );
      return;
    }
    // Native sessions retain project locks; do not replace their runtime underneath them.
    const projects = path.join(
      process.env.COUNCIL_DATA_HOME ||
        path.join(homedir(), ".local", "share", "council"),
      "projects",
    );
    for (const folder of await readdir(projects).catch((e: any) => {
      if (e.code === "ENOENT") return [];
      throw e;
    })) {
      let pid: number;
      try {
        pid = Number(
          await readFile(path.join(projects, folder, "session.lock"), "utf8"),
        );
      } catch (e: any) {
        if (e.code === "ENOENT" || e.code === "ENOTDIR") continue;
        throw e;
      }
      if (!Number.isInteger(pid) || pid < 1)
        throw new Error(
          "An invalid native session lock needs inspection before upgrading.",
        );
      try {
        process.kill(pid, 0);
      } catch (e: any) {
        if (e.code === "ESRCH") continue;
        throw new Error(
          "Cannot verify whether a native Council session is still active.",
        );
      }
      throw new Error("Stop all native Council sessions before upgrading.");
    }
    // Block the default/direct web process even when --web was omitted. Service-managed
    // deployments use their release pipeline; arbitrary ports require operator coordination.
    const port = process.env.PORT || "4310";
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (health)
      throw new Error(
        "Stop the Council web service before upgrading; active tasks would be interrupted. Set PORT when using a nondefault port.",
      );
    if (
      (await git("status", "--porcelain")) ||
      (await git("rev-parse", "HEAD")) !== before
    )
      throw new Error(
        "Installation changed while checking the update; retry after preserving that work.",
      );
    await git("-c", "core.hooksPath=/dev/null", "merge", "--ff-only", target);
    const npm = async (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.platform === "win32" ? "npm.cmd" : "npm",
          args,
          { cwd: root, stdio: "inherit", env: process.env },
        );
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `npm ${args.join(" ")} failed. Source is now ${target.slice(0, 12)} (previous ${before.slice(0, 12)}); finish installation in ${root} before relaunching.`,
                ),
              ),
        );
      });
    await npm(["ci"]);
    if (options.web) await npm(["run", "build"]);
    console.log(
      `Updated Council to ${target.slice(0, 12)} in ${root}. Configuration and history were preserved. ${options.web ? "Restart your existing web service after backing up its data and vault key." : "Launch Council again from your project directory."} Model servers were not changed.`,
    );
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
