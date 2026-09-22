import { randomUUID } from "node:crypto";
export interface Finding {
  id: string;
  key: string;
  claim: string;
  evidence: string[];
  author: string;
  revision: number;
  state: "established" | "disputed";
  participants: string[];
  acceptances: Record<string, { revision: number; reason: string }>;
  challenges: { agent: string; reason: string; recheck: string }[];
}
export interface Work {
  key: string;
  description: string;
  owner: string;
  state: "claimed" | "complete";
  result?: string;
}
export class Knowledge {
  findings = new Map<string, Finding>();
  work = new Map<string, Work>();
  constructor(
    private emit: (type: string, data: Record<string, any>) => void,
  ) {}
  key(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, "-");
  }
  get(id: string) {
    return (
      this.findings.get(id) ||
      [...this.findings.values()].find((f) => f.key === this.key(id))
    );
  }
  publish(
    author: string,
    input: { key: string; claim: string; evidence: string[] },
  ) {
    const key = this.key(input.key);
    const existing = this.get(key);
    if (existing) {
      this.emit("finding.reused", {
        agentId: author,
        findingId: existing.id,
        key,
        message: `Finding already exists at revision ${existing.revision}. Reuse its evidence; challenge it if there is a concrete contradiction.`,
      });
      return existing;
    }
    if (this.findings.size >= 40)
      throw new Error(
        "Findings ledger is full. Reuse or revise existing findings.",
      );
    const finding: Finding = {
      id: randomUUID(),
      ...input,
      key,
      author,
      revision: 1,
      state: "established",
      participants: [],
      acceptances: {},
      challenges: [],
    };
    this.findings.set(finding.id, finding);
    this.emit("finding.updated", { finding });
    return finding;
  }
  challenge(agent: string, id: string, reason: string, recheck: string) {
    const finding = this.get(id);
    if (!finding) throw new Error("Unknown finding.");
    finding.state = "disputed";
    finding.participants = [
      ...new Set([...finding.participants, finding.author, agent]),
    ];
    finding.acceptances = {};
    finding.challenges.push({ agent, reason, recheck });
    this.emit("finding.updated", { finding });
    return finding;
  }
  revise(agent: string, id: string, claim: string, evidence: string[]) {
    const finding = this.get(id);
    if (!finding) throw new Error("Unknown finding.");
    if (!finding.participants.includes(agent) && finding.author !== agent)
      throw new Error(
        "Discuss the finding with its author before revising it.",
      );
    finding.claim = claim;
    finding.evidence = evidence;
    finding.revision++;
    finding.acceptances = {};
    this.emit("finding.updated", { finding });
    return finding;
  }
  accept(agent: string, id: string, revision: number, reason: string) {
    const finding = this.get(id);
    if (!finding || finding.revision !== revision)
      throw new Error("Finding revision changed; review the current evidence.");
    finding.acceptances[agent] = { revision, reason };
    if (
      finding.participants.length &&
      finding.participants.every(
        (id) => finding.acceptances[id]?.revision === revision,
      )
    )
      finding.state = "established";
    this.emit("finding.updated", { finding });
    return finding;
  }
  claimWork(agent: string, key: string, description: string) {
    key = this.key(key);
    const previous = this.work.get(key);
    if (previous) {
      this.emit("work.reused", {
        ...previous,
        agentId: agent,
        message:
          previous.state === "complete"
            ? "Work already complete; reuse its result."
            : "Work already assigned; ask its owner for findings.",
      });
      return { acquired: false, work: previous };
    }
    if (this.work.size >= 60)
      throw new Error("Work registry is full. Reuse existing work.");
    const work: Work = { key, description, owner: agent, state: "claimed" };
    this.work.set(key, work);
    this.emit("work.updated", { work });
    return { acquired: true, work };
  }
  finishWork(agent: string, key: string, result: string) {
    const work = this.work.get(this.key(key));
    if (!work || work.owner !== agent)
      throw new Error("Only the work owner can mark it complete.");
    work.state = "complete";
    work.result = result;
    this.emit("work.updated", { work });
    return work;
  }
  transferWork(key: string, from: string, to: string, reason: string) {
    const work = this.work.get(this.key(key));
    if (!work || work.state !== "claimed" || work.owner !== from)
      throw new Error(
        "Only unfinished work owned by the delegator can be reassigned.",
      );
    work.owner = to;
    this.emit("work.reassigned", { work, from, to, reason });
    this.emit("work.updated", { work });
    return work;
  }
  disputed() {
    return [...this.findings.values()].filter((f) => f.state === "disputed");
  }
  snapshot() {
    return {
      findings: [...this.findings.values()],
      work: [...this.work.values()],
    };
  }
}
