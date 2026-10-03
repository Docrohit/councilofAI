# Media orchestration learnings from Hygaar/HDB

Date: 2026-10-03

This note extracts reusable media-orchestration lessons from the separate Hygaar
IQ/HDB backend and console repositories. Hygaar is not a Council dependency, and
these notes do not describe shipped Council behavior. Use this as design input
for Council's planned image/video generation, editing, review, file artifact and
Telegram/API media workflows.

Inspected source roots:

- Backend: `/Users/rohitsharma/Desktop/M2026/Main_products/hdb_oct17/hdb_backend_v2`
- Console: `/Users/rohitsharma/Desktop/M2026/Main_products/hdb_oct17/console_hygaar/console_live`

The backend checkout had unrelated local dirt when inspected. This review was
read-only.

## Hygaar Patterns Worth Keeping

Hygaar separates media work into concrete stages:

- Agent 3 generates images from planned inputs, model configuration and image
  references.
- Agent 3c reforms generated images against correction criteria, optional
  references and annotations.
- Agent 4 reviews quality, selects flawed outputs and dispatches regeneration.
- Agent 8 creates product videos, with a legacy multi-clip mode and a smart
  one-video-per-SKU mode.
- Agent 9 adds music to completed videos.

The strongest architectural lesson is that media tasks are not just chat turns.
They are long-running jobs with typed inputs, provider-specific constraints,
artifact records, status polling, provider task IDs, payload provenance and
retry/failure states. Council should model them as first-class tool jobs rather
than as free-form model messages.

## Image Provider Contracts

Hygaar's `docs/IMAGE_MODEL_PAYLOAD_REFERENCE.md` records useful payload shapes
and model caps. Council should keep an equivalent, code-backed provider contract
file when media tools land.

### OpenAI Images

Use for text-to-image and image editing. Hygaar's production lesson was severe:
logs counted all downloaded references while the OpenAI `images.edit` call sent
only `file_objects[0]`, silently dropping face and satellite references. Council
must record both prepared input count and actual sent input count.

Contract:

```json
{
  "model": "gpt-image-2",
  "image": ["<file_obj_1>", "<file_obj_2>"],
  "prompt": "<prompt>",
  "size": "1024x1536",
  "quality": "high",
  "n": 1
}
```

Council requirements:

- Support generate and edit as separate adapter operations.
- Accept multiple references for edit, up to the provider cap.
- Normalize oversized inputs before upload.
- Persist `actual_sent_image_count`, filenames/hashes, target size, quality,
  provider request id and revised prompt when exposed.
- Fail closed when image downloads fail instead of silently using fewer
  references unless the user/agent explicitly accepts degraded input.

### Gemini Image / Nano Banana

Hygaar's Gemini image path sends a `contents` payload with text plus image parts,
then `generationConfig` with response modalities and `imageConfig`.

Contract:

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "<prompt>" },
        { "inlineData": { "mimeType": "image/jpeg", "data": "<base64>" } }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "temperature": 0.4,
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "4K"
    }
  }
}
```

Council requirements:

- Allow inline data for small inputs and a file/upload route for large inputs.
- Treat `imageSize`, `aspectRatio`, thinking/search flags and temperature as
  adapter-specific config, not universal media fields.
- Store output image and any text/reasoning summary separately.

### Seed Dream

Hygaar uses Seed Dream for multi-reference image editing/generation and smart
3c reform. It sends image URLs directly, often as an array, and normalizes large
inputs before the provider call.

Contract:

```json
{
  "model": "seedream-5-0-260128",
  "prompt": "<prompt>",
  "image": ["https://example.com/ref1.jpg", "https://example.com/ref2.jpg"],
  "size": "2K",
  "response_format": "url",
  "watermark": false
}
```

Council requirements:

- Support URL-based reference inputs as well as uploaded local artifacts.
- Attach input-normalization metadata to the artifact record.
- Preserve role labels for each image, such as target image, product reference,
  detail crop or operator reference.

### Qwen, GLM and Kling Image

Hygaar routes several other image providers:

- Qwen uses a multimodal message content list with `{ "text": ... }` and
  `{ "image": "https://..." }` entries.
- GLM image is prompt/size driven in the inspected path and does not carry
  reference images in the same way.
- Kling image uses `image_list` with provider-specific `omni_version`,
  `resolution`, `aspect_ratio` and prompt.

Council requirements:

- Do not flatten provider differences into one fake universal payload.
- Define a normalized Council request first, then adapter-specific lowering.
- Store the lowered provider payload with secrets redacted.

## Video Provider Contracts

Agent 8 Smart is the most useful model for Council's later media loop. It
stages work through Redis and database records:

1. Setup records and resolve keys.
2. Build a storyboard prompt with OpenAI.
3. Submit a provider task.
4. Poll/webhook for completion.
5. Save the output video and merge outro/music.

Council can implement the same pattern with a simpler local store.

### Seedance Video

Hygaar documents Seedance as BytePlus ModelArk task creation with `content`
items and role labels.

Useful roles:

- Text: `{ "type": "text", "text": "..." }`
- Reference images: `role: "reference_image"`
- Last frame: `role: "last_frame"`
- Reference video: `role: "reference_video"`
- Reference audio: `role: "reference_audio"`

Important constraints:

- Bearer API key auth.
- Task endpoint returns a task id.
- Status endpoint returns running/succeeded/failed state.
- Ratios include `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`.
- Duration is provider-constrained and not identical to Kling.
- Audio has size/duration preflight constraints in Hygaar.

Council requirements:

- Represent video generation as an async `media_job`, not a blocking chat call.
- Support `reference_images`, `last_frame`, `reference_videos`,
  `reference_audio`, `ratio`, `duration`, `generate_audio` and `watermark`.
- Prefer callback/webhook when available, with polling as a sweeper fallback.

### Kling Video

Hygaar distinguishes direct Kling image-to-video and Omni Video paths. Direct
Kling auth uses a JWT generated from `ACCESS_KEY|SECRET_KEY`.

Useful fields:

- `model_name`
- `prompt`
- `image_list`
- `video_list`
- `mode`
- `aspect_ratio`
- `duration`
- `external_task_id`
- `callback_url`

Important constraints:

- Provider model names must be exact, for example `kling-v2-5-turbo`,
  `kling-v3`, `kling-video-o1`, `kling-v3-omni`.
- Resource/concurrency errors must be treated differently from exhausted
  credits.
- Submit concurrency should be bounded separately from polling concurrency.

Council requirements:

- Keep a provider-wide admission controller for long-running media jobs.
- Preserve `external_task_id`, provider task id, selected model, effective
  model and callback URL in the run artifact.
- Make retryable provider pressure visible on the board instead of hiding it as
  generic failure.

## Review And Regeneration Loop

Hygaar's Agent 3c and Agent 4 show two complementary loops:

- Agent 3c: user criteria plus optional reference images produce a fixation
  prompt and regenerated image.
- Agent 4: automated quality scoring selects flawed images and regenerates a
  bounded subset.

Council should combine these as a goal-oriented media loop:

1. Ingest original media and user goal.
2. A reviewer model creates acceptance criteria and known risks.
3. A generator/editor model creates an artifact.
4. A reviewer compares artifact to the goal and records evidence on the board.
5. A prompt designer writes a revised generation/edit prompt if the goal is not
   met.
6. The loop repeats until accepted by the council or bounded limits force a
   qualified stop.

The board should record:

- Goal and acceptance criteria.
- Input artifacts with hashes and roles.
- Provider selected, effective model and adapter operation.
- Prompt used and prompt revision number.
- Generated artifact URLs/files.
- Review verdict, failing criteria and evidence.
- Next action: accept, regenerate, edit from previous, restart from original or
  ask user.

## Council Media Tool Design

Add a typed media tool layer with these operations:

```ts
type MediaArtifactKind = "image" | "video" | "audio" | "document";

interface MediaArtifact {
  id: string;
  runId: string;
  ownerUserId: string;
  kind: MediaArtifactKind;
  role: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  localPath?: string;
  url?: string;
  provider?: string;
  model?: string;
  sourceArtifactIds?: string[];
  prompt?: string;
  providerPayload?: unknown;
  providerResponse?: unknown;
  createdAt: string;
}
```

```ts
interface MediaGenerateRequest {
  kind: "image" | "video" | "audio";
  prompt: string;
  providerId: string;
  model: string;
  config: Record<string, unknown>;
  referenceArtifactIds?: string[];
}

interface MediaEditRequest {
  sourceArtifactId: string;
  prompt: string;
  providerId: string;
  model: string;
  config: Record<string, unknown>;
  referenceArtifactIds?: string[];
}

interface MediaReviewRequest {
  artifactId: string;
  goal: string;
  criteria?: string[];
  referenceArtifactIds?: string[];
}
```

Initial tools:

- `media_generate_image`
- `media_edit_image`
- `media_review_image`
- `media_generate_video`
- `media_add_audio`
- `media_get_artifact`
- `media_list_artifacts`

Each tool result should be a board-visible event and an artifact record. Agents
should not paste base64 blobs into board text.

## Telegram And API Implications

Telegram should remain a progress channel, but for media workflows it also needs
file intake and artifact output:

- Accept Telegram photos/documents with captions.
- Download Telegram files server-side using the bot token.
- Convert them into Council attachments/artifacts with original filename,
  Telegram file id, MIME type, hash and size.
- Treat caption text as ordinary user message or `/goal` text.
- Reply with board progress, final answer and generated artifact links/files.
- For long jobs, send periodic low-noise status only on stage change, retry,
  failure or completion.

API/MCP should expose the same primitives:

- `start_goal`
- `attach_file`
- `attach_url`
- `send_board_message`
- `media_generate`
- `media_edit`
- `media_review`
- `watch_events`
- `get_artifact`

## Operational Lessons

1. Payload truth matters more than logs. Record what was actually sent to the
   provider, not only what was prepared.
2. Media inputs need roles. A face reference, target image, product image,
   detail crop, last frame and audio track are not interchangeable.
3. Provider caps belong in code and UI. Reference limits, image sizes, duration,
   aspect ratios and audio limits should be normalized before submission.
4. Separate submit and poll lanes. Long media jobs should not block normal chat,
   coding, review or board activity.
5. Use idempotent job records. Retrying should continue or supersede an artifact
   lineage, not create untraceable duplicates.
6. Store provider provenance. Keep requested provider/model and effective
   provider/model after routing or fallback.
7. Use bounded regeneration. Goal mode should keep trying, but with explicit
   attempt, time, cost and provider-pressure limits.
8. Board messages should carry conclusions and evidence, while artifacts carry
   files, payloads and heavy metadata.

## Recommended Council Roadmap

Phase 1: Artifact Store

- Store generated and uploaded media as owner/run-scoped artifacts.
- Add API endpoints to upload/download/list artifacts.
- Add board rendering for artifact cards.

Phase 2: Image Tools

- Add provider adapters for OpenAI image generate/edit and one URL-based
  provider such as Seed Dream or compatible self-hosted image editing.
- Add `media_review_image` for vision models already configured in Council.
- Add a goal-mode regenerate loop using one reviewer and one generator role.

Phase 3: Telegram Media

- Download Telegram photos/documents into the same artifact store.
- Return generated artifacts through Telegram as links or files.

Phase 4: Video Tools

- Add async video job records, provider task ids and status polling.
- Start with one provider contract.
- Add audio overlay after video artifact generation, not inside the chat loop.

Phase 5: MCP

- Wrap the stable API with an MCP server.
- Keep provider credentials in Council accounts, not MCP callers.

## Source Notes

Most useful inspected files:

- `docs/IMAGE_MODEL_PAYLOAD_REFERENCE.md`
- `docs/AGENT3_ALL_REFERENCES_DROPPED_POSTMORTEM_2026-08-21.md`
- `docs/AGENT8_SMART_VIDEO_PROVIDERS_SEEDANCE_KLING.md`
- `docs/SEEDANCE_2_IMPLEMENTATION_COMPLETE.md`
- `QUALITY_CHECK_AGENT_CELERY_GUIDE.md`
- `docs/api_schema/api_video-pipeline_generate.md`
- `docs/api_schema/api_video-pipeline_add-music-to-batch.md`
- `docs/api_schema/api_batch_image-chat-reform.md`
- `hdb/hdb_app/services/image_generation/virtual_tryon.py`
- `hdb/hdb_app/services/image_generation/smart_reform.py`
- `hdb/hdb_app/tasks/video.py`
- `hdb/hdb_app/services/video/pipeline.py`
- `hdb/hdb_app/services/video/smart_video_agent.py`
- `src/layouts/AgentLayout/components/previewArea/Agent3.jsx`
- `src/layouts/AgentLayout/components/previewArea/Agent3C.jsx`
- `src/layouts/AgentLayout/components/previewArea/Agent4.jsx`
- `src/layouts/AgentLayout/components/previewArea/Agent8.jsx`
- `src/layouts/AgentLayout/components/previewArea/Agent9.jsx`
- `src/utils/imageModelCatalog.js`
- `src/utils/openaiImageConfig.js`
