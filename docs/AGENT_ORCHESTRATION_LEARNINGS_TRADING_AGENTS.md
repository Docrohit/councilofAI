# Agent orchestration learnings from TradingAgents

Date: 2026-10-03

This note extracts reusable orchestration lessons from the separate
TradingAgents personal project. TradingAgents is not a Council dependency, and
these notes do not describe shipped Council behavior. Use this as design input
for Council's goal mode, evidence board, specialist roles, API/MCP surface,
Telegram progress and long-running work sessions.

Inspected source root:

- `/Users/rohitsharma/Desktop/M2026/Personal/TradingAgents`

The TradingAgents checkout had unrelated local `.DS_Store` dirt when inspected.
This review was read-only.

## What TradingAgents Gets Right

TradingAgents models a stock review as an ordered firm-like workflow:

1. Analyst agents gather different evidence types.
2. Bull and bear researchers debate competing interpretations.
3. A research manager adjudicates the debate.
4. A trader converts the decision into an action proposal.
5. Aggressive, conservative and neutral risk agents challenge it.
6. A portfolio manager makes the final decision.

The useful Council lesson is not the trading domain. The useful lesson is the
shape of the work: specialists produce evidence, adversarial peers test it,
judges synthesize it, and a final owner decides with an audit trail.

## Patterns Council Should Reuse

### Role Groups Instead Of Flat Agents

TradingAgents separates agents by job:

- Evidence collectors: market, social, news and fundamentals analysts.
- Debate agents: bull and bear researchers.
- Synthesis agents: research manager, trader and portfolio manager.
- Risk challengers: aggressive, neutral and conservative debaters.

Council already has peers, objections and a board. For stronger work sessions,
Council should allow a goal to declare role groups:

- `collector`: gathers source evidence or project facts.
- `builder`: proposes or implements candidate work.
- `critic`: searches for failure modes and missing evidence.
- `defender`: argues for the current best candidate.
- `judge`: decides whether the evidence satisfies the goal.
- `risk`: checks cost, safety, regressions, deployment and user impact.

Peers can still be equal council members, but the run should know which kind of
evidence each member is expected to produce.

### Debate Has A Bounded Structure

TradingAgents uses explicit debate counters:

- Bull and bear researchers alternate until `max_debate_rounds`.
- Risk agents rotate until `max_risk_discuss_rounds`.
- Then the workflow must advance to a manager/judge.

Council goal mode should preserve its "keep trying" spirit, but it should not
become an endless chat. A good run has:

- a minimum effort window;
- a maximum time or attempt bound;
- required challenge rounds before early agreement;
- a clear handoff from debate to decision;
- a qualified stop when the best answer is still uncertain.

### Tools Are Capabilities, Agents Are Decision-Makers

TradingAgents makes this explicit in docs and code. Data fetching, ranking,
portfolio summary and order placement are pure, importable tool functions.
Agents call those tools and make decisions over the results.

Council should use the same split:

- tools fetch facts, read files, run commands, create artifacts or call
  providers;
- agents decide which tools to use, what the results mean and whether the goal
  is satisfied;
- UI, CLI, Telegram, API and MCP should all call the same tool layer.

This is especially important for media and coding. The image editor, file
writer, command runner or MCP adapter should not hide business logic in a UI
route. The board should receive the tool result and the agent's interpretation.

### Provider Catalogs Beat Scattered Model Names

TradingAgents centralizes model choices in `model_catalog.py` and routes
providers through an LLM client factory. It distinguishes quick and deep models
and passes provider-specific reasoning knobs from config:

- OpenAI-compatible providers: OpenAI, xAI, DeepSeek, Qwen, GLM, Ollama,
  OpenRouter and Kimi.
- Native clients: Anthropic, Google and Azure OpenAI.
- Provider-specific controls: Google thinking level, OpenAI reasoning effort
  and Anthropic effort.

Council should keep its model registry as a real contract:

- provider id;
- display name;
- supported modalities;
- tool support;
- structured-output support;
- context window;
- cost hints;
- self-hosted endpoint compatibility;
- provider-specific reasoning controls.

Teams should be assembled from capabilities, not only model names.

### Structured Output Where Decisions Matter

TradingAgents uses Pydantic schemas for decision agents, then renders the
parsed result back to markdown for compatibility. It also falls back to
free-text generation when structured output is unsupported or fails.

Council should use the same pattern for high-value board artifacts:

- candidate proposal;
- objection;
- evidence item;
- test result;
- risk assessment;
- media review verdict;
- final decision.

The board can remain human-readable, but the underlying event should be typed.
If a provider cannot produce structured output reliably, Council should mark the
item as unstructured and ask a capable peer to normalize it before consensus.

### Persistent Learning Should Store Outcomes, Not Noise

TradingAgents moved toward an append-only decision log that stores final
decisions, later resolves outcomes and injects recent same-ticker and
cross-ticker lessons. The key idea is that memory is grounded in outcomes
rather than every intermediate agent message.

Council should avoid dumping the whole discussion into future context. Better
memory units are:

- goal summary;
- final answer or shipped artifact;
- evidence that changed the decision;
- objections that survived review;
- tests/deploy/live proof;
- outcome observed later;
- lesson learned.

For long projects, this can become a reusable "Council memory log" that informs
future runs without drowning agents in transcript noise.

### Checkpoint And Resume Are Core Features

TradingAgents supports checkpointed LangGraph execution for expensive,
long-running analyses. Council needs the same posture for coding, media,
research and Telegram sessions:

- persist the run graph;
- persist board events and artifacts;
- persist each peer's last completed step;
- resume after process restart or provider failure;
- avoid redoing completed expensive work;
- distinguish retry from superseding an old attempt.

This matters for the user's requirement that a council may work for minutes or
hours.

### One Conversational Entry Point

TradingAgents plans an "Agent 0" orchestrator that receives Telegram,
dashboard and API commands, dispatches the right sub-agents and reports back.
Council already has a similar product direction.

Council should keep one command grammar across channels:

- normal message: guidance or question;
- `/goal`: top-priority goal;
- board message: public evidence or instruction;
- direct message: targeted peer instruction;
- attachment: artifact input;
- final answer: consensus or qualified stop.

Telegram, web, CLI and MCP should be different transports for the same run
model, not separate orchestration systems.

### Progressive Autonomy And Safety Gates

TradingAgents has a progressive autonomy model:

- recommend only;
- execute with rules;
- freer execution within strategy bounds.

Council's equivalent is not trading permission; it is work permission. A team
should have explicit authority levels:

- discuss only;
- read files and inspect;
- write files with review;
- run tests/commands;
- deploy or publish;
- call paid or irreversible providers.

Every destructive, costly or external action should pass through the run's
permission and audit layer, even when agents are confident.

## Council Design Implications

### Goal Mode

For non-trading goals, Council can borrow TradingAgents' debate skeleton:

1. Parse the goal and acceptance criteria.
2. Assign role groups to available peers.
3. Collect evidence from tools and attachments.
4. Run at least one adversarial challenge round.
5. Ask a judge peer to decide whether the board proves the goal.
6. Continue, revise or stop with a qualified answer.

For coding goals, the risk group should check tests, diff scope, deployment
state and rollback risk. For media goals, it should check the artifact against
visual criteria. For research goals, it should check source quality and
alternative interpretations.

### Board Events

TradingAgents' state fields map well to Council board events:

- analyst reports -> evidence cards;
- debate history -> objection and rebuttal cards;
- judge decision -> candidate status change;
- trader proposal -> action proposal;
- risk debate -> risk cards;
- portfolio decision -> final decision.

Council should make these first-class event types rather than plain chat lines.

### API And MCP

TradingAgents' "pure tools, agents decide" philosophy points to a clean Council
API/MCP boundary:

- `start_goal`
- `post_evidence`
- `post_objection`
- `request_role_review`
- `attach_artifact`
- `run_tool`
- `get_board`
- `get_decision`
- `watch_events`

The caller should not need to know the internal agent graph. It should only
start work, supply artifacts, observe events and receive results.

### Model Selection

Council teams should support quick/deep assignment:

- quick models for collection, summarization, first-pass review and formatting;
- deep models for adjudication, synthesis, architecture, risk and final answer;
- local/self-hosted models when privacy, cost or latency matters;
- cloud frontier models when the decision has high consequence.

The same provider may appear in both quick and deep roles with different model
ids or reasoning settings.

## Things Not To Copy Blindly

- Do not copy trading-specific execution semantics into Council. Council should
  have permissioned work actions, not financial trade actions.
- Do not expose chain-of-thought as a product promise. Council should show
  useful reasoning summaries, evidence and objections.
- Do not allow direct external actions that bypass the orchestrator. The
  TradingAgents docs record why bypassing safety gates is dangerous.
- Do not use free-form provider names scattered through prompts. Keep models in
  a catalog and validate them at configuration time.
- Do not let memory become transcript storage. Store decisions and outcomes.

## Recommended Council Follow-Ups

1. Add typed board event schemas for evidence, objection, rebuttal, risk,
   candidate, test result and final decision.
2. Add role templates so a goal can request collectors, builders, critics,
   judges and risk reviewers.
3. Add a model capability catalog that includes structured output, tool use,
   modalities, quick/deep suitability and provider-specific reasoning controls.
4. Add checkpoint/resume semantics for multi-hour Telegram and API goals.
5. Add a decision/outcome memory log for completed Council goals.
6. Expose the same primitives through web, CLI, Telegram, API and MCP.

## Source Notes

Most useful inspected files:

- `README.md`
- `AGENT_GOALS.md`
- `product_theory.md`
- `goal_vision_bestcase.md`
- `web/README.md`
- `tradingagents/graph/trading_graph.py`
- `tradingagents/graph/setup.py`
- `tradingagents/graph/conditional_logic.py`
- `tradingagents/graph/propagation.py`
- `tradingagents/agents/schemas.py`
- `tradingagents/agents/utils/structured.py`
- `tradingagents/agents/utils/memory.py`
- `tradingagents/default_config.py`
- `tradingagents/llm_clients/factory.py`
- `tradingagents/llm_clients/model_catalog.py`
- `tradingagents/dataflows/interface.py`
