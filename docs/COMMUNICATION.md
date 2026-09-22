# Shared board and direct agent discussions

Every peer sees the original goal, shared evidence/work ledger, agent activity,
and a common broadcast board. Board posts have stable IDs and author IDs.
Specialists joining later receive the latest posts and can page back using
`read_board` with a `before` cursor. Agents can reply to a post or contact its
author directly.

```council
{"broadcasts":[{"content":"The four candidate roots pass substitution."}],"conversations":[{"to":"peer-id","topic":"Completeness of roots","message":"Does this account for every real root?"}]}
```

A thread has exactly two participants. Only those peers receive its draft
messages and proposal in model context. The account owner sees all threads in
**Conversations**. Other peers see thread metadata and any published conclusion.
This is context routing, not secrecy from the user or a guarantee that a model
will never paraphrase a draft in its public response.

```council
{"conversations":[{"threadId":"thread-id","proposal":{"summary":"Exactly four real roots: -2,-1,1,2.","evidence":["Factorization into (x²-1)(x²-4), followed by substitution."]}}]}
```

Each new proposal increments its revision and clears all votes. Both participants,
including the author, must explicitly accept the same revision with evidence.
A negative review leaves the proposal unresolved. Other peers cannot vote or
read the thread with `read_conversation`. Models can page their own thread using
that tool and an `offset`.

```council
{"conversations":[{"threadId":"thread-id","review":{"revision":1,"agree":true,"reason":"Both quadratic factors cover all cases over the real domain."}}]}
```

After both accept, either may request `publish:true`. Publication is idempotent
and creates a board post with both authors and the source revision. A published
revision is immutable; a correction starts a new revision and requires fresh
reviews. Agreement can remain in the thread without publication. Open proposals
prevent completed status, including when a participant becomes unavailable;
budget-limited answers explicitly list them instead of manufacturing agreement.

Legacy `messages` directed to `all` become board posts. Other directed messages
become two-peer threads. Task/challenge notifications still enter recipient
inboxes. Direct contents are excluded from global recent-message context.
Board/thread state is checkpointed with the run and replayed on continuation.
Messages arrive while peers work and are consumed on their next model turn;
active model generation is not secretly interrupted.

Math and deduction prompts require domains, substitution, counterexamples and
explicit assumptions. Coding prompts require work/file ownership and actual
tool results. These are behavior instructions and testable mechanisms, not a
claim that a council always beats a single model. Use Benchmarks to measure
accuracy, calls, latency and reported usage with real connected models.
