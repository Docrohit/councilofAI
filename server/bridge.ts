import { randomUUID } from "node:crypto";
import type { Chunk, Provider } from "../shared/types.ts";
import type { CompletionRequest } from "./providers.ts";
interface Job {
  id: string;
  userId: string;
  providerId: string;
  request: { messages: CompletionRequest["messages"]; maxTokens: number };
  chunks: Chunk[];
  done: boolean;
  error?: string;
  claimed: boolean;
  wake?: () => void;
}
export class Bridge {
  jobs = new Map<string, Job>();
  online = new Map<string, number>();
  poll(userId: string, providerId: string) {
    this.online.set(`${userId}:${providerId}`, Date.now());
    const job = [...this.jobs.values()].find(
      (j) => j.userId === userId && j.providerId === providerId && !j.claimed,
    );
    if (!job) return null;
    job.claimed = true;
    return { id: job.id, request: job.request };
  }
  push(
    userId: string,
    id: string,
    data: { chunks?: Chunk[]; done?: boolean; error?: string },
  ) {
    const job = this.jobs.get(id);
    if (!job || job.userId !== userId) return false;
    this.online.set(`${userId}:${job.providerId}`, Date.now());
    if (job.chunks.length + (data.chunks?.length || 0) > 200) {
      job.error = "Bridge stream buffer exceeded limit.";
      job.done = true;
      job.wake?.();
      return false;
    }
    job.chunks.push(...(data.chunks || []));
    if (data.done) job.done = true;
    if (data.error) {
      job.error =
        "Local bridge reported a provider error. Check the worker terminal.";
      job.done = true;
    }
    job.wake?.();
    return true;
  }
  async *complete(
    userId: string,
    provider: Provider,
    request: CompletionRequest,
  ): AsyncGenerator<Chunk> {
    if (
      Date.now() - (this.online.get(`${userId}:${provider.id}`) || 0) >
      20_000
    )
      throw new Error(
        "Local bridge is offline. Start the CLI worker for this connection.",
      );
    const job: Job = {
      id: randomUUID(),
      userId,
      providerId: provider.id,
      request: { messages: request.messages, maxTokens: request.maxTokens },
      chunks: [],
      done: false,
      claimed: false,
    };
    this.jobs.set(job.id, job);
    const abort = () => job.wake?.();
    request.signal.addEventListener("abort", abort);
    try {
      while (true) {
        request.signal.throwIfAborted();
        while (job.chunks.length) yield job.chunks.shift()!;
        if (job.done) {
          if (job.error) throw new Error(job.error);
          break;
        }
        await new Promise<void>((resolve) => {
          job.wake = resolve;
          if (request.signal.aborted || job.done || job.chunks.length)
            resolve();
        });
      }
    } finally {
      request.signal.removeEventListener("abort", abort);
      this.jobs.delete(job.id);
    }
  }
}
