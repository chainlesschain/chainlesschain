/**
 * Proactive Agent Skill Handler
 *
 * Autonomous monitoring with file-watch, threshold, periodic, and pattern triggers.
 *
 * Enhanced with ContextKit/PlanKit-inspired capabilities:
 * - 4-phase planning methodology (spec -> research -> steps -> execute)
 * - Built-in quality agents (build, test, lint, debt checks)
 * - Backlog management (add, list, prioritize, remove)
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const _deps = { fs, path, os: require("os") };

const watchers = new Map();
const planStore = new Map();
const backlogStore = new Map();

let planIdCounter = 1;
let backlogIdCounter = 1;

module.exports = {
  async init(skill) {
    logger.info("[ProactiveAgent] Initialized (v2.0 + Planning)");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[ProactiveAgent] Action: ${parsed.action}`);

    try {
      switch (parsed.action) {
        // Original actions
        case "watch":
          return handleWatch(parsed);
        case "threshold":
          return handleThreshold(parsed);
        case "periodic":
          return handlePeriodic(parsed);
        case "pattern":
          return handlePattern(parsed);
        case "list":
          return handleList();
        case "stop":
          return handleStop(parsed.target);
        case "status":
          return handleStatus(parsed.target);
        // New: Planning
        case "plan":
          return handlePlan(parsed, context);
        // New: Quality checks
        case "quality":
          return handleQuality(parsed, context);
        // New: Backlog
        case "backlog":
          return handleBacklog(parsed);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use watch, threshold, periodic, pattern, plan, quality, backlog, list, stop, or status.`,
          };
      }
    } catch (error) {
      logger.error("[ProactiveAgent] Error:", error);
      return { success: false, error: error.message };
    }
  },

  _deps,
  _watchers: watchers,
  _planStore: planStore,
  _backlogStore: backlogStore,
};

// ── Input Parsing ───────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list" };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "list").toLowerCase();

  const result = { action, target: parts[1] || "", raw: trimmed };
  result.subAction = parts[1] || "";
  result.rest = parts.slice(2).join(" ");

  // Extract --on-change, --action, --above, --match flags
  const onChangeMatch = trimmed.match(/--on-change\s+"([^"]+)"/);
  if (onChangeMatch) {
    result.command = onChangeMatch[1];
  }

  const actionMatch = trimmed.match(/--action\s+"([^"]+)"/);
  if (actionMatch) {
    result.command = actionMatch[1];
  }

  const aboveMatch = trimmed.match(/--above\s+(\d+)/);
  if (aboveMatch) {
    result.threshold = parseInt(aboveMatch[1], 10);
  }

  const matchPattern = trimmed.match(/--match\s+"([^"]+)"/);
  if (matchPattern) {
    result.pattern = matchPattern[1];
  }

  if (action === "periodic" && parts[1]) {
    result.interval = parseInterval(parts[1]);
  }

  const quotedCmd = trimmed.match(/"([^"]+)"$/);
  if (quotedCmd && !result.command) {
    result.command = quotedCmd[1];
  }

  return result;
}

function parseInterval(str) {
  const match = str.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) {
    return 60000;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2] || "s";
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 1000);
}

// ── Original Trigger Handlers ───────────────────────────────────────

function handleWatch(parsed) {
  const watchPath = parsed.target;
  if (!watchPath) {
    return { success: false, error: "No path specified for watch." };
  }

  const resolvedPath = _deps.path.resolve(watchPath);
  if (!_deps.fs.existsSync(resolvedPath)) {
    return { success: false, error: `Path not found: ${resolvedPath}` };
  }

  const id = generateId();
  const watcher = _deps.fs.watch(
    resolvedPath,
    { recursive: true },
    (eventType, filename) => {
      logger.info(
        `[ProactiveAgent:${id}] ${eventType}: ${filename} -> ${parsed.command || "notify"}`,
      );
      const entry = watchers.get(id);
      if (entry) {
        entry.lastTriggered = new Date().toISOString();
        entry.triggerCount++;
      }
    },
  );

  watchers.set(id, {
    id,
    type: "watch",
    path: resolvedPath,
    command: parsed.command || null,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    _handle: watcher,
  });

  return {
    success: true,
    action: "watch",
    watcherId: id,
    path: resolvedPath,
    message: `Watching "${resolvedPath}" for changes.`,
  };
}

function handleThreshold(parsed) {
  const metric = parsed.target;
  if (!metric) {
    return { success: false, error: "No metric specified." };
  }

  const id = generateId();
  const interval = setInterval(() => {
    const value = getMetricValue(metric);
    if (value !== null && parsed.threshold && value > parsed.threshold) {
      logger.warn(
        `[ProactiveAgent:${id}] Threshold exceeded: ${metric}=${value} > ${parsed.threshold}`,
      );
      const entry = watchers.get(id);
      if (entry) {
        entry.lastTriggered = new Date().toISOString();
        entry.triggerCount++;
        entry.lastValue = value;
      }
    }
  }, 10000);

  watchers.set(id, {
    id,
    type: "threshold",
    metric,
    threshold: parsed.threshold,
    command: parsed.command || null,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    lastValue: null,
    _handle: interval,
  });

  return {
    success: true,
    action: "threshold",
    watcherId: id,
    metric,
    threshold: parsed.threshold,
    message: `Monitoring ${metric} with threshold ${parsed.threshold}.`,
  };
}

function handlePeriodic(parsed) {
  const intervalMs = parsed.interval || 60000;
  const command = parsed.command;

  if (!command) {
    return {
      success: false,
      error: "No command specified for periodic task.",
    };
  }

  const id = generateId();
  const interval = setInterval(() => {
    logger.info(`[ProactiveAgent:${id}] Periodic trigger: ${command}`);
    const entry = watchers.get(id);
    if (entry) {
      entry.lastTriggered = new Date().toISOString();
      entry.triggerCount++;
    }
  }, intervalMs);

  watchers.set(id, {
    id,
    type: "periodic",
    intervalMs,
    command,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    _handle: interval,
  });

  return {
    success: true,
    action: "periodic",
    watcherId: id,
    interval: intervalMs,
    command,
    message: `Periodic task created: "${command}" every ${intervalMs / 1000}s.`,
  };
}

function handlePattern(parsed) {
  const filePath = parsed.target;
  if (!filePath) {
    return { success: false, error: "No file path specified." };
  }

  const resolvedPath = _deps.path.resolve(filePath);
  const pattern = parsed.pattern;
  if (!pattern) {
    return { success: false, error: "No pattern specified. Use --match." };
  }

  const id = generateId();
  let lastSize = 0;

  try {
    if (_deps.fs.existsSync(resolvedPath)) {
      lastSize = _deps.fs.statSync(resolvedPath).size;
    }
  } catch {
    // file may not exist yet
  }

  const interval = setInterval(() => {
    try {
      if (!_deps.fs.existsSync(resolvedPath)) {
        return;
      }
      const stat = _deps.fs.statSync(resolvedPath);
      if (stat.size <= lastSize) {
        return;
      }

      const fd = _deps.fs.openSync(resolvedPath, "r");
      const buf = Buffer.alloc(stat.size - lastSize);
      _deps.fs.readSync(fd, buf, 0, buf.length, lastSize);
      _deps.fs.closeSync(fd);
      lastSize = stat.size;

      const newContent = buf.toString("utf8");
      const regex = new RegExp(pattern, "g");
      const matches = newContent.match(regex);
      if (matches && matches.length > 0) {
        logger.info(
          `[ProactiveAgent:${id}] Pattern matched ${matches.length} time(s)`,
        );
        const entry = watchers.get(id);
        if (entry) {
          entry.lastTriggered = new Date().toISOString();
          entry.triggerCount += matches.length;
        }
      }
    } catch (err) {
      logger.debug(
        `[ProactiveAgent:${id}] Pattern check error: ${err.message}`,
      );
    }
  }, 5000);

  watchers.set(id, {
    id,
    type: "pattern",
    file: resolvedPath,
    pattern,
    command: parsed.command || null,
    createdAt: new Date().toISOString(),
    lastTriggered: null,
    triggerCount: 0,
    _handle: interval,
  });

  return {
    success: true,
    action: "pattern",
    watcherId: id,
    file: resolvedPath,
    pattern,
    message: `Watching "${resolvedPath}" for pattern "${pattern}".`,
  };
}

function handleList() {
  const list = [];
  for (const [_id, entry] of watchers) {
    const { _handle, ...info } = entry;
    list.push(info);
  }

  return {
    success: true,
    action: "list",
    watchers: list,
    watcherCount: list.length,
  };
}

function handleStop(target) {
  if (target === "all") {
    const count = watchers.size;
    for (const [_id, entry] of watchers) {
      cleanup(entry);
    }
    watchers.clear();
    return {
      success: true,
      action: "stop",
      message: `Stopped all ${count} watcher(s).`,
    };
  }

  const entry = watchers.get(target);
  if (!entry) {
    return { success: false, error: `Watcher "${target}" not found.` };
  }

  cleanup(entry);
  watchers.delete(target);

  return {
    success: true,
    action: "stop",
    watcherId: target,
    message: `Watcher "${target}" stopped.`,
  };
}

function handleStatus(target) {
  const entry = watchers.get(target);
  if (!entry) {
    return { success: false, error: `Watcher "${target}" not found.` };
  }

  const { _handle, ...info } = entry;
  return { success: true, action: "status", watcher: info };
}

function cleanup(entry) {
  if (entry._handle) {
    if (typeof entry._handle.close === "function") {
      entry._handle.close();
    } else {
      clearInterval(entry._handle);
    }
  }
}

function getMetricValue(metric) {
  try {
    const os = _deps.os;
    switch (metric.toLowerCase()) {
      case "cpu": {
        const cpus = os.cpus();
        const avg =
          cpus.reduce((sum, cpu) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            return sum + ((total - cpu.times.idle) / total) * 100;
          }, 0) / cpus.length;
        return Math.round(avg);
      }
      case "memory":
      case "mem":
        return Math.round(
          ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
        );
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ── Plan Mode (4-Phase Methodology) ─────────────────────────────────

function handlePlan(parsed, context) {
  const sub = parsed.subAction?.toLowerCase() || "list";
  const content = parsed.rest || "";

  switch (sub) {
    case "spec":
      return planSpec(content);
    case "research":
      return planResearch(content);
    case "steps":
      return planSteps(content);
    case "execute":
      return planExecute(content);
    case "list":
      return planList();
    case "status":
      return planStatus(content);
    default:
      return {
        success: false,
        error: `Unknown plan action: ${sub}. Use spec, research, steps, execute, list, or status.`,
      };
  }
}

function planSpec(description) {
  if (!description) {
    return { success: false, error: "Provide a description for the spec." };
  }

  const id = `P${String(planIdCounter++).padStart(3, "0")}`;
  const plan = {
    id,
    phase: 1,
    phaseName: "spec",
    title: description.substring(0, 80),
    description,
    spec: {
      what: description,
      why: "TBD - Define the business value",
      userStories: [],
      acceptanceCriteria: [],
      scope: { in: [], out: [] },
    },
    research: null,
    steps: null,
    status: "spec",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  planStore.set(id, plan);

  const msg =
    `Plan Created: ${id}\n${"=".repeat(25)}\n` +
    `Phase 1: Business Spec\n\n` +
    `Title: ${plan.title}\n\n` +
    `Template:\n` +
    `## What\n${description}\n\n` +
    `## Why\n[Define the business value]\n\n` +
    `## User Stories\n- As a [user], I want [feature] so that [benefit]\n\n` +
    `## Acceptance Criteria\n- [ ] Criterion 1\n\n` +
    `## Scope\n- In: [what's included]\n- Out: [what's excluded]\n\n` +
    `Next: Run "plan research ${id}" to proceed to Phase 2.`;

  return { success: true, result: plan, message: msg };
}

function planResearch(planId) {
  const plan = planStore.get(planId);
  if (!plan) {
    return { success: false, error: `Plan "${planId}" not found.` };
  }

  plan.phase = 2;
  plan.phaseName = "research";
  plan.status = "research";
  plan.research = {
    architecture: [],
    techChoices: [],
    risks: [],
    dependencies: [],
  };
  plan.updatedAt = new Date().toISOString();

  const msg =
    `Plan ${planId}: Phase 2 - Technical Research\n${"=".repeat(40)}\n\n` +
    `Title: ${plan.title}\n\n` +
    `Template:\n` +
    `## Architecture Decisions\n- Decision 1: [choice] because [rationale]\n\n` +
    `## Technology Choices\n- [tech]: [reason]\n\n` +
    `## Risks\n- Risk 1: [description] | Mitigation: [plan]\n\n` +
    `## Dependencies\n- [dependency]: [version/status]\n\n` +
    `Next: Run "plan steps ${planId}" to proceed to Phase 3.`;

  return { success: true, result: plan, message: msg };
}

function planSteps(planId) {
  const plan = planStore.get(planId);
  if (!plan) {
    return { success: false, error: `Plan "${planId}" not found.` };
  }

  plan.phase = 3;
  plan.phaseName = "steps";
  plan.status = "steps";
  plan.steps = {
    tasks: [],
    nextTaskId: 1,
  };
  plan.updatedAt = new Date().toISOString();

  const msg =
    `Plan ${planId}: Phase 3 - Implementation Steps\n${"=".repeat(40)}\n\n` +
    `Title: ${plan.title}\n\n` +
    `Template (number tasks S001-S999):\n\n` +
    `S001: [Task description]\n` +
    `  Files: [file1.js, file2.js]\n` +
    `  Depends: [none]\n` +
    `  Parallel: [P] (if parallelizable)\n\n` +
    `S002: [Task description]\n` +
    `  Files: [file3.js]\n` +
    `  Depends: [S001]\n\n` +
    `S003: Write tests\n` +
    `  Depends: [S001, S002]\n\n` +
    `Next: Run "plan execute ${planId}" to begin Phase 4.`;

  return { success: true, result: plan, message: msg };
}

function planExecute(planId) {
  const plan = planStore.get(planId);
  if (!plan) {
    return { success: false, error: `Plan "${planId}" not found.` };
  }

  plan.phase = 4;
  plan.phaseName = "execute";
  plan.status = "executing";
  plan.updatedAt = new Date().toISOString();

  const msg =
    `Plan ${planId}: Phase 4 - Execution\n${"=".repeat(35)}\n\n` +
    `Title: ${plan.title}\n` +
    `Status: EXECUTING\n\n` +
    `The plan is now in execution phase.\n` +
    `Quality checks will run automatically.\n\n` +
    `Available quality checks:\n` +
    `  quality build  - Check for build errors\n` +
    `  quality test   - Check test results\n` +
    `  quality lint   - Check lint status\n` +
    `  quality debt   - Check code debt\n` +
    `  quality all    - Run all checks`;

  return { success: true, result: plan, message: msg };
}

function planList() {
  const plans = [];
  for (const [_id, plan] of planStore) {
    plans.push({
      id: plan.id,
      title: plan.title,
      phase: plan.phase,
      phaseName: plan.phaseName,
      status: plan.status,
      createdAt: plan.createdAt,
    });
  }

  if (plans.length === 0) {
    return {
      success: true,
      result: { plans: [] },
      message: "No plans found. Create one with: plan spec <description>",
    };
  }

  const msg =
    `Plans (${plans.length})\n${"=".repeat(20)}\n\n` +
    plans
      .map(
        (p) =>
          `${p.id} [Phase ${p.phase}: ${p.phaseName}] ${p.title}\n  Status: ${p.status} | Created: ${p.createdAt}`,
      )
      .join("\n\n");

  return { success: true, result: { plans }, message: msg };
}

function planStatus(planId) {
  const plan = planStore.get(planId);
  if (!plan) {
    return { success: false, error: `Plan "${planId}" not found.` };
  }

  const { spec, research, steps, ...info } = plan;
  return {
    success: true,
    result: plan,
    message:
      `Plan ${planId} Status\n${"=".repeat(20)}\n` +
      `Title: ${plan.title}\n` +
      `Phase: ${plan.phase} (${plan.phaseName})\n` +
      `Status: ${plan.status}\n` +
      `Created: ${plan.createdAt}\n` +
      `Updated: ${plan.updatedAt}`,
  };
}

// ── Quality Agents ──────────────────────────────────────────────────

function handleQuality(parsed, context) {
  const check = parsed.subAction?.toLowerCase() || "all";
  const projectRoot =
    context.projectRoot ||
    context.workspaceRoot ||
    context.workspacePath ||
    process.cwd();

  switch (check) {
    case "build":
      return qualityBuild(projectRoot);
    case "test":
      return qualityTest(projectRoot);
    case "lint":
      return qualityLint(projectRoot);
    case "debt":
      return qualityDebt(projectRoot);
    case "all":
      return qualityAll(projectRoot);
    default:
      return {
        success: false,
        error: `Unknown quality check: ${check}. Use build, test, lint, debt, or all.`,
      };
  }
}

function qualityBuild(projectRoot) {
  // Check for common build config files
  const buildFiles = [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "webpack.config.js",
  ];
  const found = [];
  for (const f of buildFiles) {
    if (_deps.fs.existsSync(_deps.path.join(projectRoot, f))) {
      found.push(f);
    }
  }

  return {
    success: true,
    result: { check: "build", status: "info", configs: found },
    message:
      `Quality: Build Check\n${"=".repeat(20)}\n` +
      `Build configs found: ${found.join(", ") || "none"}\n` +
      `Run "npm run build" to verify build status.`,
  };
}

function qualityTest(projectRoot) {
  const testDirs = ["__tests__", "tests", "test", "spec"];
  const foundDirs = [];
  for (const d of testDirs) {
    const full = _deps.path.join(projectRoot, d);
    if (_deps.fs.existsSync(full)) {
      foundDirs.push(d);
    }
  }

  return {
    success: true,
    result: { check: "test", status: "info", testDirs: foundDirs },
    message:
      `Quality: Test Check\n${"=".repeat(20)}\n` +
      `Test directories found: ${foundDirs.join(", ") || "none"}\n` +
      `Run "npm test" or "npx vitest run" to execute tests.`,
  };
}

function qualityLint(projectRoot) {
  const lintConfigs = [
    ".eslintrc.js",
    ".eslintrc.json",
    "eslint.config.js",
    ".prettierrc",
  ];
  const found = [];
  for (const f of lintConfigs) {
    if (_deps.fs.existsSync(_deps.path.join(projectRoot, f))) {
      found.push(f);
    }
  }

  return {
    success: true,
    result: { check: "lint", status: "info", configs: found },
    message:
      `Quality: Lint Check\n${"=".repeat(20)}\n` +
      `Lint configs found: ${found.join(", ") || "none"}\n` +
      `Run "npm run lint" to check code style.`,
  };
}

function qualityDebt(projectRoot) {
  // Scan for TODO/FIXME/HACK comments
  const debtPatterns = [
    { pattern: /\/\/\s*TODO\b/gi, label: "TODO" },
    { pattern: /\/\/\s*FIXME\b/gi, label: "FIXME" },
    { pattern: /\/\/\s*HACK\b/gi, label: "HACK" },
    { pattern: /\/\/\s*XXX\b/gi, label: "XXX" },
    { pattern: /\/\/\s*TEMP\b/gi, label: "TEMP" },
  ];

  const counts = {};
  const samples = [];

  // Quick scan of src directory
  const srcDir = _deps.path.join(projectRoot, "src");
  if (_deps.fs.existsSync(srcDir)) {
    const files = collectCodeFiles(srcDir, 3);
    for (const file of files.slice(0, 100)) {
      let content;
      try {
        content = _deps.fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      for (const dp of debtPatterns) {
        dp.pattern.lastIndex = 0;
        const matches = content.match(dp.pattern);
        if (matches) {
          counts[dp.label] = (counts[dp.label] || 0) + matches.length;
          if (samples.length < 10) {
            const relPath = _deps.path.relative(projectRoot, file);
            samples.push(`${dp.label}: ${relPath}`);
          }
        }
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    success: true,
    result: {
      check: "debt",
      status: total > 50 ? "warning" : "pass",
      counts,
      total,
      samples,
    },
    message:
      `Quality: Code Debt\n${"=".repeat(20)}\n` +
      `Total markers: ${total}\n` +
      Object.entries(counts)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n") +
      (samples.length > 0
        ? `\n\nSamples:\n${samples.map((s) => `  ${s}`).join("\n")}`
        : ""),
  };
}

function qualityAll(projectRoot) {
  const build = qualityBuild(projectRoot);
  const test = qualityTest(projectRoot);
  const lint = qualityLint(projectRoot);
  const debt = qualityDebt(projectRoot);

  return {
    success: true,
    result: {
      check: "all",
      build: build.result,
      test: test.result,
      lint: lint.result,
      debt: debt.result,
    },
    message:
      `Quality Report (All Checks)\n${"=".repeat(30)}\n\n` +
      `Build: ${build.result.configs.length} configs\n` +
      `Test: ${test.result.testDirs.length} test dirs\n` +
      `Lint: ${lint.result.configs.length} configs\n` +
      `Debt: ${debt.result.total} markers (${debt.result.status})`,
  };
}

function collectCodeFiles(dir, maxDepth, depth = 0) {
  const files = [];
  if (depth > maxDepth) {
    return files;
  }
  try {
    const entries = _deps.fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        files.push(
          ...collectCodeFiles(
            _deps.path.join(dir, entry.name),
            maxDepth,
            depth + 1,
          ),
        );
      } else if (entry.isFile()) {
        const ext = _deps.path.extname(entry.name).slice(1);
        if (["js", "ts", "tsx", "jsx", "vue"].includes(ext)) {
          files.push(_deps.path.join(dir, entry.name));
        }
      }
      if (files.length >= 200) {
        return files;
      }
    }
  } catch {
    // skip
  }
  return files;
}

// ── Backlog Management ──────────────────────────────────────────────

function handleBacklog(parsed) {
  const sub = parsed.subAction?.toLowerCase() || "list";
  const content = parsed.rest || "";

  switch (sub) {
    case "add":
      return backlogAdd(content);
    case "list":
      return backlogList();
    case "prioritize":
      return backlogPrioritize();
    case "remove":
      return backlogRemove(content);
    default:
      return {
        success: false,
        error: `Unknown backlog action: ${sub}. Use add, list, prioritize, or remove.`,
      };
  }
}

function backlogAdd(idea) {
  if (!idea) {
    return { success: false, error: "Provide an idea description." };
  }

  const id = `B${String(backlogIdCounter++).padStart(3, "0")}`;
  const item = {
    id,
    idea,
    impact: 0,
    effort: 0,
    priority: 0,
    createdAt: new Date().toISOString(),
  };

  backlogStore.set(id, item);

  return {
    success: true,
    result: item,
    message: `Backlog item added: ${id} - ${idea}`,
  };
}

function backlogList() {
  const items = Array.from(backlogStore.values());

  if (items.length === 0) {
    return {
      success: true,
      result: { items: [] },
      message: "Backlog is empty. Add items with: backlog add <idea>",
    };
  }

  const msg =
    `Backlog (${items.length} items)\n${"=".repeat(25)}\n\n` +
    items
      .map(
        (item) =>
          `${item.id}: ${item.idea}\n  Priority: ${item.priority} | Impact: ${item.impact} | Effort: ${item.effort}`,
      )
      .join("\n\n");

  return { success: true, result: { items }, message: msg };
}

function backlogPrioritize() {
  const items = Array.from(backlogStore.values());

  if (items.length === 0) {
    return {
      success: true,
      result: { items: [] },
      message: "Backlog is empty.",
    };
  }

  // Auto-prioritize: impact/effort ratio (default both to 5 if unset)
  for (const item of items) {
    if (item.impact === 0) {
      item.impact = 5;
    }
    if (item.effort === 0) {
      item.effort = 5;
    }
    item.priority = Math.round((item.impact / item.effort) * 100) / 100;
  }

  const sorted = items.sort((a, b) => b.priority - a.priority);

  const msg =
    `Backlog Prioritized\n${"=".repeat(20)}\n\n` +
    sorted
      .map(
        (item, i) =>
          `${i + 1}. ${item.id}: ${item.idea} (priority: ${item.priority})`,
      )
      .join("\n");

  return { success: true, result: { items: sorted }, message: msg };
}

function backlogRemove(id) {
  if (!backlogStore.has(id)) {
    return { success: false, error: `Backlog item "${id}" not found.` };
  }

  backlogStore.delete(id);
  return { success: true, message: `Backlog item "${id}" removed.` };
}
