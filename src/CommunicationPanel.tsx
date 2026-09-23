import type { CouncilEvent, Member } from "../shared/types";
import type { BoardPost, Conversation } from "../server/communication";
import { Markdown } from "./Markdown";

export function CommunicationPanel({
  events,
  members,
  mode,
}: {
  events: CouncilEvent[];
  members: Member[];
  mode: "board" | "conversations";
}) {
  const board = new Map<string, BoardPost>(),
    threads = new Map<string, Conversation>();
  for (const event of events) {
    if (event.type === "board.post")
      board.set(event.data.post.id, event.data.post);
    if (event.type === "conversation.updated")
      threads.set(event.data.conversation.id, event.data.conversation);
  }
  const name = (id: string) => members.find((m) => m.id === id)?.name || id;
  return (
    <section className="communication-panel">
      <h2>
        {mode === "board" ? "Shared broadcast board" : "Agent conversations"}
      </h2>
      <p className="muted">
        {mode === "board"
          ? "Every agent can read these posts, including specialists who join later. Joint conclusions identify both authors."
          : "Two agents can ask questions, compare evidence and agree on a conclusion. You can inspect every thread; other agents receive published conclusions."}
      </p>
      {mode === "board"
        ? [...board.values()].map((post) => (
            <article
              className="communication-card"
              key={post.id}
              id={`post-${post.id}`}
            >
              <header>
                <strong>
                  {(post.coauthors || [post.author]).map(name).join(" + ")}
                </strong>
                <span>
                  {post.threadId
                    ? `Joint conclusion · revision ${post.revision}`
                    : "Broadcast"}
                </span>
              </header>
              {post.replyTo && (
                <a href={`#post-${post.replyTo}`}>Reply to earlier post</a>
              )}
              <Markdown>{post.content}</Markdown>
            </article>
          ))
        : [...threads.values()].map((thread) => (
            <article className="communication-card" key={thread.id}>
              <header>
                <strong>{thread.participants.map(name).join(" ↔ ")}</strong>
                <span>
                  {thread.proposal?.publishedPostId
                    ? "Published"
                    : thread.proposal
                      ? "Reviewing conclusion"
                      : "Discussing"}
                </span>
              </header>
              <h3>{thread.topic}</h3>
              {thread.messages.map((message, index) => (
                <div className="conversation-message" key={index}>
                  <strong>{name(message.author)}</strong>
                  <Markdown>{message.content}</Markdown>
                </div>
              ))}
              {thread.proposal && (
                <div className="conversation-proposal">
                  <h4>
                    Proposed conclusion · revision {thread.proposal.revision}
                  </h4>
                  <Markdown>{thread.proposal.summary}</Markdown>
                  <ul>
                    {thread.proposal.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                  {thread.participants.map((id) => (
                    <p key={id}>
                      <strong>{name(id)}: </strong>
                      {thread.proposal!.reviews[id]
                        ? `${thread.proposal!.reviews[id].agree ? "Agrees" : "Disagrees"} — ${thread.proposal!.reviews[id].reason}`
                        : "Awaiting review"}
                    </p>
                  ))}
                </div>
              )}
            </article>
          ))}
      {!(mode === "board" ? board.size : threads.size) && (
        <p className="notice">
          {mode === "board"
            ? "No broadcasts yet. Posts appear here as the team works."
            : "No direct conversations yet. Agents choose when to contact a peer."}
        </p>
      )}
    </section>
  );
}
