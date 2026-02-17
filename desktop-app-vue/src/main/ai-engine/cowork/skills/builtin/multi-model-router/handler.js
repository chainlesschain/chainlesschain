/**
 * Multi-Model Router Skill Handler
 *
 * Intelligently routes tasks to the most appropriate AI model
 * based on complexity scoring and cost/quality optimization.
 * Modes: --route, --analyze, --config
 */

const { logger } = require("../../../../../utils/logger.js");

// ── Model capability matrix ────────────────────────────────────────

const MODEL_MATRIX = {
  "claude-opus": {
    name: "Claude Opus 4.6",
    reasoning: 10,
    coding: 9,
    speed: 3,
    costPer1kTokens: 0.075,
    strengths: [
      "complex architecture",
      "multi-file reasoning",
      "security analysis",
      "debugging",
    ],
    bestFor:
      "Complex reasoning, architectural decisions, security-critical code",
  },
  "claude-sonnet": {
    name: "Claude Sonnet 4.5",
    reasoning: 8,
    coding: 9,
    speed: 7,
    costPer1kTokens: 0.015,
    strengths: [
      "code generation",
      "refactoring",
      "test writing",
      "explanations",
    ],
    bestFor: "General coding tasks, refactoring, test generation",
  },
  "claude-haiku": {
    name: "Claude Haiku 4.5",
    reasoning: 5,
    coding: 6,
    speed: 10,
    costPer1kTokens: 0.005,
    strengths: ["quick edits", "formatting", "simple Q&A", "translation"],
    bestFor: "Simple edits, formatting, quick answers",
  },
  "gpt-4o": {
    name: "GPT-4o",
    reasoning: 9,
    coding: 8,
    speed: 6,
    costPer1kTokens: 0.025,
    strengths: ["multimodal", "broad knowledge", "creative tasks"],
    bestFor: "Multimodal tasks, creative coding, broad knowledge queries",
  },
  "gpt-4o-mini": {
    name: "GPT-4o Mini",
    reasoning: 6,
    coding: 6,
    speed: 9,
    costPer1kTokens: 0.003,
    strengths: ["fast responses", "simple tasks", "classification"],
    bestFor: "Fast simple tasks, classification, data extraction",
  },
  "qwen2-local": {
    name: "Qwen2 7B (Local)",
    reasoning: 7,
    coding: 7,
    speed: 8,
    costPer1kTokens: 0,
    strengths: ["free", "offline", "Chinese language", "privacy"],
    bestFor: "Free local inference, Chinese language tasks, offline use",
  },
};

// ── Complexity keywords ─────────────────────────────────────────────

const COMPLEXITY_KEYWORDS = {
  high: {
    patterns: [
      /\b(architect|refactor|redesign|migrate|rewrite|overhaul|security|audit)\b/i,
      /\b(across|multiple|all|entire|whole|system|infrastructure)\b/i,
      /\b(15|20|30|50|100)\+?\s*(files?|modules?|components?)/i,
      /\b(breaking\s+change|backward\s+compat|api\s+design)\b/i,
    ],
    weight: 3,
  },
  medium: {
    patterns: [
      /\b(implement|add|create|build|develop|integrate|update)\b/i,
      /\b(feature|component|module|service|endpoint|page)\b/i,
      /\b(test|debug|fix|optimize|improve)\b/i,
      /\b(3|4|5|6|7|8|9|10)\s*(files?|modules?)/i,
    ],
    weight: 1,
  },
  low: {
    patterns: [
      /\b(typo|rename|format|indent|comment|log|print)\b/i,
      /\b(simple|quick|small|minor|trivial|easy)\b/i,
      /\b(one|single|1)\s*(file|line|function|variable)\b/i,
      /\b(readme|changelog|docs?|documentation)\b/i,
    ],
    weight: -2,
  },
};

const DOMAIN_WEIGHTS = {
  security: 2,
  architecture: 2,
  performance: 1,
  testing: 0,
  documentation: -1,
  formatting: -2,
};

// ── Scoring ─────────────────────────────────────────────────────────

function analyzeComplexity(task) {
  let score = 5; // baseline
  const factors = {
    scope: "medium",
    reasoning: "medium",
    domain: "general",
    risk: "low",
    matchedPatterns: [],
  };

  // Keyword scoring
  for (const [level, config] of Object.entries(COMPLEXITY_KEYWORDS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(task)) {
        score += config.weight;
        factors.matchedPatterns.push(
          level + ": " + pattern.source.substring(0, 40),
        );
      }
    }
  }

  // Domain detection
  for (const [domain, weight] of Object.entries(DOMAIN_WEIGHTS)) {
    if (new RegExp("\\b" + domain + "\\b", "i").test(task)) {
      score += weight;
      factors.domain = domain;
    }
  }

  // Scope estimation from word count
  const wordCount = task.split(/\s+/).length;
  if (wordCount > 30) {
    score += 1;
    factors.scope = "large";
  } else if (wordCount < 8) {
    score -= 1;
    factors.scope = "small";
  }

  // File count detection
  const fileCountMatch = task.match(/(\d+)\s*(files?|modules?)/i);
  if (fileCountMatch) {
    const count = parseInt(fileCountMatch[1]);
    if (count > 10) {
      score += 3;
      factors.scope = "very-large";
    } else if (count > 5) {
      score += 2;
      factors.scope = "large";
    } else if (count > 2) {
      score += 1;
      factors.scope = "medium";
    }
  }

  // Risk assessment
  if (
    /\b(security|auth|payment|credential|token|password|encrypt)\b/i.test(task)
  ) {
    factors.risk = "high";
    score += 2;
  } else if (/\b(database|migration|deploy|production)\b/i.test(task)) {
    factors.risk = "medium";
    score += 1;
  }

  // Reasoning depth
  if (score >= 7) {
    factors.reasoning = "high";
  } else if (score <= 3) {
    factors.reasoning = "low";
  }

  // Clamp
  score = Math.max(1, Math.min(10, Math.round(score)));

  return { score, factors };
}

function selectModel(score) {
  if (score >= 8) {
    return "claude-opus";
  }
  if (score >= 5) {
    return "claude-sonnet";
  }
  if (score >= 3) {
    return "claude-haiku";
  }
  return "claude-haiku";
}

function estimateCost(model, taskLength) {
  const info = MODEL_MATRIX[model];
  if (!info) {
    return "$0.00";
  }
  // Rough estimate: task description length * 10 for response tokens
  const estimatedTokens = Math.max(500, taskLength * 10);
  const cost = (estimatedTokens / 1000) * info.costPer1kTokens;
  return "$" + cost.toFixed(4);
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[multi-model-router] init: " + (_skill?.name || "multi-model-router"),
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const routeMatch = input.match(/--route\s+(.+)/is);
    const analyzeMatch = input.match(/--analyze\s+(.+)/is);
    const isConfig = /--config/i.test(input);

    try {
      if (isConfig) {
        let msg = "Model Capability Matrix\n" + "=".repeat(40) + "\n\n";
        msg += "Model".padEnd(20) + "Reasoning  Coding  Speed  Cost/1k\n";
        msg += "-".repeat(60) + "\n";
        for (const [key, model] of Object.entries(MODEL_MATRIX)) {
          msg +=
            key.padEnd(20) +
            String(model.reasoning).padEnd(11) +
            String(model.coding).padEnd(8) +
            String(model.speed).padEnd(7) +
            "$" +
            model.costPer1kTokens.toFixed(3) +
            "\n";
        }
        msg += "\nUse --route <task> to get a recommendation.";
        return {
          success: true,
          result: { models: MODEL_MATRIX },
          message: msg,
        };
      }

      const taskDesc = routeMatch
        ? routeMatch[1].trim()
        : analyzeMatch
          ? analyzeMatch[1].trim()
          : input;
      if (!taskDesc) {
        return {
          success: false,
          error:
            "No task provided. Usage: /multi-model-router --route <task> | --analyze <task> | --config",
          message:
            "Usage: /multi-model-router --route <task> | --analyze <task> | --config",
        };
      }

      const { score, factors } = analyzeComplexity(taskDesc);

      if (analyzeMatch) {
        let msg = "Complexity Analysis\n" + "=".repeat(30) + "\n";
        msg += "Task: " + taskDesc.substring(0, 100) + "\n";
        msg += "Score: " + score + "/10\n";
        msg += "Scope: " + factors.scope + "\n";
        msg += "Reasoning: " + factors.reasoning + "\n";
        msg += "Domain: " + factors.domain + "\n";
        msg += "Risk: " + factors.risk + "\n";
        if (factors.matchedPatterns.length > 0) {
          msg +=
            "Matched patterns:\n" +
            factors.matchedPatterns.map((p) => "  - " + p).join("\n");
        }
        return {
          success: true,
          result: { complexity: score, factors },
          message: msg,
        };
      }

      // Route mode
      const modelKey = selectModel(score);
      const model = MODEL_MATRIX[modelKey];
      const costEstimate = estimateCost(modelKey, taskDesc.length);

      let msg = "Model Routing\n" + "=".repeat(30) + "\n";
      msg += "Task: " + taskDesc.substring(0, 100) + "\n";
      msg += "Complexity: " + score + "/10\n\n";
      msg += "Recommended: " + model.name + " (" + modelKey + ")\n";
      msg += "Estimated cost: " + costEstimate + "\n";
      msg += "Best for: " + model.bestFor + "\n";
      msg += "Strengths: " + model.strengths.join(", ") + "\n\n";
      msg +=
        "Factors: scope=" +
        factors.scope +
        ", reasoning=" +
        factors.reasoning +
        ", domain=" +
        factors.domain +
        ", risk=" +
        factors.risk;

      const result = {
        complexity: score,
        recommendedModel: modelKey,
        modelName: model.name,
        reasoning: model.bestFor,
        costEstimate,
        factors,
        alternatives: Object.entries(MODEL_MATRIX)
          .filter(([k]) => k !== modelKey)
          .map(([k, v]) => ({
            model: k,
            name: v.name,
            costPer1k: "$" + v.costPer1kTokens.toFixed(3),
          }))
          .slice(0, 3),
      };

      return { success: true, result, message: msg };
    } catch (err) {
      logger.error("[multi-model-router] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Model router failed: " + err.message,
      };
    }
  },
};
