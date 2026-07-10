/**
 * `cc artifacts` — browse/manage the agent-published deliverable store
 * (gap-analysis P1 #10). The `publish_artifact` agent tool copies finished
 * deliverables (reports/patches/screenshots/logs) into
 * `~/.chainlesschain/artifacts/`; this command is the user-facing surface:
 *
 *   cc artifacts list [--session <id>] [--kind <k>] [--json]
 *   cc artifacts show <id> [--json]        metadata + stored path
 *   cc artifacts open <id>                 print the stored path (pipe/open)
 *   cc artifacts remove <id>
 *   cc artifacts clean [--json]            drop expired artifacts (TTL)
 */

import chalk from "chalk";
import { ArtifactStore } from "../lib/artifact-store.js";

export function registerArtifactsCommand(program) {
  const cmd = program
    .command("artifacts")
    .alias("artifact")
    .description(
      "Browse agent-published deliverables (reports/patches/screenshots; see the publish_artifact tool)",
    );

  cmd
    .command("list", { isDefault: true })
    .description("List published artifacts")
    .option("--session <id>", "Only artifacts from one agent session")
    .option(
      "--kind <kind>",
      "Filter by kind (report|patch|screenshot|log|data|other)",
    )
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runArtifactsList(options);
    });

  cmd
    .command("show <id>")
    .description("Show one artifact's metadata + stored path")
    .option("--json", "Machine-readable JSON output")
    .action((id, options) => {
      process.exitCode = runArtifactsShow(id, options);
    });

  cmd
    .command("open <id>")
    .description("Print the artifact's stored file path (for piping/opening)")
    .action((id) => {
      process.exitCode = runArtifactsOpen(id);
    });

  cmd
    .command("remove <id>")
    .alias("rm")
    .description("Remove one artifact (stored copy + metadata)")
    .option("--json", "Machine-readable JSON output")
    .action((id, options) => {
      process.exitCode = runArtifactsRemove(id, options);
    });

  cmd
    .command("clean")
    .description("Remove expired artifacts (past their TTL)")
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runArtifactsClean(options);
    });
}

export function runArtifactsList(options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  let entries = store.list({ sessionId: options.session });
  if (options.kind) {
    entries = entries.filter((e) => e.kind === String(options.kind));
  }
  if (options.json) {
    console.log(JSON.stringify({ artifacts: entries }, null, 2));
    return 0;
  }
  if (entries.length === 0) {
    console.log(
      chalk.dim(
        "No artifacts. Agents publish deliverables with the publish_artifact tool.",
      ),
    );
    return 0;
  }
  for (const e of entries) {
    console.log(
      `${chalk.cyan(e.id)}  ${chalk.bold(e.title)}  ${chalk.dim(
        `[${e.kind}] ${e.mime} ${e.size}B ${e.createdAt}${
          e.sessionId ? ` session=${e.sessionId}` : ""
        }`,
      )}`,
    );
  }
  console.log(
    chalk.dim(`${entries.length} artifact(s). cc artifacts show <id>`),
  );
  return 0;
}

export function runArtifactsShow(id, options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  const entry = store.get(id);
  if (!entry) {
    console.error(chalk.red(`No artifact with id "${id}".`));
    return 1;
  }
  const payload = { ...entry, storedPath: store.storedPath(entry) };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  for (const [k, v] of Object.entries(payload)) {
    console.log(`${chalk.dim(k.padEnd(11))} ${v == null ? "" : v}`);
  }
  return 0;
}

export function runArtifactsOpen(id, deps = {}) {
  const store = deps.store || new ArtifactStore();
  const entry = store.get(id);
  if (!entry) {
    console.error(chalk.red(`No artifact with id "${id}".`));
    return 1;
  }
  console.log(store.storedPath(entry));
  return 0;
}

export function runArtifactsRemove(id, options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  const found = store.remove(id);
  if (options.json) {
    console.log(JSON.stringify({ removed: found ? id : null, found }));
    return found ? 0 : 1;
  }
  if (!found) {
    console.error(chalk.red(`No artifact with id "${id}".`));
    return 1;
  }
  console.log(chalk.green(`Removed ${id}.`));
  return 0;
}

export function runArtifactsClean(options = {}, deps = {}) {
  const store = deps.store || new ArtifactStore();
  const { removed } = store.cleanupExpired();
  if (options.json) {
    console.log(JSON.stringify({ removed }));
    return 0;
  }
  console.log(
    removed > 0
      ? chalk.green(`Removed ${removed} expired artifact(s).`)
      : chalk.dim("Nothing expired."),
  );
  return 0;
}
