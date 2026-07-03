/**
 * cc code-intel — semantic code navigation via the Language Server Protocol.
 *
 * End-to-end surface for the LSP code-intelligence layer (Phase 2 of the CLI
 * optimization plan). Proves the stack works without touching the contended
 * agent-core; the agent `code_intelligence` tool is wired separately.
 *
 *   cc code-intel status                          # which servers are installed
 *   cc code-intel def <file> <line> <col>         # go to definition
 *   cc code-intel refs <file> <line> <col>        # find references
 *   cc code-intel hover <file> <line> <col>       # type / doc info
 *   cc code-intel symbols <file>                  # document symbols
 *   cc code-intel wsymbols <query>                # workspace symbol search
 *   cc code-intel diag <file>                     # diagnostics
 *   cc code-intel rename <file> <line> <col> <newName>   # preview a rename
 *
 * Positions are 1-based (line/col), matching editor gutters.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

function num(v, name) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${name} must be a positive integer (1-based), got "${v}"`);
  }
  return n;
}

async function withCI(fn, { json } = {}) {
  const { CodeIntelligence } = await import("../lib/lsp/code-intelligence.js");
  // coldStart: each CLI invocation spawns a fresh server, so wait for the
  // project to load before querying (the warm agent path leaves this off).
  const ci = new CodeIntelligence({
    projectRoot: process.cwd(),
    coldStart: true,
  });
  try {
    const result = await fn(ci);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    await ci.dispose();
  }
}

function reportUnavailable(res) {
  logger.warn(
    chalk.yellow(`LSP unavailable: ${res.reason}`) +
      chalk.gray(
        "\n  → falling back to text search (`cc search` / agent search_files)",
      ),
  );
  process.exitCode = 3;
}

function fmtLoc(l) {
  const pos = `${chalk.cyan(l.file)}:${chalk.yellow(l.line)}:${l.col}`;
  return l.snippet ? `${pos}  ${chalk.gray(l.snippet)}` : pos;
}

export function registerCodeIntelCommand(program) {
  const ci = program
    .command("code-intel")
    .alias("ci")
    .description(
      "Semantic code navigation via LSP (definition/references/symbols/diagnostics)",
    );

  ci.command("status")
    .description("Show which language servers are installed and detectable")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const { probeServers, supportedExtensions } =
        await import("../lib/lsp/lsp-server-registry.js");
      // Surface plugin-contributed servers too (Phase 3: .lsp.json).
      const { ensurePluginLspServers } =
        await import("../lib/plugin-runtime/lsp.js");
      ensurePluginLspServers({ cwd: process.cwd() });
      const servers = probeServers(process.cwd());
      if (options.json) {
        console.log(
          JSON.stringify(
            { servers, extensions: supportedExtensions() },
            null,
            2,
          ),
        );
        return;
      }
      logger.log(chalk.bold("LSP servers:"));
      for (const s of servers) {
        const mark = s.available ? chalk.green("✔") : chalk.gray("✖");
        const where = s.available
          ? chalk.gray(s.command)
          : chalk.gray("not installed");
        logger.log(`  ${mark} ${s.id.padEnd(28)} ${where}`);
      }
      const anyAvail = servers.some((s) => s.available);
      if (!anyAvail) {
        logger.log(
          chalk.yellow(
            "\nNo language servers found. Install one to enable semantic navigation, e.g.:\n",
          ) + chalk.gray("  npm i -g typescript-language-server typescript"),
        );
      }
    });

  ci.command("def <file> <line> <col>")
    .description("Go to definition of the symbol at file:line:col")
    .option("--json", "Output as JSON")
    .action(async (file, line, col, options) => {
      const res = await withCI(
        (c) => c.definition(file, num(line, "line"), num(col, "col")),
        options,
      );
      if (!res.available) return reportUnavailable(res);
      if (options.json) return;
      if (!res.locations.length)
        return logger.log(chalk.gray("No definition found."));
      for (const l of res.locations) logger.log(fmtLoc(l));
    });

  ci.command("refs <file> <line> <col>")
    .description("Find references to the symbol at file:line:col")
    .option("--no-decl", "Exclude the declaration itself")
    .option("--json", "Output as JSON")
    .action(async (file, line, col, options) => {
      const res = await withCI(
        (c) =>
          c.references(file, num(line, "line"), num(col, "col"), {
            includeDeclaration: options.decl !== false,
          }),
        options,
      );
      if (!res.available) return reportUnavailable(res);
      if (options.json) return;
      logger.log(chalk.bold(`${res.locations.length} reference(s):`));
      for (const l of res.locations) logger.log("  " + fmtLoc(l));
    });

  ci.command("hover <file> <line> <col>")
    .description("Show type/doc info for the symbol at file:line:col")
    .option("--json", "Output as JSON")
    .action(async (file, line, col, options) => {
      const res = await withCI(
        (c) => c.hover(file, num(line, "line"), num(col, "col")),
        options,
      );
      if (!res.available) return reportUnavailable(res);
      if (options.json) return;
      logger.log(res.contents || chalk.gray("No hover info."));
    });

  ci.command("symbols <file>")
    .description("List symbols declared in a document")
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      const res = await withCI((c) => c.documentSymbols(file), options);
      if (!res.available) return reportUnavailable(res);
      if (options.json) return;
      for (const s of res.symbols) {
        const loc = chalk.gray(`${s.line}:${s.col}`);
        const kind = chalk.magenta(s.kind.padEnd(10));
        const container = s.container ? chalk.gray(` (${s.container})`) : "";
        logger.log(`  ${loc}  ${kind} ${s.name}${container}`);
      }
    });

  ci.command("wsymbols <query>")
    .description("Search symbols across the workspace by name")
    .option("--json", "Output as JSON")
    .action(async (query, options) => {
      const res = await withCI((c) => c.workspaceSymbols(query), options);
      if (!res.available) return reportUnavailable(res);
      if (options.json) return;
      logger.log(chalk.bold(`${res.symbols.length} symbol(s):`));
      for (const s of res.symbols) {
        logger.log(
          `  ${chalk.magenta(s.kind.padEnd(10))} ${s.name}  ${chalk.gray(`${s.file}:${s.line}`)}`,
        );
      }
    });

  ci.command("diag <file>")
    .description("Show diagnostics (errors/warnings) for a file")
    .option(
      "--timeout <ms>",
      "How long to wait for the server to publish",
      "5000",
    )
    .option("--json", "Output as JSON")
    .action(async (file, options) => {
      const res = await withCI(
        (c) =>
          c.diagnostics(file, { timeoutMs: num(options.timeout, "timeout") }),
        options,
      );
      if (!res.available) return reportUnavailable(res);
      if (options.json) return;
      if (!res.diagnostics.length)
        return logger.log(chalk.green("No diagnostics."));
      for (const d of res.diagnostics) {
        const sev =
          d.severity === "error"
            ? chalk.red(d.severity)
            : d.severity === "warning"
              ? chalk.yellow(d.severity)
              : chalk.gray(d.severity);
        logger.log(
          `  ${chalk.gray(`${d.line}:${d.col}`)} ${sev} ${d.message}${d.code ? chalk.gray(` [${d.code}]`) : ""}`,
        );
      }
    });

  ci.command("rename <file> <line> <col> <newName>")
    .description(
      "Preview a symbol rename across files (does NOT apply the edit)",
    )
    .option("--json", "Output as JSON")
    .action(async (file, line, col, newName, options) => {
      const res = await withCI(
        (c) =>
          c.renamePreview(file, num(line, "line"), num(col, "col"), newName),
        options,
      );
      if (!res.available) return reportUnavailable(res);
      if (options.json) return;
      const total = res.edits.reduce((n, f) => n + f.edits.length, 0);
      logger.log(
        chalk.bold(
          `Rename would touch ${res.edits.length} file(s), ${total} edit(s):`,
        ),
      );
      for (const f of res.edits) {
        logger.log(`  ${chalk.cyan(f.file)} — ${f.edits.length} edit(s)`);
        for (const e of f.edits) {
          logger.log(chalk.gray(`      ${e.line}:${e.col} → "${e.newText}"`));
        }
      }
      logger.log(
        chalk.gray(
          "\n(preview only — apply with your editor or agent edit tools)",
        ),
      );
    });

  return ci;
}
