/**
 * Project-memory commands (CLI 0.162.41 batch) — pure helpers behind the
 * "Generate Project Memory (cc.md)" / "Show Project Memory Files" palette
 * commands. The CLI does the real work (`chainlesschain init` inventories the
 * folder into a cc.md that `cc agent` auto-loads; `memory files` shows the
 * effective chain); the extension just drives it in an integrated terminal,
 * which already carries the bridge env (CHAINLESSCHAIN_IDE_PORT/TOKEN), so a
 * follow-up `chainlesschain agent` in the same terminal gets IDE context too.
 *
 * Kept free of any `vscode` import so the logic is unit-testable from the CLI
 * test suite (same pattern as ide-tools.js / lockfile.js).
 */

const TERMINAL_NAME = "ChainlessChain";

/** Build the `init` command line for the picked mode. */
function buildInitCommand({ ai = false, force = false } = {}) {
  return [
    "chainlesschain init",
    ai ? "--ai" : "",
    force ? "--force" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Build the `memory files` command line. */
function buildMemoryFilesCommand() {
  return "chainlesschain memory files";
}

/** QuickPick items for the init command (offline census vs --ai refine). */
function initQuickPickItems() {
  return [
    {
      label: "$(checklist) Offline inventory (default)",
      detail:
        "chainlesschain init — census languages/scripts/layout into a starter cc.md",
      args: {},
    },
    {
      label: "$(sparkle) Inventory + AI refine (--ai)",
      detail:
        "Bounded headless agent fills the Conventions section with observed facts (needs a reachable LLM)",
      args: { ai: true },
    },
  ];
}

/**
 * Run a command line in the shared ChainlessChain terminal (reused by name
 * when still alive, created at `cwd` otherwise). Returns the terminal.
 */
function runInTerminal(vscodeApi, command, cwd) {
  const existing = (vscodeApi.window.terminals || []).find(
    (t) => t.name === TERMINAL_NAME && !t.exitStatus,
  );
  const term =
    existing ||
    vscodeApi.window.createTerminal({ name: TERMINAL_NAME, cwd });
  term.show(true);
  term.sendText(command);
  return term;
}

module.exports = {
  TERMINAL_NAME,
  buildInitCommand,
  buildMemoryFilesCommand,
  initQuickPickItems,
  runInTerminal,
};
