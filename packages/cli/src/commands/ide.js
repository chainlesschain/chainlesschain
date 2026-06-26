/**
 * `cc ide` — inspect IDE bridge discovery (Phase 0).
 *
 * The agent auto-connects a running editor's MCP server when inside an IDE
 * integrated terminal (or with `cc agent --ide`). These subcommands make that
 * discovery visible and debuggable WITHOUT running an agent:
 *
 *   cc ide list             list live IDE lockfiles found
 *   cc ide status           which server `cc agent` would connect to (+ its MCP config)
 *   cc ide doctor           explain WHY discovery did / didn't pick a server
 *
 * Pure read-only over ~/.chainlesschain/ide/*.json — see
 * docs/design/modules/98_IDE桥接对标方案.md.
 */
import chalk from "chalk";
import {
  readIdeLocks,
  discoverIdeServer,
  ideServerToMcpConfig,
  isInIdeTerminal,
  ideLockDir,
  diagnoseIde,
} from "../lib/ide-bridge.js";
import { diagnoseJetbrains } from "../lib/jetbrains-bridge.js";

function emit(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

export function registerIdeCommand(program) {
  const ide = program
    .command("ide")
    .description(
      "Inspect IDE bridge discovery (editor MCP server auto-connect)",
    );

  ide
    .command("list")
    .description("List live IDE lockfiles (editor MCP servers advertised)")
    .option("--json", "Machine-readable output")
    .action((options) => {
      const locks = readIdeLocks();
      if (options.json) {
        // Never surface the raw bearer token or internal _file path.
        const safe = locks.map(({ token, _file, ...rest }) => ({
          ...rest,
          hasToken: !!token,
        }));
        emit({ lockDir: ideLockDir(), count: safe.length, locks: safe });
        return;
      }
      if (!locks.length) {
        console.log(chalk.gray(`No live IDE lockfiles in ${ideLockDir()}`));
        console.log(
          chalk.gray(
            "Start an IDE extension that advertises one, or run `cc ide doctor`.",
          ),
        );
        return;
      }
      console.log(
        chalk.bold(`IDE servers (${locks.length}) in ${ideLockDir()}:`),
      );
      for (const l of locks) {
        console.log(
          `  ${chalk.cyan(l.ide)}  port ${l.port}  ${l.transport}  ` +
            `${l.token ? chalk.green("token") : chalk.yellow("no-token")}`,
        );
        console.log(chalk.gray(`    url ${l.url}`));
        if (l.workspaceFolders.length) {
          console.log(chalk.gray(`    ws  ${l.workspaceFolders.join(", ")}`));
        }
      }
    });

  ide
    .command("status")
    .description("Show the IDE server `cc agent` would connect to right now")
    .option("--ide", "Force selection even outside an IDE terminal")
    .option("--json", "Machine-readable output")
    .action((options) => {
      const env = process.env;
      const cwd = process.cwd();
      const inIde = isInIdeTerminal(env);
      const lock = discoverIdeServer({ cwd, env, force: options.ide === true });
      const cfg = lock ? ideServerToMcpConfig(lock) : null;
      // Redact the bearer token in the previewed config.
      const safeCfg = cfg
        ? {
            ...cfg,
            headers: cfg.headers?.Authorization
              ? { ...cfg.headers, Authorization: "Bearer ***" }
              : cfg.headers,
          }
        : null;
      if (options.json) {
        // Strip the raw token + internal _file from the chosen lock.
        const safeChosen = lock
          ? (({ token, _file, ...rest }) => ({ ...rest, hasToken: !!token }))(
              lock,
            )
          : null;
        emit({
          inIdeTerminal: inIde,
          chosen: safeChosen,
          mcpConfig: safeCfg,
        });
        return;
      }
      console.log(
        `In IDE terminal: ${inIde ? chalk.green("yes") : chalk.gray("no")}`,
      );
      if (!lock) {
        console.log(
          chalk.gray(
            "No IDE server would be connected. Try `cc ide doctor` for why.",
          ),
        );
        return;
      }
      console.log(
        `Would connect: ${chalk.cyan(lock.ide)} on port ${lock.port} ` +
          `(${lock.transport}) as MCP server ${chalk.bold("ide")}`,
      );
      console.log(chalk.gray("MCP config:"));
      console.log(chalk.gray("  " + JSON.stringify(safeCfg)));
    });

  ide
    .command("doctor")
    .description("Explain why IDE discovery did / didn't pick a server")
    .option("--ide", "Diagnose as if --ide (force) were passed")
    .option("--json", "Machine-readable output")
    .action((options) => {
      const diag = diagnoseIde({
        cwd: process.cwd(),
        env: process.env,
        force: options.ide === true,
      });
      if (options.json) {
        emit(diag);
        return;
      }
      console.log(chalk.bold("IDE bridge discovery"));
      console.log(`  lock dir       : ${diag.lockDir}`);
      console.log(
        `  in IDE terminal: ${diag.inIdeTerminal ? chalk.green("yes") : chalk.gray("no")}`,
      );
      console.log(`  live locks     : ${diag.locks.length}`);
      for (const l of diag.locks) {
        const m =
          l.matchScore >= 0
            ? chalk.green(`workspace-match(${l.matchScore})`)
            : chalk.yellow("no-workspace-match");
        console.log(
          `    - ${chalk.cyan(l.ide)} port ${l.port} ${l.transport} ` +
            `${l.hasToken ? "token" : chalk.yellow("no-token")} ${m}`,
        );
      }
      console.log(
        `  result         : ${
          diag.chosen
            ? chalk.green(`connect ${diag.chosen.ide}:${diag.chosen.port}`)
            : chalk.yellow("nothing to connect")
        }`,
      );
      console.log(`  reason         : ${diag.reason}`);
    });

  ide
    .command("jetbrains")
    .description(
      "Show whether IntelliJ IDEA's built-in MCP (server `idea`) would auto-connect",
    )
    .option("--json", "Machine-readable output")
    .action((options) => {
      const diag = diagnoseJetbrains({ env: process.env });
      if (options.json) {
        emit(diag);
        return;
      }
      console.log(chalk.bold("IDEA built-in MCP (server `idea`)"));
      console.log(
        `  endpoint injected: ${
          diag.supported ? chalk.green("yes") : chalk.gray("no")
        }`,
      );
      if (diag.chosen) {
        console.log(
          `  would connect    : ${chalk.cyan(diag.chosen.url)} ` +
            `(${diag.chosen.transport}) ` +
            `${diag.chosen.hasToken ? chalk.green("token") : chalk.yellow("no-token")}`,
        );
      } else {
        console.log(`  would connect    : ${chalk.yellow("nothing")}`);
      }
      console.log(`  reason           : ${diag.reason}`);
      if (!diag.supported) {
        console.log(
          chalk.gray(
            "\n  IDEA 2025.2+ exposes a built-in MCP server (Settings | Tools |",
          ),
        );
        console.log(
          chalk.gray(
            "  MCP Server). The ChainlessChain JetBrains plugin injects its",
          ),
        );
        console.log(
          chalk.gray(
            "  endpoint into the cc it spawns — run cc from the plugin's chat",
          ),
        );
        console.log(
          chalk.gray(
            "  panel / IDE terminal, or set CHAINLESSCHAIN_JETBRAINS_MCP_URL.",
          ),
        );
      }
    });

  return ide;
}
