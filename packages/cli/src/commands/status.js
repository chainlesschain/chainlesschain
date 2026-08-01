import chalk from "chalk";
import logger from "../lib/logger.js";

export function collectOtlpStatus(runtime = null) {
  return (
    runtime?.getStats?.() || {
      enabled: false,
      protocol: "http/json",
      tracesEndpoint: null,
      metricsEndpoint: null,
      queued: 0,
      queueCapacity: 0,
      queuePressure: "normal",
      enqueued: 0,
      exported: 0,
      retried: 0,
      dropped: 0,
      permanentFailures: 0,
      recovered: 0,
      spoolErrors: 0,
      configurationErrors: [],
      lastError: null,
    }
  );
}

export function registerStatusCommand(program) {
  program
    .command("status")
    .description("Show status of ChainlessChain app and services")
    .option("--json", "Output as machine-readable JSON")
    .option("--deep", "Include Docker Compose service inspection")
    .action(async (options) => {
      try {
        const report = options.deep
          ? await (
              await import("../runtime/diagnostics.js")
            ).collectStatusReport({ deep: true })
          : await (
              await import("../runtime/status-diagnostics-lite.js")
            ).collectQuickStatusReport();
        let observabilityRuntime = null;
        if (
          program.opts().otlpEndpoint ||
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
          process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
          process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
        ) {
          observabilityRuntime = (
            await import("../lib/observability/index.js")
          ).getObservabilityRuntime();
        }
        report.observability = {
          otlp: collectOtlpStatus(observabilityRuntime),
        };

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }

        // App status
        logger.log(chalk.bold("\n  App Status\n"));
        if (report.app.running) {
          logger.log(
            `  ${chalk.green("●")} Desktop app running (PID: ${report.app.pid})`,
          );
        } else {
          logger.log(`  ${chalk.gray("○")} Desktop app not running`);
        }

        if (report.setup.completed) {
          logger.log(
            `  ${chalk.green("●")} Setup completed (${report.setup.completedAt || "unknown"})`,
          );
          if (report.setup.edition) {
            logger.log(`    Edition: ${report.setup.edition}`);
          }
          if (report.setup.llm) {
            logger.log(
              `    LLM: ${report.setup.llm.provider} (${report.setup.llm.model})`,
            );
          }
        } else {
          logger.log(`  ${chalk.yellow("●")} Setup not completed`);
        }

        // Docker services
        logger.log(chalk.bold("\n  Docker Services\n"));
        if (!report.docker.available) {
          logger.log(`  ${chalk.gray("○")} Docker not available`);
        } else if (report.docker.services) {
          for (const svc of report.docker.services) {
            const running = svc.state === "running";
            const icon = running ? chalk.green("●") : chalk.red("●");
            logger.log(`  ${icon} ${svc.name}: ${svc.state}`);
          }
        } else if (report.docker.note) {
          const icon = report.docker.note.includes("not found")
            ? chalk.gray("○")
            : chalk.gray("○");
          logger.log(`  ${icon} ${report.docker.note}`);
        }

        // Ports
        logger.log(chalk.bold("\n  Ports\n"));
        for (const p of report.ports) {
          const icon = p.open ? chalk.green("●") : chalk.gray("○");
          logger.log(`  ${icon} ${p.name}: ${p.port}`);
        }

        const otlp = report.observability.otlp;
        logger.log(chalk.bold("\n  OpenTelemetry Collector\n"));
        if (!otlp.enabled) {
          logger.log(`  ${chalk.gray("○")} OTLP export disabled`);
          if (otlp.configurationErrors?.length) {
            logger.log(
              `    configuration: ${otlp.configurationErrors.join("; ")}`,
            );
          }
        } else {
          logger.log(
            `  ${chalk.green("●")} ${otlp.protocol} · queue ${otlp.queued}/${otlp.queueCapacity} (${otlp.queuePressure})`,
          );
          logger.log(`    traces: ${otlp.tracesEndpoint || "disabled"}`);
          logger.log(`    metrics: ${otlp.metricsEndpoint || "disabled"}`);
          if (otlp.retried || otlp.dropped || otlp.permanentFailures) {
            logger.log(
              `    retries ${otlp.retried}, dropped ${otlp.dropped}, permanent failures ${otlp.permanentFailures}`,
            );
          }
          if (otlp.configurationErrors?.length) {
            logger.log(
              `    configuration: ${otlp.configurationErrors.join("; ")}`,
            );
          }
          if (otlp.lastError) logger.log(`    last error: ${otlp.lastError}`);
        }

        logger.newline();
      } catch (err) {
        logger.error(`Status check failed: ${err.message}`);
        process.exit(1);
      }
    });
}
