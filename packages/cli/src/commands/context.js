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
    .option(
      "--sources",
      "Also break tokens down by source (project-memory instruction files + message classes)",
    )
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      const { rebuildMessages, getLastSessionId, sessionExists, readEvents } =
        await import("../harness/jsonl-session-store.js");
      const { estimateTokens, getContextWindow } =
        await import("../harness/prompt-compressor.js");

      const sessionId = id || getLastSessionId();
      if (!sessionId) {
        logger.error(
          "No session found. Run a headless agent with `--session <id>` first, or pass a session id.",
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
      let recordedContextSources = null;
      try {
        const sessionEvents = readEvents(sessionId) || [];
        const start = sessionEvents.find(
          (e) => e.type === "session_start",
        );
        recordedModel = start?.data?.model || "";
        recordedProvider = start?.data?.provider || "";
        recordedContextSources = [...sessionEvents]
          .reverse()
          .find((e) => e.type === "context_sources")?.data || null;
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

      // --sources (opt-in): attribute the project-memory instruction files that
      // WOULD load for the current cwd (same instructionExcludes the agent
      // honors), folded in with the session's message-role buckets. The base
      // view is byte-for-byte unchanged when the flag is absent.
      let sourceReport = null;
      if (options.sources) {
        try {
          const { loadProjectInstructions } =
            await import("../lib/project-instructions.js");
          const {
            breakdownInstructionSources,
            breakdownMcpSchemas,
            breakdownSkillSources,
            rankContextSources,
          } =
            await import("../lib/context-breakdown.js");
          const cwd = process.cwd();
          let instructionExcludes;
          try {
            const { readStringArraySetting } =
              await import("../lib/settings-loader.cjs");
            instructionExcludes = readStringArraySetting(
              "instructionExcludes",
              {
                cwd,
              },
            );
          } catch {
            instructionExcludes = undefined; // fail-open — load everything
          }
          const loaded = loadProjectInstructions({ cwd, instructionExcludes });
          const instr = breakdownInstructionSources(
            loaded.files,
            estimateTokens,
            cwd,
          );
          const mcp = breakdownMcpSchemas(
            recordedContextSources?.mcp || [],
            estimateTokens,
          );
          const skills = breakdownSkillSources(
            recordedContextSources?.skills || [],
            estimateTokens,
          );
          const ranked = rankContextSources({
            instructionTotal: instr.total,
            buckets,
            counts,
            extraSources: [
              ...mcp.sources.map((source) => ({
                ...source,
                kind: "mcp_schema",
              })),
              ...skills.sources.map((source) => ({
                ...source,
                kind: "skill",
              })),
            ],
          });
          sourceReport = {
            cwd,
            instructions: instr.sources,
            instructionTokens: instr.total,
            mcpSchemas: mcp.sources,
            mcpSchemaTokens: mcp.total,
            skills: skills.sources,
            skillTokens: skills.total,
            ranked: ranked.sources,
            combinedTotal: ranked.total,
          };
        } catch {
          // Best-effort — a source breakdown must never break the base view.
          sourceReport = null;
        }
      }

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
              ...(sourceReport
                ? {
                    sources: sourceReport.ranked,
                    instructions: sourceReport.instructions,
                    instructionTokens: sourceReport.instructionTokens,
                    mcpSchemas: sourceReport.mcpSchemas,
                    mcpSchemaTokens: sourceReport.mcpSchemaTokens,
                    combinedTotal: sourceReport.combinedTotal,
                    cwd: sourceReport.cwd,
                  }
                : {}),
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.log(
        chalk.bold(`Context — session ${chalk.gray(sessionId.slice(0, 28))}`),
      );
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
      const color =
        used > 0.9 ? chalk.red : used > 0.7 ? chalk.yellow : chalk.green;
      logger.log(
        `  ${chalk.bold("total".padEnd(11))} ${String(total).padStart(7)}  ` +
          `${color(bar(used))} ${color(`${pct}% of window`)}`,
      );
      logger.log(
        chalk.gray(
          `  headroom      ${String(remaining).padStart(7)} tokens remaining`,
        ),
      );
      if (total > window) {
        logger.log(
          chalk.red(
            "  ⚠ exceeds the model context window — compaction required",
          ),
        );
      }

      if (sourceReport) {
        logger.log("");
        logger.log(
          chalk.bold("By source") +
            chalk.gray(`  (project memory for ${sourceReport.cwd})`),
        );
        if (sourceReport.instructions.length) {
          for (const s of sourceReport.instructions) {
            logger.log(
              chalk.gray(`  · ${String(s.scope).padEnd(7)} `) +
                `${String(s.tokens).padStart(7)}  ${s.source}` +
                (s.truncated ? chalk.yellow("  (truncated)") : ""),
            );
          }
          logger.log(
            chalk.gray("    project-memory subtotal ") +
              `${String(sourceReport.instructionTokens).padStart(7)} tokens`,
          );
        } else {
          logger.log(
            chalk.gray("  (no project-memory instruction files for this cwd)"),
          );
        }
        logger.log("");
        for (const s of sourceReport.ranked) {
          logger.log(
            `  ${String(s.source).padEnd(30)} ${String(s.tokens).padStart(7)}  ` +
              `${chalk.cyan(bar(s.share))} ${String(Math.round(s.share * 100)).padStart(3)}%`,
          );
        }
        logger.log(
          chalk.gray(
            "  note: instructions reflect the current cwd (what a new run here",
          ),
        );
        logger.log(
          chalk.gray(
            "  would load); messages are this session's stored turns. Skill / MCP",
          ),
        );
        logger.log(
          chalk.gray(
            "  tool schemas load at runtime and are not counted here.",
          ),
        );
      }
    });
}
