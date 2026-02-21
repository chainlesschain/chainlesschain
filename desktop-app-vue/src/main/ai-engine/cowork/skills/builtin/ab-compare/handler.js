/**
 * A/B Compare Skill Handler
 *
 * Generates and compares multiple implementation variants.
 * Delegates to the ABComparator manager.
 */

const { logger } = require("../../../../../utils/logger.js");

/**
 * Parse command arguments
 * /ab-compare "task description" [--variants 3] [--benchmark]
 */
function parseArgs(input) {
  const args = { taskDescription: null, variantCount: 3, benchmark: true };
  if (!input) {
    return args;
  }

  let remaining = input.trim();

  // Extract --variants N
  const variantMatch = remaining.match(/--variants\s+(\d+)/);
  if (variantMatch) {
    args.variantCount = parseInt(variantMatch[1], 10);
    remaining = remaining.replace(variantMatch[0], "").trim();
  }

  // Extract --benchmark / --no-benchmark
  if (remaining.includes("--no-benchmark")) {
    args.benchmark = false;
    remaining = remaining.replace("--no-benchmark", "").trim();
  } else {
    remaining = remaining.replace("--benchmark", "").trim();
  }

  // Remove quotes from task description
  args.taskDescription = remaining.replace(/^["']|["']$/g, "").trim() || null;

  return args;
}

/**
 * Format comparison result for display
 */
function formatResult(result) {
  if (result.error) {
    return `A/B Comparison Error: ${result.error}`;
  }

  const lines = [
    "A/B Comparison Report",
    "=====================",
    `Task: "${result.taskDescription}"`,
    `Variants: ${(result.variants || []).length}`,
    "",
  ];

  if (Object.keys(result.scores || {}).length > 0) {
    lines.push("| Agent | Concise | Error | Readable | Total |");
    lines.push("| --- | --- | --- | --- | --- |");

    for (const variant of result.variants || []) {
      const score = result.scores[variant.name] || {};
      lines.push(
        `| ${variant.name} | ${score.conciseness || 0} | ${score.errorHandling || 0} | ${score.readability || 0} | ${score.total || 0} |`,
      );
    }
  } else {
    lines.push("| Agent | Style |");
    lines.push("| --- | --- |");
    for (const variant of result.variants || []) {
      lines.push(`| ${variant.name} | ${variant.style} |`);
    }
  }

  lines.push("");
  if (result.winner) {
    const winnerScore = result.scores?.[result.winner]?.total;
    lines.push(
      `Winner: **${result.winner}**${winnerScore ? ` (${winnerScore}/100)` : ""}`,
    );
  } else {
    lines.push("Winner: (tie / no clear winner)");
  }

  if (result.duration) {
    lines.push(`Duration: ${result.duration}ms`);
  }

  return lines.join("\n");
}

/**
 * Handler entry point
 */
async function handler(params) {
  const { input, context } = params;

  const args = parseArgs(input);

  if (!args.taskDescription) {
    return {
      success: false,
      output:
        'Usage: /ab-compare "task description" [--variants 3] [--benchmark]',
    };
  }

  try {
    const { getABComparator } = require("../../ab-comparator");
    const abComparator = getABComparator();

    if (!abComparator.initialized) {
      return {
        success: false,
        output:
          "ABComparator is not initialized. Make sure the system is fully loaded.",
      };
    }

    const result = await abComparator.compare({
      taskDescription: args.taskDescription,
      variantCount: args.variantCount,
      benchmark: args.benchmark,
      context: context?.additionalContext,
    });

    return {
      success: true,
      output: formatResult(result),
      data: result,
    };
  } catch (error) {
    logger.error("[ab-compare handler] Error:", error.message);
    return {
      success: false,
      output: `A/B comparison failed: ${error.message}`,
    };
  }
}

module.exports = {
  async init(_skill) {
    logger.info("[ab-compare] Handler initialized");
  },
  async execute(task, context = {}, _skill) {
    const input = task.input || task.args || "";
    return handler({ input, context });
  },
};
