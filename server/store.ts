import type { DB } from "./db.ts";
import type { CouncilEvent, Provider, Run } from "../shared/types.ts";
import { vault } from "./security.ts";
export class Store {
  listeners = new Map<string, Set<(event: CouncilEvent) => void>>();
  secrets: ReturnType<typeof vault>;
  constructor(
    public db: DB,
    directory: string,
  ) {
    this.secrets = vault(directory);
  }
  providers(userId: string, secret = false): Provider[] {
    return (
      this.db
        .prepare("SELECT id,config,secret FROM providers WHERE user_id=?")
        .all(userId) as any[]
    ).map((row) => ({
      ...JSON.parse(row.config),
      id: row.id,
      hasKey: !!row.secret,
      ...(secret ? { apiKey: this.secrets.decrypt(row.secret) } : {}),
    }));
  }
  saveRun(userId: string, run: Run) {
    this.db
      .prepare(
        "INSERT INTO runs(id,user_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(run.id, userId, JSON.stringify(run));
  }
  getRun(userId: string, id: string): Run | undefined {
    const row = this.db
      .prepare("SELECT data FROM runs WHERE id=? AND user_id=?")
      .get(id, userId) as any;
    return row ? JSON.parse(row.data) : undefined;
  }
  runs(userId: string): Run[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM runs WHERE user_id=? ORDER BY rowid DESC LIMIT 200",
        )
        .all(userId) as any[]
    ).map((row) => JSON.parse(row.data));
  }
  event(runId: string, type: string, data: Record<string, any>) {
    const at = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO events(run_id,type,at,data) VALUES(?,?,?,?)")
      .run(runId, type, at, JSON.stringify(data));
    const event = { id: Number(result.lastInsertRowid), runId, type, at, data };
    for (const notify of this.listeners.get(runId) || []) notify(event);
    return event;
  }
  events(runId: string, after = 0): CouncilEvent[] {
    return (
      this.db
        .prepare("SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id")
        .all(runId, after) as any[]
    ).map((row) => ({
      id: row.id,
      runId,
      type: row.type,
      at: row.at,
      data: JSON.parse(row.data),
    }));
  }
  subscribe(runId: string, notify: (event: CouncilEvent) => void) {
    const set = this.listeners.get(runId) || new Set();
    set.add(notify);
    this.listeners.set(runId, set);
    return () => {
      set.delete(notify);
      if (!set.size) this.listeners.delete(runId);
    };
  }
  recover() {
    for (const row of this.db
      .prepare("SELECT id,user_id,data FROM runs")
      .all() as any[]) {
      const run: Run = JSON.parse(row.data);
      if (run.status === "running" || run.status === "queued") {
        run.status = "interrupted";
        this.saveRun(row.user_id, run);
        this.event(run.id, "run.status", {
          status: "interrupted",
          message:
            "Server restarted. Continue from the saved team checkpoint; previous events are preserved.",
        });
      }
    }
  }
}
