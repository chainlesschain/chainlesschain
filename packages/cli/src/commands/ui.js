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
    .option(
      "--ui-mode <mode>",
      'UI rendering mode: "auto" (default), "full" (require Vue panel), or "minimal" (embedded HTML only)',
      "auto",
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
          uiMode: opts.uiMode || "auto",
        });
        await runtime.startUiServer();
      } catch (err) {
        logger.error(`Failed to start UI server: ${err.message}`);
        process.exit(1);
      }
    });
}

// === Iter26 V2 governance overlay ===
export function registerWebuigovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "ui");
  if (!parent) return;
  const L = async () => await import("../lib/web-ui-server.js");
  parent
    .command("webuigov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.WEBUIGOV_PROFILE_MATURITY_V2,
            requestLifecycle: m.WEBUIGOV_REQUEST_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("webuigov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveWebuigovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingWebuigovRequestsPerProfileV2(),
            idleMs: m.getWebuigovProfileIdleMsV2(),
            stuckMs: m.getWebuigovRequestStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("webuigov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveWebuigovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("webuigov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingWebuigovRequestsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("webuigov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setWebuigovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("webuigov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setWebuigovRequestStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("webuigov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--endpoint <v>", "endpoint")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerWebuigovProfileV2({ id, owner, endpoint: o.endpoint }),
          null,
          2,
        ),
      );
    });
  parent
    .command("webuigov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateWebuigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-degrade-v2 <id>")
    .description("Degrade profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).degradeWebuigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveWebuigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchWebuigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getWebuigovProfileV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listWebuigovProfilesV2(), null, 2),
      );
    });
  parent
    .command("webuigov-create-request-v2 <id> <profileId>")
    .description("Create request")
    .option("--method <v>", "method")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createWebuigovRequestV2({ id, profileId, method: o.method }),
          null,
          2,
        ),
      );
    });
  parent
    .command("webuigov-serving-request-v2 <id>")
    .description("Mark request as serving")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).servingWebuigovRequestV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-complete-request-v2 <id>")
    .description("Complete request")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeRequestWebuigovV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-fail-request-v2 <id> [reason]")
    .description("Fail request")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failWebuigovRequestV2(id, reason), null, 2),
      );
    });
  parent
    .command("webuigov-cancel-request-v2 <id> [reason]")
    .description("Cancel request")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify(
          (await L()).cancelWebuigovRequestV2(id, reason),
          null,
          2,
        ),
      );
    });
  parent
    .command("webuigov-get-request-v2 <id>")
    .description("Get request")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).getWebuigovRequestV2(id), null, 2),
      );
    });
  parent
    .command("webuigov-list-requests-v2")
    .description("List requests")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).listWebuigovRequestsV2(), null, 2),
      );
    });
  parent
    .command("webuigov-auto-degrade-idle-v2")
    .description("Auto-degrade idle")
    .action(async () => {
      console.log(
        JSON.stringify(
          (await L()).autoDegradeIdleWebuigovProfilesV2(),
          null,
          2,
        ),
      );
    });
  parent
    .command("webuigov-auto-fail-stuck-v2")
    .description("Auto-fail stuck requests")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckWebuigovRequestsV2(), null, 2),
      );
    });
  parent
    .command("webuigov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getWebUiServerGovStatsV2(), null, 2),
      );
    });
}
