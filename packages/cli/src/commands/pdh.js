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
import { setupMcpFromConfig } from "../runtime/mcp-config.js";
import { readFeedback, summarizeFeedback } from "../lib/pdh-feedback-ledger.js";

function emit(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

/** Concatenate the text blocks of an MCP tool result, else null. */
function mcpResultText(r) {
  if (!r) return null;
  if (Array.isArray(r.content)) {
    const t = r.content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    if (t) return t;
  }
  if (typeof r.result === "string") return r.result;
  return null;
}

async function safeDisconnectAll(out) {
  try {
    await out?.mcpClient?.disconnectAll?.();
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Live connectivity probe for the discovered PDH bridge — the cc-side
 * diagnostic the list/status/doctor inspectors lack: list/status/doctor only
 * read lockfiles, this actually **connects** and verifies the server responds
 * (discover → connect → `pdh_ping` round-trip → report). Best-effort; always
 * disconnects. The result NEVER carries the bearer token. Injectable for tests.
 *
 * @returns {Promise<object>} { ok, stage, reason?, device?, port?, transport?,
 *   tools?, latencyMs?, pingAttempted?, pingOk?, pingText?, pingError? }
 */
export async function probePdhBridge(opts = {}, deps = {}) {
  const env = opts.env || process.env;
  const discover = deps.discoverPdhServer || discoverPdhServer;
  const connect = deps.setupMcpFromConfig || setupMcpFromConfig;
  const now = deps.now || (() => Date.now());

  const lock = discover({ env });
  if (!lock) {
    return {
      ok: false,
      stage: "discover",
      reason: "no live PDH server discovered (run `cc pdh doctor`)",
    };
  }
  const base = {
    device: lock.device,
    port: lock.port,
    transport: lock.transport,
  };
  const cfg = pdhServerToMcpConfig(lock);
  const start = now();
  let out;
  try {
    out = await connect({ pdh: cfg }, { writeErr: () => {} });
  } catch (err) {
    return { ok: false, stage: "connect", reason: err.message, ...base };
  }
  const conn = (out.connected || []).find((c) => c.server === "pdh");
  if (!conn) {
    await safeDisconnectAll(out);
    return {
      ok: false,
      stage: "connect",
      reason: "server did not connect (no tools)",
      ...base,
    };
  }
  // The bare tool names the bridge exposes (mcp__pdh__collect_files →
  // collect_files), so the probe shows WHICH collectors a device advertises —
  // confirming the bridge version/capabilities, not just a count.
  const toolNames = (out.extraToolDefinitions || [])
    .map((t) => t && t.function && t.function.name)
    .filter((n) => typeof n === "string")
    .map((n) =>
      n.startsWith("mcp__pdh__") ? n.slice("mcp__pdh__".length) : n,
    );
  // Round-trip via pdh_ping when the bridge exposes it; otherwise the
  // tools/list that connect already performed is itself proof of liveness.
  const hasPing = toolNames.includes("pdh_ping");
  let pingOk = null;
  let pingText = null;
  let pingError = null;
  if (hasPing) {
    try {
      const r = await out.mcpClient.callTool("pdh", "pdh_ping", {});
      pingOk = !r?.isError;
      pingText = mcpResultText(r);
    } catch (err) {
      pingOk = false;
      pingError = err.message;
    }
  }
  await safeDisconnectAll(out);
  return {
    ok: pingOk !== false, // connected; an attempted ping must not have failed
    stage: "ping",
    ...base,
    tools: conn.tools,
    toolNames,
    latencyMs: now() - start,
    pingAttempted: hasPing,
    pingOk,
    pingText,
    pingError,
  };
}

/** Strip the raw bearer token + internal _file path from a lock for output. */
function redactLock(lock) {
  if (!lock) return null;
  const { token, _file, ...rest } = lock;
  return { ...rest, hasToken: !!token };
}

export function registerPdhCommand(program, deps = {}) {
  const probe = deps.probePdhBridge || probePdhBridge;
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

  pdh
    .command("ping")
    .description(
      "Connect to the discovered PDH server and verify it responds (pdh_ping round-trip)",
    )
    .option("--json", "Machine-readable output")
    .action(async (options) => {
      const res = await probe({ env: process.env });
      if (options.json) {
        emit(res);
      } else if (res.stage === "discover") {
        console.log(
          chalk.yellow("No PDH server discovered.") +
            chalk.gray(" Run `cc pdh doctor` for why."),
        );
      } else if (!res.ok) {
        console.log(
          chalk.red(
            `PDH ${res.device}:${res.port} — ${res.stage} failed: ` +
              `${res.reason || res.pingError || "unknown"}`,
          ),
        );
      } else {
        const tag = res.pingAttempted
          ? res.pingOk
            ? chalk.green("pong")
            : chalk.red("ping failed")
          : chalk.gray("connected (no pdh_ping tool)");
        console.log(
          `PDH ${chalk.cyan(res.device)}:${res.port} ${chalk.green("OK")} — ` +
            `${tag}, ${res.tools} tools, ${res.latencyMs}ms`,
        );
        if (res.toolNames && res.toolNames.length) {
          console.log(chalk.gray("  tools: " + res.toolNames.join(", ")));
        }
        if (res.pingText) console.log(chalk.gray("  " + res.pingText));
      }
      if (!res.ok) process.exitCode = 1;
    });

  pdh
    .command("feedback")
    .description(
      "Show what cc has learned from your cross-session corrections (§3.5.13 flywheel)",
    )
    .option("--json", "Machine-readable output")
    .action((options) => {
      const read = deps.readFeedback || readFeedback;
      const summarize = deps.summarizeFeedback || summarizeFeedback;
      const summary = summarize(read());
      if (options.json) {
        emit(summary);
        return;
      }
      // Honest empty state (§3.5.18: surface "尚无" truthfully, never hide).
      if (!summary.total) {
        console.log(
          chalk.gray("尚无跨会话反馈记录 (no cross-session feedback yet)."),
        );
        return;
      }
      console.log(chalk.bold(`PDH 自学习反馈 (${summary.total} 条)`));
      console.log(
        `  ${chalk.green("👍 " + summary.positive)}  ` +
          `${chalk.red("👎 " + summary.negative)}  ` +
          `净倾向 ${summary.sentiment >= 0 ? "+" : ""}${summary.sentiment}`,
      );
      if (summary.corrections.length) {
        console.log(chalk.bold("  已记住的纠正 (最新优先):"));
        for (const c of summary.corrections) {
          console.log(chalk.gray(`    • ${c}`));
        }
      }
    });

  return pdh;
}
