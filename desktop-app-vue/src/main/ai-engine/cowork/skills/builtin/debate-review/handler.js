/**
 * Debate Review Skill Handler
 *
 * Multi-agent debate code review with configurable perspectives.
 * Delegates to the DebateReview manager for execution.
 */

const { logger } = require("../../../../../utils/logger.js");
const path = require("path");

/**
 * Parse command arguments
 * /debate-review <target> [--perspectives perf,security,maintain]
 */
function parseArgs(input) {
  const args = { target: null, perspectives: null };
  if (!input) {
    return args;
  }

  const parts = input.trim().split(/\s+/);
  const nonFlags = [];
  let i = 0;

  while (i < parts.length) {
    if (parts[i] === "--perspectives" && parts[i + 1]) {
      args.perspectives = parts[i + 1].split(",").map((p) => p.trim());
      i += 2;
    } else if (parts[i].startsWith("--")) {
      i++;
    } else {
      nonFlags.push(parts[i]);
      i++;
    }
  }

  args.target = nonFlags.join(" ") || null;
  return args;
}

/**
 * Format debate result for display
 */
function formatResult(result) {
  if (result.error) {
    return `Debate Review Error: ${result.error}`;
  }

  const lines = [
    "Debate Review Report",
    "====================",
    `Target: ${result.target}`,
    `Perspectives: ${(result.votes || []).map((v) => v.perspective).join(", ")}`,
    "",
    "| Reviewer | Vote | Issues |",
    "| --- | --- | --- |",
  ];

  for (const vote of result.votes || []) {
    const issueCount = vote.issues?.length || 0;
    lines.push(`| ${vote.perspective} | ${vote.vote} | ${issueCount} |`);
  }

  lines.push("");
  lines.push(
    `Verdict: **${result.verdict}** (consensus: ${(result.consensusScore || 0).toFixed(2)})`,
  );

  if (result.duration) {
    lines.push(`Duration: ${result.duration}ms`);
  }

  // List critical/warning issues
  const allIssues = (result.votes || []).flatMap((v) => v.issues || []);
  const critical = allIssues.filter((i) => i.severity === "critical");
  const warnings = allIssues.filter((i) => i.severity === "warning");

  if (critical.length > 0) {
    lines.push("", "### Critical Issues");
    for (const issue of critical) {
      const loc = issue.line ? `:${issue.line}` : "";
      lines.push(`- ${loc} ${issue.description}`);
    }
  }

  if (warnings.length > 0) {
    lines.push("", "### Warnings");
    for (const issue of warnings) {
      const loc = issue.line ? `:${issue.line}` : "";
      lines.push(`- ${loc} ${issue.description}`);
    }
  }

  return lines.join("\n");
}

/**
 * Handler entry point
 * @param {Object} params - { input, context, workspace }
 * @returns {Object} Skill result
 */
async function handler(params) {
  const { input, context, workspace } = params;

  const args = parseArgs(input);

  if (!args.target) {
    return {
      success: false,
      output:
        "Usage: /debate-review <file-or-diff> [--perspectives perf,security,maintain]",
    };
  }

  // Resolve target path
  let targetPath = args.target;
  if (workspace && !path.isAbsolute(targetPath)) {
    targetPath = path.resolve(workspace, targetPath);
  }

  try {
    // Get DebateReview manager
    const { getDebateReview } = require("../../debate-review");
    const debateReview = getDebateReview();

    if (!debateReview.initialized) {
      return {
        success: false,
        output:
          "DebateReview is not initialized. Make sure the system is fully loaded.",
      };
    }

    const result = await debateReview.startDebate({
      target: targetPath,
      perspectives: args.perspectives,
      context: context?.additionalContext,
    });

    return {
      success: true,
      output: formatResult(result),
      data: result,
    };
  } catch (error) {
    logger.error("[debate-review handler] Error:", error.message);
    return {
      success: false,
      output: `Debate review failed: ${error.message}`,
    };
  }
}

module.exports = {
  async init(_skill) {
    logger.info("[debate-review] Handler initialized");
  },
  async execute(task, context = {}, _skill) {
    const input = task.input || task.args || "";
    return handler({ input, context });
  },
};
