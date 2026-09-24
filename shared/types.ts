export type ProviderKind =
  | "ollama"
  | "vllm"
  | "openai"
  | "anthropic"
  | "glm"
  | "compatible"
  | "opencode"
  | "demo";
export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  transport: "direct" | "bridge";
  reasoning: boolean;
  hasKey?: boolean;
  apiKey?: string;
}
export interface Member {
  id: string;
  name: string;
  role: string;
  providerId: string;
  parentId?: string;
  depth?: number;
  reportsTo?: string;
}
export interface RunConfig {
  webResearch?: boolean;
  sandbox?: boolean;
  members: Member[];
  providerIds: string[];
  maxAgents: number | null;
  maxDepth: number | null;
  concurrency: number;
  maxCalls: number;
  maxOutputTokens: number;
  maxMinutes: number;
}
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted"
  | "needs_review";
export interface Run {
  id: string;
  title: string;
  prompt: string;
  userMessage?: string;
  status: RunStatus;
  config: RunConfig;
  createdAt: string;
  final: string;
  demo: boolean;
  verificationTools?: boolean;
  attachments?: import("./attachments").Attachment[];
  parentId?: string;
  resumeState?: SharedState;
  sharedState?: SharedState;
}
export interface SharedState {
  communication?: import("../server/communication").CommunicationState;
  peers: {
    member: Member;
    task: string;
    latest: string;
    inbox?: { from: string; kind: string; content: string }[];
  }[];
  findings: import("../server/knowledge").Finding[];
  work: import("../server/knowledge").Work[];
  assessments?: import("../server/adaptation").Assessment[];
}
export interface CouncilEvent {
  id: number;
  runId: string;
  type: string;
  at: string;
  data: Record<string, any>;
}
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface Chunk {
  type: "text" | "reasoning" | "usage" | "coding";
  text?: string;
  input?: number;
  output?: number;
  activity?: CodingActivity;
  jobId?: string;
}
export interface CodingActivity {
  kind: "session" | "tool" | "diff" | "permission" | "question";
  sessionId: string;
  id: string;
  title: string;
  detail: string;
  status?: string;
  questions?: { question: string; options: string[]; multiple?: boolean }[];
}
export interface CodingReply {
  id: string;
  kind: "permission" | "question";
  reply: "once" | "reject";
  answers?: string[][];
}
export const roles = ["Architect", "Researcher", "Critic"];
