/**
 * `cc pdh` — inspect PDH bridge discovery (Phase 0).
 *
 * The agent auto-connects the Android app's "device capability" MCP server
 * (collect / query / file / task tools) when the app spawns cc with
 * `CHAINLESSCHAIN_PDH_PORT` set, or via a lockfile scan for external agents.
 * These subcommands make that discovery visible and debuggable WITHOUT running
 * an agent:
 *
 *   cc pdh list             list live PDH lockfiles found
 *   cc pdh status           which server `cc agent` would connect to (+ its MCP config)
 *   cc pdh doctor           explain WHY discovery did / didn't pick a server
 *
 * Pure read-only over ~/.chainlesschain/pdh-bridge/*.json — mirrors `cc ide`
 * (module 98). See docs/design/modules/101_个人数据IDE桥接方案.md.
 */
import chalk from "chalk";
import {
  readPdhLocks,
  discoverPdhServer,
  pdhServerToMcpConfig,
  isInPdhTerminal,
  pdhLockDir,
  diagnosePdh,
} from "../lib/pdh-bridge.js";

function emit(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

/** Strip the raw bearer token + internal _file path from a lock for output. */
function redactLock(lock) {
  if (!lock) return null;
  const { token, _file, ...rest } = lock;
  return { ...rest, hasToken: !!token };
}

export function registerPdhCommand(program) {
  const pdh = program
    .command("pdh")
    .description(
      "Inspect PDH bridge discovery (Android personal-data MCP server auto-connect)",
    );

  pdh
    .command("list")
    .description(
      "List live PDH lockfiles (device capability MCP servers advertised)",
    )
    .option("--json", "Machine-readable output")
    .action((options) => {
      const locks = readPdhLocks();
      if (options.json) {
        // Never surface the raw bearer token or internal _file path.
        const safe = locks.map(redactLock);
        emit({ lockDir: pdhLockDir(), count: safe.length, locks: safe });
        return;
      }
      if (!locks.length) {
        console.log(chalk.gray(`No live PDH lockfiles in ${pdhLockDir()}`));
        console.log(
          chalk.gray(
            "Start the app's PDH bridge server, or run `cc pdh doctor`.",
          ),
        );
        return;
      }
      console.log(
        chalk.bold(`PDH servers (${locks.length}) in ${pdhLockDir()}:`),
      );
      for (const l of locks) {
        console.log(
          `  ${chalk.cyan(l.device)}  port ${l.port}  ${l.transport}  ` +
            `${l.token ? chalk.green("token") : chalk.yellow("no-token")}`,
        );
        console.log(chalk.gray(`    url ${l.url}`));
        if (l.appUid != null) {
          console.log(chalk.gray(`    uid ${l.appUid}`));
        }
      }
    });

  pdh
    .command("status")
    .description("Show the PDH server `cc agent` would connect to right now")
    .option("--json", "Machine-readable output")
    .action((options) => {
      const env = process.env;
      const inPdh = isInPdhTerminal(env);
      const lock = discoverPdhServer({ env });
      const cfg = lock ? pdhServerToMcpConfig(lock) : null;
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
        emit({
          inPdhTerminal: inPdh,
          chosen: redactLock(lock),
          mcpConfig: safeCfg,
        });
        return;
      }
      console.log(
        `In PDH terminal: ${inPdh ? chalk.green("yes") : chalk.gray("no")}`,
      );
      if (!lock) {
        console.log(
          chalk.gray(
            "No PDH server would be connected. Try `cc pdh doctor` for why.",
          ),
        );
        return;
      }
      console.log(
        `Would connect: ${chalk.cyan(lock.device)} on port ${lock.port} ` +
          `(${lock.transport}) as MCP server ${chalk.bold("pdh")}`,
      );
      console.log(chalk.gray("MCP config:"));
      console.log(chalk.gray("  " + JSON.stringify(safeCfg)));
    });

  pdh
    .command("doctor")
    .description("Explain why PDH discovery did / didn't pick a server")
    .option("--json", "Machine-readable output")
    .action((options) => {
      const diag = diagnosePdh({ env: process.env });
      if (options.json) {
        emit(diag);
        return;
      }
      console.log(chalk.bold("PDH bridge discovery"));
      console.log(`  lock dir       : ${diag.lockDir}`);
      console.log(
        `  in PDH terminal: ${diag.inPdhTerminal ? chalk.green("yes") : chalk.gray("no")}`,
      );
      console.log(`  live locks     : ${diag.locks.length}`);
      for (const l of diag.locks) {
        console.log(
          `    - ${chalk.cyan(l.device)} port ${l.port} ${l.transport} ` +
            `${l.hasToken ? "token" : chalk.yellow("no-token")}` +
            `${l.appUid != null ? ` uid ${l.appUid}` : ""}`,
        );
      }
      console.log(
        `  result         : ${
          diag.chosen
            ? chalk.green(`connect ${diag.chosen.device}:${diag.chosen.port}`)
            : chalk.yellow("nothing to connect")
        }`,
      );
      console.log(`  reason         : ${diag.reason}`);
    });

  return pdh;
}
