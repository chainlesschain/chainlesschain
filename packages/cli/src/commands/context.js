/**
 * cc context [sessionId] — context-window token breakdown for a session.
 *
 * Shows how a session's stored conversation fills the model context window,
 * grouped by role (system / user / assistant / tool), with the share each takes
 * and the headroom remaining. Reuses the SAME token estimator + window table as
 * the headless auto-compactor (prompt-compressor.js) and the JSONL session store
 * (rebuildMessages) — no new data is collected, this is purely a reporting view.
 *
 * Complements `cc cost` ($ spend) and `cc session usage` (raw token counts):
 * this is the "how full is the window right now" view (Claude-Code `/context`).
 *
 *   cc context                       # most-recent headless session
 *   cc context <sessionId>
 *   cc context --model claude-sonnet-4-6   # size against a specific window
 *   cc context --json
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";

/**
 * Bucket message tokens by role. tool_calls carried on assistant messages are
 * counted separately so the breakdown reflects what actually fills the window.
 */
export function categorizeContext(messages, estimateTokens) {
  const buckets = { system: 0, user: 0, assistant: 0, tool: 0, toolCalls: 0 };
  const counts = { system: 0, user: 0, assistant: 0, tool: 0 };
  for (const m of messages) {
    if (!m) continue;
    const role =
      m.role === "system" || m.role === "user" || m.role === "tool"
        ? m.role
        : "assistant";
    const content =
      typeof m.content === "string"
        ? m.content
        : JSON.stringify(m.content || "");
    buckets[role] += estimateTokens(content);
    counts[role] += 1;
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      buckets.toolCalls += estimateTokens(JSON.stringify(m.tool_calls));
    }
  }
  const total =
    buckets.system +
    buckets.user +
    buckets.assistant +
    buckets.tool +
    buckets.toolCalls;
  return { buckets, counts, total };
}

function bar(frac, width = 24) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const filled = Math.round(f * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function registerContextCommand(program) {
  program
    .command("context")
    .description(
      "Context-window token breakdown for a session (Claude-Code /context parity)",
    )
    .argument("[id]", "Session ID (omit for the most-recent headless session)")
    .option("--model <model>", "Size against this model's context window")
    .option("--provider <provider>", "Provider (for the window default)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      const {
        rebuildMessages,
        getLastSessionId,
        sessionExists,
        readEvents,
      } = await import("../harness/jsonl-session-store.js");
      const { estimateTokens, getContextWindow } = await import(
        "../harness/prompt-compressor.js"
      );

      const sessionId = id || getLastSessionId();
      if (!sessionId) {
        logger.error(
          'No session found. Run a headless agent with `--session <id>` first, or pass a session id.',
        );
        process.exitCode = 1;
        return;
      }
      if (!sessionExists(sessionId)) {
        logger.error(
          `No headless transcript for session "${sessionId}" (headless sessions are JSONL-only).`,
        );
        process.exitCode = 1;
        return;
      }

      const messages = rebuildMessages(sessionId) || [];

      // Auto-detect the session's model/provider from its session_start header,
      // overridable by flags so you can size the same transcript against a
      // different window.
      let recordedModel = "";
      let recordedProvider = "";
      try {
        const start = (readEvents(sessionId) || []).find(
          (e) => e.type === "session_start",
        );
        recordedModel = start?.data?.model || "";
        recordedProvider = start?.data?.provider || "";
      } catch {
        // header optional — fall through to flags/defaults
      }
      const model = options.model || recordedModel || null;
      const provider = options.provider || recordedProvider || "ollama";
      const window = getContextWindow(model, provider);

      const { buckets, counts, total } = categorizeContext(
        messages,
        estimateTokens,
      );
      const used = window > 0 ? total / window : 0;
      const remaining = Math.max(0, window - total);

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              sessionId,
              model: model || null,
              provider,
              contextWindow: window,
              totalTokens: total,
              usedFraction: Number(used.toFixed(4)),
              remainingTokens: remaining,
              messageCount: messages.length,
              breakdown: buckets,
              counts,
              overflows: total > window,
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.log(chalk.bold(`Context — session ${chalk.gray(sessionId.slice(0, 28))}`));
      logger.log(
        chalk.gray(
          `  model ${model || "(default)"} · provider ${provider} · ` +
            `window ${window.toLocaleString()} tokens · ${messages.length} messages`,
        ),
      );
      logger.log("");

      const rows = [
        ["system", buckets.system, counts.system],
        ["user", buckets.user, counts.user],
        ["assistant", buckets.assistant, counts.assistant],
        ["tool results", buckets.tool, counts.tool],
        ["tool calls", buckets.toolCalls, null],
      ];
      for (const [label, tok, cnt] of rows) {
        if (!tok) continue;
        const frac = total ? tok / total : 0;
        logger.log(
          `  ${label.padEnd(13)} ${String(tok).padStart(7)}  ` +
            `${chalk.cyan(bar(frac))} ${String(Math.round(frac * 100)).padStart(3)}%` +
            `${cnt != null ? chalk.gray(`  (${cnt})`) : ""}`,
        );
      }

      logger.log("");
      const pct = (used * 100).toFixed(1);
      const color = used > 0.9 ? chalk.red : used > 0.7 ? chalk.yellow : chalk.green;
      logger.log(
        `  ${chalk.bold("total".padEnd(11))} ${String(total).padStart(7)}  ` +
          `${color(bar(used))} ${color(`${pct}% of window`)}`,
      );
      logger.log(
        chalk.gray(`  headroom      ${String(remaining).padStart(7)} tokens remaining`),
      );
      if (total > window) {
        logger.log(
          chalk.red("  ⚠ exceeds the model context window — compaction required"),
        );
      }
    });
}
