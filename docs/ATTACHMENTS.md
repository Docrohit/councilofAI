# Chat attachments

Candidate v0.2.9 adds **Attach files** to the main web chatbox on desktop and
mobile. Choose files, expand each preview to see exactly what Council extracted,
write your goal, then send. Remove unwanted files with the adjacent remove button.
Uploading alone does not call a model. Sending shares extracted content with all
selected models, including cloud APIs and local model bridges.

| File | What every peer receives |
| --- | --- |
| `.md`, `.txt` | UTF-8 text, including code and Markdown |
| `.docx` | Paragraph text; images/layout and some equations are not included |
| `.pdf` | Text from up to the first 30 pages; no OCR or image understanding |
| `.apk` | SHA-256, archive inventory and Android manifest strings; not full source code |

APKs are never installed or executed. This is not decompilation, signature
verification or a malware verdict. The static report cannot establish runtime
behavior. Use a source repository with Council's coding tools for source-level
work. A scanned PDF with no readable text is rejected; provide OCR text instead.

Limits: four files per conversation, 20 MiB per file, 12,000 extracted characters
per file (48,000 total). Truncation and format limitations appear in the preview
and model context. Attachment text consumes model context and provider tokens on
each turn. Small-context models may require smaller files or shorter tasks.
Follow-ups and continued runs retain the extracted attachments. Start a new
session when you need a different set or more than four files.

The original binary is processed in memory and discarded. Only the name, type,
size, SHA-256, extracted text and warnings are stored. These remain available in
the saved run; original-file download and binary forwarding to provider-specific
file APIs are not implemented. Draft extractions are owner-scoped, expire after
24 hours, and are cleaned at server startup and the next upload. At most 20
pending drafts per account are retained. Removing a draft deletes its extraction.

## Implementation and operations

`POST /api/attachments` accepts authenticated `application/octet-stream` requests
with the existing request-protection header and an encoded `X-File-Name` header.
`DELETE /api/attachments/:id` removes only the caller's pending extraction.
`POST /api/runs` accepts up to four `attachmentIds`, resolves them by owner and
expiry, and stores snapshots with the run. The original prompt stays readable;
`attachmentContext` inserts the snapshots into each peer's user message as
untrusted source material. The session list excludes attachment bodies.

An additive SQLite `attachments` table stores drafts; existing runs remain valid.
The readers use `pdf-parse` for PDF text, Mammoth for DOCX text, and yauzl for
bounded ZIP inspection. A child process has a 20-second deadline, a 384 MiB V8
old-space ceiling and a minimal environment without provider credentials. This
is fault isolation, not an OS security sandbox or a total-RSS memory limit.
Two readers may run at once, one per account. Archives have entry, expanded-size
and actual-inflation limits. No uploaded archive is unpacked onto the filesystem.

The managed Nginx configuration increases its request ceiling to 21 MiB; the
application still enforces 20 MiB specifically on uploads. Other JSON requests
retain their existing 512 KiB limit. Self-hosted reverse proxies must allow the
same upload size and at least 20 seconds for extraction. No new worker service,
external parser executable or paid API is required.

This change does not add file picking to the TUI, OCR, image attachments, full
APK analysis or board evidence labels. Production release approval is separate.

## Greeting routing

The shared engine now answers standalone greetings and thanks with a short,
fixed reply and zero model or tool calls. This applies to web, CLI and TUI;
there is no multi-agent debate or capability verification for `hello`. The
complete message must match a conservative greeting list. `Hello, debug this`
remains a task. Attachments and resumed team work are never skipped by this rule.
A raw `userMessage` field preserves this distinction when follow-ups also carry
previous conversation context. This is not general automatic complexity routing.
