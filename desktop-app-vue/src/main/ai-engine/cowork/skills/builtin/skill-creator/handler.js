/**
 * Skill Creator Handler
 *
 * Create, test, optimize, and validate skills.
 * v1.2.0: Added LLM-driven description optimization loop (optimize-description).
 */

const path = require("path");
const os = require("os");
const { logger } = require("../../../../../utils/logger.js");
const {
  requireBundledSkillEnvironmentBroker,
} = require("../../bundled-skill-environment-broker.js");
const {
  requireBundledSkillProcessBroker,
} = require("../../bundled-skill-process-broker.js");
const {
  bundledSkillFs: fs,
  withBundledSkillFilesystem,
} = require("../../bundled-skill-filesystem-broker.js");

function defaultManagedSkillsRoot() {
  let userDataPath = path.join(os.homedir(), ".chainlesschain");
  try {
    const { app } = require("electron");
    if (app?.getPath) userDataPath = app.getPath("userData");
  } catch {
    // CLI/test fallback matches SkillLoader.getLayerPaths().
  }
  return path.join(userDataPath, "skills");
}

// Injectable dependencies for testing
const _deps = {
  path,
  getManagedSkillsRoot: defaultManagedSkillsRoot,
};

const STAGE_A_CANDIDATE_STATUS = Object.freeze({
  candidateOnly: true,
  persisted: false,
  activeMutation: false,
});

function candidateOnlyResult(result) {
  return {
    ...result,
    ...STAGE_A_CANDIDATE_STATUS,
  };
}

function isMutationProposalAction(action) {
  return action === "create" || action === "optimize-description";
}

function resolveSkillDir(name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]{0,127}$/.test(name)) {
    const error = new Error(
      "Skill name must start with a letter and contain only letters, digits, or hyphens",
    );
    error.code = "CC_SKILL_NAME_INVALID";
    throw error;
  }
  const root = _deps.path.resolve(_deps.getManagedSkillsRoot());
  const target = _deps.path.resolve(root, name);
  const relative = _deps.path.relative(root, target);
  if (
    !relative ||
    relative.startsWith("..") ||
    _deps.path.isAbsolute(relative)
  ) {
    const error = new Error("Skill path escapes the managed skills root");
    error.code = "CC_SKILL_ROOT_ESCAPE";
    throw error;
  }
  return target;
}

module.exports = {
  _deps,

  async init() {
    logger.info("[SkillCreator] Initialized");
  },

  async execute(task, context = {}) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(
      `[SkillCreator] Action: ${parsed.action}, Name: ${parsed.name}`,
    );

    try {
      switch (parsed.action) {
        case "create":
          return handleCreate(parsed.name, parsed.description);
        case "test":
          return await handleTest(parsed.name, parsed.testInput, context);
        case "optimize":
          return handleOptimize(parsed.name);
        case "optimize-description":
          return await handleOptimizeDescription(
            parsed.name,
            parsed.maxIterations,
            {
              environment: {
                ...requireBundledSkillEnvironmentBroker(
                  context,
                  "skill-creator",
                ).snapshot(),
                CHAINLESSCHAIN_QUIET: "1",
              },
              processBroker: requireBundledSkillProcessBroker(
                context,
                "skill-creator",
              ),
              cliEntrypoint: context.cliEntrypoint || process.argv[1],
              cwd:
                context.projectRoot ||
                context.workspaceRoot ||
                context.workspacePath ||
                process.cwd(),
            },
          );
        case "validate":
          return handleValidate(parsed.name);
        case "list-templates":
          return handleListTemplates();
        case "get-template":
          return handleGetTemplate(parsed.name);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use create, test, optimize, optimize-description, validate, list-templates, or get-template.`,
          };
      }
    } catch (error) {
      logger.error("[SkillCreator] Error:", error);
      const result = {
        success: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      };
      return isMutationProposalAction(parsed.action)
        ? candidateOnlyResult({ action: parsed.action, ...result })
        : result;
    }
  },
};

// ─── Input Parser ────────────────────────────────────────────────────────────

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list-templates" };
  }

  const trimmed = input.trim();

  // Handle "optimize-description <name> [--iterations N]"
  const optDescMatch = trimmed.match(
    /^optimize-description\s+(\S+)(?:\s+--iterations\s+(\d+))?/i,
  );
  if (optDescMatch) {
    return {
      action: "optimize-description",
      name: optDescMatch[1],
      maxIterations: optDescMatch[2] ? parseInt(optDescMatch[2], 10) : 5,
    };
  }

  // Handle "optimize <name> --advanced [--iterations N]"
  const optAdvancedMatch = trimmed.match(
    /^optimize\s+(\S+)\s+--advanced(?:\s+--iterations\s+(\d+))?/i,
  );
  if (optAdvancedMatch) {
    return {
      action: "optimize-description",
      name: optAdvancedMatch[1],
      maxIterations: optAdvancedMatch[2]
        ? parseInt(optAdvancedMatch[2], 10)
        : 5,
    };
  }

  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "list-templates").toLowerCase();
  const name = parts[1] || "";

  const quotedMatch = trimmed.match(/"([^"]+)"/);
  const description = quotedMatch ? quotedMatch[1] : parts.slice(2).join(" ");

  return {
    action,
    name,
    description,
    testInput: description,
    maxIterations: 5,
  };
}

// ─── LLM Bridge (CLI context) ─────────────────────────────────────────────────

/**
 * Call the ChainlessChain CLI `ask` command to invoke the LLM.
 * Works when running inside `chainlesschain agent` or `chainlesschain skill run`.
 * Returns null on failure (non-CLI env, timeout, etc.).
 */
function callLLM(prompt, runtime) {
  try {
    if (!runtime.cliEntrypoint) {
      return null;
    }
    const output = runtime.processBroker.execFileSync(
      "node",
      [runtime.cliEntrypoint, "ask", prompt],
      {
        cwd: runtime.cwd,
        env: runtime.environment,
        timeout: 60_000,
      },
    );
    return (output || "").toString("utf8").trim() || null;
  } catch (error) {
    if (String(error?.code || "").startsWith("CC_BUNDLED_SKILL_PROCESS_")) {
      throw error;
    }
    return null;
  }
}

// ─── Optimize-Description Helpers ────────────────────────────────────────────

/**
 * Ask LLM to produce 20 eval queries for the skill.
 * Returns [{query, should_trigger}] or null on failure.
 */
function generateEvalQueries(skillName, description, runtimeEnv) {
  const prompt = `Generate exactly 20 realistic test queries to evaluate when to trigger a skill.

Skill name: "${skillName}"
Skill description: "${description}"

Rules:
- 10 queries where the skill SHOULD be triggered (should_trigger: true)
- 10 queries where the skill should NOT be triggered (should_trigger: false)
- Queries must be concrete, realistic user requests (include file names, context, specific details)
- Negative cases must be near-misses sharing keywords with the skill — NOT obviously unrelated
- Mix formal and casual phrasing, different lengths
- Return ONLY a JSON array, no explanation, no markdown fences

Format:
[{"query":"...", "should_trigger":true}, ...]`;

  const response = callLLM(prompt, runtimeEnv);
  if (!response) {
    return null;
  }

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    return parsed.filter(
      (q) =>
        typeof q.query === "string" && typeof q.should_trigger === "boolean",
    );
  } catch {
    return null;
  }
}

/**
 * Evaluate how well a description triggers (or doesn't) for each query.
 * Returns { score, correct, total, details }.
 */
function evaluateDescriptionDetailed(
  skillName,
  description,
  queries,
  runtimeEnv,
) {
  const details = [];
  let correct = 0;

  for (const q of queries) {
    const prompt = `You have one skill available:
Name: ${skillName}
Description: ${description}

A user sends this request: "${q.query}"

Would you invoke this skill to help? Answer with exactly YES or NO.`;

    const response = callLLM(prompt, runtimeEnv);
    const triggered = response ? /^\s*yes\b/i.test(response) : false;
    const isCorrect = triggered === q.should_trigger;

    if (isCorrect) {
      correct++;
    }
    details.push({
      query: q.query,
      shouldTrigger: q.should_trigger,
      triggered,
      correct: isCorrect,
    });
  }

  return {
    score: queries.length > 0 ? correct / queries.length : 0,
    correct,
    total: queries.length,
    details,
  };
}

/**
 * Ask LLM to rewrite the description to fix the given failures.
 * Returns the improved description string or null.
 */
function improveDescription(
  skillName,
  currentDescription,
  failures,
  runtimeEnv,
) {
  const failureLines = failures
    .map((f) => {
      const expected = f.shouldTrigger
        ? "SHOULD trigger"
        : "should NOT trigger";
      const got = f.triggered ? "triggered" : "did not trigger";
      return `  - "${f.query}" → expected ${expected}, but ${got}`;
    })
    .join("\n");

  const prompt = `Improve this skill description to fix the triggering failures below.

Skill: "${skillName}"
Current description: "${currentDescription}"

Failed test cases:
${failureLines}

Guidelines:
- Keep the description under 200 characters
- Include WHAT the skill does AND WHEN to use it
- For should-trigger failures: add contexts/phrases that better match those queries
- For should-not-trigger failures: narrow the scope to avoid false positives
- Make it slightly "pushy" — prefer triggering over missing — but stay accurate
- Return ONLY the new description text, no quotes, no explanation`;

  const response = callLLM(prompt, runtimeEnv);
  if (!response) {
    return null;
  }

  // Strip surrounding quotes if the LLM included them
  return response.replace(/^["'`]|["'`]$/g, "").trim() || null;
}

// ─── Main Optimization Loop ───────────────────────────────────────────────────

async function handleOptimizeDescription(name, maxIterations = 5, runtimeEnv) {
  if (!name) {
    return candidateOnlyResult({
      success: false,
      action: "optimize-description",
      error: "No skill name provided.",
    });
  }

  const skillDir = resolveSkillDir(name);
  const skillMdPath = _deps.path.join(skillDir, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    return candidateOnlyResult({
      success: false,
      action: "optimize-description",
      skillName: name,
      error: `SKILL.md not found for "${name}".`,
    });
  }

  const content = fs.readFileSync(skillMdPath, "utf-8");
  const descMatch = content.match(/^description:\s*(.+)/m);
  const originalDesc = descMatch ? descMatch[1].trim() : "";

  if (!originalDesc) {
    return candidateOnlyResult({
      success: false,
      action: "optimize-description",
      skillName: name,
      error: "No description field found in SKILL.md.",
    });
  }

  logger.info(
    `[SkillCreator] optimize-description: generating eval queries for "${name}"...`,
  );

  // Step 1: Generate eval queries
  const evalQueries = generateEvalQueries(name, originalDesc, runtimeEnv);
  if (!evalQueries || evalQueries.length < 4) {
    return candidateOnlyResult({
      success: false,
      action: "optimize-description",
      skillName: name,
      error:
        "Failed to generate eval queries. Ensure `chainlesschain ask` is available (CLI context required).",
      hint: `Run via: chainlesschain skill run skill-creator "optimize-description ${name}"`,
    });
  }

  // Step 2: Shuffle + 60/40 split
  const shuffled = [...evalQueries].sort(() => Math.random() - 0.5);
  const splitIdx = Math.ceil(shuffled.length * 0.6);
  const trainSet = shuffled.slice(0, splitIdx);
  const testSet = shuffled.slice(splitIdx);

  logger.info(
    `[SkillCreator] eval queries: ${evalQueries.length} total, ${trainSet.length} train / ${testSet.length} test`,
  );

  // Step 3: Baseline test score
  const baselineTestResult = evaluateDescriptionDetailed(
    name,
    originalDesc,
    testSet,
    runtimeEnv,
  );
  let bestDesc = originalDesc;
  let bestTestScore = baselineTestResult.score;

  const iterations = [];
  let currentDesc = originalDesc;

  // Step 4: Optimization loop
  for (let i = 0; i < maxIterations; i++) {
    logger.info(`[SkillCreator] iteration ${i + 1}/${maxIterations}...`);

    const trainResult = evaluateDescriptionDetailed(
      name,
      currentDesc,
      trainSet,
      runtimeEnv,
    );
    const failures = trainResult.details.filter((d) => !d.correct);

    if (failures.length === 0) {
      logger.info("[SkillCreator] Perfect train score — stopping early.");
      const testResult = evaluateDescriptionDetailed(
        name,
        currentDesc,
        testSet,
        runtimeEnv,
      );
      iterations.push({
        iteration: i + 1,
        description: currentDesc,
        trainScore: trainResult.score,
        testScore: testResult.score,
        failures: 0,
        note: "perfect train score",
      });
      if (testResult.score > bestTestScore) {
        bestTestScore = testResult.score;
        bestDesc = currentDesc;
      }
      break;
    }

    const improved = improveDescription(
      name,
      currentDesc,
      failures,
      runtimeEnv,
    );
    if (!improved || improved === currentDesc) {
      logger.info("[SkillCreator] No improvement from LLM — stopping.");
      break;
    }

    const testResult = evaluateDescriptionDetailed(
      name,
      improved,
      testSet,
      runtimeEnv,
    );

    iterations.push({
      iteration: i + 1,
      description: improved,
      trainScore: trainResult.score,
      testScore: testResult.score,
      failures: failures.length,
    });

    if (testResult.score > bestTestScore) {
      bestTestScore = testResult.score;
      bestDesc = improved;
    }

    currentDesc = improved;
  }

  // Step 5: Build a proposal without mutating the active managed Skill.
  // Stage A deliberately has no persistence adapter: only a trusted future
  // candidate controller may store, evaluate, and promote these bytes.
  const descImproved = bestDesc !== originalDesc;
  const proposedContent = descImproved
    ? content.replace(/^(description:\s*).+/m, `$1${bestDesc}`)
    : content;

  // Step 6: Return evaluation evidence in-band. Writing `.opt-workspace`
  // beneath the managed Skill would itself mutate the active tree, and the old
  // best-effort write could fail while the response still implied persistence.
  const workspaceEvidence = {
    skillName: name,
    timestamp: new Date().toISOString(),
    originalDescription: originalDesc,
    bestDescription: bestDesc,
    baselineTestScore: baselineTestResult.score,
    bestTestScore,
    iterations,
    evalQueries: shuffled.map((q, idx) => ({
      ...q,
      split: idx < splitIdx ? "train" : "test",
    })),
  };

  const baselinePct = Math.round(baselineTestResult.score * 100);
  const bestPct = Math.round(bestTestScore * 100);

  return candidateOnlyResult({
    success: true,
    action: "optimize-description",
    status: descImproved ? "candidate-proposed" : "no-change",
    skillName: name,
    originalDescription: originalDesc,
    bestDescription: bestDesc,
    improved: descImproved,
    proposedContent,
    proposedFiles: {
      "SKILL.md": proposedContent,
    },
    diff: {
      path: "SKILL.md",
      field: "description",
      changed: descImproved,
      before: originalDesc,
      after: bestDesc,
    },
    workspaceEvidence: {
      persisted: false,
      reason: "stage-a-mutation-freeze",
      payload: workspaceEvidence,
    },
    baselineTestScore: baselineTestResult.score,
    bestTestScore,
    iterations: iterations.length,
    iterationDetails: iterations,
    evalQueriesGenerated: evalQueries.length,
    message: descImproved
      ? `Description candidate proposed (test score: ${baselinePct}% → ${bestPct}%); active SKILL.md is unchanged and the proposal is not persisted.`
      : `No description change proposed (test score: ${bestPct}%); active SKILL.md is unchanged.`,
  });
}

// ─── Existing Actions (unchanged) ────────────────────────────────────────────

function handleCreate(name, description) {
  if (!name) {
    return candidateOnlyResult({
      success: false,
      action: "create",
      error: "No skill name provided.",
    });
  }

  const skillName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
  const displayName = skillName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const category = guessCategory(description || skillName);

  const skillMd = `---
name: ${skillName}
display-name: ${displayName}
description: ${description || `[Describe what ${displayName} does and when to use it]`}
version: 1.0.0
category: ${category}
user-invocable: true
tags: [${skillName.split("-").join(", ")}]
capabilities: [${skillName}-action]
execution-capabilities: [data:task, data:result]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [${skillName}-tool]
instructions: |
  ${description || `Use this skill when [describe when to use ${displayName}].`}
examples:
  - input: "example usage of ${skillName}"
    action: default
author: ChainlessChain
license: MIT
---

# ${displayName}

${description || "[Add skill description here]"}

## Usage

\`\`\`
/${skillName} <action> [options]
\`\`\`

## Actions

| Action | Description |
| --- | --- |
| \`default\` | [Main action description] |

## Examples

\`\`\`
/${skillName} [example]
\`\`\`
`;

  const handlerJs = `/**
 * ${displayName} Skill Handler
 */

module.exports = {
  async init() {},

  async execute(task) {
    const input = task.input || task.args || "";

    try {
      // TODO: Implement skill logic
      return {
        success: true,
        action: "default",
        input,
        message: "${displayName} executed successfully.",
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};
`;

  if (!skillName) {
    return candidateOnlyResult({
      success: false,
      action: "create",
      error: "Skill name is invalid.",
    });
  }
  const skillDir = resolveSkillDir(skillName);
  const files = {
    "SKILL.md": skillMd,
    "handler.js": handlerJs,
  };
  const activeExists = fs.existsSync(skillDir);

  return candidateOnlyResult({
    success: true,
    action: "create",
    status: "candidate-proposed",
    skillName,
    activeExists,
    files,
    proposedFiles: files,
    candidate: {
      kind: "skill-scaffold",
      skillName,
      files,
    },
    diff: {
      kind: "file-set",
      changes: Object.keys(files).map((file) => ({
        path: file,
        operation: activeExists ? "propose-replace" : "propose-create",
      })),
    },
    // Retained as a compatibility hint about the active directory only. It
    // never means that this invocation persisted any candidate bytes.
    alreadyExists: activeExists,
    message: activeExists
      ? `Skill "${skillName}" already exists. Returning an in-memory candidate for review; active files are unchanged.`
      : `Generated an in-memory candidate for "${skillName}"; it is not persisted or active.`,
  });
}

async function handleTest(name, testInput, context) {
  if (!name) {
    return { success: false, error: "No skill name provided." };
  }

  try {
    resolveSkillDir(name);
    const { getSkillRegistry } = require("../../skill-registry");
    const registry = getSkillRegistry();
    const skill = registry.getSkill(name);
    if (!skill) {
      return {
        success: false,
        error: `Skill is not loaded in the managed registry: ${name}`,
      };
    }
    const result = await registry.executeSkill(
      name,
      { input: testInput || "test", args: testInput || "test" },
      context,
    );

    return {
      success: true,
      action: "test",
      skillName: name,
      testInput: testInput || "test",
      result,
      message: `Test completed. Result success: ${result?.success}`,
    };
  } catch (error) {
    return {
      success: false,
      action: "test",
      skillName: name,
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      message: `Test failed: ${error.message}`,
    };
  }
}

function handleOptimize(name) {
  if (!name) {
    return { success: false, error: "No skill name provided." };
  }

  const skillMdPath = _deps.path.join(resolveSkillDir(name), "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    return { success: false, error: `SKILL.md not found for "${name}".` };
  }

  const content = fs.readFileSync(skillMdPath, "utf8");
  const descMatch = content.match(/description:\s*(.+)/);
  const currentDesc = descMatch ? descMatch[1].trim() : "";

  const suggestions = [];
  if (currentDesc.length < 50) {
    suggestions.push(
      "Description is too short. Add more context about WHEN to use this skill.",
    );
  }
  if (!/use when/i.test(currentDesc) && !/trigger/i.test(currentDesc)) {
    suggestions.push(
      'Add trigger keywords. E.g., "Use when user asks to..." or "Triggers on..."',
    );
  }
  if (currentDesc.length > 200) {
    suggestions.push(
      "Description may be too long. Keep under 200 chars for metadata.",
    );
  }

  return {
    success: true,
    action: "optimize",
    skillName: name,
    currentDescription: currentDesc,
    suggestions,
    hint: `For LLM-driven optimization run: skill run skill-creator "optimize-description ${name}"`,
    message:
      suggestions.length > 0
        ? `Found ${suggestions.length} optimization hint(s). Use --advanced for full LLM loop.`
        : `Description looks good! Use --advanced for LLM-driven eval loop.`,
  };
}

function handleValidate(name) {
  if (!name) {
    return { success: false, error: "No skill name/path provided." };
  }

  const skillDir = resolveSkillDir(name);
  const skillMdPath = _deps.path.join(skillDir, "SKILL.md");
  const handlerPath = _deps.path.join(skillDir, "handler.js");

  const issues = [];
  const checks = [];

  if (!fs.existsSync(skillMdPath)) {
    issues.push("SKILL.md not found");
  } else {
    checks.push("SKILL.md exists");
    const content = fs.readFileSync(skillMdPath, "utf8");

    if (!content.startsWith("---")) {
      issues.push("Missing YAML frontmatter (---) at start");
    } else {
      checks.push("Has YAML frontmatter");
    }

    if (!/^name:/m.test(content)) {
      issues.push("Missing 'name' field");
    } else {
      checks.push("Has name field");
    }

    if (!/^description:/m.test(content)) {
      issues.push("Missing 'description' field");
    } else {
      checks.push("Has description field");
    }

    if (!/^handler:/m.test(content)) {
      issues.push("Missing 'handler' field");
    } else {
      checks.push("Has handler field");
    }
  }

  if (!fs.existsSync(handlerPath)) {
    issues.push("handler.js not found");
  } else {
    checks.push("handler.js exists");

    const handlerSource = fs.readFileSync(handlerPath, "utf8");
    if (!/(?:async\s+)?execute\s*\(/.test(handlerSource)) {
      issues.push("handler.js missing execute() function");
    } else {
      checks.push("Has execute() function");
    }
    if (!/(?:async\s+)?init\s*\(/.test(handlerSource)) {
      issues.push(
        "handler.js missing init() function (optional but recommended)",
      );
    } else {
      checks.push("Has init() function");
    }
  }

  return {
    success: issues.length === 0,
    action: "validate",
    skillName: name,
    valid: issues.length === 0,
    checks,
    issues,
    message:
      issues.length === 0
        ? `Skill "${name}" is valid.`
        : `Found ${issues.length} issue(s).`,
  };
}

function handleListTemplates() {
  const templates = Object.entries(SKILL_TEMPLATES).map(([name, t]) => ({
    name,
    description: t.description,
    hasHandler: true,
    hasSkillMd: true,
  }));

  return {
    success: true,
    action: "list-templates",
    templates,
    result: templates,
    message: `${templates.length} template(s) available. Use "get-template <name>" to retrieve full code.`,
  };
}

function handleGetTemplate(name) {
  if (!name) {
    return {
      success: false,
      error:
        "Provide a template name. Use list-templates to see available templates.",
    };
  }

  const template = SKILL_TEMPLATES[name.toLowerCase()];
  if (!template) {
    const available = Object.keys(SKILL_TEMPLATES).join(", ");
    return {
      success: false,
      error: `Template "${name}" not found. Available: ${available}`,
    };
  }

  return {
    success: true,
    action: "get-template",
    templateName: name,
    description: template.description,
    files: {
      "handler.js": template.handler,
      "SKILL.md": template.skillMd,
    },
    result: {
      name,
      description: template.description,
      handler: template.handler,
      skillMd: template.skillMd,
    },
    message: `Template "${name}" retrieved. Contains handler.js and SKILL.md.`,
  };
}

// ─── Built-in Templates ───────────────────────────────────────────────────────

const SKILL_TEMPLATES = {
  basic: {
    description: "Simple greeter skill with a single action",
    handler: `/**
 * Basic Greeter Skill Handler
 */
module.exports = {
  async init() {},

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const name = input.trim().split(/\\s+/).slice(1).join(" ") || "World";

    return {
      success: true,
      action: "greet",
      result: { greeting: \`Hello, \${name}!\`, timestamp: new Date().toISOString() },
      message: \`Hello, \${name}!\`,
    };
  },
};
`,
    skillMd: `---
name: greeter
display-name: Greeter
description: A simple greeting skill that says hello
version: 1.0.0
category: general
user-invocable: true
tags: [greeter, hello, demo]
execution-capabilities: [data:task, data:result]
handler: ./handler.js
os: [win32, darwin, linux]
instructions: |
  Use this skill to greet someone by name.
examples:
  - input: "greet Alice"
    action: greet
author: ChainlessChain
license: MIT
---

# Greeter

A simple skill that demonstrates the basic handler structure.

## Usage

\\\`\\\`\\\`
/greeter greet <name>
\\\`\\\`\\\`
`,
  },

  "multi-action": {
    description: "Task tracker with create/list/complete/stats actions",
    handler: `/**
 * Task Tracker Skill Handler — Multi-action template
 */
let tasks = [];

module.exports = {
  _resetState() { tasks = []; },

  async init() {},

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parts = input.trim().split(/\\s+/);
    const action = (parts[0] || "list").toLowerCase();
    const rest = parts.slice(1).join(" ");

    switch (action) {
      case "create": {
        if (!rest) return { success: false, error: "Provide a task name." };
        const entry = { id: tasks.length + 1, name: rest, done: false, created: new Date().toISOString() };
        tasks.push(entry);
        return { success: true, action: "create", result: entry, message: \`Task #\${entry.id} created.\` };
      }
      case "list": {
        const filtered = tasks.filter((t) => !t.done);
        return { success: true, action: "list", result: { tasks: filtered, total: tasks.length }, message: \`\${filtered.length} pending task(s).\` };
      }
      case "complete": {
        const id = parseInt(rest, 10);
        const found = tasks.find((t) => t.id === id);
        if (!found) return { success: false, error: \`Task #\${id} not found.\` };
        found.done = true;
        return { success: true, action: "complete", result: found, message: \`Task #\${id} completed.\` };
      }
      case "stats": {
        const done = tasks.filter((t) => t.done).length;
        return { success: true, action: "stats", result: { total: tasks.length, done, pending: tasks.length - done }, message: \`\${done}/\${tasks.length} done.\` };
      }
      default:
        return { success: false, error: \`Unknown action: \${action}. Use: create, list, complete, stats\` };
    }
  },
};
`,
    skillMd: `---
name: task-tracker
display-name: Task Tracker
description: Track tasks with create, list, complete, and stats actions
version: 1.0.0
category: productivity
user-invocable: true
tags: [tasks, tracker, productivity]
execution-capabilities: [data:task, data:result]
handler: ./handler.js
os: [win32, darwin, linux]
instructions: |
  Use this skill to manage a simple task list.
examples:
  - input: "create Buy groceries"
    action: create
  - input: "list"
    action: list
  - input: "complete 1"
    action: complete
author: ChainlessChain
license: MIT
---

# Task Tracker

A multi-action skill template demonstrating create/list/complete/stats pattern.
`,
  },

  "api-integration": {
    description: "API caller using isolated capability broker ports",
    handler: `/**
 * API Caller Skill Handler — isolated capability broker template
 */
module.exports = {
  async init() {},

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parts = input.trim().split(/\\s+/);
    const action = (parts[0] || "status").toLowerCase();
    const query = parts.slice(1).join(" ");

    const envResult = context.apiKey
      ? { value: context.apiKey }
      : await chainlesschain.capabilities.call(
          "env:read",
          "read",
          { name: "MY_API_KEY" }
        );
    const apiKey = envResult && envResult.value;
    if (!apiKey) {
      return { success: false, error: "MY_API_KEY is unavailable through the approved env port." };
    }

    try {
      switch (action) {
        case "status": return await handleStatus(apiKey);
        case "search": return await handleSearch(apiKey, query);
        default: return { success: false, error: \`Unknown action: \${action}. Use: status, search\` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

async function apiRequest(path, apiKey) {
  return await chainlesschain.capabilities.call(
    "network:https",
    "request",
    {
      url: \`https://api.example.com\${path}\`,
      method: "GET",
      headers: {
        Authorization: \`Bearer \${apiKey}\`,
        "User-Agent": "ChainlessChain/1.2.0"
      },
      maxResponseBytes: 262144
    }
  );
}

async function handleStatus(apiKey) {
  const res = await apiRequest("/v1/status", apiKey);
  return { success: res.status === 200, action: "status", result: res.body, message: \`API status: \${res.status}\` };
}

async function handleSearch(apiKey, query) {
  if (!query) return { success: false, error: "Provide a search query." };
  const res = await apiRequest(\`/v1/search?q=\${encodeURIComponent(query)}\`, apiKey);
  return { success: res.status === 200, action: "search", result: res.body, message: \`Search returned status \${res.status}.\` };
}
`,
    skillMd: `---
name: api-caller
display-name: API Caller
description: Template for skills that call external REST APIs with auth
version: 1.0.0
category: automation
user-invocable: true
tags: [api, rest, integration]
execution-capabilities: [data:task, data:result, env:read, network:https]
handler: ./handler.js
os: [win32, darwin, linux]
instructions: |
  Use this skill to query an external API. Requires an approved env:read port
  for MY_API_KEY and an approved network:https request port.
examples:
  - input: "status"
    action: status
  - input: "search my query"
    action: search
author: ChainlessChain
license: MIT
---

# API Caller

Demonstrates default-deny env and HTTPS capability ports. The host owns secret
lookup, DNS/redirect policy, timeouts, and response-size enforcement.
`,
  },

  "file-processor": {
    description: "Markdown file analyzer using a bounded filesystem port",
    handler: `/**
 * File Processor Skill Handler — isolated filesystem capability template
 */
module.exports = {
  async init() {},

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parts = input.trim().split(/\\s+/);
    const action = (parts[0] || "analyze").toLowerCase();
    const filePath = parts.slice(1).join(" ");

    switch (action) {
      case "analyze": return await handleAnalyze(filePath);
      case "stats": return await handleStats(filePath);
      default: return { success: false, error: \`Unknown action: \${action}. Use: analyze, stats\` };
    }
  },
};

async function readTextFile(filePath) {
  return await chainlesschain.capabilities.call(
    "filesystem:read",
    "read-file",
    { path: filePath, encoding: "utf8", maxBytes: 262144 }
  );
}

async function handleAnalyze(filePath) {
  if (!filePath) return { success: false, error: "Provide a file path." };
  const file = await readTextFile(filePath);
  const content = file.content;
  const lines = content.split("\\n");
  const headings = lines.filter((l) => /^#{1,6}\\s/.test(l)).map((l) => l.replace(/^#+\\s*/, "").trim());
  const wordCount = content.split(/\\s+/).filter(Boolean).length;
  const links = content.match(/\\[([^\\]]+)\\]\\([^)]+\\)/g) || [];

  return {
    success: true,
    action: "analyze",
    result: { file: file.name, lines: lines.length, words: wordCount, headings, linkCount: links.length },
    message: \`Analyzed "\${file.name}": \${lines.length} lines, \${wordCount} words, \${headings.length} headings.\`,
  };
}

async function handleStats(dirPath) {
  if (!dirPath) return { success: false, error: "Provide a directory path." };
  const listing = await chainlesschain.capabilities.call(
    "filesystem:read",
    "list-directory",
    { path: dirPath, maxEntries: 64 }
  );
  const mdFiles = listing.entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".md"));
  let totalWords = 0;
  for (const entry of mdFiles) {
    const file = await readTextFile(entry.path);
    totalWords += file.content.split(/\\s+/).filter(Boolean).length;
  }

  return {
    success: true,
    action: "stats",
    result: { directory: listing.path, totalFiles: listing.entries.length, markdownFiles: mdFiles.length, totalWords },
    message: \`\${mdFiles.length} markdown file(s), \${totalWords} total words.\`,
  };
}
`,
    skillMd: `---
name: file-processor
display-name: File Processor
description: Analyze markdown files for structure, word count, and links
version: 1.0.0
category: productivity
user-invocable: true
tags: [file, markdown, analysis]
execution-capabilities: [data:task, data:result, filesystem:read]
handler: ./handler.js
os: [win32, darwin, linux]
instructions: |
  Use this skill to analyze markdown files or directories.
examples:
  - input: "analyze ./README.md"
    action: analyze
  - input: "stats ./docs"
    action: stats
author: ChainlessChain
license: MIT
---

# File Processor

Demonstrates bounded filesystem capability calls. The host resolves paths,
enforces the approved root, and caps files and directory entries.
`,
  },

  "code-analyzer": {
    description: "Code complexity analyzer using pure regex logic",
    handler: `/**
 * Code Analyzer Skill Handler — Pure regex-based code analysis
 */
module.exports = {
  async init() {},

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parts = input.trim().split(/\\s+/);
    const action = (parts[0] || "complexity").toLowerCase();
    const code = parts.slice(1).join(" ");

    switch (action) {
      case "complexity": return handleComplexity(code);
      case "metrics": return handleMetrics(code);
      default: return { success: false, error: \`Unknown action: \${action}. Use: complexity, metrics\` };
    }
  },
};

function handleComplexity(code) {
  if (!code) return { success: false, error: "Provide code to analyze." };

  let complexity = 1;
  const branches = (code.match(/\\b(if|else if|else|switch|case|catch|while|for|&&|\\|\\|)\\b/g) || []);
  complexity += branches.length;

  const functions = (code.match(/\\b(function\\s|=>|async\\s+function)/g) || []);
  const lines = code.split("\\n").length;
  const nesting = Math.max(0, ...(code.match(/^(\\s+)/gm) || [""]).map((s) => Math.floor(s.length / 2)));

  let rating;
  if (complexity <= 5) rating = "low";
  else if (complexity <= 10) rating = "moderate";
  else if (complexity <= 20) rating = "high";
  else rating = "very-high";

  return {
    success: true,
    action: "complexity",
    result: { complexity, rating, branches: branches.length, functions: functions.length, lines, maxNesting: nesting },
    message: \`Cyclomatic complexity: \${complexity} (\${rating}). \${branches.length} branch(es), \${functions.length} function(s).\`,
  };
}

function handleMetrics(code) {
  if (!code) return { success: false, error: "Provide code to analyze." };

  const lines = code.split("\\n");
  const codeLines = lines.filter((l) => l.trim().length > 0 && !l.trim().startsWith("//")).length;
  const commentLines = lines.filter((l) => l.trim().startsWith("//")).length;
  const blankLines = lines.filter((l) => l.trim().length === 0).length;
  const todoCount = (code.match(/\\/\\/\\s*(TODO|FIXME|HACK|XXX)/gi) || []).length;
  const avgLineLength = Math.round(lines.reduce((s, l) => s + l.length, 0) / Math.max(lines.length, 1));

  return {
    success: true,
    action: "metrics",
    result: { totalLines: lines.length, codeLines, commentLines, blankLines, todoCount, avgLineLength },
    message: \`\${codeLines} code lines, \${commentLines} comments, \${blankLines} blank, \${todoCount} TODOs.\`,
  };
}
`,
    skillMd: `---
name: code-analyzer
display-name: Code Analyzer
description: Analyze code complexity and metrics using regex patterns
version: 1.0.0
category: development
user-invocable: true
tags: [code, analysis, complexity, metrics]
execution-capabilities: [data:task, data:result]
handler: ./handler.js
os: [win32, darwin, linux]
instructions: |
  Use this skill to measure code complexity and gather metrics.
examples:
  - input: "complexity function foo() { if (x) { return 1; } }"
    action: complexity
  - input: "metrics const x = 1; // TODO: fix"
    action: metrics
author: ChainlessChain
license: MIT
---

# Code Analyzer

Pure regex-based code analysis — no external dependencies needed.
`,
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function guessCategory(text) {
  const lower = text.toLowerCase();
  if (/search|knowledge|rag|document|research/.test(lower)) {
    return "knowledge";
  }
  if (/automat|workflow|browser|schedule|cron|watch/.test(lower)) {
    return "automation";
  }
  if (/code|test|lint|review|debug|refactor|deploy/.test(lower)) {
    return "development";
  }
  if (/video|image|audio|media|chart/.test(lower)) {
    return "media";
  }
  if (/content|publish|slide|plan|note/.test(lower)) {
    return "productivity";
  }
  return "general";
}

module.exports = withBundledSkillFilesystem("skill-creator", module.exports);
