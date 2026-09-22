import { randomUUID } from "node:crypto";
import type {
  Chunk,
  Provider,
  CodingActivity,
  CodingReply,
} from "../shared/types.ts";
import type { CompletionRequest } from "./providers.ts";
interface Job {
  id: string;
  userId: string;
  providerId: string;
  request: {
    messages: CompletionRequest["messages"];
    maxTokens: number;
    context?: CompletionRequest["context"];
  };
  coding: boolean;
  prompts: Map<string, CodingActivity>;
  replies: Map<string, CodingReply>;
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
    data: {
      chunks?: Chunk[];
      done?: boolean;
      error?: string;
      acknowledged?: string[];
    },
  ) {
    const job = this.jobs.get(id);
    if (!job || job.userId !== userId) return false;
    if (
      (data.chunks || []).some(
        (c) => (c.type === "coding" || c.activity) && !job.coding,
      )
    )
      return false;
    this.online.set(`${userId}:${job.providerId}`, Date.now());
    if (job.chunks.length + (data.chunks?.length || 0) > 200) {
      job.error = "Bridge stream buffer exceeded limit.";
      job.done = true;
      job.wake?.();
      return false;
    }
    job.chunks.push(...(data.chunks || []));
    for (const chunk of data.chunks || []) {
      const a = chunk.activity;
      if (
        a &&
        ["permission", "question"].includes(a.kind) &&
        !job.prompts.has(a.id)
      )
        job.prompts.set(a.id, a);
    }
    for (const id of data.acknowledged || []) job.replies.delete(id);
    if (data.done) job.done = true;
    if (data.error) {
      job.error =
        "Local bridge reported a provider error. Check the worker terminal.";
      job.done = true;
    }
    job.wake?.();
    return true;
  }
  controls(userId: string, id: string) {
    const job = this.jobs.get(id);
    return job?.userId === userId ? [...job.replies.values()] : [];
  }
  reply(userId: string, id: string, reply: CodingReply) {
    const job = this.jobs.get(id);
    const prompt = job?.prompts.get(reply.id);
    if (
      !job ||
      job.userId !== userId ||
      job.done ||
      !prompt ||
      prompt.kind !== reply.kind ||
      prompt.status === "answered"
    )
      return undefined;
    if (
      reply.kind === "question" &&
      reply.reply !== "reject" &&
      reply.answers?.length !== prompt.questions?.length
    )
      return undefined;
    prompt.status = "answered";
    job.replies.set(reply.id, reply);
    return { context: job.request.context, prompt };
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
      request: {
        messages: request.messages,
        maxTokens: request.maxTokens,
        context: request.context,
      },
      coding: provider.kind === "opencode",
      prompts: new Map(),
      replies: new Map(),
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
        while (job.chunks.length)
          yield { ...job.chunks.shift()!, jobId: job.id };
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
