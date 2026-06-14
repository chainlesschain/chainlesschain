/**
 * cc insights [id] — analyze a session (Claude-Code `/insights` parity).
 *
 *   cc insights              # most-recent session
 *   cc insights <id>         # a specific session
 *   cc insights --json       # machine-readable
 *
 * A pure reporting view over the JSONL session events (no new data): turns,
 * tool usage + error rate, duration, token usage, and estimated $ cost
 * (reusing the cc cost price table + config.llm.pricing overrides). Distinct
 * from `cc cost` (spend only) and `cc session usage` (tokens only).
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

function fmtUsd(n) {
  const v = Number(n) || 0;
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

export function registerInsightsCommand(program) {
  program
    .command("insights [id]")
    .description(
      "Analyze a session: turns, tools, errors, duration, tokens + cost",
    )
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const { sessionExists, readEvents, getLastSessionId } =
          await import("../harness/jsonl-session-store.js");

        const sessionId = id || getLastSessionId();
        if (!sessionId) {
          if (options.json) {
            console.log(JSON.stringify({ error: "no sessions found" }, null, 2));
            return;
          }
          logger.log(chalk.gray("No sessions found. Start one with: cc agent"));
          return;
        }
        if (!sessionExists(sessionId)) {
          logger.error(chalk.red(`no such session: ${sessionId}`));
          logger.log(chalk.gray("  list sessions with: cc session list"));
          process.exitCode = 1;
          return;
        }

        const events = readEvents(sessionId);
        const { analyzeSession, formatDuration } =
          await import("../lib/session-insights.js");
        const insights = analyzeSession(events, sessionId);

        // Layer estimated $ cost over the token aggregate (same table as cc cost).
        const { priceRollup, mergePricing } =
          await import("../lib/llm-pricing.js");
        const { loadConfig } = await import("../lib/config-manager.js");
        const table = mergePricing(loadConfig()?.llm?.pricing);
        const priced = priceRollup(insights.usage, { table });
        insights.usage = priced;
        insights.cost = priced.cost;

        if (options.json) {
          console.log(JSON.stringify(insights, null, 2));
          return;
        }

        const m = insights.meta;
        logger.log(
          chalk.bold(`Insights — session ${chalk.gray(sessionId.slice(0, 24))}`),
        );
        if (m.title) logger.log(chalk.gray(`  "${m.title}"`));
        logger.log(
          `  ${chalk.gray("model:")} ${m.provider || "?"}/${m.model || "?"}` +
            `  ${chalk.gray("duration:")} ${formatDuration(m.durationMs)}` +
            `  ${chalk.gray("events:")} ${insights.events}`,
        );
        logger.log(
          `  ${chalk.gray("turns:")} ${insights.messages.user} user / ` +
            `${insights.messages.assistant} assistant` +
            (insights.compactions
              ? chalk.gray(`  (compacted ${insights.compactions}×)`)
              : ""),
        );

        // Tools
        if (insights.tools.calls > 0) {
          const errRate =
            insights.tools.calls > 0
              ? Math.round(
                  (insights.tools.errors / insights.tools.calls) * 100,
                )
              : 0;
          logger.log(
            `  ${chalk.gray("tools:")} ${insights.tools.calls} call(s), ` +
              `${insights.tools.errors} error(s)` +
              (insights.tools.calls
                ? chalk.gray(` (${errRate}% error rate)`)
                : ""),
          );
          for (const t of insights.tools.byTool.slice(0, 8)) {
            const errs = t.errors
              ? chalk.red(` ${t.errors} err`)
              : "";
            logger.log(
              `    ${chalk.cyan(t.tool.padEnd(16))} ${String(t.count).padStart(4)}×${errs}`,
            );
          }
        } else {
          logger.log(
            chalk.gray("  tools: none recorded (headless runs omit tool events)"),
          );
        }

        // Tokens + cost
        const u = insights.usage.total;
        logger.log(
          `  ${chalk.gray("tokens:")} ${u.totalTokens.toLocaleString()} ` +
            `(in ${u.inputTokens.toLocaleString()} / out ${u.outputTokens.toLocaleString()}, ${u.calls} call(s))` +
            `  ${chalk.gray("cost:")} ${chalk.green(fmtUsd(insights.cost.totalCost))}`,
        );
        if (insights.cost.unpricedCount > 0) {
          logger.log(
            chalk.yellow(
              `  note: ${insights.cost.unpricedCount} model(s) unpriced — tokens excluded from cost. Add rates via config.llm.pricing.`,
            ),
          );
        }
      } catch (err) {
        logger.error(chalk.red(`insights failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
