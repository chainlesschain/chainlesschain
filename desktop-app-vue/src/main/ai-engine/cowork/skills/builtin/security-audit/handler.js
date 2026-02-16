/**
 * Security Audit Skill Handler
 *
 * Scans source code for OWASP Top 10 patterns, hardcoded secrets,
 * and insecure coding practices. Generates risk-rated reports.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
  "vendor",
]);
const CODE_EXTS = new Set([
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "vue",
  "py",
  "java",
  "kt",
]);

// Secret patterns (regex + severity)
const SECRET_PATTERNS = [
  {
    name: "AWS Access Key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: "critical",
  },
  {
    name: "AWS Secret Key",
    pattern: /(?:aws_secret|AWS_SECRET)[^=]*=\s*['"]([A-Za-z0-9/+=]{40})['"]/g,
    severity: "critical",
  },
  {
    name: "Generic API Key",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]([a-zA-Z0-9_-]{20,})['"]/gi,
    severity: "high",
  },
  {
    name: "Generic Secret",
    pattern: /(?:secret|password|passwd|token)\s*[:=]\s*['"]([^'"]{8,})['"]/gi,
    severity: "high",
  },
  {
    name: "Private Key",
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    severity: "critical",
  },
  {
    name: "JWT Token",
    pattern:
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    severity: "high",
  },
  {
    name: "Hardcoded IP",
    pattern: /['"](\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})['"]/g,
    severity: "low",
  },
];

// OWASP patterns
const OWASP_PATTERNS = [
  {
    name: "SQL Injection",
    pattern: /(?:query|exec|execute)\s*\(\s*[`'"].*?\$\{/g,
    severity: "critical",
    owasp: "A03:2021",
  },
  {
    name: "SQL Injection (concat)",
    pattern: /(?:query|exec)\s*\(.*?\+\s*(?:req|input|params)/g,
    severity: "critical",
    owasp: "A03:2021",
  },
  {
    name: "XSS (innerHTML)",
    pattern: /\.innerHTML\s*=\s*(?!['"]<)/g,
    severity: "high",
    owasp: "A07:2021",
  },
  {
    name: "XSS (v-html)",
    pattern: /v-html\s*=\s*"/g,
    severity: "moderate",
    owasp: "A07:2021",
  },
  {
    name: "Eval Usage",
    pattern: /\beval\s*\(/g,
    severity: "high",
    owasp: "A03:2021",
  },
  {
    name: "Exec Command Injection",
    pattern: /(?:exec|execSync|spawn)\s*\(.*?\$\{/g,
    severity: "critical",
    owasp: "A03:2021",
  },
  {
    name: "No CSRF Protection",
    pattern: /app\.(?:post|put|delete)\s*\(/g,
    severity: "moderate",
    owasp: "A01:2021",
  },
  {
    name: "Insecure Random",
    pattern: /Math\.random\s*\(\)/g,
    severity: "low",
    owasp: "A02:2021",
  },
  {
    name: "Disabled Security",
    pattern: /(?:rejectUnauthorized|verify)\s*:\s*false/g,
    severity: "high",
    owasp: "A02:2021",
  },
  {
    name: "Hardcoded Credentials",
    pattern: /(?:username|user)\s*[:=]\s*['"](?:admin|root|test)['"]/gi,
    severity: "moderate",
    owasp: "A07:2021",
  },
];

module.exports = {
  async init(skill) {
    logger.info("[SecurityAudit] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[SecurityAudit] Scanning: ${options.targetDir}`);

    try {
      switch (action) {
        case "secrets":
          return await handleSecrets(options.targetDir);
        case "owasp":
          return await handleOWASP(options.targetDir);
        default:
          return await handleFullAudit(options.targetDir);
      }
    } catch (error) {
      logger.error(`[SecurityAudit] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Security audit failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = { targetDir: context.workspacePath || process.cwd() };
  let action = "full";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--secrets") {
      action = "secrets";
    } else if (p === "--owasp") {
      action = "owasp";
    } else if (p && !p.startsWith("-")) {
      const resolved = path.resolve(options.targetDir, p);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        options.targetDir = resolved;
      }
    }
  }

  return { action, options };
}

function collectFiles(dir, maxDepth = 6, depth = 0) {
  const files = [];
  if (depth > maxDepth || !fs.existsSync(dir)) {
    return files;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !IGNORE_DIRS.has(entry.name) &&
      !entry.name.startsWith(".")
    ) {
      files.push(
        ...collectFiles(path.join(dir, entry.name), maxDepth, depth + 1),
      );
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1);
      if (CODE_EXTS.has(ext)) {
        files.push(path.join(dir, entry.name));
      }
      if (files.length >= 300) {
        return files;
      }
    }
  }
  return files;
}

function scanPatterns(content, patterns, filePath, baseDir) {
  const findings = [];
  const relPath = path.relative(baseDir, filePath);

  for (const p of patterns) {
    // Reset regex lastIndex
    if (p.pattern.global) {
      p.pattern.lastIndex = 0;
    }

    let m;
    while ((m = p.pattern.exec(content)) !== null) {
      const line = content.substring(0, m.index).split("\n").length;
      // Skip test files and comments
      if (relPath.includes("test") || relPath.includes("spec")) {
        continue;
      }

      findings.push({
        rule: p.name,
        severity: p.severity,
        owasp: p.owasp || null,
        file: relPath,
        line,
        snippet: content.split("\n")[line - 1]?.trim().substring(0, 80) || "",
      });

      // Limit findings per pattern per file
      if (
        findings.filter((f) => f.rule === p.name && f.file === relPath)
          .length >= 5
      ) {
        break;
      }
    }
  }

  return findings;
}

async function handleSecrets(targetDir) {
  const files = collectFiles(targetDir);
  const allFindings = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const findings = scanPatterns(content, SECRET_PATTERNS, file, targetDir);
    allFindings.push(...findings);
  }

  const report = formatReport(
    "Secret Detection Report",
    allFindings,
    files.length,
  );
  return {
    success: true,
    result: { findings: allFindings, fileCount: files.length },
    message: report,
  };
}

async function handleOWASP(targetDir) {
  const files = collectFiles(targetDir);
  const allFindings = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const findings = scanPatterns(content, OWASP_PATTERNS, file, targetDir);
    allFindings.push(...findings);
  }

  const report = formatReport(
    "OWASP Security Report",
    allFindings,
    files.length,
  );
  return {
    success: true,
    result: { findings: allFindings, fileCount: files.length },
    message: report,
  };
}

async function handleFullAudit(targetDir) {
  const files = collectFiles(targetDir);
  const allFindings = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    allFindings.push(
      ...scanPatterns(content, SECRET_PATTERNS, file, targetDir),
    );
    allFindings.push(...scanPatterns(content, OWASP_PATTERNS, file, targetDir));
  }

  const report = formatReport(
    "Full Security Audit Report",
    allFindings,
    files.length,
  );
  return {
    success: true,
    result: { findings: allFindings, fileCount: files.length },
    message: report,
  };
}

function formatReport(title, findings, fileCount) {
  const bySeverity = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const f of findings) {
    if (bySeverity[f.severity] !== undefined) {
      bySeverity[f.severity]++;
    }
  }

  const sorted = findings.sort((a, b) => {
    const order = { critical: 0, high: 1, moderate: 2, low: 3 };
    return (order[a.severity] || 4) - (order[b.severity] || 4);
  });

  return (
    `${title}\n${"=".repeat(title.length)}\n` +
    `Files scanned: ${fileCount}\n` +
    `Findings: ${findings.length}\n` +
    `  Critical: ${bySeverity.critical}, High: ${bySeverity.high}, Moderate: ${bySeverity.moderate}, Low: ${bySeverity.low}\n\n` +
    (sorted.length > 0
      ? sorted
          .slice(0, 50)
          .map((f) => {
            const icon =
              f.severity === "critical"
                ? "🔴"
                : f.severity === "high"
                  ? "🟠"
                  : f.severity === "moderate"
                    ? "🟡"
                    : "🔵";
            return `${icon} [${f.severity.toUpperCase()}] ${f.rule}${f.owasp ? ` (${f.owasp})` : ""}\n   ${f.file}:${f.line}\n   ${f.snippet}`;
          })
          .join("\n\n")
      : "✅ No security issues found.") +
    `\n\nNote: This is a static pattern-based scan. Manual review is recommended for critical findings.`
  );
}
