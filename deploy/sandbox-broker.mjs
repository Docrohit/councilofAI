// Narrow Unix-socket broker. The web service never receives Docker access.
import http from "node:http";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const image = process.env.COUNCIL_SANDBOX_IMAGE || "node:22-bookworm-slim";
const label = "council.sandbox=v1";
const sessions = new Map(),
  locks = new Map();
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "docker",
      args,
      { timeout: 40_000, maxBuffer: 300_000 },
      (error, stdout, stderr) => {
        if (error) {
          let detail = stderr || "Sandbox operation failed";
          try {
            detail = JSON.parse(stdout).error || detail;
          } catch {}
          reject(new Error(detail.slice(0, 2000)));
        } else resolve(stdout);
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input || "");
  });
}
// Runs INSIDE the nonroot, read-only, networkless container, never on the host.
const fileProgram = String.raw`
const fs = require('fs'), path = require('path'), crypto = require('crypto');
let input=''; process.stdin.on('data',b=>input+=b); process.stdin.on('end',()=>{try {
const a=JSON.parse(input), root='/workspace';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function safe(p, mkdir=false) {
 if(typeof p!=='string'||p.length>200||!p||p.includes('\\')||p.startsWith('/')||p.split('/').some(x=>!x||x==='.'||x==='..')) throw Error('Invalid project path');
 const pieces=p.split('/'); let current=root;
 for(let i=0;i<pieces.length;i++) {current=path.join(current,pieces[i]);
  let st; try { st=fs.lstatSync(current); } catch(e) {if(e.code!=='ENOENT') throw e;}
  if(st) { if(st.isSymbolicLink()) throw Error('Symbolic links are not editable');
   if(i<pieces.length-1&&!st.isDirectory()) throw Error('Parent is not a directory');
  } else if(i<pieces.length-1) {if(mkdir) fs.mkdirSync(current); else throw Error('File not found');}
 } return current;
}
function read(p) {const full=safe(p); if(!fs.existsSync(full)) return {path:p,content:'',sha:null};
 const stat=fs.lstatSync(full); if(!stat.isFile()||stat.size>128000) throw Error('Select a text file up to 128 KB');
 const content=fs.readFileSync(full,'utf8'); if(content.includes('\u0000')) throw Error('Binary files are not editable');
 return {path:p,content,sha:hash(content)};
}
let result;
if(a.action==='tree'||a.action==='export') {const files=[]; let total=0;
 function walk(dir,prefix='') {for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
  if(files.length>=500) throw Error('Project exceeds 500-file export limit');
  const p=prefix+item.name; if(item.isSymbolicLink()) continue;
  if(item.isDirectory()) {if(!['node_modules','.git'].includes(item.name)) walk(path.join(dir,item.name),p+'/');}
  else if(item.isFile()) {if(a.action==='export') {const f=read(p); total+=Buffer.byteLength(f.content); if(total>240000) throw Error('Export exceeds 240 KB; export individual files or reduce the project'); files.push(f);} else files.push({path:p,size:fs.statSync(path.join(dir,item.name)).size});}
 }} walk(root); result={files};
} else if(a.action==='read') result=read(a.path);
else if(a.action==='write') {if(typeof a.content!=='string'||Buffer.byteLength(a.content)>128000) throw Error('File exceeds 128 KB');
 const full=safe(a.path,true), previous=read(a.path); if(previous.sha!==a.sha) throw Error('File changed since it was read. Reload before saving.');
 fs.writeFileSync(full,a.content); result=read(a.path);
} else throw Error('Unknown file operation');
console.log(JSON.stringify(result));
}catch(e){console.log(JSON.stringify({error:e.message}));process.exitCode=1}});
`;
function ownerKey(owner) {
  if (typeof owner !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(owner))
    throw new Error("Invalid owner");
  return createHash("sha256").update(owner).digest("hex").slice(0, 32);
}
async function remove(key) {
  const session = sessions.get(key);
  if (session) {
    await docker(["rm", "-f", session.container]);
    sessions.delete(key);
  }
}
async function operate(a) {
  const key = ownerKey(a.owner),
    now = Date.now();
  let s = sessions.get(key);
  if (
    s &&
    (now - s.touched > 30 * 60_000 || now - s.created > 2 * 60 * 60_000)
  ) {
    await remove(key);
    s = undefined;
  }
  if (a.action === "status")
    return {
      available: true,
      active: !!s,
      expiresAt: s ? new Date(s.created + 2 * 60 * 60_000).toISOString() : null,
    };
  if (a.action === "create") {
    if (s) return { active: true };
    if (sessions.size >= 4)
      throw new Error(
        "All four hosted sandboxes are busy. Try again later or connect your own OpenCode worker.",
      );
    const container = `council-sandbox-${key}`;
    // Reserve before awaiting Docker so concurrent owners cannot exceed capacity.
    s = { container, created: now, touched: now };
    sessions.set(key, s);
    try {
      await docker([
        "run",
        "-d",
        "--name",
        container,
        "--label",
        label,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "256m",
        "--memory-swap",
        "256m",
        "--cpus",
        "0.5",
        "--pids-limit",
        "64",
        "--ulimit",
        "nofile=256:256",
        "--log-driver",
        "none",
        "--user",
        "1000:1000",
        "--tmpfs",
        "/workspace:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=16m,uid=1000,gid=1000,mode=0700",
        "--workdir",
        "/workspace",
        image,
        "sleep",
        "infinity",
      ]);
    } catch (error) {
      sessions.delete(key);
      throw error;
    }
    return { active: true };
  }
  if (!s)
    throw new Error(
      "Create a hosted sandbox first. Expired project files cannot be recovered; import a saved export.",
    );
  s.touched = now;
  if (a.action === "destroy") {
    await remove(key);
    return { active: false };
  }
  if (a.action === "exec") {
    if (
      typeof a.command !== "string" ||
      !a.command.trim() ||
      a.command.length > 8000
    )
      throw new Error("Invalid command");
    const result = await new Promise((resolve) => {
      execFile(
        "docker",
        [
          "exec",
          s.container,
          "timeout",
          "--signal=TERM",
          "--kill-after=2",
          "30",
          "sh",
          "-c",
          a.command,
        ],
        { timeout: 35_000, maxBuffer: 128_000 },
        (error, stdout, stderr) =>
          resolve({
            stdout: stdout.slice(0, 64000),
            stderr: stderr.slice(0, 64000),
            exitCode: error
              ? typeof error.code === "number"
                ? error.code
                : -1
              : 0,
            timedOut: !!error && (error.killed || error.code === 124),
          }),
      );
    });
    return result;
  }
  if (!["tree", "read", "write", "export"].includes(a.action))
    throw new Error("Unknown sandbox operation");
  const output = await docker(
    [
      "exec",
      "-i",
      s.container,
      "timeout",
      "--kill-after=2",
      "15",
      "node",
      "-e",
      fileProgram,
    ],
    JSON.stringify(a),
  );
  return JSON.parse(output);
}
export async function handle(a) {
  const key = ownerKey(a.owner);
  if (locks.has(key))
    throw new Error(
      "Project is busy. Wait for the current command or file operation.",
    );
  locks.set(key, true);
  try {
    return await operate(a);
  } finally {
    locks.delete(key);
  }
}
export async function startBroker(socket) {
  // Clear only this broker's labelled ephemeral containers after restart.
  const ids = String(await docker(["ps", "-aq", "--filter", `label=${label}`]))
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length) await docker(["rm", "-f", ...ids]);
  try {
    unlinkSync(socket);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST" || req.url !== "/") {
      res.writeHead(404).end("{}");
      return;
    }
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 200_000) throw new Error("Request too large");
      }
      res.end(JSON.stringify(await handle(JSON.parse(body))));
    } catch (error) {
      res.writeHead(400).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  chmodSync(socket, 0o660);
  const timer = setInterval(async () => {
    for (const [key, s] of sessions)
      if (
        !locks.has(key) &&
        (Date.now() - s.touched > 30 * 60_000 ||
          Date.now() - s.created > 2 * 60 * 60_000)
      ) {
        locks.set(key, true);
        try {
          await remove(key);
        } catch {
        } finally {
          locks.delete(key);
        }
      }
  }, 60_000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startBroker(
    process.env.COUNCIL_SANDBOX_SOCKET || "/run/council-sandbox/broker.sock",
  );
  console.log("Council sandbox broker ready");
}
