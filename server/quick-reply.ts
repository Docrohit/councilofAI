import type { Run } from "../shared/types.ts";

// Conservative whole-message routing, not a task-complexity classifier. Never
// match a greeting prefix: "hello, debug this" still needs normal task handling.
export function quickReply(
  run: Pick<Run, "prompt" | "userMessage" | "attachments" | "resumeState">,
): string | undefined {
  if (run.resumeState || run.attachments?.length) return;
  const message = (run.userMessage ?? run.prompt).normalize("NFKC").trim();
  if (message.length > 80) return;
  const plain = message
    .toLowerCase()
    .replace(/[.!?,\s👋]+$/u, "")
    .trim();
  if (
    /^(hello|hi|hey|hiya|greetings|namaste|namaskar|नमस्ते|नमस्कार)(?: (?:council|everyone|there))?$/.test(
      plain,
    ) ||
    /^(good morning|good afternoon|good evening)$/.test(plain) ||
    message === "👋"
  )
    return "Hello! What would you like to work on?";
  if (/^(thanks|thank you|thanks council|thank you council)$/.test(plain))
    return "You're welcome!";
  return undefined;
}
