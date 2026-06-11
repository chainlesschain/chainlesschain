/**
 * `cc init --ai` — agent-enhanced inventory (claude /init parity, module 99
 * §5.2). Runs AFTER the offline census wrote the starter cc.md: a bounded
 * headless agent reads the repo (README, entry files) and rewrites cc.md so
 * the Conventions section holds real, observed conventions instead of the
 * "(add project rules here)" placeholder.
 *
 * Self-reference guard: the child run executes with CC_PROJECT_MEMORY=0 so
 * the half-baked cc.md being refined is NOT injected into the very agent
 * refining it. Restored in finally.
 *
 * Offline inventory stays the `cc init` default — this is strictly opt-in
 * (needs a reachable LLM).
 */

export const AI_REFINE_MAX_TURNS = 12;
export const AI_REFINE_TOOLS = [
  "read_file",
  "list_dir",
  "search_files",
  "write_file",
];

export function buildRefinePrompt() {
  return [
    "You are refining this project's memory file `cc.md` (it was just generated from an offline folder census).",
    "Steps:",
    "1. read_file cc.md to see the current draft.",
    "2. Read the README and one or two key entry/config files to learn the project's real conventions (code style, commit format, how to run tests, architecture notes worth remembering).",
    "3. write_file cc.md with the refined version: KEEP the existing sections and data, but replace the placeholder under `## Conventions` with concrete, observed conventions (5-10 short bullets max). Do not invent facts you did not see.",
    "Keep the file concise — it is loaded into every agent run.",
  ].join("\n");
}

/**
 * Run the refine pass.
 * @param {object} opts { cwd, provider?, model?, baseUrl?, apiKey?,
 *                        maxTurns?, runHeadless? (test seam) }
 * @returns {Promise<{exitCode:number, result:string, isError:boolean}>}
 */
export async function aiRefineMemoryFile(opts = {}) {
  const run =
    opts.runHeadless ||
    (await import("../runtime/headless-runner.js")).runAgentHeadless;

  const prev = process.env.CC_PROJECT_MEMORY;
  process.env.CC_PROJECT_MEMORY = "0"; // self-reference guard
  try {
    return await run({
      prompt: buildRefinePrompt(),
      cwd: opts.cwd || process.cwd(),
      provider: opts.provider || undefined,
      model: opts.model || undefined,
      baseUrl: opts.baseUrl || undefined,
      apiKey: opts.apiKey || undefined,
      permissionMode: "acceptEdits", // write_file must work headless
      allowedTools: AI_REFINE_TOOLS,
      maxTurns: opts.maxTurns || AI_REFINE_MAX_TURNS,
      expandFileRefs: false,
      outputFormat: "text",
    });
  } finally {
    if (prev === undefined) delete process.env.CC_PROJECT_MEMORY;
    else process.env.CC_PROJECT_MEMORY = prev;
  }
}
