# Web research

Council can search and retrieve public sources using its own tools, without
OpenCode or MCP. This is a first research implementation, not a complete browser.

Enable **Configure team → Web research** before starting a new web session.
Native Council supports `--web` at launch or `/web on` in the TUI. Headless and
hosted CLI runs accept `--web` too. Research is off by default, preserving offline
workflows. Existing running sessions retain their settings.

- `web_fetch` reads a known public HTTPS URL. Any model can request it. It returns
  readable text, title, final URL and retrieval time. HTML, text, Markdown and JSON
  are supported. Retrieved content is evidence, not instructions.
- `web_search` uses a **selected direct OpenAI API connection**, with its saved
  model and key. A non-Codex model is preferred if available. The model must support
  Responses `web_search`; otherwise the error is shown. Local-only, Claude-only or
  bridged pools can read known URLs, but need a selected search-capable OpenAI
  connection for search. Other search providers are pending.

Search sends the query, not the entire project/session. Retrieved content is shared
with council peers and their selected models. Never include secrets or private
records in queries. OpenAI search fees and model-token charges may apply. Requests
use `store:false` and at most one built-in search call. Each search request consumes
a Council model call, including failures; one model call is reserved for the
conclusion. Usage is recorded in tool results and the native token total. This is
not dollar accounting or provider spend enforcement.

Limits: **4 search requests and 12 page downloads per run**. Identical requests
reuse a shared per-run cache, including failures to avoid repeated spending.
Continuations have a new cache/budget, while earlier shared evidence persists.
Research remains disabled on both sides of the deterministic benchmarks.

Discussion shows results and clickable source links. The board gets a bounded
excerpt with URLs and retrieval dates. Peers can fetch the same URL to inspect
cached text. Agents are instructed to inspect primary sources, corroborate
consequential claims and cite actual URLs. Generated search digests are labelled;
retrieval time is never represented as publication time.

Page reads are limited to 1 MB downloaded, 12,000 extracted characters, 20 seconds
and four redirects. Only HTTPS/443 is allowed. Private/reserved IPs, mixed public
and private DNS answers, embedded credentials and unsafe redirects are rejected.
DNS is validated and pinned per request; TLS verifies the original hostname.
Requests carry no user cookies, account keys or browser sessions.

This does not log into sites, bypass access restrictions, render JavaScript,
extract PDFs or guarantee access to every page. Failures are shown instead of
inventing evidence. Search does not make forecasts certain or prove Council is
better than one model.

Reference: [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search).
