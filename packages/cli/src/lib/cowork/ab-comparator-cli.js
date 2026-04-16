/**
 * A/B Comparator for CLI
 *
 * Generates N solution variants for a prompt using different agent configurations,
 * then scores and ranks them against specified criteria.
 */

import { createChatFn } from "../cowork-adapter.js";
import { runPeerGroup } from "./agent-group-runner.js";

const DEFAULT_CRITERIA = ["quality", "performance", "readability"];

const VARIANT_PROFILES = [
  {
    name: "conservative",
    system:
      "You are a conservative software engineer who favors proven patterns, stability, and minimal dependencies. Prefer simple, well-tested approaches over cutting-edge solutions.",
  },
  {
    name: "innovative",
    system:
      "You are an innovative software engineer who favors modern patterns, new APIs, and elegant abstractions. Prioritize developer experience and future-proofing.",
  },
  {
    name: "pragmatic",
    system:
      "You are a pragmatic software engineer who balances simplicity with capability. Choose the approach that ships fastest while maintaining acceptable quality.",
  },
  {
    name: "performance-focused",
    system:
      "You are a performance-oriented engineer. Optimize for speed, memory efficiency, and minimal overhead. Accept complexity if it yields measurable performance gains.",
  },
];

/**
 * Generate and compare N solution variants
 *
 * @param {object} params
 * @param {string} params.prompt - The task/problem description
 * @param {number} [params.variants=3] - Number of variants to generate
 * @param {string[]} [params.criteria] - Scoring criteria
 * @param {object} [params.llmOptions] - LLM provider options
 * @returns {Promise<object>} Comparison result with ranked variants
 */
export async function compare({
  prompt,
  variants = 3,
  criteria = DEFAULT_CRITERIA,
  llmOptions = {},
}) {
  const chat = createChatFn(llmOptions);
  const numVariants = Math.min(variants, VARIANT_PROFILES.length);
  const profiles = VARIANT_PROFILES.slice(0, numVariants);

  // Phase 1: Team of peer variant-generators; judge is the coordinator.
  const peers = profiles.map((profile) => ({
    agentId: `variant_${profile.name}`,
    role: profile.name,
    taskTitle: `Generate variant (${profile.name})`,
    taskDescription: prompt,
    payload: { profile },
  }));

  const runResult = await runPeerGroup({
    peers,
    coordinator: { agentId: "judge", role: "Judge" },
    metadata: { kind: "ab-comparator", prompt },
    runPeer: async (peer) => {
      const profile = peer.payload.profile;
      const messages = [
        { role: "system", content: profile.system },
        {
          role: "user",
          content: `Provide a solution for the following task. Include code if applicable.\n\nTask: ${prompt}\n\nProvide your solution with:\n1. Approach summary (1-2 sentences)\n2. Implementation (code or detailed steps)\n3. Trade-offs (pros and cons of this approach)`,
        },
      ];
      const response = await chat(messages, { maxTokens: 2000 });
      return {
        name: profile.name,
        profile: profile.system,
        solution: response,
      };
    },
  });

  const generatedVariants = runResult.results.map((r) => {
    if (r.ok) return r.value;
    const profile = r.peer.payload.profile;
    return {
      name: profile.name,
      profile: profile.system,
      solution: `Error generating variant: ${r.error?.message || r.error}`,
    };
  });

  // Phase 2: Score each variant against criteria
  const scoringPrompt = `You are an impartial judge evaluating ${numVariants} solution variants against these criteria: ${criteria.join(", ")}.

For each variant, assign a score from 1-10 for each criterion. Then provide an overall ranking.

${generatedVariants
  .map((v, i) => `### Variant ${i + 1}: ${v.name}\n${v.solution}`)
  .join("\n\n---\n\n")}

Respond in this exact format for each variant:
SCORES:
${generatedVariants.map((v, i) => `Variant ${i + 1} (${v.name}): ${criteria.map((c) => `${c}=X`).join(", ")}`).join("\n")}

RANKING: (best to worst, comma-separated variant names)
WINNER: (name of the best variant)
REASON: (1-2 sentence justification)`;

  let scores = [];
  let ranking = [];
  let winner = "";
  let reason = "";

  try {
    const judgement = await chat(
      [
        {
          role: "system",
          content:
            "You are an impartial technical evaluator. Score solutions objectively based on the given criteria.",
        },
        { role: "user", content: scoringPrompt },
      ],
      { maxTokens: 1500 },
    );

    // Parse scores
    scores = parseScores(judgement, generatedVariants, criteria);
    ranking = parseRanking(judgement, generatedVariants);
    winner = parseWinner(judgement) || generatedVariants[0]?.name || "unknown";
    reason = parseReason(judgement) || "See detailed scores above.";
  } catch (err) {
    reason = `Scoring error: ${err.message}`;
  }

  return {
    prompt,
    criteria,
    variants: generatedVariants.map((v, i) => ({
      ...v,
      scores: scores[i] || {},
      totalScore: scores[i]
        ? Object.values(scores[i]).reduce((a, b) => a + b, 0)
        : 0,
    })),
    ranking,
    winner,
    reason,
    group: {
      groupId: runResult.groupId,
      parentAgentId: runResult.parentAgentId,
      members: runResult.members,
      tasks: runResult.tasks,
    },
  };
}

function parseScores(text, variants, criteria) {
  const scores = [];
  for (let i = 0; i < variants.length; i++) {
    const variantScores = {};
    for (const c of criteria) {
      const pattern = new RegExp(
        `variant\\s*${i + 1}[^\\n]*${c}\\s*=\\s*(\\d+)`,
        "i",
      );
      const match = text.match(pattern);
      variantScores[c] = match ? parseInt(match[1], 10) : 5;
    }
    scores.push(variantScores);
  }
  return scores;
}

function parseRanking(text, variants) {
  const match = text.match(/RANKING:\s*(.+)/i);
  if (match) {
    return match[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return variants.map((v) => v.name);
}

function parseWinner(text) {
  const match = text.match(/WINNER:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

function parseReason(text) {
  const match = text.match(/REASON:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

export { DEFAULT_CRITERIA, VARIANT_PROFILES };
