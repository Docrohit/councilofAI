import { randomUUID } from "node:crypto";
import type { Finding } from "./knowledge.ts";
export interface Assessment {
  id: string;
  agentId: string;
  observer: string;
  domain: string;
  outcome: "success" | "mixed" | "failure";
  evidence: { findingId: string; revision: number }[];
  reason: string;
  source: "peer-assessment";
}
export class Adaptation {
  assessments: Assessment[] = [];
  constructor(
    private emit: (type: string, data: Record<string, any>) => void,
  ) {}
  record(
    observer: string,
    input: {
      agentId: string;
      domain: string;
      outcome: Assessment["outcome"];
      findingIds: string[];
      reason: string;
    },
    get: (id: string) => Finding | undefined,
  ) {
    const findings = input.findingIds.map(get);
    if (
      findings.some(
        (f) =>
          !f ||
          f.state !== "established" ||
          (f.author !== input.agentId && !f.acceptances[input.agentId]),
      )
    )
      throw new Error(
        "Skill assessments must cite established findings contributed to by the assessed peer.",
      );
    if (this.assessments.length >= 100)
      throw new Error("Task assessment limit reached.");
    const domain = input.domain.toLowerCase().trim();
    const evidence = findings.map((f) => ({
      findingId: f!.id,
      revision: f!.revision,
    }));
    const existing = this.assessments.find(
      (a) =>
        a.observer === observer &&
        a.agentId === input.agentId &&
        a.domain === domain &&
        JSON.stringify(a.evidence) === JSON.stringify(evidence),
    );
    if (existing) return existing;
    const assessment: Assessment = {
      id: randomUUID(),
      agentId: input.agentId,
      observer,
      domain,
      outcome: input.outcome,
      evidence,
      reason: input.reason,
      source: "peer-assessment",
    };
    this.assessments.push(assessment);
    this.emit("agent.assessment", { assessment });
    return assessment;
  }
  scores(get: (id: string) => Finding | undefined) {
    const grouped = new Map<
      string,
      {
        agentId: string;
        domain: string;
        success: number;
        mixed: number;
        failure: number;
        observations: number;
        score: number;
      }
    >();
    for (const a of this.assessments) {
      if (
        a.observer === a.agentId ||
        !a.evidence.every((e) => {
          const f = get(e.findingId);
          return f?.state === "established" && f.revision === e.revision;
        })
      )
        continue;
      const key = `${a.agentId}:${a.domain}`;
      const row = grouped.get(key) || {
        agentId: a.agentId,
        domain: a.domain,
        success: 0,
        mixed: 0,
        failure: 0,
        observations: 0,
        score: 0,
      };
      row[a.outcome]++;
      row.observations++;
      row.score = (row.success + row.mixed * 0.5) / row.observations;
      grouped.set(key, row);
    }
    return [...grouped.values()];
  }
}
