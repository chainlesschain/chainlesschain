/**
 * cc terminal-setup — bind Shift+Enter to insert a newline in the agent REPL
 * (Claude-Code `/terminal-setup` parity).
 *
 *   cc terminal-setup            preview what to configure for this terminal
 *   cc terminal-setup --apply    write the VS Code keybinding (VS Code only)
 *
 * cc multiline works by ending a line with a backslash; this makes Shift+Enter
 * do that for you. Only VS Code can be auto-configured (its user
 * keybindings.json); other terminals get manual instructions.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  detectTerminal,
  vscodeKeybinding,
  vscodeKeybindingsPath,
  parseKeybindings,
  hasKeybinding,
  appendKeybindingText,
  instructionsFor,
} from "../lib/terminal-setup.js";

/** Shared core so the REPL `/terminal-setup` can reuse it. Returns lines. */
export function runTerminalSetup({
  apply = false,
  env = process.env,
  platform = process.platform,
  _fs = fs,
} = {}) {
  const term = detectTerminal(env);
  const lines = [chalk.bold(`Terminal: ${term.name}`)];
  lines.push(
    chalk.gray(
      "Goal: Shift+Enter → newline in the REPL (cc treats a trailing \\ as a line continuation).",
    ),
  );

  if (term.id !== "vscode") {
    lines.push("");
    for (const l of instructionsFor(term.id)) lines.push("  " + l);
    if (apply) {
      lines.push("");
      lines.push(
        chalk.yellow(
          "--apply only auto-configures VS Code; follow the steps above for this terminal.",
        ),
      );
    }
    return { changed: false, lines, terminal: term.id };
  }

  // VS Code: read → check → (optionally) write keybindings.json.
  const kbPath = vscodeKeybindingsPath(platform, env);
  const binding = vscodeKeybinding();
  let text = "";
  try {
    text = _fs.readFileSync(kbPath, "utf-8");
  } catch {
    text = ""; // missing file → we'll create it
  }
  const parsed = parseKeybindings(text);

  if (Array.isArray(parsed) && hasKeybinding(parsed, binding)) {
    lines.push(chalk.green(`Already configured: ${kbPath}`));
    return { changed: false, lines, terminal: term.id, path: kbPath };
  }

  if (!apply) {
    lines.push("");
    lines.push("Would add this to " + chalk.cyan(kbPath) + ":");
    lines.push(chalk.gray(JSON.stringify(binding, null, 2)));
    lines.push("");
    lines.push(
      "Run " +
        chalk.cyan("cc terminal-setup --apply") +
        " to write it, then reload VS Code.",
    );
    return { changed: false, lines, terminal: term.id, path: kbPath };
  }

  // Apply. Bail rather than clobber a file we cannot parse.
  if (parsed === null) {
    lines.push(
      chalk.red(`Could not parse ${kbPath} — add this binding manually:`),
    );
    lines.push(chalk.gray(JSON.stringify(binding, null, 2)));
    return { changed: false, lines, terminal: term.id, path: kbPath };
  }
  const next = appendKeybindingText(text, binding);
  if (next === null) {
    lines.push(chalk.red(`Unexpected keybindings.json shape — add manually:`));
    lines.push(chalk.gray(JSON.stringify(binding, null, 2)));
    return { changed: false, lines, terminal: term.id, path: kbPath };
  }
  try {
    _fs.mkdirSync(path.dirname(kbPath), { recursive: true });
    if (text) _fs.writeFileSync(kbPath + ".bak", text, "utf-8");
    _fs.writeFileSync(kbPath, next, "utf-8");
  } catch (err) {
    lines.push(chalk.red(`Write failed: ${err.message}`));
    return { changed: false, lines, terminal: term.id, path: kbPath };
  }
  lines.push(chalk.green(`Added Shift+Enter binding → ${kbPath}`));
  if (text) lines.push(chalk.gray(`(backup: ${kbPath}.bak)`));
  lines.push(
    chalk.gray("Reload VS Code (Developer: Reload Window) to activate."),
  );
  return { changed: true, lines, terminal: term.id, path: kbPath };
}

export function registerTerminalSetupCommand(program) {
  program
    .command("terminal-setup")
    .description("Bind Shift+Enter to a REPL newline (Claude-Code parity)")
    .option(
      "--apply",
      "Write the keybinding (VS Code only; otherwise prints steps)",
    )
    .action((options) => {
      const res = runTerminalSetup({ apply: options.apply === true });
      for (const l of res.lines) logger.log(l);
    });
}
