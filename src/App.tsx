import { ChatAttachments, AttachmentPreview } from "./ChatAttachments";
import type { Attachment } from "../shared/attachments";
import { BenchmarkWorkspace } from "./BenchmarkWorkspace";
import { version as councilVersion } from "../package.json";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { CommunicationPanel } from "./CommunicationPanel";
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
  ReceiptText,
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
import { Markdown } from "./Markdown";
import type {
  CouncilEvent,
  Member,
  Provider,
  ProviderKind,
  ReasoningEffort,
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
  maxOutputTokens: 8192,
  maxMinutes: 20,
  goalMode: false,
  minGoalMinutes: 10,
});
const busy = (run?: Run | null) =>
  !!run && ["queued", "running"].includes(run.status);
const clean = (text: string) =>
  text.replace(/```council[\s\S]*?(?:```|$)/g, "").trim();
interface BillingStatus {
  emailVerified: boolean;
  accessApproved: boolean;
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number | null;
  paymentSatoshis: number;
  paymentBtc: number;
  paymentUsdEstimate: number | null;
  paymentUsdSource: string;
  paymentUsdUpdatedAt: string | null;
  billingPeriodMonths: number;
  tokenBudgetMarginPercent: number;
  paymentEmail: string;
  lightningWallet: string;
  needsPayment: boolean;
}
interface PaymentSubmission {
  id: string;
  userId: string;
  fileName: string;
  mime: string;
  status: "submitted" | "approved" | "rejected";
  createdAt: string;
  note: string;
}
interface AdminPaymentSubmission extends PaymentSubmission {
  email: string;
  name: string;
  accessApproved: number;
  freeUsed: number;
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`mark ${small ? "small" : ""}`}>
      <i />
      <i />
      <i />
    </span>
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
  const [forgot, setForgot] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState({
    signup: true,
    inviteRequired: false,
    emailConfirmationRequired: false,
  });
  useEffect(() => {
    api("/info")
      .then(setInfo)
      .catch(() => {});
    const token = new URLSearchParams(window.location.search).get("reset");
    if (token) {
      setResetToken(token);
      setForgot(false);
      setSignup(false);
    }
  }, []);
  async function forgotSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api("/auth/password/forgot", "POST", values);
      setNotice(
        result.message ||
          "If that email is registered, a password reset link will arrive shortly.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function resetSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api("/auth/password/reset", "POST", {
        ...values,
        token: resetToken,
      });
      window.history.replaceState({}, "", "/");
      onUser(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api(
        `/auth/${signup ? "signup" : "login"}`,
        "POST",
        values,
      );
      if (result.needsConfirmation) {
        setNotice(
          result.message ||
            "Check your email and click the confirmation link to finish signup.",
        );
        setSignup(false);
        return;
      }
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
          <h2>
            {resetToken
              ? "Reset your password"
              : forgot
                ? "Recover your workspace"
                : signup
                  ? "Create your workspace"
                  : "Enter your workspace"}
          </h2>
          <p className="muted">
            {resetToken
              ? "Choose a new password for your Council account."
              : forgot
                ? "Enter your email and Council will send a reset link."
                : "Your conversations, models, and team. In one place."}
          </p>
          {resetToken ? (
            <form onSubmit={resetSubmit}>
              <label>
                New password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 10 characters"
                  minLength={10}
                  maxLength={200}
                  required
                />
              </label>
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              {notice && <div className="success-note">{notice}</div>}
              <button className="primary auth-submit" disabled={loading}>
                {loading ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    Reset password
                    <ArrowUpRight size={18} />
                  </>
                )}
              </button>
            </form>
          ) : forgot ? (
            <form onSubmit={forgotSubmit}>
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
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              {notice && <div className="success-note">{notice}</div>}
              <button className="primary auth-submit" disabled={loading}>
                {loading ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    Send reset link
                    <ArrowUpRight size={18} />
                  </>
                )}
              </button>
            </form>
          ) : (
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
            {notice && <div className="success-note">{notice}</div>}
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
          )}
          {!resetToken && !signup && !forgot && (
            <p className="auth-switch">
              <button
                onClick={() => {
                  setForgot(true);
                  setError("");
                  setNotice("");
                }}
              >
                Forgot password?
              </button>
            </p>
          )}
          {forgot && (
            <p className="auth-switch">
              Remembered it?{" "}
              <button
                onClick={() => {
                  setForgot(false);
                  setError("");
                  setNotice("");
                }}
              >
                Sign in
              </button>
            </p>
          )}
          {info.signup && !forgot && !resetToken && (
            <p className="auth-switch">
              {signup ? "Already have a workspace?" : "New to Council?"}{" "}
              <button
                onClick={() => {
                  setSignup(!signup);
                  setForgot(false);
                  setError("");
                  setNotice("");
                }}
              >
                {signup ? "Sign in" : "Create an account"}
              </button>
            </p>
          )}
          <div className="auth-note">
            <ShieldCheck size={15} />{" "}
            {info.emailConfirmationRequired
              ? "Email-confirmed workspaces"
              : "Private sessions"}{" "}
            · Bring your own models
          </div>
        </div>
      </div>
      <footer className="auth-footer">
        <span>Built for open collaboration.</span>
        <span>Personal project · v{councilVersion}</span>
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
    | { type: "turn"; id: string }
    | { type: "event"; event: CouncilEvent }
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
      <span className="field-help">Coding session {d.sessionId}</span>
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
        {Array.isArray(d.sources) && (
          <ul>
            {d.sources
              .filter((s: any) => /^https:\/\//.test(s.url))
              .map((s: any) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title || s.url}
                  </a>
                </li>
              ))}
          </ul>
        )}
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

function BillingPanel({
  status,
  onRefresh,
}: {
  status: BillingStatus | null;
  onRefresh: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [payments, setPayments] = useState<PaymentSubmission[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function refreshAll() {
    await onRefresh();
    const rows = await api<PaymentSubmission[]>("/billing/payments");
    setPayments(rows);
  }
  useEffect(() => {
    refreshAll().catch((e) => setError((e as Error).message));
  }, []);
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/billing/payment", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": file.type,
          "X-Council-Request": "1",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || `Upload failed (${response.status})`);
      setMessage(
        data.message ||
          "Payment screenshot submitted. Your account will be reviewed within 24 hours.",
      );
      setFile(null);
      await refreshAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const usdEstimate =
    typeof status?.paymentUsdEstimate === "number"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        }).format(status.paymentUsdEstimate)
      : "";
  const btcAmount =
    typeof status?.paymentBtc === "number"
      ? status.paymentBtc.toLocaleString("en-US", {
          minimumFractionDigits: 8,
          maximumFractionDigits: 8,
        })
      : "";
  return (
    <div className="settings-panel billing-panel">
      <div className="settings-section">
        <h3>Account access</h3>
        <p className="muted">
          The first {status?.freeLimit ?? 10} user or board messages are free.
          After that, your account needs manual approval or a Lightning payment.
        </p>
        <div className="billing-grid">
          <div>
            <span className="field-help">Free messages used</span>
            <b>
              {status ? `${status.freeUsed}/${status.freeLimit}` : "Loading"}
            </b>
          </div>
          <div>
            <span className="field-help">Account status</span>
            <b>
              {status?.accessApproved
                ? "Approved"
                : status?.needsPayment
                  ? "Payment needed"
                  : "Free tier"}
            </b>
          </div>
          <div>
            <span className="field-help">Email</span>
            <b>{status?.emailVerified ? "Confirmed" : "Pending"}</b>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <h3>Lightning payment</h3>
        <p className="muted">
          Pay {status?.paymentSatoshis?.toLocaleString("en-US") || "100,000"}{" "}
          satoshis for quarterly access
          {status?.lightningWallet ? ` to ${status.lightningWallet}` : ""}.
          {btcAmount ? ` That is ${btcAmount} BTC` : ""}
          {usdEstimate ? `, about ${usdEstimate} right now` : ""}. Then upload
          a screenshot. It will be emailed for manual review, and approval
          should happen within 24 hours.
        </p>
        <p className="field-help">
          The upper usage limit should be set from the highest expected token
          price at the maximum tokens allowed, plus a{" "}
          {status?.tokenBudgetMarginPercent ?? 25}% margin.
        </p>
        {status?.paymentUsdUpdatedAt && (
          <p className="field-help">
            USD estimate from {status.paymentUsdSource}, updated{" "}
            {new Date(status.paymentUsdUpdatedAt).toLocaleString()}.
          </p>
        )}
        {!status?.lightningWallet && (
          <div className="error">
            Lightning wallet is not configured on the server yet.
          </div>
        )}
        <label>
          Payment screenshot
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <div className="modal-actions">
          <button className="quiet-button" type="button" onClick={refreshAll}>
            Refresh
          </button>
          <button className="primary" disabled={!file || busy} onClick={upload}>
            {busy ? "Uploading..." : "Upload screenshot"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {message && <div className="success-note">{message}</div>}
        {status?.paymentEmail && (
          <p className="field-help">
            Screenshots are sent to {status.paymentEmail}.
          </p>
        )}
      </div>
      <div className="settings-section">
        <h3>Payment submissions</h3>
        {payments.length ? (
          <div className="payment-list">
            {payments.map((payment) => (
              <div className="payment-row" key={payment.id}>
                <div>
                  <b>{payment.fileName}</b>
                  <span className="field-help">
                    {new Date(payment.createdAt).toLocaleString()} ·{" "}
                    {payment.mime}
                  </span>
                  {payment.note && <p>{payment.note}</p>}
                </div>
                <span className={`tiny-tag payment-${payment.status}`}>
                  {payment.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No payment screenshots uploaded yet.</p>
        )}
      </div>
    </div>
  );
}

function ApprovePaidUsers() {
  const [payments, setPayments] = useState<AdminPaymentSubmission[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  async function refresh() {
    setPayments(await api<AdminPaymentSubmission[]>("/billing/admin/payments"));
  }
  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);
  async function review(id: string, status: "approved" | "rejected") {
    setBusy(id);
    setError("");
    try {
      await api(`/billing/admin/payments/${id}/review`, "POST", {
        status,
        note: note[id] || "",
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="settings-panel billing-panel">
      <div className="settings-section">
        <h3>Approve paid users</h3>
        <p className="muted">
          Review Lightning payment screenshots. Approving a submission unlocks
          that user account.
        </p>
        <div className="modal-actions">
          <button className="quiet-button" onClick={refresh}>
            Refresh
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {payments.length ? (
          <div className="admin-payment-list">
            {payments.map((payment) => (
              <article className="admin-payment-card" key={payment.id}>
                <div className="admin-payment-main">
                  <div>
                    <b>{payment.email}</b>
                    <span className="field-help">
                      {payment.name} · free messages {payment.freeUsed} ·{" "}
                      {payment.accessApproved ? "approved" : "not approved"}
                    </span>
                    <span className="field-help">
                      {payment.fileName} ·{" "}
                      {new Date(payment.createdAt).toLocaleString()}
                    </span>
                    {payment.note && <p>{payment.note}</p>}
                  </div>
                  <span className={`tiny-tag payment-${payment.status}`}>
                    {payment.status}
                  </span>
                </div>
                <img
                  alt={`Payment screenshot for ${payment.email}`}
                  src={`/api/billing/admin/payments/${payment.id}/image`}
                />
                <label>
                  Review note
                  <input
                    value={note[payment.id] || ""}
                    onChange={(e) =>
                      setNote({ ...note, [payment.id]: e.target.value })
                    }
                    placeholder="Optional note"
                  />
                </label>
                <div className="modal-actions">
                  <button
                    className="quiet-button"
                    disabled={busy === payment.id}
                    onClick={() => review(payment.id, "rejected")}
                  >
                    Reject
                  </button>
                  <button
                    className="primary"
                    disabled={busy === payment.id}
                    onClick={() => review(payment.id, "approved")}
                  >
                    Approve user
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No payment screenshots submitted yet.</p>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingAdmin, setBillingAdmin] = useState(false);
  const [checking, setChecking] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<CouncilEvent[]>([]);
  const [config, setConfig] = useState<RunConfig>(defaults([]));
  const [prompt, setPrompt] = useState("");
  const [boardDraft, setBoardDraft] = useState("");
  const [boardPosting, setBoardPosting] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const [tab, setTab] = useState("discussion");
  const [modal, setModal] = useState<
    | "connections"
    | "team"
    | "files"
    | "cli"
    | "benchmarks"
    | "project"
    | "billing"
    | "billingAdmin"
    | null
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
      .then((r) => {
        setUser(r.user);
        setBilling(r.billing || null);
        setBillingAdmin(!!r.billingAdmin);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  async function loadBilling() {
    const next = await api<BillingStatus>("/billing");
    setBilling(next);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        runRef.current = null;
        setRun(null);
        setEvents([]);
        setPrompt("");
        setDraftKey((k) => k + 1);
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
      loadBilling().catch(() => {});
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
          // Reconcile persisted final state after completion or a reconnect.
          api<{ run: Run; events: CouncilEvent[] }>(`/runs/${runId}`)
            .then((data) => {
              if (runRef.current !== runId) return;
              setRun(data.run);
              setEvents(data.events);
            })
            .catch(() => setStreamError(true));
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
    if (follow.current && ["discussion", "engagement"].includes(tab))
      bottom.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [events.length, tab]);
  useEffect(() => {
    follow.current = ["discussion", "engagement"].includes(tab);
    if (!follow.current) list.current?.scrollTo({ top: 0 });
  }, [tab, runId]);
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
  function parseGoalCommand(value: string) {
    const match = /^\/goal(?:\s+(\d+)(?:-(\d+))?m)?\s+([\s\S]+)$/i.exec(
      value.trim(),
    );
    if (!match) return null;
    const minMinutes = match[1] ? Number(match[1]) : 10;
    const maxMinutes = match[2] ? Number(match[2]) : Math.max(minMinutes, 20);
    return { goal: match[3].trim(), minMinutes, maxMinutes };
  }
  async function start(goal = prompt) {
    if (!goal.trim() || uploading || sending || active) return;
    setError("");
    setSending(true);
    const goalCommand = parseGoalCommand(goal);
    try {
      const next = await api<Run>("/runs", "POST", {
        prompt: goalCommand?.goal || goal,
        attachmentIds: attachments.map((a) => a.id),
        config: goalCommand
          ? {
              ...config,
              goalMode: true,
              minGoalMinutes: goalCommand.minMinutes,
              maxMinutes: Math.max(config.maxMinutes, goalCommand.maxMinutes),
              maxCalls: Math.max(
                config.maxCalls,
                config.members.length * 6 + 12,
              ),
            }
          : config,
        ...(goalCommand
          ? {
              goalMode: true,
              minGoalMinutes: goalCommand.minMinutes,
              maxGoalMinutes: Math.max(
                config.maxMinutes,
                goalCommand.maxMinutes,
              ),
            }
          : {}),
        ...(run && !active ? { parentId: run.id } : {}),
      });
      runRef.current = next.id;
      setRun(next);
      setEvents([]);
      setPrompt("");
      setTab(next.status === "completed" ? "answer" : "discussion");
      setRuns((old) => [next, ...old]);
      loadBilling().catch(() => {});
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
    setDraftKey((k) => k + 1);
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
  const who = (id: string) =>
    id === "user"
      ? "You"
      : id === "system"
        ? "System"
        : members.find((m) => m.id === id)?.name || id;
  function download() {
    if (!run) return;
    const board = events
      .filter((e) => e.type === "board.post")
      .map((e) => e.data.post);
    const conversations = new Map<string, any>();
    for (const e of events)
      if (e.type === "conversation.updated")
        conversations.set(e.data.conversation.id, e.data.conversation);
    const text =
      `Council transcript\n${run.title}\nRun: ${run.id}\nStatus: ${run.status}\nCreated: ${run.createdAt}\n\n` +
      `Goal\n${run.prompt}\n\n` +
      `Final answer\n${run.final || "(No final answer yet.)"}\n\n` +
      `Board messages\n${
        board.length
          ? board
              .map(
                (p) =>
                  `[${p.at}] ${p.kind || "broadcast"} · ${(p.coauthors || [p.author]).map(who).join(" + ")}\n${p.content}${p.evidenceSummary ? `\nEvidence/deduction summary: ${p.evidenceSummary}` : ""}`,
              )
              .join("\n\n")
          : "(No board messages.)"
      }\n\n` +
      `Agent discussion\n` +
      [...view.turns.values()]
        .map((t) => `### ${t.name} · ${t.model}\n\n${clean(t.text)}`)
        .join("\n\n") +
      "\n\nEngagement\n" +
      events
        .filter((e) => e.type === "agent.message")
        .map((e) => `${e.data.name} → ${e.data.to}: ${e.data.content}`)
        .join("\n\n") +
      "\n\nConversations\n" +
      ([...conversations.values()]
        .map(
          (t) =>
            `${t.participants.map(who).join(" <-> ")} · ${t.topic}\n${t.messages.map((m: any) => `${who(m.author)}: ${m.content}`).join("\n")}\n${t.proposal ? `Conclusion r${t.proposal.revision}: ${t.proposal.summary}\nEvidence: ${t.proposal.evidence.join("; ")}` : ""}`,
        )
        .join("\n\n") || "(No direct conversations.)") +
      "\n\nFindings\n" +
      (knowledge.findings
        .map(
          (f) =>
            `${f.key} · revision ${f.revision}\n${f.claim}\nEvidence: ${f.evidence.join("; ")}`,
        )
        .join("\n\n") || "(No findings.)");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `council-${run.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function postBoard() {
    if (!run || !active || !boardDraft.trim() || boardPosting) return;
    setBoardPosting(true);
    setError("");
    try {
      await api(`/runs/${run.id}/board`, "POST", { content: boardDraft });
      setBoardDraft("");
      setTab("board");
      loadBilling().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBoardPosting(false);
    }
  }
  async function postGoal() {
    if (!run || !active || !boardDraft.trim() || boardPosting) return;
    const goalCommand = parseGoalCommand(`/goal ${boardDraft}`)!;
    setBoardPosting(true);
    setError("");
    try {
      await api(`/runs/${run.id}/goal`, "POST", {
        goal: goalCommand.goal,
        minMinutes: goalCommand.minMinutes,
        maxMinutes: Math.max(config.maxMinutes, goalCommand.maxMinutes),
      });
      setBoardDraft("");
      setTab("board");
      loadBilling().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBoardPosting(false);
    }
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
        <button className="nav-button" onClick={() => setModal("project")}>
          <Terminal size={16} /> Coding project{" "}
          {config.sandbox && <span className="count">On</span>}
        </button>
        <button className="nav-button" onClick={() => setModal("files")}>
          <FileText size={16} /> Workspace files
        </button>
        <button className="nav-button" onClick={() => setModal("billing")}>
          <ReceiptText size={16} /> Billing{" "}
          {!billing?.accessApproved && (
            <span className="count">
              {billing ? `${billing.freeUsed}/${billing.freeLimit}` : ""}
            </span>
          )}
        </button>
        {billingAdmin && (
          <button
            className="nav-button"
            onClick={() => setModal("billingAdmin")}
          >
            <ShieldCheck size={16} /> Approve paid users
          </button>
        )}
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
                    {config.members.length} peers · shared board and direct
                    conversations
                    {config.sandbox ? " · hosted coding enabled" : ""}
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
                  <div className="run-attachments">
                    {run.attachments?.map((item) => (
                      <AttachmentPreview key={item.id} item={item} />
                    ))}
                  </div>
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
                      className={tab === "board" ? "active" : ""}
                      onClick={() => setTab("board")}
                    >
                      <Radio size={15} /> Board
                    </button>
                    <button
                      className={tab === "conversations" ? "active" : ""}
                      onClick={() => setTab("conversations")}
                    >
                      <Users size={15} /> Conversations
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
                  {tab === "board" || tab === "conversations" ? (
                    <CommunicationPanel
                      events={events}
                      members={members}
                      mode={tab}
                    />
                  ) : tab === "knowledge" ? (
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
                            ? "No final answer yet."
                            : "No final answer was produced."}
                        </h3>
                        <p>
                          {active
                            ? "The council is still working. This tab will show its final answer or qualified conclusion when the run ends. Follow current work in Discussion."
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
              {active && run && (
                <form
                  className="board-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    postBoard();
                  }}
                >
                  <label>
                    Send live message to board
                    <textarea
                      value={boardDraft}
                      onChange={(e) => setBoardDraft(e.target.value)}
                      placeholder="Correct direction, add evidence, or tag @Atlas to address a specific agent…"
                      maxLength={4000}
                      disabled={boardPosting}
                    />
                  </label>
                  <button
                    className="quiet-button bordered"
                    disabled={!boardDraft.trim() || boardPosting}
                  >
                    {boardPosting ? "Posting…" : "Post to board"}
                  </button>
                  <button
                    type="button"
                    className="quiet-button bordered"
                    disabled={!boardDraft.trim() || boardPosting}
                    onClick={postGoal}
                  >
                    Set goal
                  </button>
                </form>
              )}
              <form
                className={`composer ${active ? "running" : ""}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  start();
                }}
              >
                <ChatAttachments
                  key={`${run?.id || "new"}-${draftKey}`}
                  disabled={active || sending}
                  inherited={run?.attachments?.length || 0}
                  onChange={setAttachments}
                  onBusy={setUploading}
                />
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
                      disabled={
                        !prompt.trim() ||
                        sending ||
                        uploading ||
                        !providers.length
                      }
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
                  Use <code>/goal 10-180m …</code> for persistent goal mode.
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
                    {view.turns.size +
                      events.filter((e) => e.type === "research.start")
                        .length}{" "}
                    / {config.maxCalls}
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
              <span>v{councilVersion}</span>
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
      {modal === "project" && (
        <ProjectWorkspace
          close={() => setModal(null)}
          enabled={!!config.sandbox}
          running={active}
          enable={async (value) => {
            const next = { ...config, sandbox: value };
            setConfig(next);
            try {
              await api("/team", "PUT", next);
            } catch (error) {
              setConfig(config);
              throw error;
            }
          }}
        />
      )}
      {modal === "files" && <Files close={() => setModal(null)} />}
      {modal === "billing" && (
        <Modal title="Billing" close={() => setModal(null)} wide>
          <BillingPanel status={billing} onRefresh={loadBilling} />
        </Modal>
      )}
      {modal === "billingAdmin" && (
        <Modal title="Approve paid users" close={() => setModal(null)} wide>
          <ApprovePaidUsers />
        </Modal>
      )}
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
type ModelShortcut = {
  id: string;
  label: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  defaultReasoning?: boolean;
  defaultEffort?: ReasoningEffort;
  efforts?: ReasoningEffort[];
  note?: string;
};
const allReasoningEfforts: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
function reasoningEfforts(kind: ProviderKind, shortcut?: ModelShortcut) {
  if (shortcut?.efforts) return shortcut.efforts;
  if (kind === "glm") return ["low", "high", "max"] as ReasoningEffort[];
  return allReasoningEfforts;
}
const modelShortcuts: ModelShortcut[] = [
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    name: "DeepSeek V4 Pro",
    kind: "compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    defaultReasoning: true,
    defaultEffort: "high",
    efforts: ["low", "high", "max"],
    note: "DeepSeek V4 Pro supports low, high and max thinking effort; high is its documented default.",
  },
  {
    id: "glm-5.3",
    label: "GLM 5.3",
    name: "GLM 5.3",
    kind: "glm",
    baseUrl: "https://api.z.ai/api/paas/v4",
    model: "glm-5.3",
    defaultReasoning: true,
    defaultEffort: "max",
    efforts: ["low", "high", "max"],
    note: "GLM 5.3 always reasons and rejects unsupported effort values; max is recommended for complex coding.",
  },
  {
    id: "gpt-5.5-high",
    label: "OpenAI GPT-5.5 High",
    name: "GPT-5.5 High",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    defaultReasoning: true,
    defaultEffort: "high",
    efforts: ["none", "low", "medium", "high", "xhigh"],
    note: "GPT-5.5 supports none, low, medium, high and xhigh; medium is default, this shortcut sets high.",
  },
  {
    id: "gpt-6-luna",
    label: "OpenAI GPT-6 Luna",
    name: "GPT-6 Luna",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6-luna",
    defaultReasoning: true,
    defaultEffort: "low",
    efforts: ["none", "low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "gpt-6.1-sol",
    label: "OpenAI GPT-6.1 Sol",
    name: "GPT-6.1 Sol",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-6.1-sol",
    defaultReasoning: true,
    defaultEffort: "medium",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "gpt-5.6-terra",
    label: "OpenAI GPT-5.6 Terra",
    name: "GPT-5.6 Terra",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    defaultReasoning: true,
    defaultEffort: "medium",
    note: "Current Terra family option; GPT-6 Terra is not listed in OpenAI's model catalog.",
  },
  {
    id: "gpt-5.3-codex",
    label: "OpenAI GPT-5.3 Codex",
    name: "GPT-5.3 Codex",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.3-codex",
    note: "Legacy Codex model; OpenAI recommends newer GPT-6 replacements.",
  },
  {
    id: "gpt-4o",
    label: "OpenAI GPT-4o",
    name: "GPT-4o",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    note: "Kept as a familiar existing OpenAI model ID.",
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    name: "Claude Opus 5.5",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-5-5",
    defaultReasoning: true,
    defaultEffort: "medium",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    note: "Claude Opus 5.5 always uses adaptive thinking; medium is the documented default.",
  },
];
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
  const [shortcutId, setShortcutId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [testId, setTestId] = useState("");
  const [telegram, setTelegram] = useState<any>(null);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [kite, setKite] = useState<any>(null);
  const [kiteApiKey, setKiteApiKey] = useState("");
  const [kiteApiSecret, setKiteApiSecret] = useState("");
  const [kiteRequestToken, setKiteRequestToken] = useState("");
  const [kiteAccessToken, setKiteAccessToken] = useState("");
  const [kiteSaving, setKiteSaving] = useState(false);
  const shortcut = modelShortcuts.find((item) => item.id === shortcutId);
  useEffect(() => {
    api("/integrations/telegram")
      .then(setTelegram)
      .catch(() => {});
    api("/integrations/kite")
      .then(setKite)
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const reasoningEffort =
      typeof data.reasoningEffort === "string" && data.reasoningEffort
        ? data.reasoningEffort
        : undefined;
    try {
      await api(
        edit ? `/providers/${edit.id}` : "/providers",
        edit ? "PUT" : "POST",
        {
          ...data,
          kind,
          transport,
          reasoning: data.reasoning === "on" || !!reasoningEffort,
          reasoningEffort,
        },
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
      <p className="modal-intro">
        For RunPod vLLM from this desktop, open an SSH tunnel and add a vLLM
        connection at <code>http://127.0.0.1:18100/v1</code> with the exact
        served model ID, for example <code>qwen38-heretic</code>.
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
                {p.model}
                {p.reasoningEffort
                  ? ` · effort ${p.reasoningEffort}`
                  : ""} ·{" "}
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
                setShortcutId("");
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
      {!show && (
        <section className="connection-form">
          <div className="resource-heading">
            <h3>Telegram bridge</h3>
            <span>
              {telegram?.enabled
                ? `Enabled${telegram.username ? ` · @${telegram.username}` : ""}`
                : "Optional input channel"}
            </span>
          </div>
          <p className="field-help">
            Telegram messages can start Council sessions or guide a running
            session. The bot receives only board progress and final answers. Use{" "}
            <code>/goal 10-180m your goal</code> for goal mode. After a final
            answer, replies continue that session; use <code>/new</code> to
            start fresh.
          </p>
          <div className="form-grid">
            <label className="full">
              Bot token
              <input
                type="password"
                value={telegramToken}
                autoComplete="off"
                placeholder={
                  telegram?.hasToken
                    ? "Leave blank to keep saved token"
                    : "123456:ABC..."
                }
                onChange={(e) => setTelegramToken(e.target.value)}
              />
            </label>
          </div>
          {telegram?.lastError && (
            <div className="error">Telegram: {telegram.lastError}</div>
          )}
          <div className="modal-actions">
            <button
              className="quiet-button bordered"
              disabled={telegramSaving}
              onClick={async () => {
                setTelegramSaving(true);
                setError("");
                try {
                  setTelegram(
                    await api("/integrations/telegram", "PUT", {
                      token: telegramToken || undefined,
                      enabled: !telegram?.enabled,
                    }),
                  );
                  setTelegramToken("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setTelegramSaving(false);
                }
              }}
            >
              {telegramSaving
                ? "Saving…"
                : telegram?.enabled
                  ? "Disable Telegram"
                  : "Enable Telegram"}
            </button>
            {telegram?.hasToken && (
              <button
                className="quiet-button"
                disabled={telegramSaving}
                onClick={async () => {
                  setTelegramSaving(true);
                  try {
                    await api("/integrations/telegram", "DELETE");
                    setTelegram(await api("/integrations/telegram"));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setTelegramSaving(false);
                  }
                }}
              >
                Clear token
              </button>
            )}
          </div>
        </section>
      )}
      {!show && (
        <section className="connection-form">
          <div className="resource-heading">
            <h3>Zerodha Kite data</h3>
            <span>
              {kite?.enabled
                ? "Enabled · read-only tools"
                : "Optional market data"}
            </span>
          </div>
          <p className="field-help">
            Adds read-only Kite tools for quotes, historical candles and option
            chain data. Council never places, modifies or cancels orders. Save
            your Kite app credentials once, then refresh the request token after
            your morning Kite login.
          </p>
          {kite?.accessTokenUpdatedAt && (
            <p className="field-help">
              Last token refresh:{" "}
              {new Date(kite.accessTokenUpdatedAt).toLocaleString()}
            </p>
          )}
          <div className="form-grid">
            <label>
              API key
              <input
                type="password"
                value={kiteApiKey}
                autoComplete="off"
                placeholder={
                  kite?.hasApiKey
                    ? "Leave blank to keep saved key"
                    : "Kite api_key"
                }
                onChange={(e) => setKiteApiKey(e.target.value)}
              />
            </label>
            <label>
              API secret
              <input
                type="password"
                value={kiteApiSecret}
                autoComplete="off"
                placeholder={
                  kite?.hasApiSecret
                    ? "Leave blank to keep saved secret"
                    : "Kite api_secret"
                }
                onChange={(e) => setKiteApiSecret(e.target.value)}
              />
            </label>
            <label>
              Request token
              <input
                type="password"
                value={kiteRequestToken}
                autoComplete="off"
                placeholder="Paste request_token after Kite login"
                onChange={(e) => setKiteRequestToken(e.target.value)}
              />
            </label>
            <label>
              Access token
              <input
                type="password"
                value={kiteAccessToken}
                autoComplete="off"
                placeholder={
                  kite?.hasAccessToken
                    ? "Paste new token or leave blank"
                    : "Today's access_token"
                }
                onChange={(e) => setKiteAccessToken(e.target.value)}
              />
            </label>
          </div>
          {kite?.lastError && (
            <div className="error">Kite: {kite.lastError}</div>
          )}
          {kite?.callbackUrl && (
            <p className="field-help">
              Kite app redirect URL for direct callback: {kite.callbackUrl}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="quiet-button bordered"
              disabled={kiteSaving}
              onClick={async () => {
                setKiteSaving(true);
                setError("");
                try {
                  setKite(
                    await api("/integrations/kite", "PUT", {
                      apiKey: kiteApiKey || undefined,
                      apiSecret: kiteApiSecret || undefined,
                      accessToken: kiteAccessToken || undefined,
                      enabled: kiteAccessToken ? true : !!kite?.enabled,
                    }),
                  );
                  setKiteApiKey("");
                  setKiteApiSecret("");
                  setKiteAccessToken("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setKiteSaving(false);
                }
              }}
            >
              {kiteSaving
                ? "Saving…"
                : kiteAccessToken
                  ? "Save and enable"
                  : "Save Kite settings"}
            </button>
            {kite?.loginUrl && (
              <a
                className="quiet-button bordered"
                href={kite.loginUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Kite login <ArrowUpRight size={14} />
              </a>
            )}
            <button
              className="quiet-button bordered"
              disabled={kiteSaving || !kiteRequestToken.trim()}
              onClick={async () => {
                setKiteSaving(true);
                setError("");
                try {
                  setKite(
                    await api("/integrations/kite/request-token", "POST", {
                      requestToken: kiteRequestToken,
                    }),
                  );
                  setKiteRequestToken("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setKiteSaving(false);
                }
              }}
            >
              Refresh token
            </button>
            {kite?.enabled && (
              <button
                className="quiet-button"
                disabled={kiteSaving}
                onClick={async () => {
                  setKiteSaving(true);
                  setError("");
                  try {
                    setKite(
                      await api("/integrations/kite", "PUT", {
                        enabled: false,
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setKiteSaving(false);
                  }
                }}
              >
                Disable Kite
              </button>
            )}
            {(kite?.hasApiKey || kite?.hasApiSecret || kite?.hasAccessToken) && (
              <button
                className="quiet-button"
                disabled={kiteSaving}
                onClick={async () => {
                  setKiteSaving(true);
                  try {
                    await api("/integrations/kite", "DELETE");
                    setKite(await api("/integrations/kite"));
                    setKiteApiKey("");
                    setKiteApiSecret("");
                    setKiteRequestToken("");
                    setKiteAccessToken("");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setKiteSaving(false);
                  }
                }}
              >
                Clear Kite
              </button>
            )}
          </div>
        </section>
      )}
      {show ? (
        <form
          className="connection-form"
          key={edit?.id || "new"}
          onSubmit={submit}
        >
          <div className="form-grid">
            <label>
              Known model
              <select
                value={shortcutId}
                disabled={!!edit}
                onChange={(e) => {
                  const next = modelShortcuts.find(
                    (item) => item.id === e.target.value,
                  );
                  setShortcutId(e.target.value);
                  if (next) {
                    setKind(next.kind);
                    setTransport("direct");
                  }
                }}
              >
                <option value="">Custom exact model ID</option>
                {modelShortcuts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Provider
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ProviderKind);
                  setShortcutId("");
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
                key={`name-${edit?.id || shortcutId || "custom"}`}
                defaultValue={edit?.name || shortcut?.name || ""}
                placeholder="My local Qwen"
              />
            </label>
            <label>
              Model ID
              <input
                name="model"
                key={`model-${kind}-${shortcutId || "custom"}`}
                required
                defaultValue={
                  edit?.kind === kind
                    ? edit.model
                    : shortcut?.model || presets[kind].model
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
                key={`url-${kind}-${shortcutId || "custom"}`}
                defaultValue={
                  edit?.kind === kind
                    ? edit.baseUrl
                    : shortcut?.baseUrl || presets[kind].url
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
              key={`reasoning-${edit?.id || shortcutId || "custom"}`}
              type="checkbox"
              defaultChecked={
                edit?.reasoning || shortcut?.defaultReasoning || false
              }
            />{" "}
            Request provider reasoning / summaries (model must support it)
          </label>
          <label>
            Reasoning effort
            <select
              name="reasoningEffort"
              key={`effort-${kind}-${shortcutId || "custom"}`}
              defaultValue={
                edit?.reasoningEffort || shortcut?.defaultEffort || ""
              }
            >
              <option value="">Provider default</option>
              {reasoningEfforts(kind, shortcut).map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          {kind === "anthropic" && (
            <p className="field-help">
              Uses adaptive thinking when enabled. Leave off for models that do
              not support it.
            </p>
          )}
          {shortcut?.note && <p className="field-help">{shortcut.note}</p>}
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
              setShortcutId("");
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
  const patchMember = (index: number, patch: Partial<Member>) =>
    setValue((old) => ({
      ...old,
      members: old.members.map((m, i) =>
        i === index ? { ...m, ...patch } : m,
      ),
    }));
  const update = (index: number, key: keyof Member, data: string) =>
    patchMember(index, { [key]: data } as Partial<Member>);
  const tokenTier = (m: Member) =>
    m.maxOutputTokens === undefined
      ? "default"
      : m.maxOutputTokens === 2048
        ? "low"
        : m.maxOutputTokens === 8192
          ? "mid"
          : m.maxOutputTokens === 16384
            ? "high"
            : "custom";
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
              <label>
                Role
                <input
                  value={m.role}
                  maxLength={200}
                  onChange={(e) => update(i, "role", e.target.value)}
                />
              </label>
              <label>
                Token tier
                <select
                  value={tokenTier(m)}
                  onChange={(e) => {
                    const tiers: Record<string, number | undefined> = {
                      default: undefined,
                      low: 2048,
                      mid: 8192,
                      high: 16384,
                      custom: m.maxOutputTokens || value.maxOutputTokens,
                    };
                    patchMember(i, { maxOutputTokens: tiers[e.target.value] });
                  }}
                >
                  <option value="default">Default run cap</option>
                  <option value="low">Low · 2K</option>
                  <option value="mid">Mid · 8K</option>
                  <option value="high">High · 16K</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {tokenTier(m) === "custom" && (
                <label>
                  Custom tokens
                  <input
                    type="number"
                    min={256}
                    max={16384}
                    value={m.maxOutputTokens || value.maxOutputTokens}
                    onChange={(e) =>
                      patchMember(i, {
                        maxOutputTokens: Number(e.target.value),
                      })
                    }
                  />
                </label>
              )}
              <label className="member-prompt">
                System prompt / agent instructions
                <textarea
                  value={m.systemPrompt || ""}
                  maxLength={4000}
                  placeholder="Optional extra instructions for this peer. Keep them subordinate to the user goal and project rules."
                  onChange={(e) =>
                    patchMember(i, {
                      systemPrompt: e.target.value.trim()
                        ? e.target.value
                        : undefined,
                    })
                  }
                />
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
            checked={!!value.webResearch}
            onChange={(e) =>
              setValue({ ...value, webResearch: e.target.checked })
            }
          />{" "}
          Web research — search and read public sources
        </label>
        <p className="field-help">
          Any model can read public HTTPS pages. Search uses a selected direct
          OpenAI API connection and may incur search fees; each search request
          counts toward the model-call budget. Retrieved evidence is shared with
          your team. Maximum 4 searches and 12 page reads per run.
        </p>
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
        Council has its own standalone terminal interface and project tools. No
        OpenCode installation or web account is required for local use.
      </p>
      <h3>Standalone Council</h3>
      <pre>
        {
          "# In the Council checkout, once:\nnpm ci\nnpm link\n\n# In any project directory:\ncouncil"
        }
      </pre>
      <p className="field-help">
        Use /connect to add a model, /agents to choose team size, /files to
        browse, and /edit to open Council’s editor. Models connect directly
        through Ollama, vLLM or API credentials from your environment. Local
        sessions stay on that computer.
      </p>
      <h3>Optional hosted account access</h3>
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
      <h3>Optional OpenCode compatibility</h3>
      <pre>
        {
          "npm run cli -- coding-worker --provider CONNECTION_ID --url http://127.0.0.1:4096 --directory /your/project"
        }
      </pre>
      <p className="field-help">
        Choose OpenCode coding runtime in Connections and start OpenCode in your
        project first. Native tool activity and permission requests appear in
        your Council discussion. Model credentials stay in OpenCode.
      </p>
      <h3>Attach an existing OpenCode session (optional)</h3>
      <pre>
        {
          "npm run cli -- opencode --url http://127.0.0.1:4096 --directory /your/project --session SESSION_ID"
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
  return (
    <Modal title="Council vs. one model" close={close} wide>
      <BenchmarkWorkspace providers={providers} config={config} />
    </Modal>
  );
}
