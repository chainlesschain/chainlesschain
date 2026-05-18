import chalk from "chalk";
import { startApp, isAppRunning } from "../lib/process-manager.js";
import {
  servicesUp,
  findComposeFile,
  isDockerAvailable,
} from "../lib/service-manager.js";
import { loadConfig } from "../lib/config-manager.js";
import logger from "../lib/logger.js";

export function registerStartCommand(program) {
  program
    .command("start")
    .description("Launch ChainlessChain desktop application")
    .option("--headless", "Start backend services only (no GUI)")
    .option("--services", "Also start Docker services")
    .action(async (options) => {
      try {
        const config = loadConfig();

        if (!config.setupCompleted) {
          logger.warn('Setup not completed. Run "chainlesschain setup" first.');
          process.exit(1);
        }

        if (options.services || options.headless) {
          if (!isDockerAvailable()) {
            logger.error(
              "Docker is required for --headless and --services modes",
            );
            process.exit(1);
          }
          const composePath = findComposeFile([
            process.cwd(),
            "backend/docker",
          ]);
          if (composePath) {
            logger.info("Starting Docker services...");
            servicesUp(composePath);
            logger.success("Docker services started");
          } else {
            logger.warn("docker-compose.yml not found");
          }
        }

        if (!options.headless) {
          if (isAppRunning()) {
            logger.info("ChainlessChain is already running");
            return;
          }

          logger.info("Starting ChainlessChain...");
          const pid = startApp({ headless: false });

          if (pid) {
            logger.success(`ChainlessChain started (PID: ${pid})`);
          } else {
            logger.warn("App was already running");
          }
        } else {
          logger.success("Backend services running in headless mode");
        }
      } catch (err) {
        logger.error(`Failed to start: ${err.message}`);
        process.exit(1);
      }
    });
}

// === Iter27 V2 governance overlay ===
export function registerPmgrgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "start");
  if (!parent) return;
  const L = async () => await import("../lib/process-manager.js");
  parent
    .command("pmgrgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.PMGRGOV_PROFILE_MATURITY_V2,
            procLifecycle: m.PMGRGOV_PROC_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgrgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActivePmgrgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingPmgrgovProcsPerProfileV2(),
            idleMs: m.getPmgrgovProfileIdleMsV2(),
            stuckMs: m.getPmgrgovProcStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgrgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActivePmgrgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgrgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingPmgrgovProcsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgrgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setPmgrgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgrgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setPmgrgovProcStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("pmgrgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--kind <v>", "kind")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerPmgrgovProfileV2({ id, owner, kind: o.kind }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgrgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activatePmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmgrgov-stop-v2 <id>")
    .description("Stop profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).stopPmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmgrgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archivePmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmgrgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchPmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("pmgrgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPmgrgovProfileV2(id), null, 2));
    });
  parent
    .command("pmgrgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPmgrgovProfilesV2(), null, 2));
    });
  parent
    .command("pmgrgov-create-proc-v2 <id> <profileId>")
    .description("Create proc")
    .option("--command <v>", "command")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createPmgrgovProcV2({ id, profileId, command: o.command }),
          null,
          2,
        ),
      );
    });
  parent
    .command("pmgrgov-starting-proc-v2 <id>")
    .description("Mark proc as starting")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).startingPmgrgovProcV2(id), null, 2),
      );
    });
  parent
    .command("pmgrgov-complete-proc-v2 <id>")
    .description("Complete proc")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeProcPmgrgovV2(id), null, 2),
      );
    });
  parent
    .command("pmgrgov-fail-proc-v2 <id> [reason]")
    .description("Fail proc")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failPmgrgovProcV2(id, reason), null, 2),
      );
    });
  parent
    .command("pmgrgov-cancel-proc-v2 <id> [reason]")
    .description("Cancel proc")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelPmgrgovProcV2(id, reason), null, 2),
      );
    });
  parent
    .command("pmgrgov-get-proc-v2 <id>")
    .description("Get proc")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getPmgrgovProcV2(id), null, 2));
    });
  parent
    .command("pmgrgov-list-procs-v2")
    .description("List procs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listPmgrgovProcsV2(), null, 2));
    });
  parent
    .command("pmgrgov-auto-stop-idle-v2")
    .description("Auto-stop idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStopIdlePmgrgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("pmgrgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck procs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckPmgrgovProcsV2(), null, 2),
      );
    });
  parent
    .command("pmgrgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getProcessManagerGovStatsV2(), null, 2),
      );
    });
}
