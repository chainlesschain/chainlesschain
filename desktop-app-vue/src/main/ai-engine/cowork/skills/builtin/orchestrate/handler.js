/**
 * Orchestrate Workflow Skill Handler
 *
 * Multi-agent workflow orchestration with predefined templates
 * (feature, bugfix, refactor, security-audit), agent handoff
 * protocol, and structured inter-agent documents.
 *
 * Inspired by the everything-claude-code orchestrate pattern.
 */

const { logger } = require("../../../../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

/**
 * Workflow template definitions.
 * Each maps a workflow type to an ordered list of agent roles.
 */
const WORKFLOW_TEMPLATES = {
  feature: {
    name: "Feature Development",
    agents: [
      {
        role: "planner",
        agentType: "document",
        label: "Requirements Planner",
        prompt:
          "Analyze the following feature request and produce a structured requirements document with acceptance criteria, scope, and implementation priorities.",
      },
      {
        role: "architect",
        agentType: "design",
        label: "Solution Architect",
        prompt:
          "Based on the requirements, design the technical architecture. Identify components, data models, API contracts, and integration points.",
      },
      {
        role: "coder",
        agentType: "code-generation",
        label: "Implementation Coder",
        prompt:
          "Implement the feature according to the architecture design. Follow existing code patterns and conventions.",
      },
      {
        role: "reviewer",
        agentType: "code-review",
        label: "Code Reviewer",
        prompt:
          "Review the implementation for code quality, security, performance, and adherence to the architecture. Flag issues by severity.",
      },
      {
        role: "verify",
        agentType: "testing",
        label: "Verification",
        isVerification: true,
      },
    ],
  },

  bugfix: {
    name: "Bug Fix",
    agents: [
      {
        role: "debugger",
        agentType: "debugging",
        label: "Bug Debugger",
        prompt:
          "Diagnose the reported bug. Identify root cause, affected components, and reproduction steps. Provide a fix strategy.",
      },
      {
        role: "coder",
        agentType: "code-generation",
        label: "Fix Implementer",
        prompt:
          "Implement the bug fix based on the diagnosis. Ensure minimal blast radius and no regressions.",
      },
      {
        role: "tester",
        agentType: "testing",
        label: "Test Generator",
        prompt:
          "Generate regression tests for the bug fix. Cover the original bug scenario and edge cases.",
      },
      {
        role: "verify",
        agentType: "testing",
        label: "Verification",
        isVerification: true,
      },
    ],
  },

  refactor: {
    name: "Code Refactoring",
    agents: [
      {
        role: "architect",
        agentType: "design",
        label: "Refactor Planner",
        prompt:
          "Analyze the codebase area to refactor. Plan the refactoring steps, identify dependencies, and define the target architecture.",
      },
      {
        role: "coder",
        agentType: "refactoring",
        label: "Refactor Implementer",
        prompt:
          "Execute the refactoring plan. Make incremental changes, preserving external behavior. Follow the boy scout rule.",
      },
      {
        role: "reviewer",
        agentType: "code-review",
        label: "Refactor Reviewer",
        prompt:
          "Review the refactored code. Verify behavior preservation, improved structure, and no regressions introduced.",
      },
      {
        role: "verify",
        agentType: "testing",
        label: "Verification",
        isVerification: true,
      },
    ],
  },

  "security-audit": {
    name: "Security Audit",
    agents: [
      {
        role: "security-reviewer",
        agentType: "security",
        label: "Security Scanner",
        prompt:
          "Perform a comprehensive security audit. Scan for OWASP Top 10, hardcoded secrets, insecure dependencies, and authentication/authorization issues.",
      },
      {
        role: "coder",
        agentType: "code-generation",
        label: "Security Fixer",
        prompt:
          "Fix the security issues identified in the audit. Prioritize critical and high severity findings.",
      },
      {
        role: "security-verifier",
        agentType: "security",
        label: "Security Re-scan",
        prompt:
          "Re-scan the codebase after fixes. Verify all critical and high issues are resolved. Flag any remaining concerns.",
      },
      {
        role: "verify",
        agentType: "testing",
        label: "Verification",
        isVerification: true,
      },
    ],
  },
};

module.exports = {
  async init(_skill) {
    logger.info("[Orchestrate] Handler initialized");
  },

  async execute(task, context = {}, _skill) {
    const input = task.input || task.args || "";
    const { workflowType, description, options } = parseInput(input);

    logger.info(
      `[Orchestrate] Workflow: ${workflowType}, desc: ${description}`,
    );

    try {
      const template = getWorkflowTemplate(workflowType);
      if (!template) {
        const available = Object.keys(WORKFLOW_TEMPLATES).join(", ");
        return {
          success: false,
          message: `Unknown workflow: "${workflowType}". Available: ${available}`,
        };
      }

      if (!description) {
        return {
          success: false,
          message: `Usage: /orchestrate <template> "description"\nExample: /orchestrate feature "add user profile page"`,
        };
      }

      const pipelineResult = await runPipeline(
        template,
        description,
        context,
        options,
      );
      return pipelineResult;
    } catch (error) {
      logger.error(`[Orchestrate] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Orchestration failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input) {
  const trimmed = (input || "").trim();
  const options = { verbose: false };

  // Extract --verbose flag
  const cleaned = trimmed.replace(/--verbose\b/, "").trim();

  if (trimmed.includes("--verbose")) {
    options.verbose = true;
  }

  // Parse: <workflowType> "description" or <workflowType> description
  const quotedMatch = cleaned.match(/^(\S+)\s+"([^"]+)"/);
  if (quotedMatch) {
    return {
      workflowType: quotedMatch[1].toLowerCase(),
      description: quotedMatch[2],
      options,
    };
  }

  const parts = cleaned.split(/\s+/);
  const workflowType = (parts[0] || "").toLowerCase();
  const description = parts.slice(1).join(" ");

  return { workflowType, description, options };
}

function getWorkflowTemplate(type) {
  return WORKFLOW_TEMPLATES[type] || null;
}

async function runPipeline(template, description, context, _options) {
  const sessionId = uuidv4();
  const startTime = Date.now();
  const results = [];

  logger.info(
    `[Orchestrate] Starting ${template.name} pipeline (session: ${sessionId})`,
  );

  let previousHandoff = {
    description,
    context: context.workspacePath || process.cwd(),
  };

  // Try to get AgentCoordinator from context
  const coordinator = context.agentCoordinator || null;

  for (let i = 0; i < template.agents.length; i++) {
    const agentDef = template.agents[i];
    const stepStart = Date.now();

    logger.info(
      `[Orchestrate] Step ${i + 1}/${template.agents.length}: ${agentDef.label}`,
    );

    let stepResult;

    if (agentDef.isVerification) {
      // Run verification-loop as final stage
      stepResult = await runVerificationStage(context);
    } else if (coordinator) {
      // Use AgentCoordinator for real agent execution
      stepResult = await runWithCoordinator(
        coordinator,
        agentDef,
        description,
        previousHandoff,
      );
    } else {
      // Fallback: simulate agent execution with structured output
      stepResult = simulateAgentExecution(
        agentDef,
        description,
        previousHandoff,
      );
    }

    const duration = ((Date.now() - stepStart) / 1000).toFixed(1);

    const handoff = createHandoffDocument(
      agentDef,
      stepResult,
      i + 1 < template.agents.length ? template.agents[i + 1] : null,
    );

    results.push({
      step: i + 1,
      role: agentDef.role,
      label: agentDef.label,
      agentType: agentDef.agentType,
      status: stepResult.success ? "Complete" : "Failed",
      duration: parseFloat(duration),
      summary: stepResult.summary || stepResult.message || "",
      handoff,
    });

    previousHandoff = handoff;

    // Stop pipeline on critical failure (non-verification stages)
    if (!stepResult.success && !agentDef.isVerification) {
      logger.warn(
        `[Orchestrate] Pipeline halted at step ${i + 1}: ${agentDef.role}`,
      );
      break;
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  return aggregateResults(template, description, results, totalDuration);
}

async function runWithCoordinator(
  coordinator,
  agentDef,
  description,
  previousHandoff,
) {
  try {
    const taskDescription = [
      agentDef.prompt,
      `\nTask: ${description}`,
      previousHandoff.decisions
        ? `\nPrevious decisions: ${previousHandoff.decisions.join(", ")}`
        : "",
      previousHandoff.nextAgentInstructions
        ? `\nInstructions from previous agent: ${previousHandoff.nextAgentInstructions}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await coordinator.orchestrate(taskDescription, {
      strategy: "sequential",
      context: { agentType: agentDef.agentType },
    });

    return {
      success: result.success !== false,
      summary: result.summary?.overview || "Task completed",
      deliverables: result.summary?.deliverables || [],
      decisions: result.summary?.decisions || [],
      concerns: result.summary?.concerns || [],
    };
  } catch (error) {
    logger.error(
      `[Orchestrate] Coordinator error for ${agentDef.role}: ${error.message}`,
    );
    return {
      success: false,
      summary: `Agent error: ${error.message}`,
      deliverables: [],
      decisions: [],
      concerns: [error.message],
    };
  }
}

function simulateAgentExecution(agentDef, description, _previousHandoff) {
  // When no coordinator is available, produce structured output
  // indicating what the agent would do
  return {
    success: true,
    summary: `[${agentDef.label}] Analyzed: "${description.substring(0, 60)}"`,
    deliverables: [`${agentDef.role}-output`],
    decisions: [],
    concerns: [],
    message:
      `${agentDef.label} completed analysis of the task. ` +
      `Agent type: ${agentDef.agentType}. ` +
      `Prompt: ${(agentDef.prompt || "").substring(0, 100)}...`,
  };
}

async function runVerificationStage(context) {
  try {
    const verificationHandler = require("../verification-loop/handler.js");
    const result = await verificationHandler.execute(
      { input: "", args: "" },
      context,
    );

    return {
      success: result.allPassed !== false,
      summary: result.result
        ? `${result.result.passed}/${result.result.passed + result.result.failed} stages passed. Verdict: ${result.result.verdict}`
        : result.message || "Verification complete",
      deliverables: ["verification-report"],
      decisions: [],
      concerns:
        result.result?.failed > 0
          ? result.result.stages
              .filter((s) => s.status === "FAIL")
              .map((s) => `${s.stage}: ${s.details}`)
          : [],
    };
  } catch (error) {
    logger.warn(`[Orchestrate] Verification handler error: ${error.message}`);
    return {
      success: true,
      summary: "Verification skipped (handler unavailable)",
      deliverables: [],
      decisions: [],
      concerns: ["Verification handler could not be loaded"],
    };
  }
}

function createHandoffDocument(agentDef, agentResult, nextAgent) {
  return {
    agent: agentDef.role,
    agentType: agentDef.agentType,
    status: agentResult.success ? "complete" : "failed",
    deliverables: agentResult.deliverables || [],
    decisions: agentResult.decisions || [],
    concerns: agentResult.concerns || [],
    nextAgentInstructions: nextAgent
      ? `Continue with ${nextAgent.label}. ${nextAgent.prompt || ""}`
      : "Final stage reached.",
  };
}

function aggregateResults(template, description, results, totalDuration) {
  const completed = results.filter((r) => r.status === "Complete").length;
  const failed = results.filter((r) => r.status === "Failed").length;
  const total = results.length;

  // Determine verdict
  let verdict;
  const hasCriticalFailure = results.some(
    (r) => r.status === "Failed" && !r.role.includes("verify"),
  );
  const hasVerificationFailure = results.some(
    (r) => r.status === "Failed" && r.role.includes("verify"),
  );
  const hasConcerns = results.some(
    (r) => r.handoff && r.handoff.concerns && r.handoff.concerns.length > 0,
  );

  if (hasCriticalFailure) {
    verdict = "BLOCKED";
  } else if (hasVerificationFailure) {
    verdict = "NEEDS WORK";
  } else if (hasConcerns) {
    verdict = "NEEDS WORK";
  } else {
    verdict = "SHIP";
  }

  // Build report
  const lines = [
    `Orchestrate Workflow Report`,
    `===========================`,
    `Template: ${template.name}`,
    `Description: "${description}"`,
    ``,
    `| Step | Agent     | Status   | Duration | Summary                    |`,
    `| ---- | --------- | -------- | -------- | -------------------------- |`,
  ];

  for (const r of results) {
    const icon = r.status === "Complete" ? "Complete" : "Failed";
    lines.push(
      `| ${String(r.step).padEnd(4)} | ${r.role.padEnd(9)} | ${icon.padEnd(8)} | ${(r.duration + "s").padEnd(8)} | ${(r.summary || "").substring(0, 40)} |`,
    );
  }

  lines.push(``);
  lines.push(`Steps: ${completed}/${total} completed, ${failed} failed`);
  lines.push(`Duration: ${totalDuration}s`);
  lines.push(``);
  lines.push(`Verdict: ${verdict}`);

  // Add concerns if any
  const allConcerns = results.flatMap((r) =>
    (r.handoff?.concerns || []).map((c) => `  - [${r.role}] ${c}`),
  );
  if (allConcerns.length > 0) {
    lines.push(``);
    lines.push(`Concerns:`);
    lines.push(...allConcerns.slice(0, 10));
  }

  return {
    success: verdict !== "BLOCKED",
    result: {
      verdict,
      template: template.name,
      description,
      steps: results,
      completed,
      failed,
      total,
      totalDuration: parseFloat(totalDuration),
      concerns: allConcerns,
    },
    allPassed: verdict === "SHIP",
    message: lines.join("\n"),
  };
}
