import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { LocalProject } from "../cli/project.ts";
import { ProjectLsp } from "../cli/lsp.ts";
import { parseSkill } from "../cli/skills.ts";
import { parseCommandBlock } from "../server/orchestrator.ts";
const signal = () => new AbortController().signal;

test("Skills load progressively and do not bypass native path or command permissions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "council-skills-"));
  try {
    await mkdir(path.join(root, ".agents/skills/testing/references"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".agents/skills/testing/SKILL.md"),
      "---\nname: testing\ndescription: |\n  Run evidence-led checks.\nallowed-tools: exec\n---\nInspect tests first.",
    );
    await writeFile(
      path.join(root, ".agents/skills/testing/references/check.md"),
      "Reference instructions",
    );
    const project = new LocalProject(root, async () => false);
    const metadata = await project.execute({ action: "skills" }, signal());
    assert.equal(metadata.skills[0].name, "testing");
    assert.equal(
      JSON.stringify(metadata).includes("Inspect tests first."),
      false,
    );
    const loaded = await project.execute(
      { action: "skill", name: "testing" },
      signal(),
    );
    assert.equal(loaded.body, "Inspect tests first.");
    assert.match(loaded.note, /grants no permissions/);
    assert.equal(
      (
        await project.execute(
          { action: "skill", name: "testing", resource: "references/check.md" },
          signal(),
        )
      ).content,
      "Reference instructions",
    );
    await assert.rejects(
      project.execute(
        {
          action: "skill",
          name: "testing",
          resource: "references/../../../../.env",
        },
        signal(),
      ),
    );
    await writeFile(path.join(root, ".env"), "DO NOT READ");
    await symlink(
      path.join(root, ".env"),
      path.join(root, ".agents/skills/testing/references/leak.md"),
    );
    await assert.rejects(
      project.execute(
        { action: "skill", name: "testing", resource: "references/leak.md" },
        signal(),
      ),
      /Symbolic/,
    );
    await assert.rejects(
      project.execute({ action: "exec", command: "echo forbidden" }, signal()),
      /rejected/,
    );
    assert.throws(
      () =>
        parseSkill(
          "---\nname: testing\nname: testing\ndescription: x\n---\nbody",
          "testing",
        ),
      /YAML/,
    );
    assert.throws(
      () =>
        parseSkill(
          "---\nname: different\ndescription: x\n---\nbody",
          "testing",
        ),
      /directory/,
    );
    assert.match(await project.toolsContext(), /project_skill/);
    assert.equal(
      parseCommandBlock(
        JSON.stringify({
          tools: [{ name: "project_skill", skill: "testing" }],
        }),
      ).tools?.length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LSP performs handshake, refreshes files, rejects edits, handles cancellation and denied starts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "council-lsp-"));
  const serverScript = path.join(root, "fixture.mjs"),
    config = path.join(root, "lsp.json");
  const fixture = `import {createMessageConnection,StreamMessageReader,StreamMessageWriter} from ${JSON.stringify(import.meta.resolve("vscode-jsonrpc/node"))};
 const rpc=createMessageConnection(new StreamMessageReader(process.stdin),new StreamMessageWriter(process.stdout));
 let doc,edit;
 rpc.onRequest('initialize',()=>({capabilities:{textDocumentSync:2,hoverProvider:true,definitionProvider:true,referencesProvider:true,diagnosticProvider:{interFileDependencies:false,workspaceDiagnostics:false}}}));
 rpc.onNotification('initialized',()=>{rpc.sendRequest('workspace/applyEdit',{edit:{changes:{}}}).then(x=>edit=x);});
 rpc.onNotification('textDocument/didOpen',p=>doc=p.textDocument);
 rpc.onNotification('textDocument/didChange',p=>{doc={...doc,...p.textDocument,text:p.contentChanges[0].text};});
 rpc.onRequest('textDocument/diagnostic',()=>({kind:'full',items:doc.text.includes('bad')?[{message:'Type error',severity:1,range:{start:{line:0,character:0},end:{line:0,character:3}}}]:[]}));
 rpc.onRequest('textDocument/hover',p=>p.position.character===4?new Promise(()=>{}):({contents:doc.text,version:doc.version,edit,secret:process.env.COUNCIL_TEST_SECRET||null}));
 rpc.onRequest('textDocument/definition',()=>[{uri:doc.uri,range:{start:{line:0,character:0},end:{line:0,character:1}}}]);
 rpc.onRequest('textDocument/references',()=>[]);
 rpc.onRequest('shutdown',()=>null);rpc.onNotification('exit',()=>process.exit(0));rpc.listen();`;
  let lsp: ProjectLsp | undefined;
  const old = process.env.COUNCIL_TEST_SECRET;
  process.env.COUNCIL_TEST_SECRET = "must-not-inherit";
  try {
    await writeFile(serverScript, fixture);
    await writeFile(
      config,
      JSON.stringify([
        {
          id: "fixture",
          command: process.execPath,
          args: [serverScript],
          languages: { ".ts": "typescript" },
        },
      ]),
    );
    await writeFile(path.join(root, "a.ts"), "bad value");
    let approvals = 0;
    const project = new LocalProject(root, async () => false);
    const denied = new ProjectLsp(
      root,
      (p) => project.read(p),
      async () => false,
      config,
    );
    await assert.rejects(
      denied.execute(
        { action: "lsp", operation: "diagnostics", path: "a.ts" },
        signal(),
      ),
      /rejected/,
    );
    lsp = new ProjectLsp(
      root,
      (p) => project.read(p),
      async (p) => {
        assert.equal(p.kind, "exec");
        approvals++;
        return true;
      },
      config,
    );
    assert.equal(
      (await lsp.execute({ action: "lsp", operation: "status" }, signal()))
        .servers?.[0].running,
      false,
    );
    assert.equal(
      (
        await lsp.execute(
          { action: "lsp", operation: "diagnostics", path: "a.ts" },
          signal(),
        )
      ).diagnostics?.length,
      1,
    );
    await writeFile(path.join(root, "a.ts"), "good value");
    const hover = await lsp.execute(
      {
        action: "lsp",
        operation: "hover",
        path: "a.ts",
        line: 1,
        character: 1,
      },
      signal(),
    );
    assert.equal(hover.result.contents, "good value");
    assert.equal(hover.result.version, 2);
    assert.equal(hover.result.secret, null);
    assert.equal(hover.result.edit.applied, false);
    assert.equal(
      (
        await lsp.execute(
          { action: "lsp", operation: "diagnostics", path: "a.ts" },
          signal(),
        )
      ).diagnostics?.length,
      0,
    );
    assert.equal(
      (
        await lsp.execute(
          {
            action: "lsp",
            operation: "definition",
            path: "a.ts",
            line: 1,
            character: 1,
          },
          signal(),
        )
      ).result.length,
      1,
    );
    assert.equal(approvals, 1);
    await assert.rejects(
      lsp.execute(
        {
          action: "lsp",
          operation: "hover",
          path: "../outside.ts",
          line: 1,
          character: 1,
        },
        signal(),
      ),
      /project-relative/,
    );
    const controller = new AbortController();
    const pending = lsp.execute(
      {
        action: "lsp",
        operation: "hover",
        path: "a.ts",
        line: 1,
        character: 5,
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, /cancelled/);
    assert.equal(
      (
        await lsp.execute(
          {
            action: "lsp",
            operation: "hover",
            path: "a.ts",
            line: 1,
            character: 1,
          },
          signal(),
        )
      ).result.contents,
      "good value",
    );
  } finally {
    await lsp?.close();
    if (old === undefined) delete process.env.COUNCIL_TEST_SECRET;
    else process.env.COUNCIL_TEST_SECRET = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("long skill instructions can be retrieved completely in bounded pages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "council-skill-pages-"));
  try {
    const body = "A".repeat(12000) + "MIDDLE_INSTRUCTION" + "B".repeat(12000);
    await mkdir(path.join(root, ".agents/skills/long"), { recursive: true });
    await writeFile(
      path.join(root, ".agents/skills/long/SKILL.md"),
      "---\nname: long\ndescription: Long instructions\n---\n" + body,
    );
    const project = new LocalProject(root, async () => false);
    let content = "",
      offset = 0;
    for (let i = 0; i < 10; i++) {
      const page = await project.skills.load("long", undefined, offset);
      assert(JSON.stringify(page).length < 16000);
      content += page.body;
      if (page.nextOffset === null) break;
      assert(page.nextOffset > offset);
      offset = page.nextOffset;
    }
    assert.equal(content, body);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LSP cancellation and server exit interrupt blocked document writes and allow shutdown", async () => {
  for (const mode of ["abort", "exit"]) {
    const root = await mkdtemp(path.join(tmpdir(), "council-lsp-stall-"));
    const config = path.join(root, "lsp.json");
    const project = new LocalProject(root, async () => true);
    const lsp = new ProjectLsp(
      root,
      (p) => project.read(p),
      async () => true,
      config,
    );
    try {
      const script = path.join(root, "stall.mjs");
      await writeFile(
        script,
        `let data='';process.stdin.on('data',b=>{data+=b;const pos=data.indexOf('\\r\\n\\r\\n');if(pos<0)return;const len=Number(/Content-Length: (\\d+)/i.exec(data)?.[1]);if(data.length<pos+4+len)return;const req=JSON.parse(data.slice(pos+4,pos+4+len));process.stdin.pause();const answer=JSON.stringify({jsonrpc:'2.0',id:req.id,result:{capabilities:{textDocumentSync:1}}});process.stdout.write('Content-Length: '+Buffer.byteLength(answer)+'\\r\\n\\r\\n'+answer);${mode === "exit" ? "setTimeout(()=>process.exit(0),150);" : ""}setInterval(()=>{},1000);});`,
      );
      await writeFile(path.join(root, "big.ts"), "x".repeat(990000));
      await writeFile(
        config,
        JSON.stringify([
          {
            id: "stall",
            command: process.execPath,
            args: [script],
            languages: { ".ts": "typescript" },
          },
        ]),
      );
      const controller = new AbortController();
      const work = lsp.execute(
        { action: "lsp", operation: "diagnostics", path: "big.ts" },
        controller.signal,
      );
      const timer =
        mode === "abort"
          ? setTimeout(() => controller.abort(), 200)
          : undefined;
      await assert.rejects(work);
      clearTimeout(timer);
      await lsp.close();
    } finally {
      await lsp.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("missing executables and immediate server exits are caught without terminating Council", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(path.join(tmpdir(), "council-lsp-launch-"));
  try {
    const script = path.join(root, "probe.mjs");
    await writeFile(
      script,
      `import {ProjectLsp} from ${JSON.stringify(new URL("../cli/lsp.ts", import.meta.url).href)};import {writeFile} from 'node:fs/promises';
  for(const c of [{command:'/nonexistent/council-test-ls',args:[]},{command:process.execPath,args:['-e','process.exit(1)']}]) {
   const config=${JSON.stringify(path.join(root, "lsp.json"))};await writeFile(config,JSON.stringify([{id:'bad',...c,languages:{'.ts':'typescript'}}]));
   const lsp=new ProjectLsp(${JSON.stringify(root)},async()=>({content:'x',sha:'fixture'}),async()=>true,config);
   try {await lsp.execute({action:'lsp',operation:'diagnostics',path:'a.ts'},new AbortController().signal);throw new Error('unexpected success');}catch(e){if(e.message==='unexpected success')throw e;}
   finally {await lsp.close();}
  }
  await new Promise(r=>setTimeout(r,200));console.log('launch failures contained');`,
    );
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), script],
      { timeout: 10000 },
    );
    assert.match(result.stdout, /launch failures contained/);
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
