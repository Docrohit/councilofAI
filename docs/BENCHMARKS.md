# Compare one problem at a time

Open **Benchmarks** in the web workspace. Choose a real baseline connection and
configure the Council team. The default mode runs one selected problem. Inspect
both complete answers, then use **Next problem** to choose another. Starting a
new trial always starts a fresh Council and baseline context.

**Paste a custom problem** accepts the entire statement, an optional source and
an optional reference solution. Include every condition identically for both
sides. The reference is saved privately in the report and is never sent in solver
requests. Use **Proof / independent review** for proofs and open-ended coding or
reasoning tasks. These results remain **Needs review**; matching text does not
prove a proof correct. Exact/numeric grading requires a reference and checks a
final-answer marker, not the validity of the reasoning. Batch comparison remains
available for selected suite tasks.

Choose a one-call baseline or give it the Council's actual call count for
sequential refinement. This matches calls, not tokens, cost or compute. Both
sides have web research, project execution and deterministic verification tools
disabled. The built-in short problems are harness smoke tests, not an Olympiad
benchmark or evidence that collaboration outperforms a single model.

Reports retain the exact problem, source/reference, selected model IDs, complete
answers, grading explanations, timings, calls and available provider token counts.
Download the JSON for independent evaluation. The report remains accessible after
reload. Council's result is saved before baseline execution; cancellation or a
server restart preserves completed results and partial baseline text. Interrupted
comparisons do not automatically resume and should not be counted as successes.
Model streaming partials are saved after a baseline call finishes, not after every
token; a crash during the first call can lose its in-flight text.

Run repeated paired trials; include failures. For proofs, randomize and blind the
answers before independent review, preserve objections and verify disputed steps.
A single winning example or unblinded model judge does not establish superiority.
There are no new live-provider benchmark results claimed by this change.
