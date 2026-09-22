import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Command,
  Copy,
  Download,
  FileText,
  GitBranch,
  Globe,
  Layers,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  Network,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  CouncilEvent,
  Member,
  Provider,
  ProviderKind,
  Run,
  RunConfig,
  User,
} from "../shared/types";
import { api } from "./api";
import type { Finding, Work } from "../server/knowledge";
import type { Assessment } from "../server/adaptation";

const names = ["Atlas", "Sage", "Echo"];
const defaults = (providers: Provider[]): RunConfig => ({
  providerIds: [
    providers.find((p) => p.kind !== "demo")?.id || providers[0]?.id || "",
  ].filter(Boolean),
  members: names.map((name, i) => ({
    id: `peer-${i + 1}`,
    name,
    role: "Choose a useful specialization for this goal",
    providerId:
      providers.find((p) => p.kind !== "demo")?.id || providers[0]?.id || "",
  })),
  concurrency: 1,
  maxAgents: 12,
  maxDepth: 3,
  maxCalls: 24,
  maxOutputTokens: 4096,
  maxMinutes: 20,
});
const busy = (run?: Run | null) =>
  !!run && ["queued", "running"].includes(run.status);
const clean = (text: string) =>
  text.replace(/```council[\s\S]*?(?:```|$)/g, "").trim();
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`mark ${small ? "small" : ""}`}>
      <i />
      <i />
      <i />
    </span>
  );
}
function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>[Image: {alt}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Auth({ onUser }: { onUser: (user: User) => void }) {
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState({ signup: true, inviteRequired: false });
  useEffect(() => {
    api("/info")
      .then(setInfo)
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api(
        `/auth/${signup ? "signup" : "login"}`,
        "POST",
        values,
      );
      onUser(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="auth-page">
      <header className="auth-top">
        <span className="brand">
          <Mark small /> council<span className="beta">preview</span>
        </span>
        <span className="muted">Independent minds. Shared understanding.</span>
      </header>
      <div className="auth-content">
        <div className="auth-story">
          <div className="eyebrow">
            <span className="status-dot" /> YOUR MODELS, WORKING TOGETHER
          </div>
          <h1>
            One goal.
            <br />A team of <em>minds.</em>
          </h1>
          <p>
            Give your models a shared workspace. Watch them exchange findings,
            challenge assumptions, and work toward a better answer.
          </p>
          <div className="orbit">
            <div className="orbit-line" />
            <div className="orbit-node n1">
              <Sparkles size={19} />
              <span>Explore</span>
            </div>
            <div className="orbit-node n2">
              <MessageSquare size={19} />
              <span>Discuss</span>
            </div>
            <div className="orbit-center">
              <Mark />
            </div>
            <div className="orbit-node n3">
              <GitBranch size={19} />
              <span>Delegate</span>
            </div>
            <div className="orbit-node n4">
              <ShieldCheck size={19} />
              <span>Challenge</span>
            </div>
          </div>
          <div className="provider-strip">
            OLLAMA <span>·</span> vLLM <span>·</span> OPENAI <span>·</span>{" "}
            CLAUDE <span>·</span> GLM
          </div>
        </div>
        <div className="auth-card">
          <div className="eyebrow">WELCOME TO COUNCIL</div>
          <h2>{signup ? "Create your workspace" : "Enter your workspace"}</h2>
          <p className="muted">
            Your conversations, models, and team. In one place.
          </p>
          <form onSubmit={submit}>
            {signup && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Alex"
                  required
                  maxLength={60}
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                placeholder="At least 10 characters"
                minLength={10}
                maxLength={200}
                required
              />
            </label>
            {signup && info.inviteRequired && (
              <label>
                Invitation code
                <input name="inviteCode" required />
              </label>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary auth-submit" disabled={loading}>
              {loading ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {signup ? "Create account" : "Sign in"}
                  <ArrowUpRight size={18} />
                </>
              )}
            </button>
          </form>
          {info.signup && (
            <p className="auth-switch">
              {signup ? "Already have a workspace?" : "New to Council?"}{" "}
              <button
                onClick={() => {
                  setSignup(!signup);
                  setError("");
                }}
              >
                {signup ? "Sign in" : "Create an account"}
              </button>
            </p>
          )}
          <div className="auth-note">
            <ShieldCheck size={15} /> Private sessions · Bring your own models
          </div>
        </div>
      </div>
      <footer className="auth-footer">
        <span>Built for open collaboration.</span>
        <span>Personal project · v0.1</span>
      </footer>
    </div>
  );
}

interface Turn {
  id: string;
  agentId: string;
  name: string;
  role: string;
  phase: string;
  model: string;
  text: string;
  reasoning: string;
  done: boolean;
  error?: string;
  input?: number;
  output?: number;
  at: string;
}
function activity(events: CouncilEvent[]) {
  const turns = new Map<string, Turn>();
  const items: (
    { type: "turn"; id: string } | { type: "event"; event: CouncilEvent }
  )[] = [];
  for (const event of events) {
    const d = event.data;
    if (event.type === "turn.start") {
      turns.set(d.turnId, {
        id: d.turnId,
        agentId: d.agentId,
        name: d.name,
        role: d.role,
        phase: d.phase,
        model: d.model,
        text: "",
        reasoning: "",
        done: false,
        at: event.at,
      });
      items.push({ type: "turn", id: d.turnId });
    }
    if (event.type === "turn.delta") {
      const t = turns.get(d.turnId);
      if (t) t.text += d.text;
    }
    if (event.type === "turn.reasoning") {
      const t = turns.get(d.turnId);
      if (t) t.reasoning += d.text;
    }
    if (event.type === "turn.done") {
      const t = turns.get(d.turnId);
      if (t) {
        t.done = true;
        t.text = d.text;
        t.input = d.inputTokens;
        t.output = d.outputTokens;
      }
    }
    if (event.type === "turn.error") {
      const t = turns.get(d.turnId);
      if (t) {
        t.done = true;
        t.error = d.message;
      }
    }
    if (
      [
        "agent.message",
        "agent.spawn",
        "agent.organization",
        "candidate.proposed",
        "candidate.review",
        "budget.limit",
        "warning",
        "tool.result",
        "coding.activity",
        "tool.error",
        "file.proposal",
        "file.resolved",
        "finding.updated",
        "finding.reused",
        "work.updated",
        "work.reused",
        "work.reassigned",
        "agent.assessment",
        "agent.reassigned",
        "agent.unavailable",
      ].includes(event.type)
    )
      items.push({ type: "event", event });
  }
  return { turns, items };
}
function CodingCard({
  event,
  who,
  answered,
  active,
}: {
  event: CouncilEvent;
  who: string;
  answered: boolean;
  active: boolean;
}) {
  const d = event.data;
  const [sent, setSent] = useState(false),
    [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const pending = ["permission", "question"].includes(d.kind);
  async function reply(allow: boolean) {
    setBusy(true);
    setError("");
    try {
      await api(`/coding/jobs/${encodeURIComponent(d.jobId)}/reply`, "POST", {
        id: d.id,
        kind: d.kind,
        reply: allow ? "once" : "reject",
        ...(d.kind === "question" && allow
          ? {
              answers: (d.questions || []).map((_: unknown, i: number) =>
                (answers[i] || "")
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              ),
            }
          : {}),
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="candidate-card coding-card" open={pending}>
      <summary>
        <Terminal size={16} />
        <b>{who}</b> · {d.title}{" "}
        <span className="tiny-tag">
          {d.kind} · {d.status || ""}
        </span>
      </summary>
      <pre>{d.detail}</pre>
      <span className="field-help">OpenCode session {d.sessionId}</span>
      {pending &&
        (answered || sent ? (
          <p>Response sent.</p>
        ) : !active ? (
          <p>
            This run has ended. Continue the session to request new tool
            actions.
          </p>
        ) : (
          <div>
            {d.kind === "question" &&
              (d.questions || []).map((q: any, i: number) => (
                <label className="coding-question" key={i}>
                  {q.question}
                  <span className="field-help">
                    {q.options.join(" · ")}
                    {q.multiple ? " — enter one answer per line" : ""}
                  </span>
                  <textarea
                    aria-label={q.question}
                    value={answers[i] || ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [i]: e.target.value })
                    }
                  />
                </label>
              ))}
            <div className="modal-actions">
              <button
                className="quiet-button"
                disabled={busy}
                onClick={() => reply(false)}
              >
                Reject
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  (d.kind === "question" &&
                    (d.questions || []).some(
                      (_: unknown, i: number) => !answers[i]?.trim(),
                    ))
                }
                onClick={() => reply(true)}
              >
                {d.kind === "permission" ? "Allow once" : "Send answer"}
              </button>
            </div>
          </div>
        ))}
      {error && <p className="error">{error}</p>}
    </details>
  );
}
function EventCard({
  event,
  members,
  codingAnswered = false,
  active = false,
}: {
  event: CouncilEvent;
  members: Member[];
  codingAnswered?: boolean;
  active?: boolean;
}) {
  const d = event.data;
  const who = (id: string) =>
    members.find((m) => m.id === id)?.name || (id === "all" ? "Everyone" : id);
  if (event.type === "coding.activity")
    return (
      <CodingCard
        event={event}
        who={who(d.agentId)}
        answered={codingAnswered}
        active={active}
      />
    );
  if (event.type === "agent.assessment")
    return (
      <div className="review-event">
        <Users size={15} />
        <div>
          <b>
            {who(d.assessment.observer)} assessed {who(d.assessment.agentId)} ·{" "}
            {d.assessment.domain}
          </b>
          <p>{d.assessment.reason}</p>
          <span className="delivery">
            Peer assessment · linked finding evidence
          </span>
        </div>
      </div>
    );
  if (event.type === "agent.reassigned")
    return (
      <div className="system-event">
        <GitBranch size={15} />
        <span>
          <b>{d.name}</b> continued on <b>{d.model}</b> after a provider
          failure. Findings and inbox preserved.
        </span>
      </div>
    );
  if (event.type === "agent.unavailable")
    return (
      <div className="system-event amber">
        <CircleDot size={15} />
        <span>
          {d.name} is unavailable. {d.reason}
        </span>
      </div>
    );
  if (event.type === "work.reassigned")
    return (
      <div className="system-event">
        <GitBranch size={15} />
        <span>
          <b>{who(d.from)}</b> → <b>{who(d.to)}</b>: {d.work.description}.{" "}
          {d.reason}
        </span>
      </div>
    );
  if (event.type === "finding.updated")
    return (
      <div
        className={`system-event ${d.finding.state === "disputed" ? "amber" : ""}`}
      >
        <ShieldCheck size={15} />
        <span>
          <b>{d.finding.key}</b> ·{" "}
          {d.finding.state === "disputed"
            ? "Disputed — targeted recheck open"
            : "Agent-established finding"}{" "}
          · revision {d.finding.revision}
        </span>
      </div>
    );
  if (event.type === "finding.reused" || event.type === "work.reused")
    return (
      <div className="system-event">
        <Check size={15} />
        <span>{d.message}</span>
      </div>
    );
  if (event.type === "work.updated")
    return (
      <div className="system-event">
        <GitBranch size={15} />
        <span>
          <b>{who(d.work.owner)}</b>{" "}
          {d.work.state === "claimed" ? "claimed" : "completed"}{" "}
          {d.work.description}
        </span>
      </div>
    );
  if (event.type === "agent.message")
    return (
      <div
        className={`engagement ${d.kind === "challenge" ? "challenge" : ""}`}
      >
        <MessageSquare size={15} />
        <div>
          <div className="engagement-meta">
            <b>{d.name}</b>
            <span>→</span>
            <b>{who(d.to)}</b>
            <span className="tiny-tag">
              {d.kind === "task"
                ? "delegated task"
                : d.kind === "challenge"
                  ? "challenge"
                  : "engagement"}
            </span>
          </div>
          <p>{d.content}</p>
          <span className="delivery">{d.delivery}</span>
        </div>
      </div>
    );
  if (event.type === "agent.spawn")
    return (
      <div className="system-event">
        <GitBranch size={15} />
        <span>
          <b>{who(d.parentId)}</b> invited <b>{d.name}</b> · {d.task}
        </span>
      </div>
    );
  if (event.type === "agent.organization")
    return (
      <div className="system-event">
        <Users size={15} />
        <span>
          <b>{d.name}</b> chose {d.role}
          {d.reportsTo ? ` · reporting to ${who(d.reportsTo)}` : ""}
        </span>
      </div>
    );
  if (event.type === "candidate.review")
    return (
      <div className={`review-event ${d.agree ? "" : "challenge"}`}>
        <ShieldCheck size={16} />
        <div>
          <b>
            {d.name} {d.agree ? "endorsed" : "challenged"} the proposed answer
          </b>
          <p>{d.reason}</p>
        </div>
      </div>
    );
  if (event.type === "candidate.proposed")
    return (
      <details className="candidate-card">
        <summary>
          <Layers size={16} />
          <span>
            <b>{d.name}</b> proposed an answer
          </span>
          <span className="tiny-tag">peer review</span>
          <ChevronDown size={15} />
        </summary>
        <p className="muted">{d.rationale}</p>
        <Markdown>{d.answer}</Markdown>
      </details>
    );
  if (event.type === "tool.result")
    return (
      <details className="candidate-card">
        <summary>
          <FileText size={16} />
          {who(d.agentId)} · {d.tool} {d.path || ""}
        </summary>
        <pre>
          {typeof d.result === "string"
            ? d.result
            : JSON.stringify(d.result, null, 2)}
        </pre>
      </details>
    );
  if (event.type === "file.proposal")
    return (
      <div className="system-event">
        <FileText size={15} />
        <span>
          {who(d.agentId)} proposed <b>{d.path}</b>. Review it in Workspace
          files.
        </span>
      </div>
    );
  if (event.type === "file.resolved")
    return (
      <div className="system-event">
        <Check size={15} />
        <span>
          {d.path} · {d.status}
        </span>
      </div>
    );
  return (
    <div className="system-event amber">
      <CircleDot size={15} />
      {d.message}
    </div>
  );
}
function TurnCard({ turn, index }: { turn: Turn; index: number }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <article className={`turn-card ${turn.error ? "failed" : ""}`}>
      <div className="turn-heading">
        <span className={`avatar color-${index % 3}`}>
          {turn.name.charAt(0)}
        </span>
        <button className="turn-toggle" onClick={() => setExpanded(!expanded)}>
          <b>{turn.name}</b>
          <span className="model-label">{turn.model}</span>
          <ChevronDown size={14} className={!expanded ? "rotate" : ""} />
        </button>
        <span className="turn-phase">{turn.phase}</span>
        {!turn.done ? (
          <LoaderCircle size={14} className="spin green" />
        ) : turn.error ? (
          <X size={14} className="amber" />
        ) : (
          <Check size={14} className="muted" />
        )}
      </div>
      {expanded && (
        <div className="turn-body">
          {turn.reasoning && (
            <details className="thinking">
              <summary>
                <Sparkles size={14} /> Provider reasoning / summary
                <ChevronDown size={13} />
              </summary>
              <Markdown>{turn.reasoning}</Markdown>
            </details>
          )}
          {clean(turn.text) ? (
            <Markdown>{clean(turn.text)}</Markdown>
          ) : (
            <span className="muted thinking-label">
              {turn.done
                ? turn.error
                  ? "No completed contribution."
                  : "Published team actions."
                : "Working on the shared goal…"}
            </span>
          )}
          {turn.error && <p className="error">{turn.error}</p>}
          {turn.done &&
            (turn.input !== undefined || turn.output !== undefined) && (
              <div className="token-usage">
                {turn.input?.toLocaleString() ?? "—"} input ·{" "}
                {turn.output?.toLocaleString() ?? "—"} output tokens
              </div>
            )}
        </div>
      )}
    </article>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<CouncilEvent[]>([]);
  const [config, setConfig] = useState<RunConfig>(defaults([]));
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState("discussion");
  const [modal, setModal] = useState<
    "connections" | "team" | "files" | "cli" | "benchmarks" | null
  >(null);
  const [sidebar, setSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const runRef = useRef<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  useEffect(() => {
    api("/me")
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        runRef.current = null;
        setRun(null);
        setEvents([]);
        setPrompt("");
        setSidebar(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function loadProviders(initial = false) {
    const ps = await api<Provider[]>("/providers");
    setProviders(ps);
    if (initial) {
      const saved = await api<RunConfig | null>("/team");
      setConfig(
        saved && saved.providerIds.every((id) => ps.some((p) => p.id === id))
          ? saved
          : defaults(ps),
      );
    }
    return ps;
  }
  useEffect(() => {
    if (user) {
      loadProviders(true).catch((e) => setError(e.message));
      api<Run[]>("/runs")
        .then(setRuns)
        .catch((e) => setError(e.message));
    }
  }, [user]);
  async function openRun(id: string) {
    runRef.current = id;
    setSidebar(false);
    setError("");
    const data = await api(`/runs/${id}`);
    if (runRef.current !== id) return;
    setRun(data.run);
    setConfig(data.run.config);
    setEvents(data.events);
    setTab("discussion");
    follow.current = true;
  }
  const runId = run?.id;
  useEffect(() => {
    if (!runId) return;
    let last = 0;
    const source = new EventSource(`/api/runs/${runId}/events`);
    setStreamError(false);
    source.onopen = () => setStreamError(false);
    source.onerror = () => setStreamError(true);
    source.onmessage = (message) => {
      const event: CouncilEvent = JSON.parse(message.data);
      if (event.id <= last) return;
      last = event.id;
      setEvents((old) =>
        old.some((e) => e.id === event.id) ? old : [...old, event],
      );
      if (event.type === "run.status") {
        setRun((old) =>
          old?.id === runId ? { ...old, status: event.data.status } : old,
        );
        api<Run[]>("/runs")
          .then(setRuns)
          .catch(() => {});
        if (!["queued", "running"].includes(event.data.status)) {
          source.close();
          setStreamError(false);
        }
      }
      if (event.type === "run.final")
        setRun((old) =>
          old?.id === runId ? { ...old, final: event.data.text } : old,
        );
    };
    return () => source.close();
  }, [runId]);
  useEffect(() => {
    if (follow.current)
      bottom.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [events.length, tab]);
  const view = useMemo(() => activity(events), [events]);
  const members = useMemo(() => {
    const result = new Map<string, Member>(
      (run?.config.members || config.members).map((m) => [m.id, m]),
    );
    for (const e of events)
      if (
        [
          "agent.spawn",
          "agent.join",
          "agent.organization",
          "agent.reassigned",
        ].includes(e.type)
      )
        result.set(e.data.id, {
          ...result.get(e.data.id),
          ...e.data,
        } as Member);
    return [...result.values()];
  }, [events, run, config]);
  const knowledge = useMemo(() => {
    const findings = new Map<string, Finding>();
    const work = new Map<string, Work>();
    for (const e of events) {
      if (e.type === "finding.updated")
        findings.set(e.data.finding.id, e.data.finding);
      if (e.type === "work.updated") work.set(e.data.work.key, e.data.work);
    }
    return {
      findings: [...findings.values()],
      work: [...work.values()],
      assessments: events
        .filter((e) => e.type === "agent.assessment")
        .map((e) => e.data.assessment as Assessment),
    };
  }, [events]);
  const phase =
    [...events].reverse().find((e) => e.type === "phase")?.data.name ||
    "Ready when you are";
  const active = busy(run);
  const demo = config.providerIds.every(
    (id) => providers.find((p) => p.id === id)?.kind === "demo",
  );
  async function start(goal = prompt) {
    if (!goal.trim()) return;
    setError("");
    setSending(true);
    try {
      const next = await api<Run>("/runs", "POST", {
        prompt: goal,
        config,
        ...(run && !active ? { parentId: run.id } : {}),
      });
      runRef.current = next.id;
      setRun(next);
      setEvents([]);
      setPrompt("");
      setTab("discussion");
      setRuns((old) => [next, ...old]);
      follow.current = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  function fresh() {
    runRef.current = null;
    setRun(null);
    setEvents([]);
    setPrompt("");
    setSidebar(false);
    setError("");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(run?.final || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard unavailable. Use Export to save the answer.");
    }
  }
  function download() {
    if (!run) return;
    const text =
      `# ${run.title}\n\n${run.final}\n\n---\n\n## Team transcript\n\n` +
      [...view.turns.values()]
        .map((t) => `### ${t.name} · ${t.model}\n\n${clean(t.text)}`)
        .join("\n\n") +
      "\n\n## Engagement\n\n" +
      events
        .filter((e) => e.type === "agent.message")
        .map((e) => `${e.data.name} → ${e.data.to}: ${e.data.content}`)
        .join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `council-${run.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
  if (checking)
    return (
      <div className="loading-page">
        <Mark />
        <span>Opening your workspace…</span>
      </div>
    );
  if (!user) return <Auth onUser={setUser} />;
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-shade"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <div className="brand">
          <Mark small /> council <span className="beta">preview</span>
        </div>
        <button className="new-session" onClick={fresh}>
          <Plus size={17} /> New session <kbd>⌘ K</kbd>
        </button>
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search sessions"
            placeholder="Search sessions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span>/</span>
        </label>
        <div className="sidebar-label">WORKSPACE</div>
        <button
          className={`nav-button ${!run ? "selected" : ""}`}
          onClick={fresh}
        >
          <Layers size={16} /> Overview
        </button>
        <button className="nav-button" onClick={() => setModal("connections")}>
          <Network size={16} /> Connections{" "}
          <span className="count">
            {providers.filter((p) => p.kind !== "demo").length}
          </span>
        </button>
        <button className="nav-button" onClick={() => setModal("benchmarks")}>
          <ShieldCheck size={16} /> Benchmarks
        </button>
        <button className="nav-button" onClick={() => setModal("files")}>
          <FileText size={16} /> Workspace files
        </button>
        <div className="sidebar-label sessions-label">
          RECENT SESSIONS <span>{runs.length}</span>
        </div>
        <div className="session-list">
          {runs
            .filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))
            .map((r) => (
              <button
                key={r.id}
                onClick={() => openRun(r.id).catch((e) => setError(e.message))}
                className={`session-link ${r.id === run?.id ? "selected" : ""}`}
              >
                <MessageSquare size={14} />
                <span>{r.title}</span>
                {busy(r) && <span className="status-dot" />}
              </button>
            ))}
          {!runs.length && (
            <p className="empty-sessions">Your next idea starts here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-button" onClick={() => setModal("cli")}>
            <Terminal size={16} /> Developer CLI <ArrowUpRight size={14} />
          </button>
          <div className="user-row">
            <span className="user-avatar">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <b>{user.name}</b>
              <span>Personal workspace</span>
            </div>
            <button
              title="Sign out"
              aria-label="Sign out"
              className="icon-button"
              onClick={async () => {
                await api("/auth/logout", "POST");
                setUser(null);
                fresh();
                setRuns([]);
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Open navigation"
            onClick={() => setSidebar(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{run ? run.title : "New session"}</b>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <ShieldCheck size={14} /> Private
            </span>
            <button
              aria-label="Configure team"
              className="quiet-button"
              onClick={() => setModal("team")}
            >
              <Settings2 size={15} />
              <span>Configure team</span>
            </button>
          </div>
        </header>
        <div className="workspace">
          <section className={`conversation ${run ? "has-run" : ""}`}>
            {!run ? (
              <div className="welcome">
                <div className="welcome-eyebrow">
                  <span className="status-dot" /> COLLABORATIVE INTELLIGENCE
                </div>
                <h1>
                  One goal.
                  <br />
                  <span>More perspectives.</span>
                </h1>
                <p>
                  Bring your models to the same table.
                  <br />
                  Let them explore, challenge, and build an answer together.
                </p>
                <div className="welcome-team">
                  <div className="stacked-avatars">
                    {config.members.map((m, i) => (
                      <span key={m.id} className={`avatar color-${i % 3}`}>
                        {m.name.charAt(0)}
                      </span>
                    ))}
                  </div>
                  <span>
                    {config.members.length} peers · one shared conversation
                  </span>
                  <button
                    className="inline-link"
                    onClick={() => setModal("team")}
                  >
                    Customize <ArrowUpRight size={13} />
                  </button>
                </div>
                <div className="suggestions">
                  {[
                    {
                      icon: <GitBranch size={18} />,
                      title: "Think through a system",
                      prompt:
                        "Help me design a multi-model collaboration system. Challenge the architecture, identify tradeoffs, and propose a practical implementation.",
                    },
                    {
                      icon: <ShieldCheck size={18} />,
                      title: "Challenge an idea",
                      prompt:
                        "I want to launch a small software product. Help me define a useful validation process. Debate assumptions and identify the strongest evidence to gather.",
                    },
                    {
                      icon: <Search size={18} />,
                      title: "Understand the full picture",
                      prompt:
                        "Compare centralized and peer-to-peer agent orchestration. Explore strengths, limitations, and conditions where each works best.",
                    },
                  ].map((s) => (
                    <button key={s.title} onClick={() => setPrompt(s.prompt)}>
                      {s.icon}
                      <span>{s.title}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
                {demo && (
                  <div className="demo-note">
                    <Sparkles size={15} />
                    <span>
                      You’re set up for a scripted demo.{" "}
                      <button onClick={() => setModal("connections")}>
                        Connect a real model
                      </button>{" "}
                      to work on your goals.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="session-header">
                  <div className="session-title-row">
                    <div className="eyebrow">
                      SHARED GOAL{" "}
                      {run.demo && (
                        <span className="tiny-tag">SCRIPTED DEMO</span>
                      )}
                    </div>
                    <span className={`run-status ${run.status}`}>
                      {active && <span className="status-dot" />}
                      {run.status.replace("_", " ")}
                    </span>
                  </div>
                  <h1>{run.title}</h1>
                  <details className="goal-detail">
                    <summary>
                      View full goal <ChevronDown size={12} />
                    </summary>
                    <p>{run.prompt}</p>
                  </details>
                  <div className="session-tabs">
                    <button
                      className={tab === "discussion" ? "active" : ""}
                      onClick={() => setTab("discussion")}
                    >
                      <MessageSquare size={15} /> Discussion{" "}
                      <span>{view.turns.size}</span>
                    </button>
                    <button
                      className={tab === "engagement" ? "active" : ""}
                      onClick={() => setTab("engagement")}
                    >
                      <Network size={15} /> Engagement
                    </button>
                    <button
                      className={tab === "knowledge" ? "active" : ""}
                      onClick={() => setTab("knowledge")}
                    >
                      <ShieldCheck size={15} /> Findings{" "}
                      <span>{knowledge.findings.length}</span>
                    </button>
                    <button
                      className={tab === "answer" ? "active" : ""}
                      onClick={() => setTab("answer")}
                    >
                      <Layers size={15} /> Answer{" "}
                      {run.final && <span className="answer-ready" />}
                    </button>
                    <button
                      className="export-button"
                      onClick={download}
                      title="Export transcript"
                      aria-label="Export transcript"
                    >
                      <Download size={16} />
                    </button>
                  </div>
                </div>
                <div
                  className="transcript"
                  ref={list}
                  onScroll={() => {
                    const el = list.current;
                    if (el)
                      follow.current =
                        el.scrollHeight - el.scrollTop - el.clientHeight < 180;
                  }}
                  aria-live="off"
                >
                  {streamError && (
                    <div className="notice">
                      Reconnecting to live activity… Saved events will replay
                      automatically.
                    </div>
                  )}
                  {tab === "knowledge" ? (
                    <KnowledgePanel knowledge={knowledge} members={members} />
                  ) : tab === "answer" ? (
                    run.final ? (
                      <div className="final-answer">
                        <div className="final-heading">
                          <span>
                            <Mark small /> Council conclusion
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Copy answer"
                            onClick={copy}
                          >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                          </button>
                        </div>
                        <Markdown>{run.final}</Markdown>
                        <div className="answer-footnote">
                          Peer agreement reflects the team’s assessment. It is
                          not independent proof of correctness.
                        </div>
                      </div>
                    ) : (
                      <div className="waiting-answer">
                        <Layers size={30} />
                        <h3>
                          {active
                            ? "Understanding comes before the answer."
                            : "No final answer was produced."}
                        </h3>
                        <p>
                          {active
                            ? "Your team’s proposals, disagreements, and reviews are visible in Discussion."
                            : "Review the session’s errors, adjust your connections, and try again."}
                        </p>
                      </div>
                    )
                  ) : (
                    view.items
                      .filter(
                        (item) => tab !== "engagement" || item.type === "event",
                      )
                      .map((item, i) =>
                        item.type === "turn" ? (
                          <TurnCard
                            key={item.id}
                            turn={view.turns.get(item.id)!}
                            index={members.findIndex(
                              (m) => m.id === view.turns.get(item.id)!.agentId,
                            )}
                          />
                        ) : (
                          <EventCard
                            key={item.event.id}
                            event={item.event}
                            members={members}
                            active={active}
                            codingAnswered={events.some(
                              (e) =>
                                e.type === "coding.reply" &&
                                e.data.jobId === item.event.data.jobId &&
                                e.data.requestId === item.event.data.id,
                            )}
                          />
                        ),
                      )
                  )}
                  {!active &&
                    ["failed", "cancelled", "interrupted"].includes(
                      run.status,
                    ) && (
                      <div className="notice">
                        {[...events]
                          .reverse()
                          .find((e) => e.type === "run.status")?.data.message ||
                          `Session ${run.status}.`}
                      </div>
                    )}
                  {[
                    "needs_review",
                    "interrupted",
                    "failed",
                    "cancelled",
                  ].includes(run.status) && (
                    <button
                      className="continue-button"
                      onClick={async () => {
                        try {
                          const next = await api<Run>(
                            `/runs/${run.id}/continue`,
                            "POST",
                          );
                          runRef.current = next.id;
                          setRun(next);
                          setEvents([]);
                          setRuns((old) => [next, ...old]);
                          setTab("discussion");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <ArrowUpRight size={16} /> Continue with saved team &
                      findings
                    </button>
                  )}
                  {run.final && tab !== "answer" && (
                    <button
                      className="view-answer"
                      onClick={() => setTab("answer")}
                    >
                      <Check size={17} /> The council has a conclusion{" "}
                      <ArrowUpRight size={17} />
                    </button>
                  )}
                  <div ref={bottom} />
                </div>
              </>
            )}
            {error && (
              <div role="alert" className="error page-error">
                {error}
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="composer-wrap">
              <form
                className={`composer ${active ? "running" : ""}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  start();
                }}
              >
                <textarea
                  aria-label="Your goal"
                  placeholder={
                    active
                      ? "Your team is working on the shared goal…"
                      : run
                        ? "Ask a follow-up, or give the team a new direction…"
                        : "What would you like your council to work on?"
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={active}
                  maxLength={20000}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      if (!active) start();
                    }
                  }}
                />
                <div className="composer-controls">
                  <button
                    type="button"
                    className="composer-team"
                    onClick={() => setModal("team")}
                  >
                    <Users size={15} />
                    {config.members.length} peers
                    <ChevronDown size={12} />
                  </button>
                  <span className="composer-mode">
                    <span className="status-dot" />
                    {active ? phase : demo ? "Demo team" : "Open discussion"}
                  </span>
                  {active ? (
                    <button
                      type="button"
                      className="stop-button"
                      onClick={() =>
                        api(`/runs/${run!.id}/cancel`, "POST").catch((e) =>
                          setError(e.message),
                        )
                      }
                    >
                      <Square size={13} fill="currentColor" /> Stop
                    </button>
                  ) : (
                    <button
                      className="send-button"
                      aria-label="Start council"
                      disabled={!prompt.trim() || sending || !providers.length}
                    >
                      {sending ? (
                        <LoaderCircle size={19} className="spin" />
                      ) : (
                        <ArrowUp size={21} />
                      )}
                    </button>
                  )}
                </div>
              </form>
              <div className="composer-caption">
                <span>
                  Peers choose their roles. Evidence guides the answer.
                </span>
                <span>
                  Enter to send <kbd>↵</kbd>
                </span>
              </div>
            </div>
          </section>
          <aside className="team-panel">
            <div className="panel-heading">
              <span>THE COUNCIL</span>
              <button
                className="icon-button"
                aria-label="Configure team"
                onClick={() => setModal("team")}
              >
                <Settings2 size={15} />
              </button>
            </div>
            <p className="panel-subtitle">Independent peers. Shared context.</p>
            <div className="team-roster">
              {members.map((m, i) => {
                const working = [...view.turns.values()].some(
                  (t) => t.agentId === m.id && !t.done,
                );
                const provider = providers.find((p) => p.id === m.providerId);
                return (
                  <div className="peer-row" key={m.id}>
                    <span className={`avatar color-${i % 3}`}>
                      {m.name.charAt(0)}
                    </span>
                    <div>
                      <b>
                        {m.name}
                        {m.parentId && <GitBranch size={11} />}
                      </b>
                      <span>
                        {provider?.kind === "demo"
                          ? "Demo model"
                          : provider?.model || "Connection unavailable"}
                      </span>
                      <span className="peer-role">
                        {m.role ===
                        "Choose a useful specialization for this goal"
                          ? "Role emerges from the task"
                          : m.role}
                      </span>
                    </div>
                    <span
                      className={`peer-dot ${working && active ? "working" : ""}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="team-note">
              <Network size={16} />
              <p>
                Every peer can talk, delegate, challenge, or propose an answer.
                No permanent leader. Established evidence is shared to avoid
                duplicate checks.
              </p>
            </div>
            <div className="panel-section">
              <div className="panel-heading">
                SESSION LIMITS
                <button
                  className="inline-link"
                  onClick={() => setModal("team")}
                >
                  Edit
                </button>
              </div>
              <dl>
                <div>
                  <dt>Maximum peers</dt>
                  <dd>{config.maxAgents ?? "No fixed cap"}</dd>
                </div>
                <div>
                  <dt>Model calls</dt>
                  <dd>
                    {view.turns.size} / {config.maxCalls}
                  </dd>
                </div>
                <div>
                  <dt>At once</dt>
                  <dd>{config.concurrency}</dd>
                </div>
                <div>
                  <dt>Time budget</dt>
                  <dd>{config.maxMinutes} min</dd>
                </div>
              </dl>
            </div>
            <div className="transparency">
              <Sparkles size={16} />
              <h4>Open by design</h4>
              <p>
                See public findings, peer engagement, and reasoning that each
                provider makes available.
              </p>
              <p>
                Messages received during generation enter the peer’s next turn.
              </p>
            </div>
            <div className="panel-bottom">
              <span className="status-dot" />{" "}
              {active ? "Live team activity" : "Ready to connect minds"}
              <span>v0.1</span>
            </div>
          </aside>
        </div>
      </main>
      {modal === "connections" && (
        <Connections
          close={() => setModal(null)}
          providers={providers}
          refresh={() => loadProviders()}
          onTeam={() => {
            setModal("team");
          }}
        />
      )}
      {modal === "team" && (
        <TeamSettings
          providers={providers}
          config={config}
          active={active}
          save={async (value) => {
            await api("/team", "PUT", value);
            setConfig(value);
            setModal(null);
          }}
          close={() => setModal(null)}
          connect={() => setModal("connections")}
        />
      )}
      {modal === "files" && <Files close={() => setModal(null)} />}
      {modal === "cli" && <CliModal close={() => setModal(null)} />}
      {modal === "benchmarks" && (
        <BenchmarkModal
          close={() => setModal(null)}
          providers={providers}
          config={config}
        />
      )}
    </div>
  );
}

const presets: Record<
  ProviderKind,
  { url: string; model: string; label: string }
> = {
  ollama: { url: "http://127.0.0.1:11434", model: "", label: "Ollama" },
  vllm: { url: "http://127.0.0.1:8000/v1", model: "", label: "vLLM" },
  openai: { url: "https://api.openai.com/v1", model: "", label: "OpenAI" },
  anthropic: {
    url: "https://api.anthropic.com/v1",
    model: "",
    label: "Claude",
  },
  glm: { url: "https://api.z.ai/api/paas/v4", model: "", label: "GLM / Z.ai" },
  compatible: {
    url: "http://127.0.0.1:8000/v1",
    model: "",
    label: "OpenAI-compatible",
  },
  opencode: {
    url: "http://127.0.0.1:4096",
    model: "",
    label: "OpenCode coding runtime",
  },
  demo: { url: "", model: "scripted-demo", label: "Scripted demo" },
};
function Connections({
  close,
  providers,
  refresh,
  onTeam,
}: {
  close: () => void;
  providers: Provider[];
  refresh: () => Promise<Provider[]>;
  onTeam: () => void;
}) {
  const [edit, setEdit] = useState<Provider | null>(null);
  const [show, setShow] = useState(false);
  const [kind, setKind] = useState<ProviderKind>("ollama");
  const [transport, setTransport] = useState<"direct" | "bridge">("direct");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [testId, setTestId] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(
        edit ? `/providers/${edit.id}` : "/providers",
        edit ? "PUT" : "POST",
        { ...data, kind, transport, reasoning: data.reasoning === "on" },
      );
      await refresh();
      setShow(false);
      setEdit(null);
      setStatus("Connection saved. Test it, then assign it to your team.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function test(p: Provider) {
    setTestId(p.id);
    setStatus("");
    setError("");
    try {
      const result = await api(`/providers/${p.id}/test`, "POST");
      setStatus(`${p.name}: ${result.text}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTestId("");
    }
  }
  return (
    <Modal title="Model connections" close={close} wide>
      <p className="modal-intro">
        Mix local models and cloud APIs. Keys are encrypted on the server and
        never returned to your browser.
      </p>
      <div className="connection-list">
        {providers.map((p) => (
          <div className="connection-item" key={p.id}>
            <span className="connection-icon">
              {p.kind === "demo" ? (
                <Sparkles size={18} />
              ) : ["ollama", "vllm"].includes(p.kind) ? (
                <Terminal size={18} />
              ) : (
                <Globe size={18} />
              )}
            </span>
            <div>
              <b>{p.name}</b>
              <span>
                {p.model} ·{" "}
                {p.transport === "bridge"
                  ? "Local bridge"
                  : presets[p.kind].label}
              </span>
            </div>
            <button
              className="quiet-button"
              disabled={!!testId}
              onClick={() => test(p)}
            >
              {testId === p.id ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                "Test"
              )}
            </button>
            <button
              className="icon-button"
              aria-label={`Edit ${p.name}`}
              onClick={() => {
                setEdit(p);
                setKind(p.kind);
                setTransport(p.transport);
                setShow(true);
                setError("");
              }}
            >
              <Settings2 size={16} />
            </button>
            <button
              className="icon-button"
              aria-label={`Delete ${p.name}`}
              onClick={async () => {
                try {
                  await api(`/providers/${p.id}`, "DELETE");
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      {status && (
        <div role="status" className="success">
          {status}
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {show ? (
        <form
          className="connection-form"
          key={edit?.id || "new"}
          onSubmit={submit}
        >
          <div className="form-grid">
            <label>
              Provider
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ProviderKind);
                  setTransport(
                    e.target.value === "opencode" ? "bridge" : "direct",
                  );
                }}
              >
                {Object.entries(presets).map(([value, p]) => (
                  <option key={value} value={value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Connection name
              <input
                name="name"
                required
                defaultValue={edit?.name || ""}
                placeholder="My local Qwen"
              />
            </label>
            <label>
              Model ID
              <input
                name="model"
                key={`model-${kind}`}
                required
                defaultValue={
                  edit?.kind === kind ? edit.model : presets[kind].model
                }
                placeholder="Exact model ID from your provider"
              />
            </label>
            <label>
              Connection type
              <select
                value={transport}
                disabled={kind === "opencode"}
                onChange={(e) =>
                  setTransport(e.target.value as "direct" | "bridge")
                }
              >
                {kind !== "opencode" && (
                  <option value="direct">Direct from this server</option>
                )}
                {["ollama", "vllm", "compatible", "opencode"].includes(
                  kind,
                ) && <option value="bridge">Bridge from my computer</option>}
              </select>
            </label>
            <label className="full">
              Base URL
              <input
                name="baseUrl"
                key={`url-${kind}`}
                defaultValue={
                  edit?.kind === kind ? edit.baseUrl : presets[kind].url
                }
                placeholder="https://provider.example/v1"
                required={kind !== "demo"}
              />
            </label>
            {transport === "direct" && kind !== "demo" && (
              <label className="full">
                API key{" "}
                {edit?.hasKey && (
                  <span className="muted">(leave blank to keep saved key)</span>
                )}
                <input
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    ["ollama", "vllm"].includes(kind)
                      ? "Optional for local models"
                      : "Your provider API key"
                  }
                />
              </label>
            )}
          </div>
          <label className="checkbox-label">
            <input
              name="reasoning"
              type="checkbox"
              defaultChecked={edit?.reasoning || false}
            />{" "}
            Request provider reasoning / summaries (model must support it)
          </label>
          {kind === "anthropic" && (
            <p className="field-help">
              Uses adaptive thinking when enabled. Leave off for models that do
              not support it.
            </p>
          )}
          {kind === "opencode" && (
            <div className="notice">
              Real coding in your chosen project, using OpenCode’s file,
              terminal, LSP and configured MCP tools. Enter a model in{" "}
              <code>provider/model</code> format from{" "}
              <code>opencode models</code>. Model credentials stay in OpenCode.
              Start <code>opencode serve --hostname 127.0.0.1 --port 4096</code>{" "}
              in the project, then connect the worker. Tool output is shared
              with this Council account; tool permissions appear in the
              discussion.
            </div>
          )}
          {transport === "bridge" && (
            <div className="notice">
              Save this connection, then run{" "}
              <code>
                {kind === "opencode"
                  ? "npm run cli -- coding-worker --provider CONNECTION_ID --url http://127.0.0.1:4096 --directory /absolute/project"
                  : "npm run cli -- worker --provider CONNECTION_ID --url http://127.0.0.1:11434"}
              </code>{" "}
              on the project/model computer. The worker makes outbound requests;
              no public runtime port is needed. Connection ID:{" "}
              <code>
                {edit?.id || "shown after saving with CLI connections"}
              </code>
              .
            </div>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="quiet-button"
              onClick={() => setShow(false)}
            >
              Cancel
            </button>
            <button className="primary" disabled={loading}>
              {loading ? "Saving…" : "Save connection"}
            </button>
          </div>
        </form>
      ) : (
        <div className="modal-actions">
          <button
            className="quiet-button bordered"
            onClick={() => {
              setEdit(null);
              setKind("ollama");
              setTransport("direct");
              setShow(true);
              setError("");
            }}
          >
            <Plus size={15} /> Add connection
          </button>
          <button className="primary" onClick={onTeam}>
            Configure team <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      <p className="field-help">
        Direct localhost connections reach the machine running Council. For
        models on a visitor’s computer, use the local bridge. Testing makes a
        small provider request and may incur usage.
      </p>
    </Modal>
  );
}
function TeamSettings({
  providers,
  config,
  active,
  save,
  close,
  connect,
}: {
  providers: Provider[];
  config: RunConfig;
  active: boolean;
  save: (config: RunConfig) => Promise<void>;
  close: () => void;
  connect: () => void;
}) {
  const [value, setValue] = useState<RunConfig>(structuredClone(config));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  function setCount(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 32) return;
    setValue((old) => ({
      ...old,
      members: Array.from(
        { length: count },
        (_, i) =>
          old.members[i] || {
            id: crypto.randomUUID(),
            name: names[i] || `Peer ${i + 1}`,
            role: "Choose a useful specialization for this goal",
            providerId: old.providerIds[i % old.providerIds.length] || "",
          },
      ),
      maxAgents: old.maxAgents === null ? null : Math.max(old.maxAgents, count),
      maxCalls: Math.max(old.maxCalls, count * 3 + 1),
    }));
  }
  function toggleProvider(id: string) {
    setValue((old) => {
      const providerIds = old.providerIds.includes(id)
        ? old.providerIds.filter((p) => p !== id)
        : [...old.providerIds, id];
      return {
        ...old,
        providerIds,
        members: old.members.map((m, i) => ({
          ...m,
          providerId: providerIds.includes(m.providerId)
            ? m.providerId
            : providerIds[i % providerIds.length] || "",
        })),
      };
    });
  }
  const update = (index: number, key: keyof Member, data: string) =>
    setValue((old) => ({
      ...old,
      members: old.members.map((m, i) =>
        i === index ? { ...m, [key]: data } : m,
      ),
    }));
  return (
    <Modal title="Assemble your council" close={close} wide>
      <p className="modal-intro">
        Choose a model pool and a separate starting agent count. One model can
        run many peers; several models can share a larger team. Agents choose
        their roles and delegate among themselves.
      </p>
      {active && (
        <div className="notice">
          The active run keeps its current configuration. Stop it before
          changing the team.
        </div>
      )}
      {saveError && <div className="error">{saveError}</div>}
      <fieldset disabled={active || saving}>
        <div className="model-pool">
          <div className="resource-heading">
            <h3>1. Model pool</h3>
            <span>Available to every peer for delegation.</span>
          </div>
          {providers.map((p) => (
            <label className="pool-option" key={p.id}>
              <input
                type="checkbox"
                checked={value.providerIds.includes(p.id)}
                onChange={() => toggleProvider(p.id)}
              />
              <span>
                <b>{p.name}</b>
                <small>{p.model}</small>
              </span>
              <span className="tiny-tag">{presets[p.kind].label}</span>
            </label>
          ))}
        </div>
        <div className="agent-count-row">
          <label>
            2. Starting agents
            <input
              aria-label="Starting agent count"
              type="number"
              min={1}
              max={32}
              value={value.members.length}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <p>
            {value.providerIds.length} model connections ·{" "}
            {value.members.length} independent agents
          </p>
          <button
            type="button"
            className="quiet-button bordered"
            disabled={!value.providerIds.length}
            onClick={() =>
              setValue({
                ...value,
                members: value.members.map((m, i) => ({
                  ...m,
                  providerId: value.providerIds[i % value.providerIds.length],
                })),
              })
            }
          >
            Distribute evenly
          </button>
        </div>
        <div className="member-editor">
          {value.members.map((m, i) => (
            <div className="member-edit" key={m.id}>
              <span className={`avatar color-${i % 3}`}>
                {m.name.charAt(0)}
              </span>
              <label>
                Peer name
                <input
                  value={m.name}
                  maxLength={60}
                  onChange={(e) => update(i, "name", e.target.value)}
                />
              </label>
              <label>
                Model connection
                <select
                  value={m.providerId}
                  onChange={(e) => update(i, "providerId", e.target.value)}
                >
                  <option value="" disabled>
                    Choose a connection
                  </option>
                  {providers
                    .filter((p) => value.providerIds.includes(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.model}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="icon-button"
                aria-label={`Remove ${m.name}`}
                disabled={value.members.length <= 1}
                onClick={() =>
                  setValue({
                    ...value,
                    members: value.members.filter((_, index) => i !== index),
                  })
                }
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </div>
        <div className="team-editor-actions">
          <button
            className="quiet-button"
            disabled={value.members.length >= 32}
            onClick={() => setCount(value.members.length + 1)}
          >
            <Plus size={15} /> Add peer
          </button>
          <button className="inline-link" onClick={connect}>
            Manage connections <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="resource-heading">
          <h3>Resource limits</h3>
          <span>Bound the run, not the team’s organization.</span>
        </div>
        <label className="checkbox-label free-delegation">
          <input
            type="checkbox"
            checked={value.maxAgents === null}
            onChange={(e) =>
              setValue({
                ...value,
                maxAgents: e.target.checked
                  ? null
                  : Math.max(12, value.members.length),
                maxDepth: e.target.checked ? null : 3,
              })
            }
          />{" "}
          Free delegation — no fixed agent-count or spawn-depth cap
        </label>
        <p className="field-help">
          Call, time, output, and concurrency budgets still apply. Every new
          agent consumes the shared budget.
        </p>
        <div className="form-grid limits-grid">
          {(
            [
              {
                key: "maxAgents",
                label: "Maximum total peers",
                min: value.members.length,
                max: 128,
              },
              {
                key: "concurrency",
                label: "Concurrent model calls",
                min: 1,
                max: 8,
              },
              {
                key: "maxCalls",
                label: "Total model calls",
                min: value.members.length + 2,
                max: 256,
              },
              {
                key: "maxOutputTokens",
                label: "Output tokens per call",
                min: 256,
                max: 16384,
              },
              {
                key: "maxDepth",
                label: "Specialist spawn depth",
                min: 0,
                max: 16,
              },
              {
                key: "maxMinutes",
                label: "Time limit (minutes)",
                min: 1,
                max: 120,
              },
            ] as const
          ).map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                min={f.min}
                max={f.max}
                disabled={value[f.key] === null}
                placeholder="No fixed cap"
                value={value[f.key] ?? ""}
                onChange={(e) =>
                  setValue({ ...value, [f.key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <p className="field-help">
          One small local model can run many peers with separate inboxes and
          working context. Use one concurrent call to let them take turns. More
          concurrency lets cloud or sufficiently provisioned local models work
          simultaneously.
        </p>
        {providers.some(
          (p) => p.kind === "opencode" && value.providerIds.includes(p.id),
        ) && (
          <div className="notice">
            OpenCode connections use real project tools. Start with one
            concurrent call for a shared working tree. Here, the call limit
            counts Council turns; each OpenCode turn can make multiple native
            model calls. Set native step and output limits in OpenCode.
            Permission wait time is included in the four-minute coding turn
            timeout.
          </div>
        )}
      </fieldset>
      <div className="modal-actions">
        <button className="quiet-button" onClick={close}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={
            saving ||
            active ||
            !value.providerIds.length ||
            value.members.some(
              (m) => !m.name || !providers.some((p) => p.id === m.providerId),
            )
          }
          onClick={async () => {
            setSaving(true);
            setSaveError("");
            try {
              await save(value);
            } catch (e) {
              setSaveError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save team"} <Check size={16} />
        </button>
      </div>
    </Modal>
  );
}
function Files({ close }: { close: () => void }) {
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [proposals, setProposals] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("notes.md");
  const [content, setContent] = useState("");
  async function refresh() {
    const [f, p] = await Promise.all([api("/files"), api("/proposals")]);
    setFiles(f);
    setProposals(p);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <Modal title="Workspace files" close={close} wide>
      <p className="modal-intro">
        Give your peers text context to inspect. These files belong to this
        Council account. Agent-proposed changes are applied only when you accept
        them.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="file-pills">
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => {
              setName(f.name);
              setContent(f.content);
            }}
          >
            <FileText size={14} />
            {f.name}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/files", "POST", { name, content });
            await refresh();
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          File name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Content
          <textarea
            className="file-editor"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={40000}
          />
        </label>
        <div className="modal-actions">
          <button className="primary">Save file</button>
        </div>
      </form>
      {proposals.length > 0 && <h3>Proposed changes</h3>}
      {proposals.map((p) => (
        <details className="candidate-card" key={p.id}>
          <summary>
            <FileText size={15} />
            {p.name}
            <span className="tiny-tag">{p.status}</span>
          </summary>
          <div className="diff-grid">
            <div>
              <small>BEFORE</small>
              <pre>{p.original ?? "(new file)"}</pre>
            </div>
            <div>
              <small>PROPOSED</small>
              <pre>{p.content}</pre>
            </div>
          </div>
          {p.status === "pending" && (
            <div className="modal-actions">
              {[false, true].map((accept) => (
                <button
                  key={String(accept)}
                  className={accept ? "primary" : "quiet-button"}
                  onClick={async () => {
                    try {
                      await api(`/proposals/${p.id}`, "POST", { accept });
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {accept ? "Accept change" : "Reject"}
                </button>
              ))}
            </div>
          )}
        </details>
      ))}
    </Modal>
  );
}
function CliModal({ close }: { close: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Modal title="Developer CLI" close={close}>
      <p className="modal-intro">
        The CLI uses the same account, sessions, and live peer discussion as the
        web app.
      </p>
      <pre>
        npm run cli -- login --server {location.origin}
        {"\n"}npm run cli -- connections{"\n"}npm run cli -- run "Your goal"
        --providers ID1,ID2{"\n"}npm run cli -- watch RUN_ID
      </pre>
      <p className="field-help">
        Login prompts for credentials in your terminal. Or create a 30-day token
        below and set COUNCIL_TOKEN in your shell. Tokens grant access to your
        account; keep them private.
      </p>
      <div className="modal-actions">
        <button
          className="quiet-button bordered"
          onClick={async () => {
            try {
              const data = await api("/auth/token", "POST");
              setToken(data.token);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Create CLI token
        </button>
        <button
          className="quiet-button"
          onClick={async () => {
            try {
              await api("/auth/tokens", "DELETE");
              setToken("");
              setMessage("All CLI tokens revoked.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Revoke CLI tokens
        </button>
      </div>
      {token && (
        <label>
          Token (shown only here)
          <input readOnly value={token} onFocus={(e) => e.target.select()} />
        </label>
      )}
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <h3>Connect models on your computer</h3>
      <pre>
        npm run cli -- worker --provider CONNECTION_ID{"\n"} --url
        http://127.0.0.1:11434
      </pre>
      <p className="field-help">
        Create a bridge connection first. The worker reaches your local model
        and forwards its stream to your private session.
      </p>
      <h3>Connect a coding project</h3>
      <pre>
        {
          "npm run cli -- coding-worker --provider CONNECTION_ID\n  --url http://127.0.0.1:4096 --directory /your/project"
        }
      </pre>
      <p className="field-help">
        Choose OpenCode coding runtime in Connections and start OpenCode in your
        project first. Native tool activity and permission requests appear in
        your Council discussion. Model credentials stay in OpenCode.
      </p>
      <h3>Open the full native coding interface</h3>
      <pre>
        {
          "npm run cli -- code --url http://127.0.0.1:4096\n  --directory /your/project --session SESSION_ID"
        }
      </pre>
    </Modal>
  );
}

function KnowledgePanel({
  knowledge,
  members,
}: {
  knowledge: { findings: Finding[]; work: Work[]; assessments: Assessment[] };
  members: Member[];
}) {
  const who = (id: string) => members.find((m) => m.id === id)?.name || id;
  return (
    <div className="knowledge-panel">
      <div className="knowledge-intro">
        <ShieldCheck size={19} />
        <div>
          <h3>Build on what is already known.</h3>
          <p>
            Peers reuse established findings. A concrete objection opens a
            targeted recheck; all involved agents must accept the same revision.
            These are agent assessments, not independently certified facts.
          </p>
        </div>
      </div>
      {!knowledge.findings.length && (
        <p className="empty-knowledge">
          The team has not published findings yet. Live contributions are in
          Discussion.
        </p>
      )}
      {knowledge.findings.map((f) => (
        <article className={`finding-card ${f.state}`} key={f.id}>
          <header>
            <span className="tiny-tag">
              {f.state === "established" ? "AGENT-ESTABLISHED" : "DISPUTED"}
            </span>
            <span>
              revision {f.revision} · {who(f.author)}
            </span>
          </header>
          <h3>{f.key}</h3>
          <p>{f.claim}</p>
          <details open>
            <summary>Evidence</summary>
            <ul>
              {f.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
          {f.challenges.length > 0 && (
            <details open={f.state === "disputed"}>
              <summary>Disagreement & recheck</summary>
              {f.challenges.map((c, i) => (
                <div className="finding-challenge" key={i}>
                  <b>{who(c.agent)}</b>
                  <p>{c.reason}</p>
                  <p>
                    <span>Recheck:</span> {c.recheck}
                  </p>
                </div>
              ))}
              <div className="finding-acceptances">
                {f.participants.map((id) => (
                  <div key={id}>
                    <span>
                      {f.acceptances[id]?.revision === f.revision ? "✓" : "○"}{" "}
                      {who(id)}
                    </span>
                    <p>
                      {f.acceptances[id]?.revision === f.revision
                        ? f.acceptances[id].reason
                        : "Has not accepted the current revision."}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </article>
      ))}
      {knowledge.assessments.length > 0 && (
        <>
          <h3 className="work-title">Evidence-based division of labour</h3>
          <p className="field-help">
            These are task-specific peer assessments. They are not independently
            verified benchmark scores.
          </p>
          {knowledge.assessments.map((a) => (
            <div key={a.id} className="work-item">
              <span className="tiny-tag">{a.outcome}</span>
              <div>
                <b>
                  {who(a.agentId)} · {a.domain}
                </b>
                <span>
                  Assessed by {who(a.observer)} · {a.evidence.length} cited
                  findings
                </span>
                <p>{a.reason}</p>
              </div>
            </div>
          ))}
        </>
      )}
      {knowledge.work.length > 0 && (
        <>
          <h3 className="work-title">Who is checking what</h3>
          {knowledge.work.map((w) => (
            <div className="work-item" key={w.key}>
              <span className="tiny-tag">{w.state}</span>
              <div>
                <b>{w.description}</b>
                <span>
                  {who(w.owner)} · {w.key}
                </span>
                {w.result && <p>{w.result}</p>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function BenchmarkModal({
  close,
  providers,
  config,
}: {
  close: () => void;
  providers: Provider[];
  config: RunConfig;
}) {
  const [suite, setSuite] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [baseline, setBaseline] = useState(
    providers.find((p) => p.kind !== "demo")?.id || "",
  );
  const [mode, setMode] = useState("single");
  const [selected, setSelected] = useState<string[]>([]);
  const [repeats, setRepeats] = useState(1);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    api("/benchmarks/suite")
      .then((s) => {
        setSuite(s);
        setSelected(s.slice(0, 3).map((t: any) => t.id));
      })
      .catch((e) => setError(e.message));
    const refresh = () =>
      api("/benchmarks")
        .then(setResults)
        .catch((e) => setError(e.message));
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);
  const active = results.some((r) => r.status === "running");
  const realTeam =
    config.providerIds.length > 0 &&
    config.providerIds.every((id) =>
      providers.some((p) => p.id === id && p.kind !== "demo"),
    );
  async function start() {
    setSending(true);
    setError("");
    try {
      const result = await api("/benchmarks", "POST", {
        config,
        baselineProviderId: baseline,
        baselineMode: mode,
        repeats,
        taskIds: selected,
      });
      setResults((old) => [result, ...old]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  function download(report: any) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `council-benchmark-${report.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Modal title="Council vs. one model" close={close} wide>
      <p className="modal-intro">
        Compare your configured council with a single-model baseline on
        identical, deterministically scored tasks. Correctness, time, calls, and
        reported tokens stay visible. This small original suite is an
        engineering smoke test, not proof of general superiority.
      </p>
      <div className="form-grid">
        <label>
          Baseline model
          <select
            value={baseline}
            onChange={(e) => setBaseline(e.target.value)}
          >
            <option value="" disabled>
              Select a real connection
            </option>
            {providers
              .filter((p) => p.kind !== "demo")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
          </select>
        </label>
        <label>
          Comparison mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="single">One call vs. Council</option>
            <option value="matched">
              Same call count, single-model refinement
            </option>
          </select>
        </label>
        <label>
          Trials per task
          <input
            type="number"
            min={1}
            max={3}
            value={repeats}
            onChange={(e) => setRepeats(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="benchmark-tasks">
        {suite.map((t) => (
          <label className="checkbox-label" key={t.id}>
            <input
              type="checkbox"
              checked={selected.includes(t.id)}
              onChange={() =>
                setSelected((old) =>
                  old.includes(t.id)
                    ? old.filter((id) => id !== t.id)
                    : [...old, t.id],
                )
              }
            />
            {t.id}
            <span className="tiny-tag">{t.domain}</span>
          </label>
        ))}
      </div>
      <p className="field-help">
        Current council: {config.members.length} starting agents,{" "}
        {config.providerIds.length} models. Up to{" "}
        {selected.length *
          repeats *
          config.maxCalls *
          (mode === "matched" ? 2 : 1) +
          (mode === "single" ? selected.length * repeats : 0)}{" "}
        model calls. This uses real provider capacity and may incur charges.
        Matched calls do not imply equal input tokens or monetary cost.
      </p>
      {!realTeam && (
        <div className="notice">
          Configure your team with real connections first. Demo scores would be
          misleading.
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button
          className="primary"
          disabled={
            !realTeam || !baseline || !selected.length || active || sending
          }
          onClick={start}
        >
          {sending ? "Starting…" : "Run comparison"}
        </button>
      </div>
      {results.map((r) => (
        <section className="benchmark-report" key={r.id}>
          <header>
            <b>{new Date(r.createdAt).toLocaleString()}</b>
            <span className="tiny-tag">{r.status}</span>
            <button
              className="icon-button"
              aria-label="Download benchmark report"
              onClick={() => download(r)}
            >
              <Download size={15} />
            </button>
            {r.status === "running" && (
              <button
                className="quiet-button"
                onClick={() =>
                  api(`/benchmarks/${r.id}/cancel`, "POST").catch((e) =>
                    setError(e.message),
                  )
                }
              >
                Stop
              </button>
            )}
          </header>
          <p>
            {r.rows.length} / {r.taskIds.length * r.repeats} trials ·{" "}
            {r.baselineMode === "matched"
              ? "Matched call count"
              : "Single-call baseline"}
          </p>
          {r.summary && (
            <div className="benchmark-scores">
              <span>
                <b>
                  {r.summary.councilCorrect}/{r.summary.tasks}
                </b>
                Council correct
              </span>
              <span>
                <b>
                  {r.summary.baselineCorrect}/{r.summary.tasks}
                </b>
                Baseline correct
              </span>
            </div>
          )}
          <div className="benchmark-table">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Council</th>
                  <th>Baseline</th>
                  <th>Calls C/B</th>
                  <th>Seconds C/B</th>
                  <th>Tokens C/B</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row: any, i: number) => (
                  <tr key={i}>
                    <td>
                      {row.taskId} · {row.repeat}
                    </td>
                    <td>
                      {row.council.correct ? "✓" : "✕"}{" "}
                      <small>{row.council.status}</small>
                    </td>
                    <td>{row.baseline.correct ? "✓" : "✕"}</td>
                    <td>
                      {row.council.calls}/{row.baseline.calls}
                    </td>
                    <td>
                      {(row.council.ms / 1000).toFixed(1)}/
                      {(row.baseline.ms / 1000).toFixed(1)}
                    </td>
                    <td>
                      {row.council.tokens ?? "—"}/{row.baseline.tokens ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.error && <div className="error">{r.error}</div>}
        </section>
      ))}
    </Modal>
  );
}
