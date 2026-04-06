import { logger } from "../lib/logger.js";
import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";

export function registerUiCommand(program) {
  program
    .command("ui")
    .description("Start a local web management UI (project or global mode)")
    .option("-p, --port <port>", "HTTP server port", "18810")
    .option("--ws-port <port>", "WebSocket server port", "18800")
    .option("-H, --host <host>", "Bind host", "127.0.0.1")
    .option("--no-open", "Do not open browser automatically")
    .option(
      "--token <token>",
      "Authentication token for WebSocket (recommended for security)",
    )
    .option(
      "--web-panel-dir <dir>",
      "Path to built web-panel dist/ directory (auto-detected by default)",
    )
    .action(async (opts) => {
      try {
        const runtime = createAgentRuntimeFactory().createUiRuntime({
          port: parseInt(opts.port, 10),
          wsPort: parseInt(opts.wsPort, 10),
          host: opts.host,
          open: opts.open,
          token: opts.token || null,
          webPanelDir: opts.webPanelDir || null,
        });
        await runtime.startUiServer();
      } catch (err) {
        logger.error(`Failed to start UI server: ${err.message}`);
        process.exit(1);
      }
    });
}
