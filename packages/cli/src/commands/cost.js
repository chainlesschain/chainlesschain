/**
 * cc cost [sessionId] — estimated $ spend from recorded token usage.
 *
 * Builds on `cc session usage` (token aggregation) by layering the
 * llm-pricing rate table on top. Reads the same JSONL token_usage events,
 * so no new data is collected — this is purely a reporting view.
 *
 *   cc cost                 # global rollup across all sessions
 *   cc cost <sessionId>     # one session
 *   cc cost --json          # machine-readable
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

function fmtUsd(n) {
  const v = Number(n) || 0;
  // Sub-cent costs are common with cheap models — show enough precision.
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

export function registerCostCommand(program) {
  program
    .command("cost")
    .description(
      "Estimated $ cost from recorded token usage (per-session or global)",
    )
    .argument("[id]", "Session ID (omit for global rollup)")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max sessions for global rollup", "1000")
    .action(async (id, options) => {
      try {
        const { sessionUsage, allSessionsUsage } =
          await import("../lib/session-usage.js");
        const { priceRollup, mergePricing } =
          await import("../lib/llm-pricing.js");
        const { loadConfig } = await import("../lib/config-manager.js");

        // User price overrides live under config.llm.pricing — no need to edit
        // source to correct/add a model rate.
        const config = loadConfig();
        const overrides = config?.llm?.pricing;
        const table = mergePricing(overrides);

        const raw = id
          ? sessionUsage(id)
          : allSessionsUsage({ limit: parseInt(options.limit, 10) || 1000 });
        const result = priceRollup(raw, { table });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const header = id
          ? `Cost — session ${chalk.gray(id.slice(0, 16))}`
          : "Cost — global";
        logger.log(chalk.bold(header));
        logger.log(
          `  total: ${chalk.green(fmtUsd(result.cost.totalCost))} USD  ` +
            `(${result.total.totalTokens.toLocaleString()} tokens, ${result.total.calls} calls)`,
        );

        if (result.byModel.length === 0) {
          logger.log(chalk.gray("  (no token_usage events recorded)"));
          return;
        }

        for (const row of result.byModel) {
          const provider = (row.provider || "?").padEnd(10);
          const model = (row.model || "?").padEnd(24);
          const tokens = `in=${row.inputTokens} out=${row.outputTokens}`;
          if (row.free) {
            logger.log(
              `  ${chalk.gray(provider)} ${chalk.white(model)} ${chalk.gray("free (local)")}  ${chalk.gray(tokens)}`,
            );
          } else if (row.matched) {
            logger.log(
              `  ${chalk.gray(provider)} ${chalk.white(model)} ${chalk.green(fmtUsd(row.cost).padStart(12))}  ${chalk.gray(tokens)}`,
            );
          } else {
            logger.log(
              `  ${chalk.gray(provider)} ${chalk.white(model)} ${chalk.yellow("unpriced".padStart(12))}  ${chalk.gray(tokens)}`,
            );
          }
        }

        if (result.unpriced.length > 0) {
          logger.log(
            chalk.yellow(
              `  note: ${result.unpriced.length} model(s) have no rate — tokens excluded from total. Add rates via config: llm.pricing.`,
            ),
          );
        }
        if (overrides && typeof overrides === "object") {
          logger.log(
            chalk.gray(
              `  (price overrides active from config.llm.pricing: ${Object.keys(overrides).join(", ")})`,
            ),
          );
        }
        logger.log(
          chalk.gray(
            "  prices are estimates of public list rates (USD/1M tokens).",
          ),
        );
      } catch (err) {
        logger.error(chalk.red(`cost failed: ${err.message}`));
        process.exitCode = 1;
      }
    });
}
