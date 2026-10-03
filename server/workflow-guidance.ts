import type { Attachment } from "../shared/attachments.ts";

export function workflowGuidance(
  prompt: string,
  attachments: Attachment[] = [],
) {
  const text =
    `${prompt}\n${attachments.map((a) => `${a.name} ${a.kind} ${a.text}`).join("\n")}`.toLowerCase();
  const parts: string[] = [];
  const hasImage = attachments.some((a) => !!a.dataUrl);
  const imageGoal =
    hasImage ||
    /\b(image|photo|picture|visual|mountain|background|edit|fix|regenerate|generate|make it|turn .* pink|turn .* purple)\b/i.test(
      text,
    );
  const optionsGoal =
    /\b(option chain|options chain|spread|strike|expiry|call|put|iron condor|straddle|strangle|covered call|debit spread|credit spread|max profit|probability of profit|delta|theta|iv|implied volatility)\b/i.test(
      text,
    );

  if (imageGoal)
    parts.push(`IMAGE REVIEW / FIX WORKFLOW:
- Assign capable roles explicitly: a vision reviewer for the original image, a prompt designer, a media generator/editor if a compatible image tool is available, and a critic to compare the new image against the goal.
- Treat attached images as first-class evidence. Assign at least one reviewer to describe the current image, target changes, constraints and failure risks before anyone proposes final acceptance.
- If the goal asks to fix/edit/regenerate an image, use media_generate_image or media_edit_image when a compatible image provider is available. After the tool returns, review the new generated attachment against the goal and iterate with a revised prompt if criteria fail.
- If no media generation tool/provider is available, do not pretend pixels were changed. Provide a precise edit prompt, review criteria and the blocker.
- Board findings should include artifact names/hashes, the edit prompt revision, verdicts against each visual criterion and remaining uncertainty.`);

  if (optionsGoal)
    parts.push(`OPTIONS / STOCK STRATEGY WORKFLOW:
- This is high-stakes financial analysis, not financial advice. Use current web evidence for news, events, rates, earnings, macro context or live-price-sensitive facts when web research is enabled. If web research is disabled, state that limitation.
- Assign capable roles explicitly: market-data collector, fundamentals/news researcher, strategy builder, and risk critic. Use the most capable reasoning model for final synthesis when the team has mixed models.
- Parse the option-chain data from the prompt or attachments: underlying, date/time, expiry, spot, strikes, bid/ask, volume, OI, IV and Greeks when available. Flag stale, missing or illiquid data.
- Compare multiple structures before recommending one: directional debit/credit spreads, iron condor/butterfly, calendar/diagonal, straddle/strangle, covered/protective variants as applicable.
- Score candidates by max risk, max reward, breakevens, liquidity/spread width, IV regime, directional thesis, event risk, assignment risk and probability-of-profit proxy. Prefer defined-risk strategies unless the user explicitly allows undefined risk.
- Publish the recommended legs in a precise table: buy/sell, call/put, strike, expiry, quantity/ratio, expected debit/credit, max loss, max profit, breakeven(s), thesis, invalidation and key risks. Preserve objections from peers.`);

  return parts.length
    ? `\nSPECIALIZED GOAL WORKFLOW GUIDANCE:\n${parts.join("\n\n")}`
    : "";
}
