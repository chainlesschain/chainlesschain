import {
  isDockerAvailable,
  isDockerComposeAvailable,
  servicesUp,
  servicesDown,
  servicesLogs,
  servicesPull,
  findComposeFile,
} from "../lib/service-manager.js";
import logger from "../lib/logger.js";

export function registerServicesCommand(program) {
  const cmd = program
    .command("services")
    .description("Manage Docker backend services");

  cmd
    .command("up")
    .description("Start Docker services")
    .argument("[services...]", "Specific services to start")
    .action(async (services) => {
      await withCompose((composePath) => {
        logger.info("Starting services...");
        servicesUp(composePath, {
          services: services.length ? services : undefined,
        });
        logger.success("Services started");
      });
    });

  cmd
    .command("down")
    .description("Stop Docker services")
    .action(async () => {
      await withCompose((composePath) => {
        logger.info("Stopping services...");
        servicesDown(composePath);
        logger.success("Services stopped");
      });
    });

  cmd
    .command("logs")
    .description("View service logs")
    .option("-f, --follow", "Follow log output")
    .option("--tail <lines>", "Number of lines to show", "100")
    .argument("[services...]", "Specific services")
    .action(async (services, options) => {
      await withCompose(async (composePath) => {
        await servicesLogs(composePath, {
          follow: options.follow,
          tail: options.tail,
          services: services.length ? services : undefined,
        });
      });
    });

  cmd
    .command("pull")
    .description("Pull latest service images")
    .action(async () => {
      await withCompose((composePath) => {
        logger.info("Pulling images...");
        servicesPull(composePath);
        logger.success("Images updated");
      });
    });
}

async function withCompose(fn) {
  try {
    if (!isDockerAvailable()) {
      logger.error("Docker is not installed or not running");
      process.exit(1);
    }
    if (!isDockerComposeAvailable()) {
      logger.error("Docker Compose is not available");
      process.exit(1);
    }

    const composePath = findComposeFile([process.cwd(), "backend/docker"]);
    if (!composePath) {
      logger.error(
        "docker-compose.yml not found. Run from the project root directory.",
      );
      process.exit(1);
    }

    await fn(composePath);
  } catch (err) {
    logger.error(`Service operation failed: ${err.message}`);
    process.exit(1);
  }
}

// === Iter27 V2 governance overlay ===
export function registerSmgrgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "services");
  if (!parent) return;
  const L = async () => await import("../lib/service-manager.js");
  parent
    .command("smgrgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SMGRGOV_PROFILE_MATURITY_V2,
            opLifecycle: m.SMGRGOV_OP_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("smgrgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSmgrgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSmgrgovOpsPerProfileV2(),
            idleMs: m.getSmgrgovProfileIdleMsV2(),
            stuckMs: m.getSmgrgovOpStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("smgrgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSmgrgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("smgrgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSmgrgovOpsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("smgrgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSmgrgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("smgrgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSmgrgovOpStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("smgrgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--service <v>", "service")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSmgrgovProfileV2({ id, owner, service: o.service }),
          null,
          2,
        ),
      );
    });
  parent
    .command("smgrgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("smgrgov-degrade-v2 <id>")
    .description("Degrade profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).degradeSmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("smgrgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("smgrgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSmgrgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("smgrgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSmgrgovProfileV2(id), null, 2));
    });
  parent
    .command("smgrgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSmgrgovProfilesV2(), null, 2));
    });
  parent
    .command("smgrgov-create-op-v2 <id> <profileId>")
    .description("Create op")
    .option("--action <v>", "action")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSmgrgovOpV2({ id, profileId, action: o.action }),
          null,
          2,
        ),
      );
    });
  parent
    .command("smgrgov-operating-op-v2 <id>")
    .description("Mark op as operating")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).operatingSmgrgovOpV2(id), null, 2),
      );
    });
  parent
    .command("smgrgov-complete-op-v2 <id>")
    .description("Complete op")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeOpSmgrgovV2(id), null, 2));
    });
  parent
    .command("smgrgov-fail-op-v2 <id> [reason]")
    .description("Fail op")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSmgrgovOpV2(id, reason), null, 2),
      );
    });
  parent
    .command("smgrgov-cancel-op-v2 <id> [reason]")
    .description("Cancel op")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelSmgrgovOpV2(id, reason), null, 2),
      );
    });
  parent
    .command("smgrgov-get-op-v2 <id>")
    .description("Get op")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSmgrgovOpV2(id), null, 2));
    });
  parent
    .command("smgrgov-list-ops-v2")
    .description("List ops")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSmgrgovOpsV2(), null, 2));
    });
  parent
    .command("smgrgov-auto-degrade-idle-v2")
    .description("Auto-degrade idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoDegradeIdleSmgrgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("smgrgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck ops")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSmgrgovOpsV2(), null, 2),
      );
    });
  parent
    .command("smgrgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getServiceManagerGovStatsV2(), null, 2),
      );
    });
}
