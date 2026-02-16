/**
 * Fault Localizer Skill Handler
 *
 * Given an error stack trace, failing test output, or error message,
 * parses the input, navigates to source files, analyzes function
 * complexity and error-handling quality, checks git recency, and
 * produces a suspiciousness ranking to identify root-cause code.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_CONTEXT_LINES = 5;

const WEIGHTS = {
  distanceFromThrow: 0.35,
  complexity: 0.2,
  errorHandling: 0.2,
  recentModification: 0.15,
  paramValidation: 0.1,
};

const ERROR_FIX_MAP = {
  TypeError:
    "Add null/undefined checks or optional chaining (?.) before property access",
  ReferenceError: "Ensure the variable is declared and in scope before use",
  RangeError: "Add bounds checking for array indices and numeric ranges",
  SyntaxError: "Check for missing brackets, parentheses, or invalid syntax",
  ECONNREFUSED:
    "Verify the target service is running and the host:port is correct",
  ENOENT: "Check that the file or directory exists before accessing it",
  EACCES: "Verify file permissions or run with appropriate privileges",
  ETIMEDOUT: "Increase timeout value or check network connectivity",
  AssertionError: "Review the assertion - expected and actual values diverge",
};

// ── Stack Trace Parsers ────────────────────────────────────────────

function parseNodeStack(text) {
  const frames = [];
  const nodePattern = /at\s+(?:(.+?)\s+\()?([^()]+?):(\d+):(\d+)\)?/g;
  let match;
  while ((match = nodePattern.exec(text)) !== null) {
    const funcName = match[1] || "<anonymous>";
    const file = match[2].trim();
    if (file.startsWith("node:") || file.includes("node_modules")) {
      continue;
    }
    frames.push({
      function: funcName,
      file: file,
      line: parseInt(match[3], 10),
      column: parseInt(match[4], 10),
    });
  }
  return frames;
}

function parsePythonStack(text) {
  const frames = [];
  const pyPattern = /File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(\w+)/g;
  let match;
  while ((match = pyPattern.exec(text)) !== null) {
    const file = match[1];
    if (file.includes("site-packages") || file.includes("/lib/python")) {
      continue;
    }
    frames.push({
      function: match[3],
      file: file,
      line: parseInt(match[2], 10),
      column: 0,
    });
  }
  return frames.reverse();
}

function parseJavaStack(text) {
  const frames = [];
  const javaPattern = /at\s+([\w.$]+)\.([\w<>]+)\(([^:]+):(\d+)\)/g;
  let match;
  while ((match = javaPattern.exec(text)) !== null) {
    if (match[1].startsWith("java.") || match[1].startsWith("sun.")) {
      continue;
    }
    frames.push({
      function: match[1] + "." + match[2],
      file: match[3],
      line: parseInt(match[4], 10),
      column: 0,
    });
  }
  return frames;
}

function parseStackTrace(text) {
  let frames = parseNodeStack(text);
  if (frames.length > 0) {
    return { runtime: "node", frames: frames };
  }
  frames = parsePythonStack(text);
  if (frames.length > 0) {
    return { runtime: "python", frames: frames };
  }
  frames = parseJavaStack(text);
  if (frames.length > 0) {
    return { runtime: "java", frames: frames };
  }
  return { runtime: "unknown", frames: [] };
}

function extractErrorInfo(text) {
  const firstLine = text.trim().split("\n")[0];
  const nodeErr = firstLine.match(/^(\w*Error):\s*(.+)/);
  if (nodeErr) {
    return { errorType: nodeErr[1], errorMessage: nodeErr[2] };
  }
  const pyErr = firstLine.match(/^(\w*Error|Exception):\s*(.+)/);
  if (pyErr) {
    return { errorType: pyErr[1], errorMessage: pyErr[2] };
  }
  const sysErr = firstLine.match(/\b(E[A-Z]+)\b/);
  if (sysErr) {
    return { errorType: sysErr[1], errorMessage: firstLine.trim() };
  }
  const testErr = text.match(/Expected:\s*(.+)\s*Received:\s*(.+)/);
  if (testErr) {
    return {
      errorType: "AssertionError",
      errorMessage:
        "Expected " + testErr[1].trim() + ", got " + testErr[2].trim(),
    };
  }
  return { errorType: "Unknown", errorMessage: firstLine.trim() };
}

// ── Source Analysis ────────────────────────────────────────────────

function readSourceContext(filePath, line, contextLines) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);
    const contextArr = [];
    for (let i = start; i < end; i++) {
      const num = i + 1;
      const marker = num === line ? ">>>" : "   ";
      contextArr.push(marker + " " + num + ": " + lines[i]);
    }
    return { content: content, lines: lines, context: contextArr.join("\n") };
  } catch (_e) {
    return { content: "", lines: [], context: "(source unavailable)" };
  }
}

function measureComplexity(lines, targetLine) {
  let funcStart = targetLine - 1;
  let foundFunc = false;
  for (let i = targetLine - 1; i >= Math.max(0, targetLine - 50); i--) {
    if (/^\s*(?:async\s+)?(?:function|class|\w+\s*(?:=>|\())/.test(lines[i])) {
      funcStart = i;
      foundFunc = true;
      break;
    }
  }
  if (!foundFunc) {
    return { funcLength: 1, cyclomaticComplexity: 1, score: 0.1 };
  }

  let braceDepth = 0;
  let funcEnd = funcStart;
  for (let i = funcStart; i < Math.min(lines.length, funcStart + 200); i++) {
    braceDepth += (lines[i].match(/\{/g) || []).length;
    braceDepth -= (lines[i].match(/\}/g) || []).length;
    if (braceDepth <= 0 && i > funcStart) {
      funcEnd = i;
      break;
    }
  }

  const funcLength = funcEnd - funcStart + 1;
  const funcBody = lines.slice(funcStart, funcEnd + 1).join("\n");
  const decisions = (
    funcBody.match(
      /\bif\b|\belse\b|\bfor\b|\bwhile\b|\bswitch\b|\bcatch\b|\bcase\b|\b\?\?\b|\?\./g,
    ) || []
  ).length;
  const cyclomaticComplexity = decisions + 1;
  const score = Math.min(
    1,
    (funcLength / 100) * 0.5 + (cyclomaticComplexity / 15) * 0.5,
  );

  return {
    funcLength: funcLength,
    cyclomaticComplexity: cyclomaticComplexity,
    score: score,
  };
}

function checkErrorHandling(lines, targetLine) {
  const start = Math.max(0, targetLine - 10);
  const end = Math.min(lines.length, targetLine + 10);
  const surrounding = lines.slice(start, end).join("\n");

  const hasTryCatch =
    /\btry\s*\{/.test(surrounding) && /\bcatch\s*\(/.test(surrounding);
  const hasNullCheck =
    /!==?\s*(?:null|undefined)|(?:null|undefined)\s*!==?|\?\./.test(
      surrounding,
    );
  const hasIfCheck = /\bif\s*\(\s*!?\w+\s*\)/.test(surrounding);

  let score = 1.0;
  if (hasTryCatch) {
    score -= 0.5;
  }
  if (hasIfCheck) {
    score -= 0.2;
  }
  if (hasNullCheck) {
    score -= 0.3;
  }
  return {
    hasTryCatch: hasTryCatch,
    hasNullCheck: hasNullCheck,
    score: Math.max(0, score),
  };
}

function checkParamValidation(lines, targetLine) {
  let funcStart = targetLine - 1;
  for (let i = targetLine - 1; i >= Math.max(0, targetLine - 30); i--) {
    if (/^\s*(?:async\s+)?(?:function|class|\w+\s*(?:=>|\())/.test(lines[i])) {
      funcStart = i;
      break;
    }
  }
  const firstLines = lines
    .slice(funcStart, Math.min(funcStart + 10, lines.length))
    .join("\n");
  let score = 1.0;
  if (/\btypeof\s+\w+/.test(firstLines)) {
    score -= 0.3;
  }
  if (/\bthrow\b/.test(firstLines)) {
    score -= 0.3;
  }
  if (/\bassert\b/.test(firstLines)) {
    score -= 0.2;
  }
  if (/\bif\s*\(\s*!/.test(firstLines)) {
    score -= 0.2;
  }
  return { score: Math.max(0, score) };
}

function checkGitRecency(filePath, projectRoot) {
  try {
    const result = execSync('git log -1 --format=%ct -- "' + filePath + '"', {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!result) {
      return { daysAgo: Infinity, score: 0 };
    }
    const lastModified = parseInt(result, 10) * 1000;
    const daysAgo = (Date.now() - lastModified) / (1000 * 60 * 60 * 24);
    let score;
    if (daysAgo <= 7) {
      score = 1.0;
    } else if (daysAgo <= 30) {
      score = 0.6;
    } else if (daysAgo <= 90) {
      score = 0.3;
    } else {
      score = 0.1;
    }
    return { daysAgo: Math.round(daysAgo), score: score };
  } catch (_e) {
    return { daysAgo: -1, score: 0.5 };
  }
}

// ── Suspiciousness Ranking ─────────────────────────────────────────

function rankSuspiciousness(frames, projectRoot, contextLines) {
  const ranked = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    let absPath = frame.file;
    if (!path.isAbsolute(absPath)) {
      absPath = path.resolve(projectRoot, absPath);
    }

    const distanceScore = Math.max(0, 1.0 - i * 0.15);
    const source = readSourceContext(absPath, frame.line, contextLines);
    frame.sourceContext = source.context;

    let complexityResult = { score: 0.5 };
    let errorHandlingResult = { score: 0.5 };
    let paramResult = { score: 0.5 };
    let gitResult = { score: 0.5 };

    if (source.lines.length > 0) {
      complexityResult = measureComplexity(source.lines, frame.line);
      errorHandlingResult = checkErrorHandling(source.lines, frame.line);
      paramResult = checkParamValidation(source.lines, frame.line);
      gitResult = checkGitRecency(frame.file, projectRoot);
    }

    const score =
      WEIGHTS.distanceFromThrow * distanceScore +
      WEIGHTS.complexity * complexityResult.score +
      WEIGHTS.errorHandling * errorHandlingResult.score +
      WEIGHTS.recentModification * gitResult.score +
      WEIGHTS.paramValidation * paramResult.score;

    const reasons = [];
    if (i === 0) {
      reasons.push("closest to error throw point");
    }
    if (complexityResult.score > 0.6) {
      reasons.push("high function complexity");
    }
    if (errorHandlingResult.score > 0.7) {
      reasons.push("missing error handling");
    }
    if (gitResult.score > 0.7) {
      reasons.push("recently modified (" + gitResult.daysAgo + "d ago)");
    }
    if (paramResult.score > 0.7) {
      reasons.push("no input validation");
    }

    ranked.push({
      file: frame.file,
      line: frame.line,
      function: frame.function,
      score: Math.round(score * 100) / 100,
      reason: reasons.join(", ") || "standard suspicion level",
      details: {
        distanceScore: Math.round(distanceScore * 100) / 100,
        complexityScore: Math.round(complexityResult.score * 100) / 100,
        errorHandlingScore: Math.round(errorHandlingResult.score * 100) / 100,
        gitRecencyScore: Math.round(gitResult.score * 100) / 100,
        paramValidationScore: Math.round(paramResult.score * 100) / 100,
      },
    });
  }
  ranked.sort(function (a, b) {
    return b.score - a.score;
  });
  return ranked;
}

function generateFixSuggestion(errorType, errorMessage, topLocation) {
  const keys = Object.keys(ERROR_FIX_MAP);
  for (let k = 0; k < keys.length; k++) {
    if (errorType === keys[k] || errorMessage.includes(keys[k])) {
      return ERROR_FIX_MAP[keys[k]];
    }
  }
  if (errorMessage.includes("undefined") || errorMessage.includes("null")) {
    return (
      "Add null check before accessing properties at " +
      (topLocation
        ? topLocation.file + ":" + topLocation.line
        : "the error location") +
      ": use optional chaining (?.) or explicit guard"
    );
  }
  if (errorMessage.includes("is not a function")) {
    return "Verify that the value is callable - it may be undefined or the wrong type";
  }
  const loc = topLocation
    ? topLocation.file + ":" + topLocation.line
    : "unknown";
  return (
    "Investigate " +
    (topLocation ? topLocation.function : "the function") +
    " at " +
    loc +
    " - this is the most suspicious location"
  );
}

// ── Mode Handlers ──────────────────────────────────────────────────

function modeTrace(input, projectRoot, contextLines) {
  const errorInfo = extractErrorInfo(input);
  const parsed = parseStackTrace(input);

  if (parsed.frames.length === 0) {
    return {
      success: false,
      error: "Could not parse any stack frames from the input",
      message:
        "No recognizable stack trace found. Provide a Node.js, Python, or Java stack trace.",
    };
  }

  const suspiciousLocations = rankSuspiciousness(
    parsed.frames,
    projectRoot,
    contextLines,
  );
  const suggestedFix = generateFixSuggestion(
    errorInfo.errorType,
    errorInfo.errorMessage,
    suspiciousLocations[0],
  );

  return {
    success: true,
    result: {
      errorType: errorInfo.errorType,
      errorMessage: errorInfo.errorMessage,
      runtime: parsed.runtime,
      frames: parsed.frames.map(function (f) {
        return {
          file: f.file,
          line: f.line,
          column: f.column,
          function: f.function,
          sourceContext: f.sourceContext,
        };
      }),
      suspiciousLocations: suspiciousLocations,
      suggestedFix: suggestedFix,
    },
    message:
      "Parsed " +
      parsed.frames.length +
      " frames (" +
      parsed.runtime +
      "). Top suspect: " +
      (suspiciousLocations[0]
        ? suspiciousLocations[0].file +
          ":" +
          suspiciousLocations[0].line +
          " (score: " +
          suspiciousLocations[0].score +
          ")"
        : "none") +
      ". " +
      suggestedFix,
  };
}

function modeTest(input, projectRoot, contextLines) {
  const errorInfo = extractErrorInfo(input);
  const failMatch = input.match(/FAIL\s+(\S+)/);
  const testFile = failMatch ? failMatch[1] : null;
  const testNameMatch = input.match(/●\s+(.+)/);
  const testName = testNameMatch ? testNameMatch[1].trim() : "unknown test";

  const parsed = parseStackTrace(input);
  const frames = parsed.frames;

  if (frames.length === 0 && testFile) {
    const absPath = path.resolve(projectRoot, testFile);
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      const lines = content.split("\n");
      const testParts = testName.split(" › ");
      const searchTerm = testParts[testParts.length - 1];
      for (let i = 0; i < lines.length; i++) {
        if (searchTerm && lines[i].includes(searchTerm)) {
          frames.push({
            function: searchTerm,
            file: testFile,
            line: i + 1,
            column: 0,
          });
          break;
        }
      }
    } catch (_e) {
      /* test file not accessible */
    }
  }

  const suspiciousLocations =
    frames.length > 0
      ? rankSuspiciousness(frames, projectRoot, contextLines)
      : [];
  const suggestedFix =
    frames.length > 0
      ? generateFixSuggestion(
          errorInfo.errorType,
          errorInfo.errorMessage,
          suspiciousLocations[0],
        )
      : 'Investigate failing test "' +
        testName +
        '" - the assertion mismatch suggests a logic error in the tested code';

  return {
    success: true,
    result: {
      errorType: errorInfo.errorType,
      errorMessage: errorInfo.errorMessage,
      testFile: testFile,
      testName: testName,
      frames: frames.map(function (f) {
        return {
          file: f.file,
          line: f.line,
          column: f.column,
          function: f.function,
          sourceContext: f.sourceContext,
        };
      }),
      suspiciousLocations: suspiciousLocations,
      suggestedFix: suggestedFix,
    },
    message:
      'Test failure: "' +
      testName +
      '" in ' +
      (testFile || "unknown file") +
      ". " +
      errorInfo.errorType +
      ": " +
      errorInfo.errorMessage +
      ". " +
      suggestedFix,
  };
}

function modeError(input, _projectRoot) {
  const errorInfo = extractErrorInfo(input);
  const diagnosis = [];

  if (errorInfo.errorMessage.includes("ECONNREFUSED")) {
    const portMatch = errorInfo.errorMessage.match(/:(\d+)/);
    diagnosis.push({
      category: "connection",
      detail:
        "Connection refused on port " + (portMatch ? portMatch[1] : "unknown"),
      possibleCauses: [
        "Target service is not running",
        "Wrong host or port configured",
        "Firewall blocking the connection",
      ],
    });
  } else if (errorInfo.errorMessage.includes("ENOENT")) {
    const pathMatch = errorInfo.errorMessage.match(/['"]([^'"]+)['"]/);
    diagnosis.push({
      category: "filesystem",
      detail:
        "File or directory not found: " +
        (pathMatch ? pathMatch[1] : "unknown path"),
      possibleCauses: [
        "File was deleted or moved",
        "Path is misspelled",
        "Working directory is incorrect",
      ],
    });
  } else if (
    errorInfo.errorMessage.includes("ENOMEM") ||
    errorInfo.errorMessage.includes("heap")
  ) {
    diagnosis.push({
      category: "memory",
      detail: "Out of memory or heap allocation failure",
      possibleCauses: [
        "Memory leak in application",
        "Data set too large for available memory",
        "Need to increase --max-old-space-size",
      ],
    });
  } else if (
    errorInfo.errorType === "TypeError" ||
    errorInfo.errorType === "ReferenceError"
  ) {
    diagnosis.push({
      category: "code",
      detail: errorInfo.errorType + ": " + errorInfo.errorMessage,
      possibleCauses: [
        "Accessing property on null/undefined value",
        "Variable not declared or out of scope",
        "Wrong function signature or argument count",
      ],
    });
  } else {
    diagnosis.push({
      category: "general",
      detail: errorInfo.errorMessage,
      possibleCauses: [
        "Check application logs for full stack trace",
        "Run with --trace flag for detailed diagnosis",
      ],
    });
  }

  let suggestedFix =
    ERROR_FIX_MAP[errorInfo.errorType] ||
    "Provide the full stack trace for more precise fault localization";
  const keys = Object.keys(ERROR_FIX_MAP);
  for (let k = 0; k < keys.length; k++) {
    if (errorInfo.errorMessage.includes(keys[k])) {
      suggestedFix = ERROR_FIX_MAP[keys[k]];
      break;
    }
  }

  return {
    success: true,
    result: {
      errorType: errorInfo.errorType,
      errorMessage: errorInfo.errorMessage,
      diagnosis: diagnosis,
      suggestedFix: suggestedFix,
      tip: "For more precise localization, use --trace mode with the full stack trace",
    },
    message:
      "Error diagnosis: " +
      errorInfo.errorType +
      " - " +
      errorInfo.errorMessage +
      ". " +
      suggestedFix,
  };
}

// ── Argument Parser ────────────────────────────────────────────────

function parseArgs(input) {
  const args = {
    mode: "trace",
    input: "",
    contextLines: DEFAULT_CONTEXT_LINES,
  };
  if (!input) {
    return args;
  }

  if (input.includes("--test")) {
    args.mode = "test";
    input = input.replace("--test", "").trim();
  } else if (input.includes("--error")) {
    args.mode = "error";
    input = input.replace("--error", "").trim();
  } else if (input.includes("--trace")) {
    args.mode = "trace";
    input = input.replace("--trace", "").trim();
  }

  const ctxMatch = input.match(/--context-lines\s+(\d+)/);
  if (ctxMatch) {
    args.contextLines = parseInt(ctxMatch[1], 10);
    input = input.replace(ctxMatch[0], "").trim();
  }

  args.input = input.replace(/^["']|["']$/g, "");
  return args;
}

// ── Handler ────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      '[fault-localizer] handler initialized for "' +
        ((_skill && _skill.name) || "fault-localizer") +
        '"',
    );
  },

  async execute(task, context, _skill) {
    const rawInput = (
      (task && task.params && task.params.input) ||
      (task && task.input) ||
      (task && task.action) ||
      ""
    ).trim();
    const projectRoot =
      (context && context.projectRoot) ||
      (context && context.workspaceRoot) ||
      (context && context.workspacePath) ||
      process.cwd();
    const args = parseArgs(rawInput);

    if (!args.input) {
      return {
        success: false,
        error: "No input provided",
        message:
          "Please provide an error stack trace, test output, or error message to analyze.",
      };
    }

    logger.info(
      "[fault-localizer] mode=" +
        args.mode +
        ", input length=" +
        args.input.length,
    );

    try {
      switch (args.mode) {
        case "test":
          return modeTest(args.input, projectRoot, args.contextLines);
        case "error":
          return modeError(args.input, projectRoot);
        case "trace":
        default:
          return modeTrace(args.input, projectRoot, args.contextLines);
      }
    } catch (err) {
      logger.error("[fault-localizer] execution error: " + err.message);
      return {
        success: false,
        error: err.message,
        message: "Fault localization failed: " + err.message,
      };
    }
  },
};
