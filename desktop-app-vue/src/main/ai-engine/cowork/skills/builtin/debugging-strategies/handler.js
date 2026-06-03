/**
 * Debugging Strategies Skill Handler
 *
 * Systematic debugging methodologies: diagnose, bisect, trace,
 * hypothesis, rubber-duck, root-cause, red-flags, defense, session.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const _deps = { fs, path };

// ── Mode definitions ─────────────────────────────────────────────
const MODES = {
  diagnose: "diagnose",
  bisect: "bisect",
  trace: "trace",
  hypothesis: "hypothesis",
  "rubber-duck": "rubber-duck",
  "root-cause": "root-cause",
  "red-flags": "red-flags",
  defense: "defense",
  session: "session",
};

const ERROR_CATEGORIES = [
  {
    pattern: /TypeError/i,
    category: "Type Error",
    suggestions: [
      "Check null/undefined values",
      "Verify variable types",
      "Check function signatures",
    ],
  },
  {
    pattern: /ReferenceError/i,
    category: "Reference Error",
    suggestions: [
      "Check variable spelling",
      "Verify scope and imports",
      "Check declaration order",
    ],
  },
  {
    pattern: /SyntaxError/i,
    category: "Syntax Error",
    suggestions: [
      "Check brackets and parentheses",
      "Verify string quotes",
      "Look for missing commas/semicolons",
    ],
  },
  {
    pattern: /RangeError/i,
    category: "Range Error",
    suggestions: [
      "Check array bounds",
      "Verify recursive base cases",
      "Check numeric limits",
    ],
  },
  {
    pattern: /ENOENT|not found/i,
    category: "File/Path Error",
    suggestions: [
      "Verify file path exists",
      "Check working directory",
      "Check file permissions",
    ],
  },
  {
    pattern: /ECONNREFUSED|timeout/i,
    category: "Connection Error",
    suggestions: [
      "Check if service is running",
      "Verify host and port",
      "Check network/firewall",
    ],
  },
  {
    pattern: /permission|EACCES/i,
    category: "Permission Error",
    suggestions: [
      "Check file permissions",
      "Run with appropriate privileges",
      "Verify user/role access",
    ],
  },
  {
    pattern: /memory|heap|OOM/i,
    category: "Memory Error",
    suggestions: [
      "Check for memory leaks",
      "Reduce data size",
      "Increase memory limits",
    ],
  },
  {
    pattern: /UnhandledPromiseRejection|async|await/i,
    category: "Promise/Async Error",
    suggestions: [
      "Add missing await keyword",
      "Wrap async calls in try/catch",
      "Check for unhandled promise rejections",
      "Verify async function return types",
    ],
  },
  {
    pattern: /Cannot find module|ERR_MODULE_NOT_FOUND/i,
    category: "Import Error",
    suggestions: [
      "Check module name spelling",
      "Verify package is installed (npm install)",
      "Check relative import paths",
      "Verify package.json exports field",
    ],
  },
  {
    pattern: /SQLITE|ER_|PG_|deadlock/i,
    category: "Database Error",
    suggestions: [
      "Check SQL query syntax",
      "Verify database connection",
      "Check for table/column existence",
      "Look for transaction deadlocks",
      "Review migration status",
    ],
  },
  {
    pattern: /ECONNRESET|EPIPE|EHOSTUNREACH/i,
    category: "Network Error",
    suggestions: [
      "Check network connectivity",
      "Verify remote host is reachable",
      "Look for connection pool exhaustion",
      "Check for proxy/firewall issues",
    ],
  },
  {
    pattern: /webpack|vite|build failed|compilation/i,
    category: "Build Error",
    suggestions: [
      "Check for syntax errors in source files",
      "Verify dependency versions",
      "Clear build cache and retry",
      "Check bundler configuration",
      "Review loader/plugin settings",
    ],
  },
];

// ── Red Flag Patterns ────────────────────────────────────────────
const RED_FLAG_PATTERNS = [
  {
    pattern: /quick fix for now|temporary fix/i,
    flag: "Temporary Fix Mindset",
    severity: "danger",
    correction:
      "Stop and find the root cause. Temporary fixes become permanent technical debt. Ask: 'Why does this need a fix at all?'",
  },
  {
    pattern: /just try changing|let me try/i,
    flag: "Trial-and-Error Debugging",
    severity: "warning",
    correction:
      "Form a hypothesis BEFORE making changes. Ask: 'What specific behavior will change and why?' Use the hypothesis mode instead.",
  },
  {
    pattern: /don't fully understand but|might work/i,
    flag: "Incomplete Understanding",
    severity: "danger",
    correction:
      "Never commit a fix you cannot explain. Use the rubber-duck mode to articulate the problem. Read the relevant source code until you understand it.",
  },
  {
    pattern: /works on my machine/i,
    flag: "Environment Blindness",
    severity: "warning",
    correction:
      "Document exact environment differences (OS, Node version, env vars, dependencies). Use Docker or nix to reproduce the other environment locally.",
  },
  {
    pattern: /should be fine/i,
    flag: "Unverified Assumption",
    severity: "warning",
    correction:
      "Replace 'should be' with 'I verified that'. Add a test or assertion that proves it is fine. Assumptions are the #1 source of bugs.",
  },
];

// ── Debug Session Store ──────────────────────────────────────────
const sessionStore = new Map();

// ── Helpers ──────────────────────────────────────────────────────

function parseInput(raw) {
  const input = (raw || "").trim();
  if (!input) {
    return { mode: MODES.diagnose, description: "" };
  }

  const firstWord = input.split(/\s+/)[0].toLowerCase();
  if (MODES[firstWord]) {
    return {
      mode: firstWord,
      description: input.slice(firstWord.length).trim(),
    };
  }
  return { mode: MODES.diagnose, description: input };
}

function classifyError(description) {
  for (const { pattern, category, suggestions } of ERROR_CATEGORIES) {
    if (pattern.test(description)) {
      return { category, suggestions };
    }
  }
  return {
    category: "Unknown",
    suggestions: [
      "Add logging to narrow down the issue",
      "Check recent changes",
      "Review error stack trace",
    ],
  };
}

function generateDiagnose(description) {
  const classification = classifyError(description);
  const lines = [
    "# Systematic Diagnosis",
    "",
    "## Error Classification: " + classification.category,
    "**Input:** " + description,
    "",
    "## Diagnostic Checklist",
    "1. [ ] **Reproduce** - Can you consistently reproduce the issue?",
    "2. [ ] **Isolate** - What is the minimal reproduction case?",
    "3. [ ] **Environment** - Is it environment-specific (dev/staging/prod)?",
    "4. [ ] **Timing** - When did it start? What changed?",
    "5. [ ] **Scope** - Does it affect all users or specific conditions?",
    "",
    "## Likely Causes (by probability)",
  ];

  classification.suggestions.forEach((s, i) => {
    lines.push(i + 1 + ". " + s);
  });

  lines.push("");
  lines.push("## Resolution Steps");
  lines.push("1. Start with the most probable cause above");
  lines.push("2. Add logging/breakpoints at the suspected location");
  lines.push("3. Verify the fix and add a regression test");

  return {
    output: lines.join("\n"),
    data: {
      method: "diagnose",
      classification: classification.category,
      suggestions: classification.suggestions,
    },
  };
}

function generateBisect(description) {
  const lines = [
    "# Binary Search Debugging",
    "",
    "**Problem:** " + description,
    "",
    "## Bisect Strategy",
    "1. [ ] Identify the **last known good** state (commit, version, date)",
    "2. [ ] Identify the **first known bad** state",
    "3. [ ] Test the **midpoint** between good and bad",
    "4. [ ] Narrow the range by half each iteration",
    "",
    "## Git Bisect Commands",
    "```bash",
    "git bisect start",
    "git bisect bad          # Current state is broken",
    "git bisect good <ref>   # Last known working commit",
    "# Git will checkout midpoint - test and mark:",
    "git bisect good         # If this commit works",
    "git bisect bad          # If this commit is broken",
    "git bisect reset        # When done",
    "```",
    "",
    "## Bisect Log",
    "| Step | Commit/Version | Result | Notes |",
    "|------|---------------|--------|-------|",
    "| 1 | | good/bad | |",
    "| 2 | | good/bad | |",
    "| 3 | | good/bad | |",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "bisect", description },
  };
}

function generateTrace(description, context) {
  const projectRoot =
    context?.projectRoot || context?.workspaceRoot || process.cwd();
  const targetPath = description
    ? _deps.path.resolve(projectRoot, description)
    : null;
  let fileInfo = "";

  if (targetPath) {
    try {
      const stat = _deps.fs.statSync(targetPath);
      if (stat.isFile()) {
        const content = _deps.fs.readFileSync(targetPath, "utf-8");
        const lineCount = content.split("\n").length;
        const funcMatches =
          content.match(
            /(?:async\s+)?function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/g,
          ) || [];
        fileInfo =
          "\n**File:** " +
          description +
          " (" +
          lineCount +
          " lines, " +
          funcMatches.length +
          " functions)\n";
      }
    } catch {
      // File not found — trace from description instead
    }
  }

  const lines = [
    "# Execution Trace Analysis",
    "",
    "**Target:** " + description,
    fileInfo,
    "## Trace Points",
    "Add logging at these checkpoints:",
    "",
    "1. [ ] **Entry point** - Log input parameters",
    "2. [ ] **Decision points** - Log branch conditions (if/else, switch)",
    "3. [ ] **External calls** - Log API/DB call inputs and outputs",
    "4. [ ] **Data transforms** - Log before/after state changes",
    "5. [ ] **Exit point** - Log return value",
    "",
    "## Trace Template",
    "```javascript",
    'console.log("[TRACE] function entry:", { args });',
    'console.log("[TRACE] before transform:", { data });',
    'console.log("[TRACE] after transform:", { result });',
    'console.log("[TRACE] function exit:", { returnValue });',
    "```",
    "",
    "## Analysis",
    "After collecting trace output, look for:",
    "- Unexpected null/undefined values",
    "- Missing or extra function calls",
    "- Wrong data types at boundaries",
    "- Timing issues in async operations",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "trace", target: description, fileFound: !!fileInfo },
  };
}

function generateHypothesis(description) {
  const classification = classifyError(description);
  const lines = [
    "# Hypothesis-Driven Debugging",
    "",
    "**Problem:** " + description,
    "**Category:** " + classification.category,
    "",
    "## Hypothesis Table",
    "",
    "| # | Hypothesis | Test | Expected | Actual | Verdict |",
    "|---|-----------|------|----------|--------|---------|",
    "| H1 | | | | | |",
    "| H2 | | | | | |",
    "| H3 | | | | | |",
    "",
    "## Suggested Hypotheses",
  ];

  classification.suggestions.forEach((s, i) => {
    lines.push("- **H" + (i + 1) + ":** " + s);
  });

  lines.push("");
  lines.push("## Process");
  lines.push("1. Fill in hypotheses from most to least likely");
  lines.push("2. Design a test for each (should be fast and decisive)");
  lines.push("3. Run tests in order, recording actual results");
  lines.push("4. Mark verdict: CONFIRMED, REJECTED, or INCONCLUSIVE");
  lines.push("5. Pursue confirmed hypotheses, refine inconclusive ones");

  return {
    output: lines.join("\n"),
    data: { method: "hypothesis", classification: classification.category },
  };
}

function generateRubberDuck(description) {
  const lines = [
    "# Rubber Duck Debugging",
    "",
    "**Problem:** " + description,
    "",
    "## Explain Your Code",
    "Answer each question out loud or in writing:",
    "",
    "### 1. What should this code do?",
    "_(Describe the expected behavior in plain language)_",
    "",
    "### 2. What actually happens?",
    "_(Describe the actual behavior you observe)_",
    "",
    "### 3. Walk through the code step by step",
    "_(Explain each line as if teaching someone)_",
    "",
    "### 4. What assumptions am I making?",
    "_(List every assumption about inputs, state, timing)_",
    "",
    "### 5. Where does reality diverge from expectations?",
    "_(This is usually where the bug is)_",
    "",
    "## Common Revelations",
    "- A variable holds a different type than expected",
    "- An async operation completes in unexpected order",
    "- An edge case was not considered",
    "- A function has a side effect you forgot about",
    "- The wrong branch of a conditional is taken",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "rubber-duck", description },
  };
}

// ── Root Cause Mode ──────────────────────────────────────────────

function generateRootCause(description) {
  const classification = classifyError(description);
  const lines = [
    "# Root Cause Analysis",
    "",
    "**Problem:** " + description,
    "**Error Category:** " + classification.category,
    "",
    "---",
    "",
    "## Phase 1: Investigation",
    "",
    "- [ ] **Examine the error** - Read the full stack trace, not just the message",
    "- [ ] **Reproduce reliably** - Find exact steps to trigger the error every time",
    "- [ ] **Review git history** - `git log --oneline -20` and `git diff HEAD~5` for recent changes",
    "- [ ] **Check logs** - Review application logs around the time of failure",
    "- [ ] **Identify the blast radius** - What else is affected by this failure?",
    "",
    "## Phase 2: Pattern Analysis",
    "",
    "- [ ] **Find similar working code** - Locate code that does the same thing successfully",
    "- [ ] **Document differences** - What is different between working and broken code?",
    "- [ ] **Check for regressions** - Did this work before? What changed?",
    "- [ ] **Review dependencies** - Have any upstream dependencies changed?",
    "- [ ] **Map the data flow** - Trace the data from input to error point",
    "",
    "## Phase 3: Hypothesis Testing",
    "",
    "- [ ] **Formulate specific hypotheses** - Write down exactly what you think is wrong",
    "- [ ] **Test the smallest change** - Make ONE change at a time",
    "- [ ] **Record results** - Document what each change did or did not fix",
    "- [ ] **Eliminate possibilities** - Cross off hypotheses that testing disproves",
    "",
    "| # | Hypothesis | Smallest Test | Result | Eliminated? |",
    "|---|-----------|--------------|--------|-------------|",
    "| 1 | | | | |",
    "| 2 | | | | |",
    "| 3 | | | | |",
    "",
    "## Phase 4: Implementation",
    "",
    "- [ ] **Create a failing test** - Write a test that reproduces the bug",
    "- [ ] **Implement the fix** - Make the minimal change to pass the test",
    "- [ ] **Verify** - Run the full test suite, check no regressions",
    "- [ ] **Document** - Add a comment explaining WHY the fix works",
    "",
    "---",
    "",
    "## 3-Fix Threshold Rule",
    "",
    "> If you have attempted **3 or more fixes** and the problem persists,",
    "> **STOP and question the architecture.**",
    ">",
    "> The bug may be a symptom of a deeper design issue. Ask:",
    "> - Is this component doing too much?",
    "> - Is the data model wrong?",
    "> - Is there a missing abstraction?",
    "> - Should this be redesigned rather than patched?",
    "",
    "**Fix Attempts Log:**",
    "",
    "| # | What I Tried | Why It Failed |",
    "|---|-------------|---------------|",
    "| 1 | | |",
    "| 2 | | |",
    "| 3 | | STOP: Re-evaluate architecture |",
  ];

  return {
    output: lines.join("\n"),
    data: {
      method: "root-cause",
      classification: classification.category,
      phases: 4,
    },
  };
}

// ── Red Flags Mode ───────────────────────────────────────────────

function generateRedFlags(description) {
  const detectedFlags = [];

  for (const { pattern, flag, severity, correction } of RED_FLAG_PATTERNS) {
    if (pattern.test(description)) {
      detectedFlags.push({ flag, severity, correction });
    }
  }

  let rating;
  if (detectedFlags.some((f) => f.severity === "danger")) {
    rating = "danger";
  } else if (detectedFlags.length > 0) {
    rating = "warning";
  } else {
    rating = "good";
  }

  const ratingLabels = {
    good: "GOOD - No red flags detected",
    warning: "WARNING - Some concerning patterns found",
    danger: "DANGER - Risky debugging approach detected",
  };

  const lines = [
    "# Debugging Approach Quality Check",
    "",
    "**Input:** " + description,
    "",
    "## Rating: " + ratingLabels[rating],
    "",
  ];

  if (detectedFlags.length === 0) {
    lines.push(
      "No red flags detected in your debugging approach. Your description suggests",
      "a methodical approach. Continue with systematic debugging.",
      "",
      "## Best Practices Reminder",
      "- Always understand the root cause before fixing",
      "- Make one change at a time",
      "- Verify with tests, not assumptions",
      "- Document what you find for future reference",
    );
  } else {
    lines.push("## Detected Red Flags", "");

    detectedFlags.forEach((f, i) => {
      const icon = f.severity === "danger" ? "[DANGER]" : "[WARNING]";
      lines.push(
        "### " + (i + 1) + ". " + icon + " " + f.flag,
        "",
        "**Correction:** " + f.correction,
        "",
      );
    });

    lines.push(
      "## Recommended Next Steps",
      "",
      "1. Pause and re-read the error message carefully",
      "2. Use `/debugging-strategies root-cause <problem>` for systematic analysis",
      "3. Form a hypothesis BEFORE making any code changes",
      "4. Make only ONE change at a time and verify its effect",
    );
  }

  return {
    output: lines.join("\n"),
    data: {
      method: "red-flags",
      rating,
      flagCount: detectedFlags.length,
      flags: detectedFlags.map((f) => f.flag),
    },
  };
}

// ── Defense in Depth Mode ────────────────────────────────────────

function generateDefense(description) {
  const classification = classifyError(description);

  const validationLayers = {
    input: {
      name: "Input Validation Layer",
      description: "Validate all inputs at system boundaries before processing",
      patterns: [
        "Null/undefined checks for required parameters",
        "Type assertions (typeof, instanceof)",
        "Range and format validation",
        "Sanitization of user-provided strings",
      ],
      template: [
        "function validateInput(input) {",
        "  if (input == null) {",
        "    throw new Error('Input is required');",
        "  }",
        "  if (typeof input !== 'string') {",
        "    throw new TypeError(`Expected string, got ${typeof input}`);",
        "  }",
        "  if (input.length === 0 || input.length > MAX_LENGTH) {",
        "    throw new RangeError(`Input length must be 1-${MAX_LENGTH}`);",
        "  }",
        "  return sanitize(input);",
        "}",
      ],
    },
    business: {
      name: "Business Logic Layer",
      description: "Enforce business rules and invariants",
      patterns: [
        "Pre-condition checks before operations",
        "Invariant assertions during processing",
        "Post-condition verification after operations",
        "State machine transition validation",
      ],
      template: [
        "function processOrder(order) {",
        "  // Pre-condition",
        "  assert(order.status === 'pending', 'Order must be pending');",
        "  assert(order.items.length > 0, 'Order must have items');",
        "",
        "  const result = executeBusinessLogic(order);",
        "",
        "  // Post-condition",
        "  assert(result.total >= 0, 'Total must be non-negative');",
        "  assert(result.status === 'processed', 'Status must be processed');",
        "  return result;",
        "}",
      ],
    },
    data: {
      name: "Data Access Layer",
      description: "Validate data integrity at storage boundaries",
      patterns: [
        "Prepared statements for SQL (prevent injection)",
        "Schema validation before writes",
        "Referential integrity checks",
        "Transaction boundaries for multi-step operations",
      ],
      template: [
        "async function saveRecord(db, record) {",
        "  // Schema validation",
        "  const errors = validateSchema(record, SCHEMA);",
        "  if (errors.length > 0) {",
        "    throw new ValidationError('Invalid record', errors);",
        "  }",
        "",
        "  // Use prepared statement",
        "  const stmt = db.prepare(",
        "    'INSERT INTO records (id, data) VALUES (?, ?)'",
        "  );",
        "  return stmt.run(record.id, JSON.stringify(record.data));",
        "}",
      ],
    },
    output: {
      name: "Output/Response Layer",
      description: "Validate and sanitize all outputs before returning",
      patterns: [
        "Strip sensitive data from responses",
        "Validate response schema/format",
        "Error message sanitization (no stack traces to users)",
        "Content-type and encoding verification",
      ],
      template: [
        "function formatResponse(data, error) {",
        "  if (error) {",
        "    // Never expose internals to client",
        "    return {",
        "      success: false,",
        "      message: error.userMessage || 'An error occurred',",
        "      code: error.code || 'UNKNOWN_ERROR',",
        "    };",
        "  }",
        "  // Strip sensitive fields",
        "  const safe = omit(data, ['password', 'token', 'secret']);",
        "  return { success: true, data: safe };",
        "}",
      ],
    },
  };

  // Select relevant patterns based on error type
  const relevantLayers = Object.keys(validationLayers);
  const categoryHints = {
    "Type Error": ["input", "business"],
    "Database Error": ["data", "input"],
    "Permission Error": ["input", "output"],
    "Import Error": ["input"],
    "Network Error": ["output", "business"],
    "Build Error": ["input"],
  };
  const priorityLayers = categoryHints[classification.category] || [];

  const lines = [
    "# Defense in Depth - Multi-Layer Validation",
    "",
    "**Problem:** " + description,
    "**Error Category:** " + classification.category,
    "",
    "---",
    "",
    "> After finding the root cause, add validation at MULTIPLE layers so that",
    "> similar bugs are caught earlier and produce clearer error messages.",
    "",
  ];

  relevantLayers.forEach((key) => {
    const layer = validationLayers[key];
    const isPriority = priorityLayers.includes(key);
    const marker = isPriority ? " (HIGH PRIORITY for this error type)" : "";

    lines.push("## " + layer.name + marker, "");
    lines.push("_" + layer.description + "_", "");
    lines.push("### Validation Patterns", "");
    layer.patterns.forEach((p) => lines.push("- [ ] " + p));
    lines.push("");
    lines.push("### Code Template", "");
    lines.push("```javascript");
    layer.template.forEach((l) => lines.push(l));
    lines.push("```");
    lines.push("");
  });

  lines.push(
    "## Verification Checklist",
    "",
    "- [ ] Each layer validates independently (no layer trusts another)",
    "- [ ] Error messages are specific and actionable",
    "- [ ] Validation cannot be bypassed by calling internal functions directly",
    "- [ ] Tests exist for each validation rule",
  );

  return {
    output: lines.join("\n"),
    data: {
      method: "defense",
      classification: classification.category,
      layers: relevantLayers,
      priorityLayers,
    },
  };
}

// ── Session Tracking Mode ────────────────────────────────────────

function handleSession(description) {
  const parts = description.trim().split(/\s+/);
  const subcommand = (parts[0] || "").toLowerCase();
  const rest = parts.slice(1).join(" ");

  switch (subcommand) {
    case "start":
      return sessionStart(rest);
    case "log":
      return sessionLog(rest);
    case "hypothesis":
      return sessionHypothesis(rest);
    case "summary":
      return sessionSummary();
    default:
      return {
        output: [
          "# Debug Session Tracking",
          "",
          "## Subcommands",
          "",
          "- `session start <problem description>` - Start a new debugging session",
          "- `session log <entry>` - Log a debugging step",
          "- `session hypothesis <hypothesis>` - Record a hypothesis",
          "- `session summary` - Generate session summary with timeline",
          "",
          "Current active sessions: " + sessionStore.size,
        ].join("\n"),
        data: {
          method: "session",
          subcommand: "help",
          activeSessions: sessionStore.size,
        },
      };
  }
}

function sessionStart(problem) {
  if (!problem) {
    return {
      output:
        "Error: Please provide a problem description.\nUsage: `session start <problem description>`",
      data: {
        method: "session",
        subcommand: "start",
        error: "no problem provided",
      },
    };
  }

  const sessionId = "dbg-" + Date.now();
  const session = {
    id: sessionId,
    problem,
    startedAt: new Date().toISOString(),
    logs: [],
    hypotheses: [],
  };
  sessionStore.set(sessionId, session);

  return {
    output: [
      "# Debug Session Started",
      "",
      "**Session ID:** `" + sessionId + "`",
      "**Problem:** " + problem,
      "**Started:** " + session.startedAt,
      "",
      "## Next Steps",
      "- `session log <what you tried>` - Record debugging steps",
      "- `session hypothesis <your hypothesis>` - Record a hypothesis",
      "- `session summary` - View session timeline and summary",
    ].join("\n"),
    data: { method: "session", subcommand: "start", sessionId },
  };
}

function getActiveSession() {
  if (sessionStore.size === 0) {
    return null;
  }
  // Return the most recently created session
  let latest = null;
  for (const session of sessionStore.values()) {
    if (!latest || session.startedAt > latest.startedAt) {
      latest = session;
    }
  }
  return latest;
}

function sessionLog(entry) {
  const session = getActiveSession();
  if (!session) {
    return {
      output: "No active session. Start one with: `session start <problem>`",
      data: {
        method: "session",
        subcommand: "log",
        error: "no active session",
      },
    };
  }
  if (!entry) {
    return {
      output:
        "Error: Please provide a log entry.\nUsage: `session log <what you tried>`",
      data: {
        method: "session",
        subcommand: "log",
        error: "no entry provided",
      },
    };
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    entry,
    index: session.logs.length + 1,
  };
  session.logs.push(logEntry);

  return {
    output: [
      "**[Step " +
        logEntry.index +
        "]** logged to session `" +
        session.id +
        "`",
      "",
      "> " + entry,
      "",
      "Total steps: " +
        session.logs.length +
        " | Hypotheses: " +
        session.hypotheses.length,
    ].join("\n"),
    data: {
      method: "session",
      subcommand: "log",
      sessionId: session.id,
      stepIndex: logEntry.index,
    },
  };
}

function sessionHypothesis(hypothesis) {
  const session = getActiveSession();
  if (!session) {
    return {
      output: "No active session. Start one with: `session start <problem>`",
      data: {
        method: "session",
        subcommand: "hypothesis",
        error: "no active session",
      },
    };
  }
  if (!hypothesis) {
    return {
      output:
        "Error: Please provide a hypothesis.\nUsage: `session hypothesis <your hypothesis>`",
      data: {
        method: "session",
        subcommand: "hypothesis",
        error: "no hypothesis provided",
      },
    };
  }

  const hyp = {
    timestamp: new Date().toISOString(),
    hypothesis,
    index: session.hypotheses.length + 1,
    result: "PENDING",
  };
  session.hypotheses.push(hyp);

  return {
    output: [
      "**[H" + hyp.index + "]** recorded in session `" + session.id + "`",
      "",
      "> " + hypothesis,
      "",
      "Status: PENDING",
      "Total hypotheses: " + session.hypotheses.length,
    ].join("\n"),
    data: {
      method: "session",
      subcommand: "hypothesis",
      sessionId: session.id,
      hypothesisIndex: hyp.index,
    },
  };
}

function sessionSummary() {
  const session = getActiveSession();
  if (!session) {
    return {
      output: "No active session. Start one with: `session start <problem>`",
      data: {
        method: "session",
        subcommand: "summary",
        error: "no active session",
      },
    };
  }

  const elapsed = Date.now() - new Date(session.startedAt).getTime();
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  const lines = [
    "# Debug Session Summary",
    "",
    "**Session:** `" + session.id + "`",
    "**Problem:** " + session.problem,
    "**Started:** " + session.startedAt,
    "**Elapsed:** " + minutes + "m " + seconds + "s",
    "",
    "---",
    "",
  ];

  // Timeline
  lines.push("## Timeline", "");
  if (session.logs.length === 0 && session.hypotheses.length === 0) {
    lines.push("_No entries recorded yet._");
  } else {
    // Merge logs and hypotheses by timestamp
    const allEntries = [
      ...session.logs.map((l) => ({ ...l, type: "log" })),
      ...session.hypotheses.map((h) => ({ ...h, type: "hypothesis" })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    allEntries.forEach((e) => {
      const time = e.timestamp.split("T")[1].split(".")[0];
      if (e.type === "log") {
        lines.push("- `" + time + "` **Step " + e.index + ":** " + e.entry);
      } else {
        lines.push(
          "- `" +
            time +
            "` **H" +
            e.index +
            ":** " +
            e.hypothesis +
            " [" +
            e.result +
            "]",
        );
      }
    });
  }

  lines.push("");

  // Hypotheses table
  if (session.hypotheses.length > 0) {
    lines.push("## Hypotheses", "");
    lines.push("| # | Hypothesis | Status |");
    lines.push("|---|-----------|--------|");
    session.hypotheses.forEach((h) => {
      lines.push(
        "| H" + h.index + " | " + h.hypothesis + " | " + h.result + " |",
      );
    });
    lines.push("");
  }

  // 3-fix threshold check
  if (session.logs.length >= 3) {
    lines.push(
      "## 3-Fix Threshold Warning",
      "",
      "> You have recorded " + session.logs.length + " debugging steps.",
      "> If multiple fix attempts have failed, consider stepping back",
      "> and questioning the architecture. Use `/debugging-strategies root-cause` for systematic analysis.",
      "",
    );
  }

  lines.push(
    "## Stats",
    "- Steps logged: " + session.logs.length,
    "- Hypotheses: " + session.hypotheses.length,
    "- Duration: " + minutes + "m " + seconds + "s",
  );

  return {
    output: lines.join("\n"),
    data: {
      method: "session",
      subcommand: "summary",
      sessionId: session.id,
      logCount: session.logs.length,
      hypothesisCount: session.hypotheses.length,
      elapsedMs: elapsed,
    },
  };
}

// ── Handler ──────────────────────────────────────────────────────

async function init(skill) {
  logger.info(
    '[debugging-strategies] handler initialized for "' +
      (skill?.name || "debugging-strategies") +
      '"',
  );
}

async function execute(task, context, _skill) {
  const raw = task?.params?.input || task?.input || task?.action || "";
  const { mode, description } = parseInput(raw);

  // Session mode does not require a description (subcommands handle it)
  if (!description && mode !== MODES.session) {
    return {
      success: false,
      output:
        "Usage: /debugging-strategies [mode] <error or file path>\nModes: diagnose, bisect, trace, hypothesis, rubber-duck, root-cause, red-flags, defense, session",
      error: "No description provided",
    };
  }

  try {
    let result;
    switch (mode) {
      case MODES.bisect:
        result = generateBisect(description);
        break;
      case MODES.trace:
        result = generateTrace(description, context);
        break;
      case MODES.hypothesis:
        result = generateHypothesis(description);
        break;
      case MODES["rubber-duck"]:
        result = generateRubberDuck(description);
        break;
      case MODES["root-cause"]:
        result = generateRootCause(description);
        break;
      case MODES["red-flags"]:
        result = generateRedFlags(description);
        break;
      case MODES.defense:
        result = generateDefense(description);
        break;
      case MODES.session:
        result = handleSession(description);
        break;
      default:
        result = generateDiagnose(description);
        break;
    }

    logger.info(
      "[debugging-strategies] generated " +
        mode +
        " for: " +
        (description || "session").slice(0, 60),
    );

    return {
      success: true,
      output: result.output,
      result: result.data,
      message: "Generated " + mode + " debugging strategy",
    };
  } catch (err) {
    logger.error("[debugging-strategies] Error:", err.message);
    return {
      success: false,
      output: "Error: " + err.message,
      error: err.message,
    };
  }
}

module.exports = { init, execute, _deps, _sessionStore: sessionStore };
