/**
 * `cc remote-control` — unified cross-device entry (gap-analysis 第四阶段 #1).
 *
 * One command composes the existing remote-session stack (WS server + E2EE
 * relay + registry + push + audit) into the Claude-Code `/remote-control`
 * shape:
 *
 *   cc remote-control                 # start host + print pairing URI/QR
 *   cc remote-control start --relay-url wss://relay… --peer-id my-desktop
 *   cc remote-control status [--json]
 *   cc remote-control stop [--port N]
 *
 * `start` boots the WS server IN-PROCESS, then opens a loopback client that
 * acts as the remote session HOST (the registry closes a remote session when
 * its host disconnects, so this client stays open for the server's lifetime).
 * With a relay configured you get the E2EE `chainlesschain://remote-session/…`
 * URI; without one you get a direct-LAN pairing URI embedding ws://<lan-ip>.
 * Devices join with observe/prompt/approve/interrupt scopes — the same wire
 * contract the web-panel and Android client already speak.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { loadConfig } from "../lib/config-manager.js";
import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";
import { WsRpcClient } from "../lib/ws-rpc-client.js";
import {
  buildDirectPairingUri,
  pickLanAddress,
  readRemoteControlStates,
  removeRemoteControlState,
  renderQrCode,
  resolveRemoteControlOptions,
  writeRemoteControlState,
} from "../lib/remote-control.js";

export function registerRemoteControlCommand(program) {
  const cmd = program
    .command("remote-control")
    .alias("rc")
    .description(
      "Unified remote-control entry — pair mobile/web devices to drive this machine's agent sessions",
    );

  cmd
    .command("start", { isDefault: true })
    .description(
      "Start the remote-control host (WS server + remote session) and print the pairing URI/QR",
    )
    .option("-p, --port <port>", "WS server port (default 18800)")
    .option("--host <host>", "Bind host (default 0.0.0.0)")
    .option("--token <token>", "Server auth token (default: auto-generated)")
    .option(
      "--relay-url <url>",
      "Signaling relay URL for E2EE pairing (falls back to direct LAN pairing when unset)",
    )
    .option("--peer-id <id>", "Stable relay peer ID for this host")
    .option(
      "--scopes <csv>",
      "Granted device scopes (observe,prompt,approve,interrupt)",
    )
    .option("--name <name>", "Remote session display name")
    .option(
      "--session <agentSessionId>",
      "Attach to an existing agent session instead of creating a new one",
    )
    .option("--no-qr", "Skip terminal QR rendering")
    .option("--json", "Emit machine-readable pairing JSON and keep serving")
    .action(async (options) => {
      const result = await runRemoteControlStart(options);
      if (result.code !== 0) process.exit(result.code);
    });

  cmd
    .command("status")
    .description("Show discovered remote-control hosts on this machine")
    .option("--json", "Machine-readable JSON output")
    .option("--prune", "Remove stale state files (dead pid)")
    .action((options) => {
      process.exitCode = runRemoteControlStatus(options);
    });

  cmd
    .command("stop")
    .description("Stop a running remote-control host")
    .option("-p, --port <port>", "Port of the host to stop")
    .option("--json", "Machine-readable JSON output")
    .action((options) => {
      process.exitCode = runRemoteControlStop(options);
    });
}

/**
 * Boot the host: server runtime + loopback host client + remote session +
 * pairing printout + discovery state. Resolves `{code}` (0 = serving; the
 * server + host client keep the process alive) plus live handles so tests and
 * embedders can tear the host down (`{client, server, state}`).
 */
export async function runRemoteControlStart(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const errLog = _deps.err || ((m) => logger.error(m));
  const env = _deps.env || process.env;
  const stateDir = _deps.stateDir; // undefined → default dir
  let config = {};
  try {
    config = _deps.loadConfig ? _deps.loadConfig() : loadConfig();
  } catch {
    // config is optional for remote-control
  }

  let resolved;
  try {
    resolved = resolveRemoteControlOptions({
      flags: {
        port: options.port,
        host: options.host,
        token: options.token,
        relayUrl: options.relayUrl,
        peerId: options.peerId,
        scopes: options.scopes,
        name: options.name,
      },
      env,
      config,
    });
  } catch (err) {
    errLog(err.message);
    return { code: 4 };
  }

  // Refuse to double-start on a port that already has a LIVE host.
  const existing = readRemoteControlStates({ dir: stateDir }).find(
    (state) => state.port === resolved.port && state.alive,
  );
  if (existing) {
    errLog(
      `remote-control host already running on port ${resolved.port} (pid ${existing.pid}). ` +
        `Use \`cc remote-control status\` or \`cc remote-control stop --port ${resolved.port}\`.`,
    );
    return { code: 2 };
  }

  let server;
  try {
    const startServer =
      _deps.startServer ||
      (async () =>
        createAgentRuntimeFactory()
          .createServerRuntime({
            port: resolved.port,
            host: resolved.host,
            token: resolved.token,
            allowRemote: resolved.host !== "127.0.0.1",
            remoteSessionRelayUrl: resolved.relayUrl,
            remoteSessionPeerId: resolved.peerId,
          })
          .startServer());
    server = await startServer(resolved);
  } catch (err) {
    errLog(`Failed to start remote-control host: ${err.message}`);
    return { code: 1 };
  }

  // Loopback HOST connection — must stay open, its disconnect closes the
  // remote session (registry semantics).
  const client =
    _deps.createClient?.(resolved) ||
    new WsRpcClient({ url: `ws://127.0.0.1:${resolved.port}` });
  let remoteSession;
  let pairing;
  let agentSessionId = options.session || null;
  try {
    await client.connect();
    await client.auth(resolved.token);
    if (!agentSessionId) {
      const created = await client.request("session-create", {
        sessionType: "agent",
        projectRoot: _deps.cwd || process.cwd(),
      });
      agentSessionId =
        created.sessionId ||
        created.payload?.sessionId ||
        created.session?.sessionId ||
        created.session?.id;
      if (!agentSessionId) {
        throw new Error("session-create returned no sessionId");
      }
    }
    const createdRemote = await client.request("remote-session-create", {
      sessionId: agentSessionId,
      name: resolved.name,
      scopes: resolved.scopes,
    });
    remoteSession = createdRemote.session;
    pairing = createdRemote.pairing;
  } catch (err) {
    errLog(`Failed to create remote session: ${err.message}`);
    client.close();
    try {
      await server.stop?.();
    } catch {
      // best-effort teardown
    }
    return { code: 1 };
  }

  const relayMode = Boolean(pairing?.uri);
  const lanAddress = _deps.lanAddress || pickLanAddress() || "127.0.0.1";
  const wsUrl = `ws://${lanAddress}:${resolved.port}`;
  const pairingUri = relayMode
    ? pairing.uri
    : buildDirectPairingUri({
        wsUrl,
        serverToken: resolved.token,
        remoteSessionId: remoteSession.sessionId,
        agentSessionId,
        pairingToken: pairing.token,
        scopes: pairing.scopes,
        expiresAt: pairing.expiresAt,
      });

  const state = {
    pid: process.pid,
    port: resolved.port,
    host: resolved.host,
    wsUrl,
    token: resolved.token,
    mode: relayMode ? "relay" : "direct",
    relayUrl: resolved.relayUrl || null,
    peerId: resolved.peerId || null,
    agentSessionId,
    remoteSessionId: remoteSession.sessionId,
    scopes: pairing.scopes,
    startedAt: new Date().toISOString(),
  };
  const stateFile = writeRemoteControlState(state, { dir: stateDir });
  const cleanup = () => {
    removeRemoteControlState(resolved.port, { dir: stateDir });
  };
  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  if (options.json) {
    log(
      JSON.stringify(
        {
          mode: state.mode,
          wsUrl,
          port: resolved.port,
          agentSessionId,
          remoteSessionId: remoteSession.sessionId,
          pairingUri,
          pairing: {
            token: pairing.token,
            scopes: pairing.scopes,
            expiresAt: pairing.expiresAt,
          },
          stateFile,
        },
        null,
        2,
      ),
    );
  } else {
    log("");
    log(chalk.bold("  Remote Control ready"));
    log("");
    log(
      `  Mode:        ${state.mode === "relay" ? chalk.cyan("relay (E2EE)") : chalk.cyan("direct LAN")}`,
    );
    log(`  WS server:   ${chalk.cyan(wsUrl)}`);
    log(`  Agent sess:  ${agentSessionId}`);
    log(`  Remote sess: ${remoteSession.sessionId}`);
    log(`  Scopes:      ${pairing.scopes.join(", ")}`);
    log(
      `  Token exp:   ${pairing.expiresAt ? new Date(pairing.expiresAt).toISOString() : "n/a"} ${chalk.dim("(one-time; re-run start for another device)")}`,
    );
    log("");
    log("  Pairing URI (open in ChainlessChain mobile / paste in web panel):");
    log("");
    log("    " + chalk.green(pairingUri));
    if (options.qr !== false) {
      const qr = await renderQrCode(pairingUri, _deps);
      if (qr) {
        log("");
        log(
          qr
            .split("\n")
            .map((line) => "  " + line)
            .join("\n"),
        );
      } else {
        log("");
        log(
          chalk.dim(
            "  (install the optional `qrcode` package for a terminal QR)",
          ),
        );
      }
    }
    log("");
    log(chalk.dim("  Press Ctrl+C to stop"));
    log("");
  }

  return { code: 0, client, server, state, pairingUri };
}

export function runRemoteControlStatus(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const states = readRemoteControlStates({ dir: _deps.stateDir });
  if (options.prune) {
    for (const state of states) {
      if (!state.alive && state.port) {
        removeRemoteControlState(state.port, { dir: _deps.stateDir });
      }
    }
  }
  if (options.json) {
    log(
      JSON.stringify(
        // The token stays in the 0600 state file — status output may be pasted
        // into issues/chat, so redact it here.
        states.map(({ token: _token, ...rest }) => rest),
        null,
        2,
      ),
    );
    return 0;
  }
  if (states.length === 0) {
    log(chalk.gray("\n  No remote-control hosts found.\n"));
    return 0;
  }
  log("");
  log(chalk.bold("  Remote-control hosts:\n"));
  for (const state of states) {
    if (state.invalid) {
      log(`  ${chalk.red("invalid")}  ${state.stateFile}`);
      continue;
    }
    const badge = state.alive ? chalk.green("running") : chalk.yellow("stale");
    log(
      `  ${badge}  port ${String(state.port).padEnd(6)} pid ${String(state.pid).padEnd(8)} ` +
        `${(state.mode || "?").padEnd(7)} session ${state.agentSessionId || "?"}`,
    );
  }
  log("");
  return 0;
}

export function runRemoteControlStop(options = {}, _deps = {}) {
  const log = _deps.log || ((m) => console.log(m));
  const errLog = _deps.err || ((m) => logger.error(m));
  const kill = _deps.kill || ((pid) => process.kill(pid));
  const states = readRemoteControlStates({ dir: _deps.stateDir }).filter(
    (state) => !state.invalid,
  );
  const port = options.port ? Number(options.port) : null;
  const candidates = port
    ? states.filter((state) => state.port === port)
    : states;
  if (candidates.length === 0) {
    errLog(
      port
        ? `No remote-control host recorded on port ${port}.`
        : "No remote-control hosts recorded.",
    );
    return 2;
  }
  if (!port && candidates.filter((state) => state.alive).length > 1) {
    errLog(
      "Multiple hosts running — specify which with --port. Use `cc remote-control status` to list.",
    );
    return 4;
  }
  let failures = 0;
  const results = [];
  for (const state of candidates) {
    let stopped = false;
    if (state.alive) {
      try {
        kill(state.pid);
        stopped = true;
      } catch (err) {
        failures += 1;
        errLog(`Failed to stop pid ${state.pid}: ${err.message}`);
      }
    }
    removeRemoteControlState(state.port, { dir: _deps.stateDir });
    results.push({ port: state.port, pid: state.pid, stopped });
    if (!options.json) {
      log(
        stopped
          ? chalk.green(
              `  ✓ stopped host on port ${state.port} (pid ${state.pid})`,
            )
          : chalk.gray(
              `  · cleaned stale record for port ${state.port} (pid ${state.pid} not running)`,
            ),
      );
    }
  }
  if (options.json) log(JSON.stringify({ results }, null, 2));
  return failures > 0 ? 1 : 0;
}
