import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import {
  DEFAULT_SERVICE_INTERVAL_MS,
  MAX_SERVICE_INTERVAL_MS,
  MIN_SERVICE_INTERVAL_MS,
  createSchedulerService,
} from "../lib/scheduler-kernel/service.js";

export const SCHEDULER_DAEMON_DOMAINS = Object.freeze(["agenda", "cowork"]);

function schedulerDaemonError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_POLICY",
      `${field} must be a positive integer`,
    );
  }
  return normalized;
}

function nonnegativeInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_POLICY",
      `${field} must be a non-negative integer`,
    );
  }
  return normalized;
}

export function parseSchedulerCapabilities(value) {
  if (typeof value !== "string") {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_POLICY",
      "Scheduler capabilities must be a comma-separated string",
    );
  }
  const capabilities = [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].sort();
  if (capabilities.length === 0 || capabilities.includes("*")) {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_POLICY",
      "Scheduler policy requires one or more exact capabilities",
    );
  }
  return capabilities;
}

async function withSchedulerStore(dependencies, operation) {
  const openStore =
    dependencies.openSchedulerStore ||
    (await import("../lib/scheduler-kernel/store.js")).openSchedulerStore;
  const store = openStore();
  try {
    return operation(store);
  } finally {
    store.close();
  }
}

export async function getSchedulerAuthorityPolicy(
  principalType,
  principalId,
  dependencies = {},
) {
  return withSchedulerStore(dependencies, (store) => {
    const policy = store.getAuthorityPolicy({
      type: principalType,
      id: principalId,
    });
    if (!policy) {
      throw schedulerDaemonError(
        "SCHEDULER_AUTHORITY_POLICY_NOT_FOUND",
        `Scheduler authority policy does not exist: ${principalType}:${principalId}`,
      );
    }
    return policy;
  });
}

export async function setSchedulerAuthorityPolicy(
  principalType,
  principalId,
  options,
  dependencies = {},
) {
  const windowSeconds = positiveInteger(options.windowSeconds, "windowSeconds");
  const windowMs = windowSeconds * 1_000;
  if (!Number.isSafeInteger(windowMs)) {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_POLICY",
      "windowSeconds is too large",
    );
  }
  return withSchedulerStore(dependencies, (store) =>
    store.setAuthorityPolicy(
      { type: principalType, id: principalId },
      {
        capabilities: parseSchedulerCapabilities(options.capabilities),
        windowMs,
        maxRuns: positiveInteger(options.maxRuns, "maxRuns"),
        maxUnits: positiveInteger(options.maxUnits, "maxUnits"),
        enabled: options.disable !== true,
        expectedRevision: nonnegativeInteger(
          options.expectedRevision,
          "expectedRevision",
        ),
      },
    ),
  );
}

export function parseSchedulerDomains(
  value = SCHEDULER_DAEMON_DOMAINS.join(","),
) {
  if (typeof value !== "string") {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_DOMAINS",
      "Scheduler domains must be a comma-separated string",
    );
  }
  const requested = [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const unknown = requested.filter(
    (entry) => !SCHEDULER_DAEMON_DOMAINS.includes(entry),
  );
  if (requested.length === 0 || unknown.length > 0) {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_DOMAINS",
      `Scheduler domains must be selected from: ${SCHEDULER_DAEMON_DOMAINS.join(", ")}`,
      { unknown },
    );
  }
  return SCHEDULER_DAEMON_DOMAINS.filter((entry) => requested.includes(entry));
}

export function parseSchedulerIntervalMs(
  value = DEFAULT_SERVICE_INTERVAL_MS / 1000,
) {
  const seconds = Number(value);
  const intervalMs = Math.round(seconds * 1000);
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < MIN_SERVICE_INTERVAL_MS ||
    intervalMs > MAX_SERVICE_INTERVAL_MS
  ) {
    throw schedulerDaemonError(
      "SCHEDULER_DAEMON_INVALID_INTERVAL",
      `Scheduler interval must be between ${MIN_SERVICE_INTERVAL_MS / 1000} and ${MAX_SERVICE_INTERVAL_MS / 1000} seconds`,
    );
  }
  return intervalMs;
}

async function loadSchedulerRuntime() {
  const [
    { AgentScheduleStore },
    { runAgendaRun },
    { CoworkCronSchedulerBridge },
    { openSchedulerStore },
    { runCoworkTask },
  ] = await Promise.all([
    import("../lib/agent-schedule-store.js"),
    import("./agenda.js"),
    import("../lib/scheduler-kernel/cowork-cron-adapter.js"),
    import("../lib/scheduler-kernel/store.js"),
    import("../lib/cowork-task-runner.js"),
  ]);
  return {
    AgentScheduleStore,
    CoworkCronSchedulerBridge,
    openSchedulerStore,
    runAgendaRun,
    runCoworkTask,
  };
}

function parseAgendaSummary(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep looking for the machine-readable summary.
    }
  }
  return { due: 0, retired: [], actions: [] };
}

export async function createDefaultSchedulerService({
  cwd = process.cwd(),
  domains = SCHEDULER_DAEMON_DOMAINS,
  onEvent,
  runtime,
  createService = createSchedulerService,
} = {}) {
  const selected = Array.isArray(domains)
    ? parseSchedulerDomains(domains.join(","))
    : parseSchedulerDomains(domains);
  const loaded = runtime || (await loadSchedulerRuntime());
  const schedulerStore = loaded.openSchedulerStore();
  const drivers = [];
  try {
    if (selected.includes("agenda")) {
      const agendaStore = new loaded.AgentScheduleStore();
      const ownerId = `scheduler-service:agenda:${process.pid}:${randomUUID()}`;
      drivers.push({
        name: "agenda",
        async run({ signal }) {
          const lines = [];
          const code = await loaded.runAgendaRun(
            { json: true, signal },
            {
              store: agendaStore,
              schedulerStore,
              schedulerOwnerId: ownerId,
              log: (line) => lines.push(String(line)),
            },
          );
          const summary = parseAgendaSummary(lines);
          if (code !== 0) {
            throw schedulerDaemonError(
              "SCHEDULER_DAEMON_AGENDA_FAILED",
              "Agenda scheduler tick completed with one or more failed actions",
              summary,
            );
          }
          return summary;
        },
      });
    }

    if (selected.includes("cowork")) {
      const bridge = new loaded.CoworkCronSchedulerBridge({
        cwd,
        schedulerStore,
        runTask: loaded.runCoworkTask,
        ownerId: `scheduler-service:cowork:${process.pid}:${randomUUID()}`,
      });
      drivers.push({
        name: "cowork",
        run: ({ signal }) => bridge.runDue({ signal }),
      });
    }

    return createService({
      drivers,
      onEvent,
      dispose: () => schedulerStore.close(),
    });
  } catch (error) {
    schedulerStore.close();
    throw error;
  }
}

function humanEvent(event, log) {
  if (event.type === "scheduler-service-started") {
    log(
      chalk.green(
        `Scheduler service running (${event.drivers.join(", ")}); press Ctrl-C to stop.`,
      ),
    );
  } else if (event.type === "scheduler-driver-failed") {
    log(
      chalk.red(
        `${event.driver} scheduler failed (${event.error.code}): ${event.error.message}`,
      ),
    );
  } else if (event.type === "scheduler-service-stopped") {
    log(chalk.gray(`Scheduler service stopped after ${event.ticks} tick(s).`));
  }
}

export async function runSchedulerDaemon(options = {}, dependencies = {}) {
  const domains = parseSchedulerDomains(options.domains);
  const intervalMs = parseSchedulerIntervalMs(options.interval);
  const log = dependencies.log || ((line) => logger.log(line));
  const processRef = dependencies.processRef || process;
  const controller = new AbortController();
  const externalSignal = options.signal || dependencies.signal;
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener?.("abort", abort, { once: true });
  const onProcessSignal = () => controller.abort();
  processRef.once?.("SIGINT", onProcessSignal);
  processRef.once?.("SIGTERM", onProcessSignal);

  const emit =
    dependencies.onEvent ||
    ((event) => {
      if (options.json) log(JSON.stringify(event));
      else humanEvent(event, log);
    });
  const createDefault =
    dependencies.createDefaultService || createDefaultSchedulerService;
  let service;
  try {
    service = await createDefault({
      cwd: options.cwd || process.cwd(),
      domains,
      onEvent: emit,
      ...(dependencies.runtime === undefined
        ? {}
        : { runtime: dependencies.runtime }),
      ...(dependencies.createService === undefined
        ? {}
        : { createService: dependencies.createService }),
    });
    const result = await service.run({
      intervalMs,
      once: options.once === true,
      signal: controller.signal,
      ...(dependencies.maxTicks === undefined
        ? {}
        : { maxTicks: dependencies.maxTicks }),
    });
    if (options.once === true) {
      if (options.json) {
        log(JSON.stringify({ type: "scheduler-run-summary", ...result }));
      } else {
        log(
          result.status === "degraded"
            ? chalk.yellow("Scheduler tick completed with failures.")
            : chalk.green("Scheduler tick completed."),
        );
      }
    }
    return result.status === "degraded" ? 1 : 0;
  } finally {
    externalSignal?.removeEventListener?.("abort", abort);
    processRef.removeListener?.("SIGINT", onProcessSignal);
    processRef.removeListener?.("SIGTERM", onProcessSignal);
    await service?.close();
  }
}

export function registerSchedulerDaemonCommands(daemon) {
  const scheduler = daemon
    .command("scheduler")
    .description("Run durable unattended scheduler domains in one process");

  scheduler
    .command("run", { isDefault: true })
    .description("Run Agenda and Cowork scheduler domains")
    .option("--once", "Run one tick and exit")
    .option(
      "--interval <seconds>",
      "Polling interval in seconds",
      String(DEFAULT_SERVICE_INTERVAL_MS / 1000),
    )
    .option(
      "--domains <list>",
      "Comma-separated domains (agenda,cowork)",
      SCHEDULER_DAEMON_DOMAINS.join(","),
    )
    .option("--json", "Emit newline-delimited scheduler events")
    .action(async (options) => {
      try {
        process.exitCode = await runSchedulerDaemon(options);
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  const policy = scheduler
    .command("policy")
    .description("Inspect or update scheduler permission and budget policies");

  policy
    .command("get")
    .description("Read one scheduler authority policy")
    .argument("<principal-type>", "Authority principal type")
    .argument("<principal-id>", "Authority principal id")
    .action(async (principalType, principalId) => {
      try {
        logger.log(
          JSON.stringify(
            await getSchedulerAuthorityPolicy(principalType, principalId),
            null,
            2,
          ),
        );
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });

  policy
    .command("set")
    .description("CAS-update exact capabilities and a bounded usage budget")
    .argument("<principal-type>", "Authority principal type")
    .argument("<principal-id>", "Authority principal id")
    .requiredOption(
      "--capabilities <list>",
      "Comma-separated exact capabilities",
    )
    .requiredOption("--window-seconds <n>", "Budget window in seconds")
    .requiredOption("--max-runs <n>", "Maximum runs in the window")
    .requiredOption("--max-units <n>", "Maximum units in the window")
    .requiredOption(
      "--expected-revision <n>",
      "Current policy revision for compare-and-swap",
    )
    .option("--disable", "Disable unattended execution for this principal")
    .action(async (principalType, principalId, options) => {
      try {
        logger.log(
          JSON.stringify(
            await setSchedulerAuthorityPolicy(
              principalType,
              principalId,
              options,
            ),
            null,
            2,
          ),
        );
      } catch (error) {
        logger.error(chalk.red(error.message));
        process.exitCode = 1;
      }
    });
}
