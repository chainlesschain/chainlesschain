/**
 * Ultra Think Skill Handler
 * Extended thinking / deep reasoning mode
 */

const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) { logger.info("[UltraThink] Initialized"); },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "analyze": return handleAnalyze(parsed.problem, context);
        case "decompose": return handleDecompose(parsed.problem, context);
        case "evaluate": return handleEvaluate(parsed.problem, context);
        default: return handleAnalyze(parsed.problem, context);
      }
    } catch (error) {
      logger.error("[UltraThink] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "analyze", problem: "" };
  const parts = input.trim().split(/\s+/);
  const first = (parts[0] || "").toLowerCase();
  if (["analyze", "decompose", "evaluate"].includes(first)) {
    return { action: first, problem: parts.slice(1).join(" ").replace(/"/g, "") };
  }
  return { action: "analyze", problem: input.trim().replace(/"/g, "") };
}

function handleAnalyze(problem, context) {
  const thinking = {
    phase: "deep-analysis",
    steps: [
      { step: 1, name: "Problem Restatement", prompt: `Restate the problem in your own words: "${problem}". Identify what is being asked and what a successful outcome looks like.` },
      { step: 2, name: "Constraint Mapping", prompt: "List all constraints: technical limitations, time/budget, compatibility requirements, scale requirements, team expertise, existing commitments." },
      { step: 3, name: "Assumption Identification", prompt: "What assumptions are being made? Which can be validated? Which are risky if wrong?" },
      { step: 4, name: "Root Cause / Core Challenge", prompt: "What is the fundamental challenge here? Look past symptoms to underlying causes." },
      { step: 5, name: "Solution Space", prompt: "Enumerate at least 3 distinct approaches. Include unconventional options. For each: describe mechanism, pros, cons, risks." },
      { step: 6, name: "Multi-Perspective Check", prompt: "Consider from: end-user perspective, developer perspective, operations perspective, security perspective, business perspective." },
      { step: 7, name: "Recommendation", prompt: "Synthesize a recommendation with rationale. Include: primary recommendation, fallback option, key risks to monitor, first concrete next step." },
    ],
  };

  const systemPrompt = buildSystemPrompt("analyze", problem, thinking.steps);

  return {
    success: true,
    action: "analyze",
    thinking,
    systemPrompt,
    problem,
    message: `Deep analysis framework prepared for: "${truncate(problem, 80)}". Use the system prompt to guide extended reasoning.`,
  };
}

function handleDecompose(problem, context) {
  const thinking = {
    phase: "decomposition",
    steps: [
      { step: 1, name: "Scope Definition", prompt: `Define the full scope of: "${problem}". What is in scope and out of scope?` },
      { step: 2, name: "Component Identification", prompt: "Identify all major components, subsystems, or work streams. Aim for 3-7 top-level components." },
      { step: 3, name: "Dependency Mapping", prompt: "For each component, identify dependencies: what must come before it? What does it enable? Draw the dependency graph." },
      { step: 4, name: "Sub-task Breakdown", prompt: "Break each component into concrete sub-tasks. Each sub-task should be: independently testable, estimable, assignable to one person/agent." },
      { step: 5, name: "Critical Path", prompt: "Identify the critical path: the longest chain of dependent tasks. This determines minimum timeline." },
      { step: 6, name: "Risk Assessment", prompt: "For each component: what could go wrong? What is the probability and impact? What is the mitigation?" },
      { step: 7, name: "Execution Plan", prompt: "Produce an ordered execution plan. Which tasks can run in parallel? What are the milestones and checkpoints?" },
    ],
  };

  const systemPrompt = buildSystemPrompt("decompose", problem, thinking.steps);

  return {
    success: true,
    action: "decompose",
    thinking,
    systemPrompt,
    problem,
    message: `Decomposition framework prepared for: "${truncate(problem, 80)}".`,
  };
}

function handleEvaluate(problem, context) {
  const thinking = {
    phase: "evaluation",
    steps: [
      { step: 1, name: "Option Enumeration", prompt: `List all options being evaluated for: "${problem}". Describe each option clearly.` },
      { step: 2, name: "Criteria Definition", prompt: "Define evaluation criteria: performance, cost, complexity, maintainability, scalability, security, time-to-implement, team familiarity, ecosystem maturity." },
      { step: 3, name: "Criteria Weighting", prompt: "Weight each criterion based on project priorities. Justify weights." },
      { step: 4, name: "Per-Option Scoring", prompt: "Score each option against each criterion (1-5). Provide evidence/reasoning for each score." },
      { step: 5, name: "Trade-off Matrix", prompt: "Build a comparison matrix. Highlight where options differ most. Identify deal-breakers." },
      { step: 6, name: "Sensitivity Analysis", prompt: "What if weights change? Which option wins if performance matters most? If cost matters most? If time matters most?" },
      { step: 7, name: "Final Verdict", prompt: "Recommend best option with confidence level (high/medium/low). State conditions under which you'd change the recommendation." },
    ],
  };

  const systemPrompt = buildSystemPrompt("evaluate", problem, thinking.steps);

  return {
    success: true,
    action: "evaluate",
    thinking,
    systemPrompt,
    problem,
    message: `Evaluation framework prepared for: "${truncate(problem, 80)}".`,
  };
}

function buildSystemPrompt(mode, problem, steps) {
  const stepText = steps.map((s) => `### Step ${s.step}: ${s.name}\n${s.prompt}`).join("\n\n");

  return `You are in ULTRA THINK mode — extended deep reasoning activated.

## Problem
${problem}

## Mode: ${mode.toUpperCase()}

## Instructions
Work through EVERY step below thoroughly. Do not skip steps. Show your reasoning explicitly at each stage. Take your time — depth and correctness matter more than speed.

${stepText}

## Rules
- Think step by step. Show work at each stage.
- Consider edge cases and failure modes.
- Challenge your own assumptions.
- If uncertain, say so and explain why.
- Produce a concrete, actionable conclusion.`;
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + "..." : str;
}
