import type { CouncilEvent, Run, Member } from "../shared/types.ts";
export const viewNames = [
  "Discussion",
  "Engagement",
  "Board",
  "Conversations",
  "Findings",
  "Answer",
  "Tools",
  "Files",
  "Help",
] as const;
export type ViewName = (typeof viewNames)[number];
export const commands = [
  ["connections", "Manage connections, keys and endpoints"],
  ["models", "Choose models for this team"],
  ["agents", "Set the starting agent count"],
  ["sessions", "Search and open past conversations"],
  ["new", "Start a new conversation"],
  ...viewNames
    .filter((x) => x !== "Files")
    .map((x) => [x.toLowerCase(), `Open ${x}`]),
  ["files", "Browse project files"],
  ["web", "Toggle public web research"],
  ["board-msg", "Post a user message to the live board"],
  ["skills", "List project Skills"],
  ["lsp status", "Show language servers"],
  ["budget", "Set model-call budget"],
  ["concurrency", "Set simultaneous agents"],
  ["resume", "Continue the selected checkpoint"],
  ["diff", "Review project changes"],
  ["connect", "Add a connection using typed arguments"],
  ["read", "Read a project file"],
  ["search", "Search project text"],
  ["edit", "Open the built-in editor"],
  ["shell", "Open a shell or run a command"],
  ["permissions", "Clear temporary grants"],
  ["quit", "Exit Council"],
].map(([command, description]) => ({ command, description }));
const printable = (value: unknown) =>
  typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
export function sessionView(
  view: ViewName,
  events: CouncilEvent[],
  run: Run | undefined,
  name: (id: string) => string,
): string {
  if (view === "Answer")
    return (
      run?.final ||
      events.findLast((e) => e.type === "run.final")?.data.text ||
      "The team has not produced a final answer yet. Follow Discussion or Findings while it works."
    );
  if (view === "Board") {
    const posts = new Map(
      (run?.sharedState?.communication?.board || []).map((p) => [p.id, p]),
    );
    for (const e of events)
      if (e.type === "board.post") posts.set(e.data.post.id, e.data.post);
    return (
      [...posts.values()]
        .map(
          (p) =>
            `${(p.coauthors || [p.author]).map(name).join(" + ")}${p.threadId ? " · joint conclusion" : ""}\n${p.content}`,
        )
        .join("\n\n") ||
      "Shared broadcasts will appear here with their authors."
    );
  }
  if (view === "Conversations") {
    const threads = new Map(
      (run?.sharedState?.communication?.conversations || []).map((t) => [
        t.id,
        t,
      ]),
    );
    for (const e of events)
      if (e.type === "conversation.updated")
        threads.set(e.data.conversation.id, e.data.conversation);
    return (
      [...threads.values()]
        .map(
          (t) =>
            `${t.participants.map(name).join(" ↔ ")} · ${t.topic}\n${t.messages.map((m) => `${name(m.author)}: ${m.content}`).join("\n")}\n${t.proposal ? `Conclusion r${t.proposal.revision}: ${t.proposal.summary}\nEvidence: ${t.proposal.evidence.join("; ")}\n${t.participants.map((id) => `${name(id)}: ${t.proposal!.reviews[id]?.agree === true ? "agrees" : t.proposal!.reviews[id]?.agree === false ? "disagrees" : "awaiting review"}${t.proposal!.reviews[id]?.reason ? " — " + t.proposal!.reviews[id].reason : ""}`).join("\n")}${t.proposal.publishedPostId ? "\nPublished to board" : ""}` : ""}`,
        )
        .join("\n\n") || "Direct agent conversations will appear here."
    );
  }
  if (view === "Findings") {
    const findings = new Map(
      (run?.sharedState?.findings || []).map((f) => [f.id, f]),
    );
    for (const e of events)
      if (e.type === "finding.updated")
        findings.set(e.data.finding.id, e.data.finding);
    return (
      [...findings.values()]
        .map(
          (f) =>
            `${f.state.toUpperCase()} · ${f.key} · revision ${f.revision} · ${name(f.author)}\n${f.claim}\nEvidence:\n${f.evidence.map((x) => "  • " + x).join("\n")}\n${f.challenges.map((c) => `Challenge by ${name(c.agent)}: ${c.reason}\nRecheck: ${c.recheck}`).join("\n")}`,
        )
        .join("\n\n") ||
      "No findings yet. Established is a ledger status, not independent proof."
    );
  }
  if (view === "Engagement")
    return (
      events
        .map((e) => {
          const d = e.data;
          if (e.type === "agent.message")
            return `${d.name || name(d.from)} → ${d.to === "all" ? "Everyone" : name(d.to)} · ${d.kind || "message"}\n${d.content}`;
          if (e.type === "agent.spawn") return `New peer ${d.name}: ${d.task}`;
          if (e.type === "agent.organization")
            return `${d.name} chose ${d.role}${d.reportsTo ? " · reports to " + name(d.reportsTo) : ""}`;
          if (e.type === "candidate.review")
            return `${name(d.agentId)} ${d.agree ? "agrees" : "objects"}\n${d.reason}`;
          if (
            e.type === "agent.unavailable" ||
            e.type === "agent.reassigned" ||
            e.type === "warning"
          )
            return printable(d.message || d);
          return "";
        })
        .filter(Boolean)
        .join("\n\n") ||
      "Delegation, messages and reviews appear here. Messages enter the recipient’s next model turn."
    );
  if (view === "Tools") {
    const tools = new Map<string, any>();
    for (const e of events)
      if (e.type === "coding.activity") tools.set(e.data.id, e.data);
    return (
      events
        .filter((e) => e.type === "tool.result" || e.type === "tool.error")
        .map(
          (e) =>
            `${name(e.data.agentId)} · ${e.data.tool || "Tool error"}\n${printable(e.data.message || e.data.result)}`,
        )
        .concat(
          [...tools.values()].map(
            (t) => `${name(t.agentId)} · ${t.title} · ${t.status}\n${t.detail}`,
          ),
        )
        .join("\n\n") || "Actual tool results and approvals will appear here."
    );
  }
  const turns = new Map<string, { title: string; text: string }>();
  const blocks: ({ turn: string } | { text: string })[] = [];
  for (const e of events) {
    const d = e.data;
    if (e.type === "turn.start") {
      turns.set(d.turnId, {
        title: `${d.name} · ${d.model} · ${d.phase}`,
        text: "",
      });
      blocks.push({ turn: d.turnId });
    }
    if (e.type === "turn.done") {
      const t = turns.get(d.turnId);
      if (t && typeof d.text === "string") t.text = d.text;
    }
    if (e.type === "turn.delta") {
      const t = turns.get(d.turnId);
      if (t) t.text += d.text;
    }
    if (["warning", "turn.error", "run.status"].includes(e.type))
      blocks.push({ text: d.message || `Session ${d.status}` });
  }
  return (
    blocks
      .map((b) =>
        "turn" in b
          ? `${turns.get(b.turn)?.title}\n${turns.get(b.turn)?.text || "Working…"}`
          : b.text,
      )
      .join("\n\n") ||
    "Give your council a goal in the chat box below. Use /connections to get started."
  );
}
// Terminal layout is measured in display cells, not UTF-16 code units.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function cells(text: string) {
  return [...segmenter.segment(text)].reduce(
    (n, { segment }) => n + cellWidth(segment),
    0,
  );
}
function cellWidth(s: string) {
  const cp = s.codePointAt(0)!;
  if (/^\p{Mark}+$/u.test(s)) return 0;
  return /\p{Extended_Pictographic}/u.test(s) ||
    (cp >= 0x1100 &&
      (cp <= 0x115f ||
        (cp >= 0x2329 && cp <= 0x232a) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe6f) ||
        (cp >= 0xff01 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x20000 && cp <= 0x3fffd)))
    ? 2
    : 1;
}
export function fit(text: string, width: number) {
  let out = "",
    used = 0;
  for (const { segment } of segmenter.segment(text)) {
    const w = cellWidth(segment);
    if (used + w > width) break;
    out += segment;
    used += w;
  }
  return out + " ".repeat(Math.max(0, width - used));
}
export function wrapCells(text: string, width: number) {
  width = Math.max(1, width);
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let row = "",
      used = 0;
    for (const { segment } of segmenter.segment(line)) {
      const w = cellWidth(segment);
      if (used + w > width) {
        out.push(row);
        row = "";
        used = 0;
      }
      row += segment;
      used += w;
    }
    out.push(row);
  }
  return out;
}

export function livePeers(
  initial: Member[],
  events: CouncilEvent[],
): (Member & { unavailable?: boolean })[] {
  const peers = new Map<string, Member & { unavailable?: boolean }>(
    initial.map((p) => [p.id, { ...p }]),
  );
  for (const e of events) {
    const d = e.data;
    if (
      [
        "agent.join",
        "agent.spawn",
        "agent.reassigned",
        "agent.organization",
      ].includes(e.type)
    ) {
      const old = peers.get(d.id);
      peers.set(d.id, { ...old, ...d } as Member);
    }
    if (e.type === "agent.unavailable") {
      const p = peers.get(d.agentId);
      if (p) p.unavailable = true;
    }
  }
  return [...peers.values()];
}
