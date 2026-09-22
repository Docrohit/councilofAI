import { constants, realpathSync } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  mkdir,
  open,
  realpath,
  writeFile,
  copyFile,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ProjectAction,
  ProjectPermission,
  ProjectRuntime,
} from "../shared/project.ts";
const exec = promisify(execFile);
const excluded = new Set([
  ".git",
  "node_modules",
  ".council",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  ".ssh",
]);
const sensitive = (p: string) =>
  p
    .split("/")
    .some(
      (s) =>
        /^\.env(?:\.|$)/.test(s) ||
        /^(?:vault\.key|credentials|id_rsa|id_ed25519)$/.test(s) ||
        /\.(?:pem|p12|pfx|key)$/.test(s),
    );
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export class LocalProject implements ProjectRuntime {
  directory: string;
  constructor(
    directory: string,
    private approve: (
      request: ProjectPermission,
      signal: AbortSignal,
    ) => Promise<boolean>,
    private recoveryDirectory?: string,
  ) {
    this.directory = realpathSync(directory);
    this.recoveryDirectory ||= path.join(
      process.env.COUNCIL_DATA_HOME ||
        path.join(homedir(), ".local", "share", "council"),
      "file-recovery",
      sha(this.directory).slice(0, 24),
    );
  }
  private async resolve(relative: string, parents = false) {
    if (
      !relative ||
      relative.length > 500 ||
      path.isAbsolute(relative) ||
      relative.includes("\\") ||
      relative
        .split("/")
        .some((p) => !p || p === "." || p === ".." || excluded.has(p))
    )
      throw new Error(
        "Use a project-relative path outside excluded directories.",
      );
    if (sensitive(relative))
      throw new Error(
        "Secret/configuration files are excluded from automatic project access.",
      );
    const pieces = relative.split("/");
    let full = this.directory;
    for (let i = 0; i < pieces.length; i++) {
      full = path.join(full, pieces[i]);
      let stat;
      try {
        stat = await lstat(full);
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      if (stat?.isSymbolicLink())
        throw new Error("Symbolic links are not followed by project tools.");
      if (i < pieces.length - 1) {
        if (stat && !stat.isDirectory())
          throw new Error("Parent is not a directory.");
        if (!stat && parents) await mkdir(full);
        else if (!stat) throw new Error("Parent directory not found.");
      }
    }
    const parent = await realpath(path.dirname(full));
    if (
      parent !== this.directory &&
      !parent.startsWith(this.directory + path.sep)
    )
      throw new Error("Path leaves the project.");
    return full;
  }
  async files(): Promise<string[]> {
    let paths: string[];
    try {
      const result = await exec(
        "git",
        [
          "-c",
          "core.fsmonitor=false",
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ],
        { cwd: this.directory, timeout: 5000, maxBuffer: 2_000_000 },
      );
      paths = result.stdout.split("\0").filter(Boolean);
    } catch {
      paths = [];
      const walk = async (
        dir: string,
        prefix = "",
        depth = 0,
      ): Promise<void> => {
        if (depth > 20 || paths.length >= 2000) return;
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (
            excluded.has(entry.name) ||
            sensitive(entry.name) ||
            entry.isSymbolicLink()
          )
            continue;
          const relative = prefix + entry.name;
          if (entry.isDirectory())
            await walk(path.join(dir, entry.name), relative + "/", depth + 1);
          else if (entry.isFile()) paths.push(relative);
          if (paths.length >= 2000) return;
        }
      };
      await walk(this.directory);
    }
    return [...new Set(paths)]
      .filter(
        (p) => !sensitive(p) && !p.split("/").some((s) => excluded.has(s)),
      )
      .sort()
      .slice(0, 2000);
  }
  async instructions(relative = "") {
    const dirs = [""],
      pieces = relative.split("/").slice(0, -1);
    for (let i = 0; i < pieces.length; i++)
      dirs.push(pieces.slice(0, i + 1).join("/"));
    const found: string[] = [];
    for (const dir of dirs)
      for (const name of ["AGENTS.md", "agents.md"]) {
        const file = dir ? `${dir}/${name}` : name;
        try {
          const read = await this.read(file);
          if (read.sha === null) continue;
          const content = read.content;
          found.push(`Instructions from ${file}:\n${content.slice(0, 16000)}`);
          break;
        } catch {}
      }
    return found.join("\n\n").slice(0, 32000);
  }
  async read(relative: string) {
    const full = await this.resolve(relative);
    let file;
    try {
      file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e: any) {
      if (e.code === "ENOENT")
        return { path: relative, content: "", sha: null };
      throw e;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1_000_000)
        throw new Error("Read a text file up to 1 MB.");
      const content = await file.readFile("utf8");
      if (content.includes("\0"))
        throw new Error(
          "Binary documents need an appropriate parser; this tool reads text.",
        );
      return { path: relative, content, sha: sha(content) };
    } finally {
      await file.close();
    }
  }
  private async write(
    relative: string,
    content: string,
    expected: string | null,
    signal: AbortSignal,
  ) {
    if (Buffer.byteLength(content) > 1_000_000)
      throw new Error("File exceeds 1 MB.");
    let before;
    try {
      before = await this.read(relative);
    } catch (e: any) {
      if (e.message === "Parent directory not found.")
        before = { content: "", sha: null };
      else throw e;
    }
    if (before.sha !== expected)
      throw new Error("File changed. Read it again before writing.");
    const allowed = await this.approve(
      {
        kind: "write",
        title: `Write ${relative}`,
        detail: `Before:\n${before.content.slice(0, 6000)}\n\nAfter:\n${content.slice(0, 10000)}${content.length > 10000 ? "\n[preview truncated]" : ""}`,
      },
      signal,
    );
    signal.throwIfAborted();
    if (!allowed) throw new Error("User rejected file modification.");
    const full = await this.resolve(relative, true);
    const current = await this.read(relative);
    if (current.sha !== expected)
      throw new Error("File changed while awaiting approval. Read it again.");
    // A descriptor prevents a last-component symlink swap; recheck bytes before truncating.
    const file = await open(
      full,
      constants.O_RDWR |
        constants.O_NOFOLLOW |
        (expected === null ? constants.O_CREAT | constants.O_EXCL : 0),
      0o644,
    );
    try {
      const actual = await file.readFile("utf8");
      if (expected !== null && sha(actual) !== expected)
        throw new Error("File changed before writing.");
      await file.truncate(0);
      await file.write(content, 0, "utf8");
    } finally {
      await file.close();
    }
    return this.read(relative);
  }
  async execute(action: ProjectAction, signal: AbortSignal): Promise<any> {
    signal.throwIfAborted();
    if (action.action === "delete" || action.action === "move") {
      const original = await this.read(action.path);
      if (original.sha === null || original.sha !== action.sha)
        throw new Error(
          "File changed or missing. Read it again before this operation.",
        );
      if (action.action === "move") {
        if (action.path === action.destination)
          throw new Error("Choose a different destination.");
        try {
          if ((await this.read(action.destination)).sha !== null)
            throw new Error(
              "Destination already exists; it will not be overwritten.",
            );
        } catch (e) {
          if ((e as Error).message !== "Parent directory not found.") throw e;
        }
      }
      const allowed = await this.approve(
        {
          kind: "write",
          title:
            action.action === "delete"
              ? `Delete ${action.path}`
              : `Move ${action.path} to ${action.destination}`,
          detail: `A recovery copy will be saved first.\n\n${original.content.slice(0, 10000)}`,
        },
        signal,
      );
      signal.throwIfAborted();
      if (!allowed) throw new Error("User rejected file operation.");
      const source = await this.resolve(action.path);
      if ((await this.read(action.path)).sha !== action.sha)
        throw new Error("File changed while awaiting approval.");
      await mkdir(this.recoveryDirectory!, { recursive: true, mode: 0o700 });
      const recoveryPath = path.join(
        this.recoveryDirectory!,
        randomUUID() + ".json",
      );
      await writeFile(
        recoveryPath,
        JSON.stringify({
          action: action.action,
          project: this.directory,
          path: action.path,
          destination:
            action.action === "move" ? action.destination : undefined,
          sha: original.sha,
          content: original.content,
          at: new Date().toISOString(),
        }),
        { flag: "wx", mode: 0o600 },
      );
      if (action.action === "move") {
        const destination = await this.resolve(action.destination, true);
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        // Preserve both copies if an external editor raced the copy.
        if (
          (await this.read(action.path)).sha !== action.sha ||
          (await this.read(action.destination)).sha !== action.sha
        )
          throw new Error(
            "A file changed during the move; both paths were preserved. Inspect them before retrying.",
          );
      }
      signal.throwIfAborted();
      if ((await this.read(action.path)).sha !== action.sha)
        throw new Error("File changed before removal; source preserved.");
      await unlink(source);
      return {
        action: action.action,
        path: action.path,
        ...(action.action === "move"
          ? { destination: action.destination, sha: original.sha }
          : {}),
        recoveryPath,
      };
    }
    if (action.action === "tree")
      return {
        directory: this.directory,
        files: await this.files(),
        limit: 2000,
      };
    if (action.action === "read")
      return {
        ...(await this.read(action.path)),
        instructions: await this.instructions(action.path),
      };
    if (action.action === "write")
      return this.write(action.path, action.content, action.sha, signal);
    if (action.action === "patch") {
      const old = await this.read(action.path);
      if (old.sha !== action.sha)
        throw new Error("File changed. Read it again before patching.");
      if (!action.search || old.content.split(action.search).length !== 2)
        throw new Error("Patch search text must match exactly once.");
      return this.write(
        action.path,
        old.content.replace(action.search, () => action.replacement),
        action.sha,
        signal,
      );
    }
    if (action.action === "search") {
      const matches: { path: string; line: number; text: string }[] = [];
      for (const file of await this.files()) {
        signal.throwIfAborted();
        try {
          const read = await this.read(file);
          for (const [index, line] of read.content.split("\n").entries())
            if (line.includes(action.query)) {
              matches.push({
                path: file,
                line: index + 1,
                text: line.slice(0, 500),
              });
              if (matches.length >= 100) return { matches, truncated: true };
            }
        } catch {}
      }
      return { matches, truncated: false };
    }
    if (action.action === "diff") {
      const opts = { cwd: this.directory, timeout: 10000, maxBuffer: 300000 };
      const prefix = ["--no-pager", "-c", "core.fsmonitor=false"];
      const status = await exec("git", [...prefix, "status", "--short"], opts);
      const allowedFiles = (await this.files()).slice(0, 500);
      if (!allowedFiles.length)
        return { status: status.stdout, diff: "No eligible project files." };
      const changes = await exec(
        "git",
        [
          ...prefix,
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "HEAD",
          "--",
          ...allowedFiles.map((file) => ":(literal)" + file),
        ],
        opts,
      ).catch(() => ({
        stdout:
          "No HEAD diff available; use status and project_read for new files.",
      }));
      return { status: status.stdout, diff: changes.stdout.slice(0, 50000) };
    }
    if (action.action !== "exec") throw new Error("Unknown project action.");
    const allowed = await this.approve(
      { kind: "exec", title: "Run project command", detail: action.command },
      signal,
    );
    signal.throwIfAborted();
    if (!allowed) throw new Error("User rejected command execution.");
    return new Promise((resolve, reject) => {
      // No model/API tokens are inherited by commands. This is still a local shell, not an OS sandbox.
      const env: NodeJS.ProcessEnv = {};
      for (const key of [
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "SystemRoot",
      ])
        if (process.env[key]) env[key] = process.env[key];
      const child = spawn(
        process.platform === "win32" ? "cmd.exe" : "/bin/sh",
        process.platform === "win32"
          ? ["/c", action.command]
          : ["-c", action.command],
        {
          cwd: this.directory,
          env,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "",
        timedOut = false,
        overflow = false;
      const kill = (hard = false) => {
        try {
          if (process.platform !== "win32" && child.pid)
            process.kill(-child.pid, hard ? "SIGKILL" : "SIGTERM");
          else child.kill(hard ? "SIGKILL" : "SIGTERM");
        } catch {}
      };
      let hard: NodeJS.Timeout | undefined;
      const stop = () => {
        kill();
        hard ??= setTimeout(() => kill(true), 1000);
      };
      const onAbort = () => stop();
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, 120000);
      for (const [stream, isError] of [
        [child.stdout, false],
        [child.stderr, true],
      ] as const)
        stream.on("data", (b) => {
          if (isError) stderr += b.toString();
          else stdout += b.toString();
          if (stdout.length + stderr.length > 200000) {
            overflow = true;
            stdout = stdout.slice(0, 100000);
            stderr = stderr.slice(0, 100000);
            stop();
          }
        });
      child.once("error", (error) => {
        clearTimeout(timer);
        if (hard) clearTimeout(hard);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (code, exitSignal) => {
        clearTimeout(timer);
        if (hard) clearTimeout(hard);
        signal.removeEventListener("abort", onAbort);
        // Reap background descendants remaining in this command's process group.
        kill(true);
        if (signal.aborted) reject(signal.reason);
        else
          resolve({
            stdout,
            stderr,
            exitCode: code ?? -1,
            signal: exitSignal,
            timedOut,
            overflow,
          });
      });
      if (signal.aborted) stop();
    });
  }
}
