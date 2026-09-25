import { randomUUID } from "node:crypto";

export interface BoardPost {
  id: string;
  author: string;
  content: string;
  at: string;
  kind?: "broadcast" | "conclusion" | "user-instruction" | "tool-observation";
  evidenceSummary?: string;
  replyTo?: string;
  threadId?: string;
  revision?: number;
  coauthors?: string[];
}
export interface Conversation {
  id: string;
  participants: [string, string];
  topic: string;
  messages: { author: string; content: string; at: string }[];
  proposal?: {
    revision: number;
    summary: string;
    evidence: string[];
    reviews: Record<string, { agree: boolean; reason: string }>;
    publishedPostId?: string;
  };
}
export interface CommunicationState {
  board: BoardPost[];
  conversations: Conversation[];
}
export class Communication {
  board: BoardPost[];
  conversations: Conversation[];
  constructor(
    private emit: (type: string, data: Record<string, unknown>) => unknown,
    saved?: CommunicationState,
  ) {
    this.board = structuredClone(saved?.board || []);
    this.conversations = structuredClone(saved?.conversations || []);
  }
  snapshot(): CommunicationState {
    return structuredClone({
      board: this.board,
      conversations: this.conversations,
    });
  }
  broadcast(
    author: string,
    content: string,
    replyTo?: string,
    options?: Pick<BoardPost, "kind" | "evidenceSummary">,
  ) {
    if (replyTo && !this.board.some((p) => p.id === replyTo))
      throw new Error("Unknown board post.");
    const post: BoardPost = {
      id: randomUUID(),
      author,
      content,
      at: new Date().toISOString(),
      kind: options?.kind || "broadcast",
      ...(options?.evidenceSummary
        ? { evidenceSummary: options.evidenceSummary }
        : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    this.board.push(post);
    this.emit("board.post", { post });
    return post;
  }
  open(author: string, to: string, topic = "Direct discussion") {
    if (author === to)
      throw new Error("A conversation requires two different peers.");
    const existing = this.conversations.find(
      (t) =>
        t.topic === topic &&
        t.participants.includes(author) &&
        t.participants.includes(to),
    );
    if (existing) return existing;
    const thread: Conversation = {
      id: randomUUID(),
      participants: [author, to],
      topic,
      messages: [],
    };
    this.conversations.push(thread);
    this.updated(thread);
    return thread;
  }
  get(author: string, id: string) {
    const thread = this.conversations.find((t) => t.id === id);
    if (!thread || !thread.participants.includes(author))
      throw new Error("Conversation is not available to this peer.");
    return thread;
  }
  message(author: string, id: string, content: string) {
    const thread = this.get(author, id);
    thread.messages.push({ author, content, at: new Date().toISOString() });
    this.updated(thread);
    return thread;
  }
  propose(author: string, id: string, summary: string, evidence: string[]) {
    const thread = this.get(author, id);
    if (!evidence.length) throw new Error("A joint conclusion needs evidence.");
    thread.proposal = {
      revision: (thread.proposal?.revision || 0) + 1,
      summary,
      evidence,
      reviews: {},
    };
    this.updated(thread);
    return thread;
  }
  review(
    author: string,
    id: string,
    revision: number,
    agree: boolean,
    reason: string,
  ) {
    const thread = this.get(author, id);
    if (!thread.proposal || thread.proposal.revision !== revision)
      throw new Error("Review the current conversation proposal revision.");
    if (thread.proposal.publishedPostId)
      throw new Error(
        "Published agreement is immutable; propose a new revision to challenge or correct it.",
      );
    thread.proposal.reviews[author] = { agree, reason };
    this.updated(thread);
    return thread;
  }
  publish(author: string, id: string) {
    const thread = this.get(author, id),
      proposal = thread.proposal;
    if (
      !proposal ||
      !thread.participants.every((p) => proposal.reviews[p]?.agree)
    )
      throw new Error(
        "Both peers must explicitly accept the same proposal revision before publishing.",
      );
    if (proposal.publishedPostId)
      return this.board.find((p) => p.id === proposal.publishedPostId)!;
    const post: BoardPost = {
      id: randomUUID(),
      author,
      coauthors: [...thread.participants],
      content: `${proposal.summary}\n\nEvidence:\n${proposal.evidence.map((e) => `- ${e}`).join("\n")}`,
      kind: "conclusion",
      evidenceSummary: proposal.evidence.slice(0, 2).join("; "),
      threadId: id,
      revision: proposal.revision,
      at: new Date().toISOString(),
    };
    this.board.push(post);
    proposal.publishedPostId = post.id;
    this.emit("board.post", { post });
    this.updated(thread);
    return post;
  }
  unresolved() {
    return this.conversations.filter(
      (t) =>
        t.proposal &&
        !t.participants.every((p) => t.proposal!.reviews[p]?.agree),
    );
  }
  context(author: string) {
    return {
      board: this.board.slice(-20),
      boardTotal: this.board.length,
      conversations: this.conversations.map((t) =>
        t.participants.includes(author)
          ? { ...t, messages: t.messages.slice(-12) }
          : {
              id: t.id,
              participants: t.participants,
              topic: t.topic,
              state: t.proposal?.publishedPostId ? "published" : "discussing",
            },
      ),
    };
  }
  replay() {
    for (const post of this.board) this.emit("board.post", { post });
    for (const thread of this.conversations) this.updated(thread);
  }
  private updated(thread: Conversation) {
    this.emit("conversation.updated", {
      conversation: structuredClone(thread),
    });
  }
}
