/**
 * serve command — start a WebSocket server for remote CLI access
 * chainlesschain serve [--port] [--host] [--token] [--max-connections] [--timeout] [--allow-remote] [--project]
 */

import { logger } from "../lib/logger.js";
import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";
import { captureAgentSkillOutcomeIndex } from "../lib/evolution/agent-evolution-runtime-composition-brand.js";
import { captureSkillVectorAuthority } from "../lib/skill-vector-authority.js";
import { captureSkillRetrievalRevocationReader } from "../lib/evolution/skill-retrieval-revocation-authority.js";
import { isEvolutionWorkbenchCliHost } from "../lib/evolution/evolution-workbench-cli-host.js";
import { isGovernedKnowledgeReviewHost } from "../lib/evolution/governed-knowledge-review-host.js";
import path from "node:path";

export function captureServeGovernanceHosts({
  evolutionWorkbenchHost = null,
  governedKnowledgeReviewHost = null,
} = {}) {
  if (
    evolutionWorkbenchHost !== null &&
    !isEvolutionWorkbenchCliHost(evolutionWorkbenchHost)
  ) {
    throw new TypeError(
      "serve evolutionWorkbenchHost must be a branded Workbench host",
    );
  }
  if (
    governedKnowledgeReviewHost !== null &&
    !isGovernedKnowledgeReviewHost(governedKnowledgeReviewHost)
  ) {
    throw new TypeError(
      "serve governedKnowledgeReviewHost must be a branded review host",
    );
  }
  return Object.freeze({
    evolutionWorkbenchHost,
    governedKnowledgeReviewHost,
  });
}

export function registerServeCommand(program, dependencies = {}) {
  const evolutionCompositionFactory =
    dependencies.evolutionCompositionFactory ?? null;
  const skillOutcomeIndex =
    dependencies.skillOutcomeIndex == null
      ? null
      : captureAgentSkillOutcomeIndex(dependencies.skillOutcomeIndex);
  const skillVectorAuthority =
    dependencies.skillVectorAuthority == null
      ? null
      : captureSkillVectorAuthority(dependencies.skillVectorAuthority);
  const skillRetrievalRevocationReader =
    dependencies.skillRetrievalRevocationReader == null
      ? null
      : captureSkillRetrievalRevocationReader(
          dependencies.skillRetrievalRevocationReader,
        );
  const governanceHosts = captureServeGovernanceHosts(dependencies);
  const serve = program
    .command("serve")
    .description("Start WebSocket server for remote CLI access")
    .option(
      "--app-server",
      "Run the canonical CC App Server over stdio instead of the legacy WebSocket server",
    )
    .option(
      "--app-server-websocket",
      "Use the experimental canonical App Server WebSocket transport (requires --app-server)",
    )
    .option(
      "--app-server-state-dir <path>",
      "Owner-controlled rollout directory (JSONL directory or SQLite parent)",
    )
    .option(
      "--app-server-state-path <path>",
      "Exact JSONL directory or SQLite database path for --app-server",
    )
    .option(
      "--app-server-store <backend>",
      "Physical rollout adapter: jsonl or sqlite (default: jsonl)",
    )
    .option(
      "--app-server-queue-cap <n>",
      "Maximum queued App Server requests",
      "256",
    )
    .option(
      "--app-server-tls-cert <path>",
      "TLS certificate for non-loopback App Server WebSocket binding",
    )
    .option(
      "--app-server-tls-key <path>",
      "TLS private key for non-loopback App Server WebSocket binding",
    )
    .option("-p, --port <port>", "Port number", "18800")
    .option("-H, --host <host>", "Bind host", "127.0.0.1")
    .option(
      "--token <token>",
      "Authentication token (required for remote access and App Server WebSocket)",
    )
    .option("--max-connections <n>", "Maximum concurrent connections", "10")
    .option(
      "--timeout <ms>",
      "Command execution timeout in milliseconds",
      "30000",
    )
    .option(
      "--allow-remote",
      "Allow non-localhost connections (requires --token)",
    )
    .option("--project <path>", "Default project root for sessions")
    .option(
      "--remote-session-relay-url <url>",
      "Signaling relay URL for Remote Session pairing",
    )
    .option(
      "--remote-session-peer-id <id>",
      "Stable relay peer ID for this local runtime",
    )
    .option(
      "--http-port <port>",
      "Hosted HTTP port for Phase 5 envelope SSE (disabled if unset)",
    )
    .option(
      "--bundle <path>",
      "Agent bundle directory; may execute local MCP commands from mcp.json",
    )
    .action(async (opts) => {
      try {
        if (opts.appServerWebsocket && !opts.appServer) {
          throw new Error("--app-server-websocket requires --app-server");
        }
        if (opts.appServerStateDir && opts.appServerStatePath) {
          throw new Error(
            "--app-server-state-dir and --app-server-state-path are mutually exclusive",
          );
        }
        if (opts.appServer) {
          const [
            { runStdioAppServer },
            { closeRolloutStore, createRolloutStore },
            { CliAgentKernelAdapter },
          ] = await Promise.all([
            import("../lib/app-server/stdio-transport.js"),
            import("../lib/app-server/rollout-store-factory.js"),
            import("../lib/app-server/cli-agent-kernel-adapter.js"),
          ]);
          const stateDirectory = opts.appServerStateDir
            ? path.resolve(opts.appServerStateDir)
            : undefined;
          const statePath = opts.appServerStatePath
            ? path.resolve(opts.appServerStatePath)
            : undefined;
          const store = createRolloutStore({
            backend: opts.appServerStore,
            directory: stateDirectory,
            location: statePath,
          });
          const cwd = opts.project ? path.resolve(opts.project) : process.cwd();
          const maxQueuedRequests = Math.max(
            1,
            parseInt(opts.appServerQueueCap, 10) || 256,
          );
          if (opts.appServerWebsocket) {
            const { WebSocketAppServerHost } =
              await import("../lib/app-server/websocket-transport.js");
            const host = new WebSocketAppServerHost({
              host: opts.host,
              port: parseInt(opts.port, 10),
              token: opts.token || process.env.CHAINLESSCHAIN_APP_SERVER_TOKEN,
              allowRemote: opts.allowRemote === true,
              tlsCertPath: opts.appServerTlsCert,
              tlsKeyPath: opts.appServerTlsKey,
              maxConnections: parseInt(opts.maxConnections, 10),
              store,
              kernelFactory: () => new CliAgentKernelAdapter({ cwd }),
              evolutionCompositionFactory,
              skillOutcomeIndex,
              skillVectorAuthority,
              skillRetrievalRevocationReader,
              ...governanceHosts,
              maxQueuedRequests,
            });
            const info = await host.start();
            logger.info(
              `CC App Server WebSocket (${info.stability}) listening on ${info.url}`,
            );
            let shutdown;
            let fail;
            try {
              await new Promise((resolve, reject) => {
                shutdown = () => resolve();
                fail = (error) => reject(error);
                process.once("SIGINT", shutdown);
                process.once("SIGTERM", shutdown);
                host.once("error", fail);
              });
            } finally {
              process.off("SIGINT", shutdown);
              process.off("SIGTERM", shutdown);
              host.off("error", fail);
              await host.close();
              closeRolloutStore(store);
            }
            return;
          }
          try {
            await runStdioAppServer({
              store,
              kernel: new CliAgentKernelAdapter({ cwd }),
              evolutionCompositionFactory,
              skillOutcomeIndex,
              skillVectorAuthority,
              skillRetrievalRevocationReader,
              ...governanceHosts,
              maxQueuedRequests,
            });
          } finally {
            closeRolloutStore(store);
          }
          return;
        }
        const runtime = createAgentRuntimeFactory({
          deps:
            evolutionCompositionFactory === null
              ? {}
              : { evolutionCompositionFactory },
          skillOutcomeIndex,
          skillVectorAuthority,
          skillRetrievalRevocationReader,
        }).createServerRuntime({
          port: parseInt(opts.port, 10),
          host: opts.host,
          token: opts.token,
          maxConnections: parseInt(opts.maxConnections, 10),
          timeout: parseInt(opts.timeout, 10),
          allowRemote: opts.allowRemote,
          project: opts.project,
          httpPort: opts.httpPort ? parseInt(opts.httpPort, 10) : null,
          bundlePath: opts.bundle || null,
          remoteSessionRelayUrl: opts.remoteSessionRelayUrl || null,
          remoteSessionPeerId: opts.remoteSessionPeerId || null,
        });
        await runtime.startServer();
      } catch (err) {
        logger.error(`Failed to start server: ${err.message}`);
        process.exit(1);
      }
    });

  serve
    .command("migrate-rollouts")
    .description(
      "Verify or copy canonical rollouts between physical storage adapters",
    )
    .requiredOption("--from <backend>", "Source adapter: jsonl or sqlite")
    .requiredOption(
      "--from-path <path>",
      "Source JSONL directory or SQLite database file",
    )
    .requiredOption("--to <backend>", "Target adapter: jsonl or sqlite")
    .requiredOption(
      "--to-path <path>",
      "Target JSONL directory or SQLite database file",
    )
    .option(
      "--thread <id...>",
      "Migrate only the named thread ids (otherwise enumerate the source)",
    )
    .option(
      "--apply",
      "Copy verified records; without this flag the command is a dry run",
    )
    .action(async (opts) => {
      const { closeRolloutStore, createRolloutStore } =
        await import("../lib/app-server/rollout-store-factory.js");
      let source;
      let target;
      try {
        source = createRolloutStore({
          backend: opts.from,
          location: path.resolve(opts.fromPath),
        });
        target = createRolloutStore({
          backend: opts.to,
          location: path.resolve(opts.toPath),
        });
        const result = source.migrate({
          targetStore: target,
          threadIds: opts.thread || null,
          dryRun: opts.apply !== true,
        });
        process.stdout.write(
          `${JSON.stringify(
            {
              ...result,
              source: { backend: source.backend, location: source.location },
              target: { backend: target.backend, location: target.location },
            },
            null,
            2,
          )}\n`,
        );
      } finally {
        closeRolloutStore(target);
        closeRolloutStore(source);
      }
    });
}
