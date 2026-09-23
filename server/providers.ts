import type { ChatMessage, Chunk, Provider } from "../shared/types.ts";
import { validateEndpoint } from "./security.ts";

export async function* lines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000)
        throw new Error("Provider stream frame exceeded limit.");
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        signal?.throwIfAborted();
        yield buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer;
  } finally {
    signal?.removeEventListener("abort", abort);
    // A transport can leave cancellation pending (notably while a model turn
    // is paused for approval). Start cleanup without blocking iterator return.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function* streamJson(
  body: ReadableStream<Uint8Array>,
  ndjson = false,
  signal?: AbortSignal,
): AsyncGenerator<any> {
  let data: string[] = [];
  for await (const line of lines(body, signal)) {
    if (ndjson) {
      if (line.trim()) yield JSON.parse(line);
      continue;
    }
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    if (line === "" && data.length) {
      const value = data.join("\n");
      data = [];
      if (value === "[DONE]") yield { __done: true };
      else yield JSON.parse(value);
    }
  }
  if (data.length) {
    const value = data.join("\n");
    yield value === "[DONE]" ? { __done: true } : JSON.parse(value);
  }
}
export interface CompletionRequest {
  messages: ChatMessage[];
  maxTokens: number;
  signal: AbortSignal;
  context?: { runId: string; agentId: string };
}

// Provider errors are returned only to the owning account. Keep useful diagnostics,
// but never echo a key even when a provider includes one in its error message.
function providerError(provider: Provider, payload: any, status?: number) {
  const detail = payload?.error || payload?.response?.error || payload;
  const redact = (value: unknown) => {
    let text = typeof value === "string" ? value : "";
    if (provider.apiKey) text = text.replaceAll(provider.apiKey, "[redacted]");
    return text
      .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 600);
  };
  const code = redact(detail?.code || detail?.type);
  const guidance: Record<string, string> = {
    credit_balance_exhausted:
      "No API credits remain on this connection's provider account. Add API credits or use a funded API key, then test again.",
    insufficient_quota:
      "The API account's quota or spending limit is exhausted. Check the provider's API billing and limits, then test again.",
    rate_limit_exceeded:
      "The provider's rate limit was reached. Wait and retry, or reduce concurrent model calls.",
    invalid_api_key:
      "The provider rejected this API key. Edit the connection and save a valid key.",
    authentication_error:
      "The provider could not authenticate this connection. Check its API key.",
    model_not_found:
      "This model is unavailable to the saved API key. Check the model ID and the key's model access.",
  };
  const message =
    guidance[code] ||
    redact(typeof detail === "string" ? detail : detail?.message);
  return new Error(
    `${provider.name}: ${message || "The provider rejected the request. Check the endpoint, API key, model, and supported settings."}${code ? ` [${code}]` : ""}${status ? ` (HTTP ${status})` : ""}`,
  );
}

async function errorPayload(response: Response) {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 16_384) return undefined;
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return undefined;
  } finally {
    // A transport can leave cancellation pending (notably while a model turn
    // is paused for approval). Start cleanup without blocking iterator return.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function* complete(
  provider: Provider,
  request: CompletionRequest,
): AsyncGenerator<Chunk> {
  if (provider.kind === "opencode")
    throw new Error(
      "OpenCode requires a coding-worker running in your project.",
    );
  if (provider.kind === "demo") {
    yield* demo(request);
    return;
  }
  const base = validateEndpoint(provider.baseUrl);
  const system = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const messages = request.messages.filter((m) => m.role !== "system");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let suffix = "/chat/completions";
  let body: any = {
    model: provider.model,
    messages: request.messages,
    stream: true,
    max_tokens: request.maxTokens,
  };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  if (provider.kind === "ollama") {
    suffix = "/api/chat";
    body = {
      model: provider.model,
      messages: request.messages,
      stream: true,
      ...(provider.reasoning ? { think: true } : {}),
      options: { num_predict: request.maxTokens },
    };
  }
  if (provider.kind === "openai") {
    suffix = "/responses";
    body = {
      model: provider.model,
      instructions: system,
      input: messages,
      stream: true,
      store: false,
      max_output_tokens: request.maxTokens,
      ...(provider.reasoning ? { reasoning: { summary: "auto" } } : {}),
    };
  }
  if (provider.kind === "anthropic") {
    suffix = "/messages";
    delete headers.Authorization;
    headers["x-api-key"] = provider.apiKey || "";
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: provider.model,
      system,
      messages,
      stream: true,
      max_tokens: request.maxTokens,
      ...(provider.reasoning ? { thinking: { type: "adaptive" } } : {}),
    };
  }
  if (provider.kind === "glm")
    body.thinking = { type: provider.reasoning ? "enabled" : "disabled" };
  const response = await fetch(base + suffix, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
    redirect: "error",
  });
  if (!response.ok || !response.body) {
    throw providerError(
      provider,
      await errorPayload(response),
      response.status,
    );
  }
  let finished = false,
    total = 0;
  for await (const part of streamJson(
    response.body,
    provider.kind === "ollama",
    request.signal,
  )) {
    if (part.error || part.type === "error" || part.type === "response.failed")
      throw providerError(provider, part);
    if (part.type === "response.incomplete")
      throw new Error(
        `${provider.name}: output was incomplete; raise the per-call output limit.`,
      );
    const text =
      provider.kind === "ollama"
        ? part.message?.content
        : provider.kind === "openai"
          ? part.type === "response.output_text.delta"
            ? part.delta
            : ""
          : provider.kind === "anthropic"
            ? part.delta?.type === "text_delta"
              ? part.delta.text
              : ""
            : part.choices?.[0]?.delta?.content;
    const reasoning =
      provider.kind === "ollama"
        ? part.message?.thinking
        : provider.kind === "openai"
          ? part.type === "response.reasoning_summary_text.delta"
            ? part.delta
            : ""
          : provider.kind === "anthropic"
            ? part.delta?.type === "thinking_delta"
              ? part.delta.thinking
              : ""
            : part.choices?.[0]?.delta?.reasoning_content;
    for (const [type, value] of [
      ["text", text],
      ["reasoning", reasoning],
    ] as const)
      if (typeof value === "string" && value) {
        total += value.length;
        if (total > 240_000)
          throw new Error("Provider output exceeded the stream limit.");
        yield { type, text: value };
      }
    const stop = part.choices?.[0]?.finish_reason || part.delta?.stop_reason;
    if (
      stop === "length" ||
      stop === "max_tokens" ||
      part.done_reason === "length"
    )
      throw new Error(
        `${provider.name}: output token limit reached; raise the per-call output limit.`,
      );
    if (
      part.done ||
      part.__done ||
      part.type === "response.completed" ||
      part.type === "message_stop" ||
      stop
    )
      finished = true;
    const usage = part.usage || part.response?.usage;
    if (usage)
      yield {
        type: "usage",
        input: usage.input_tokens ?? usage.prompt_tokens,
        output: usage.output_tokens ?? usage.completion_tokens,
      };
    if (part.done && provider.kind === "ollama")
      yield {
        type: "usage",
        input: part.prompt_eval_count,
        output: part.eval_count,
      };
  }
  if (!finished)
    throw new Error(`${provider.name}: stream ended before completion.`);
}

async function* demo(request: CompletionRequest): AsyncGenerator<Chunk> {
  const system = request.messages[0].content;
  const user = request.messages.at(-1)!.content;
  const turn = Number(/TURN: (\d+)/.exec(system)?.[1] || 1);
  const depth = Number(/DEPTH: (\d+)/.exec(system)?.[1] || 0);
  const name = /NAME: ([^\n]+)/.exec(system)?.[1] || "Peer";
  const boardText = user
    .split("LIVE SHARED BOARD (findings may be truncated):\n")[1]
    ?.split("\n\n")[0];
  const board = boardText
    ? JSON.parse(boardText)
    : { peers: [], candidate: null };
  const candidate = board.candidate;
  const finding = board.sharedKnowledge?.findings?.find(
    (f: any) => f.key === "message-delivery",
  );
  const first = board.peers[0]?.name === name;
  const answer =
    "## A team that works together\n\nThis is a **scripted demonstration**, not an LLM-generated answer to your goal.\n\nThe peers chose responsibilities, exchanged findings, delegated a specialist, and resolved a concrete disagreement. No permanent coordinator was assigned.\n\n### What the team established\nAgent activity streams live. Messages arriving during generation reach the recipient on its next model turn. The initial assumption was challenged, rechecked, and corrected; both parties accepted the revised finding.\n\n### Shared understanding\n- Reuse established evidence instead of repeating investigations.\n- Ask peers directly to check a specific disagreement.\n- Any peer can propose an answer; every peer can challenge it.\n- Preserve unresolved objections when a resource budget ends.\n\nConnect real models in **Connections**, add them to the model pool, and choose any starting agent count to work on your actual goal. Agreement is not proof of correctness.";
  let text: string;
  if (!system.includes("PHASE:") && !boardText)
    text = "Connected — scripted demo only.";
  else if (system.includes("PHASE: synthesis")) text = answer;
  else if (
    finding?.revision === 1 &&
    board.peers[1]?.name === name &&
    !finding.challenges.some((c: any) => c.agent === board.peers[1].id)
  )
    text =
      "I disagree with the message-delivery claim. The provider receives a fixed prompt per request. Visible live activity does not mean that a running generation can read new messages. Let us recheck that boundary. This is a scripted demonstration of a peer challenge.\n\n```council\n" +
      JSON.stringify({
        disputes: [
          {
            findingId: finding.id,
            reason:
              "The current provider request has a fixed prompt; live display is not mid-generation input.",
            recheck:
              "Inspect when the provider request is constructed and when inbox messages are drained.",
          },
        ],
      }) +
      "\n```";
  else if (finding?.state === "disputed" && finding.revision === 1 && first)
    text =
      "The objection is valid. The request snapshots its input; incoming messages enter the next turn. I am correcting the finding and accepting the revised version.\n\n```council\n" +
      JSON.stringify({
        revisions: [
          {
            findingId: finding.id,
            claim:
              "Agent activity streams live. Messages arriving during generation are delivered on the recipient’s next model turn.",
            evidence: [
              "Scripted protocol check: each request body is constructed once; the inbox is drained at the beginning of the next turn.",
            ],
          },
        ],
        acceptances: [
          {
            findingId: finding.id,
            revision: 2,
            reason:
              "The request boundary supports this correction. I accept revision 2.",
          },
        ],
      }) +
      "\n```";
  else if (
    finding?.revision === 2 &&
    finding.state === "disputed" &&
    board.peers[1]?.name === name
  )
    text =
      "The revised finding resolves my objection: live display and message delivery are separate. I accept the same revised evidence. We can reuse this conclusion without another check.\n\n```council\n" +
      JSON.stringify({
        acceptances: [
          {
            findingId: finding.id,
            revision: 2,
            reason:
              "Revision 2 correctly explains next-turn delivery. This resolves the contradiction.",
          },
        ],
      }) +
      "\n```";
  else if (candidate && (!finding || finding.revision === 2))
    text =
      "I checked the proposal against the shared evidence. It preserves the corrected finding and distinguishes a scripted workflow from real model quality. I endorse this qualified answer.\n\n```council\n" +
      JSON.stringify({
        review: {
          candidateId: candidate.id,
          agree: true,
          reason:
            "The answer incorporates the shared correction and explicitly limits its claims to this scripted demonstration.",
        },
      }) +
      "\n```";
  else if (first && turn === 1 && !finding)
    text =
      "I will examine the goal and acceptance criteria. I am publishing an initial assumption for teammates to challenge and asking a specialist to check what this demonstration proves. All content in this run is scripted.\n\n```council\n" +
      JSON.stringify({
        findings: [
          {
            key: "message-delivery",
            claim:
              "Peers can receive new input inside a model response that is already generating.",
            evidence: [
              "Scripted initial assumption for demonstrating a disagreement; this will be rechecked.",
            ],
          },
        ],
        organization: { role: "Goal and acceptance reviewer", reportsTo: null },
        delegates: [
          {
            name: "Verifier",
            role: "Evidence reviewer",
            task: "Check what this demonstration can and cannot prove.",
          },
        ],
        messages: [
          {
            to: "all",
            content:
              "Challenge my message-delivery assumption against the actual request boundary.",
          },
        ],
      }) +
      "\n```\n\nThe specialist starts as soon as its request block arrives.";
  else if (depth > 0 && turn === 1)
    text =
      "Specialist finding: message delivery demonstrates orchestration, not answer quality. Do not repeat that distinction as a new investigation; reuse it in the conclusion. This is scripted demo evidence.";
  else if (
    finding?.state === "established" &&
    finding.revision === 2 &&
    turn >= 2
  )
    text =
      "The shared finding has been corrected and accepted by both parties. I propose a final answer based on that evidence.\n\n```council\n" +
      JSON.stringify({
        proposal: {
          answer,
          rationale:
            "Both disputants accepted revision 2. The answer incorporates that result and preserves the demo limitation.",
        },
      }) +
      "\n```";
  else if (board.peers.length === 1 && turn >= 2)
    text =
      "I propose a qualified answer for this single-peer demo.\n\n```council\n" +
      JSON.stringify({
        proposal: {
          answer,
          rationale: "Single-peer scripted demonstration only.",
        },
      }) +
      "\n```";
  else
    text =
      "I am following the shared findings and the current recheck. I will reuse the result once the involved peers have accepted it, rather than repeat their investigation. This is scripted demo activity.";
  for (const token of text.match(/.{1,28}|\n/g) || []) {
    request.signal.throwIfAborted();
    await new Promise((r) =>
      setTimeout(r, Number(process.env.DEMO_DELAY_MS ?? 18)),
    );
    yield { type: "text", text: token };
  }
}
