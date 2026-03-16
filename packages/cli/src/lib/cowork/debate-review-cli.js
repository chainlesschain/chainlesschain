/**
 * Multi-perspective debate review for CLI
 *
 * Spawns multiple reviewer agents (performance, security, maintainability, etc.)
 * Each reviews independently via LLM, then a moderator synthesizes a verdict.
 */

import { createChatFn } from "../cowork-adapter.js";

const DEFAULT_PERSPECTIVES = ["performance", "security", "maintainability"];

const PERSPECTIVE_PROMPTS = {
  performance: {
    role: "Performance Reviewer",
    system:
      "You are a performance-focused code reviewer. Analyze code for time complexity, memory usage, unnecessary allocations, blocking operations, N+1 queries, and scalability issues. Be specific and cite line numbers when possible.",
  },
  security: {
    role: "Security Reviewer",
    system:
      "You are a security-focused code reviewer. Analyze code for injection vulnerabilities, authentication/authorization issues, data exposure, insecure defaults, OWASP top 10, and supply chain risks. Be specific and cite line numbers when possible.",
  },
  maintainability: {
    role: "Maintainability Reviewer",
    system:
      "You are a maintainability-focused code reviewer. Analyze code for readability, naming conventions, coupling, cohesion, DRY violations, missing error handling, test coverage gaps, and documentation needs. Be specific and cite line numbers when possible.",
  },
  correctness: {
    role: "Correctness Reviewer",
    system:
      "You are a correctness-focused code reviewer. Analyze code for logic errors, off-by-one bugs, race conditions, null/undefined handling, edge cases, type mismatches, and incorrect assumptions. Be specific and cite line numbers when possible.",
  },
  architecture: {
    role: "Architecture Reviewer",
    system:
      "You are an architecture-focused code reviewer. Analyze code for separation of concerns, dependency management, design pattern usage, extensibility, and alignment with established project patterns. Be specific.",
  },
};

/**
 * Run a multi-perspective debate review
 *
 * @param {object} params
 * @param {string} params.target - Description of what's being reviewed
 * @param {string} params.code - The code to review
 * @param {string[]} [params.perspectives] - Perspectives to use
 * @param {object} [params.llmOptions] - LLM provider options
 * @returns {Promise<object>} Review result with verdict and reviews
 */
export async function startDebate({
  target,
  code,
  perspectives = DEFAULT_PERSPECTIVES,
  llmOptions = {},
}) {
  const chat = createChatFn(llmOptions);
  const reviews = [];

  // Phase 1: Independent reviews from each perspective
  for (const perspective of perspectives) {
    const config = PERSPECTIVE_PROMPTS[perspective] || {
      role: `${perspective} Reviewer`,
      system: `You are a ${perspective}-focused code reviewer. Provide specific, actionable feedback.`,
    };

    const messages = [
      { role: "system", content: config.system },
      {
        role: "user",
        content: `Review the following code/content.\n\nTarget: ${target}\n\n\`\`\`\n${code}\n\`\`\`\n\nProvide your review as a ${config.role}. Format your response as:\n\n## Issues Found\n- List each issue with severity (HIGH/MEDIUM/LOW)\n\n## Recommendations\n- List specific improvements\n\n## Verdict\nAPPROVE, NEEDS_WORK, or REJECT with a brief reason.`,
      },
    ];

    try {
      const response = await chat(messages, { maxTokens: 1500 });
      const verdict = extractVerdict(response);
      reviews.push({
        perspective,
        role: config.role,
        review: response,
        verdict,
      });
    } catch (err) {
      reviews.push({
        perspective,
        role: config.role,
        review: `Error: ${err.message}`,
        verdict: "ERROR",
      });
    }
  }

  // Phase 2: Moderator synthesizes final verdict
  // Summarize each reviewer's output to reduce context pollution for the moderator
  const REVIEW_SUMMARY_MAX = 300;
  const reviewSummaries = reviews.map((r) => {
    const summarized =
      r.review.length <= REVIEW_SUMMARY_MAX
        ? r.review
        : r.review.substring(0, REVIEW_SUMMARY_MAX) + "... [truncated]";
    return { ...r, reviewSummary: summarized };
  });

  const moderatorMessages = [
    {
      role: "system",
      content:
        "You are a senior engineering lead moderating a code review. Synthesize the perspectives below into a final verdict. Weight security and correctness issues higher than style concerns.",
    },
    {
      role: "user",
      content: `Multiple reviewers analyzed this code. Synthesize their findings into a final verdict.\n\nTarget: ${target}\n\n${reviewSummaries
        .map((r) => `### ${r.role} (${r.verdict})\n${r.reviewSummary}`)
        .join(
          "\n\n---\n\n",
        )}\n\nProvide:\n1. Final Verdict: APPROVE / NEEDS_WORK / REJECT\n2. Consensus Score: 0-100 (how much the reviewers agree)\n3. Summary of key findings across all perspectives\n4. Priority action items (if any)`,
    },
  ];

  let finalVerdict = "NEEDS_WORK";
  let consensusScore = 50;
  let summary = "";

  try {
    summary = await chat(moderatorMessages, { maxTokens: 1500 });
    finalVerdict = extractVerdict(summary);
    consensusScore = extractConsensusScore(summary);
  } catch (err) {
    summary = `Moderator error: ${err.message}`;
  }

  return {
    target,
    perspectives,
    reviews,
    verdict: finalVerdict,
    consensusScore,
    summary,
  };
}

function extractVerdict(text) {
  if (/\bREJECT\b/i.test(text)) return "REJECT";
  if (/\bAPPROVE\b/i.test(text)) return "APPROVE";
  return "NEEDS_WORK";
}

function extractConsensusScore(text) {
  const match = text.match(/consensus\s*score[:\s]*(\d+)/i);
  if (match) return parseInt(match[1], 10);
  return 50;
}

export { DEFAULT_PERSPECTIVES, PERSPECTIVE_PROMPTS };
