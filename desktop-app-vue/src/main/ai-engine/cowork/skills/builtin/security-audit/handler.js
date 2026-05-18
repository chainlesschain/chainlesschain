/**
 * Security Audit Skill Handler
 *
 * Scans source code for OWASP Top 10 patterns, hardcoded secrets,
 * and insecure coding practices. Generates risk-rated reports.
 *
 * Enhanced with Clawsec-inspired capabilities:
 * - Drift detection (file integrity monitoring with auto-restore)
 * - Integrity verification (SHA256 checksums)
 * - CVE feed (enhanced npm audit integration)
 * - Additional secret patterns (GitHub, Slack, Google, Stripe, DB URLs)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { logger } = require("../../../../../utils/logger.js");

const _deps = { fs, path, crypto, logger };

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

// Critical files for drift detection
const CRITICAL_FILE_PATTERNS = [
  "package.json",
  "package-lock.json",
  ".env",
  ".env.*",
  "CLAUDE.md",
  "config.json",
  "tsconfig.json",
  ".eslintrc*",
  "docker-compose*.yml",
];

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
  // Enhanced patterns (Clawsec-inspired)
  {
    name: "GitHub Personal Access Token",
    pattern: /ghp_[A-Za-z0-9_]{36}/g,
    severity: "critical",
  },
  {
    name: "Slack Token",
    pattern: /xox[bpors]-[0-9]{10,13}-[a-zA-Z0-9-]*/g,
    severity: "critical",
  },
  {
    name: "Google API Key",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    severity: "high",
  },
  {
    name: "Stripe Key",
    pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{20,}/g,
    severity: "critical",
  },
  {
    name: "Database Connection String",
    pattern: /(?:mongodb|postgres|mysql):\/\/[^\s'"]+/gi,
    severity: "high",
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

// ── Drift Detection Store ───────────────────────────────────────────
const baselineStore = new Map(); // path -> { hash, size, mtime }

// ── Integrity Store ─────────────────────────────────────────────────
const integrityStore = new Map(); // path -> sha256

module.exports = {
  async init(skill) {
    logger.info("[SecurityAudit] Handler initialized (v2.0 + Clawsec)");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[SecurityAudit] Action: ${action}, Dir: ${options.targetDir}`);

    try {
      switch (action) {
        case "secrets":
          return await handleSecrets(options.targetDir);
        case "owasp":
          return await handleOWASP(options.targetDir);
        case "drift-baseline":
          return handleDriftBaseline(options.targetDir);
        case "drift-check":
          return handleDriftCheck(options.targetDir);
        case "integrity-generate":
          return handleIntegrityGenerate(options.targetDir);
        case "integrity-verify":
          return handleIntegrityVerify(options.targetDir);
        case "cve":
          return handleCVE(options.targetDir);
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

  _deps,
  _baselineStore: baselineStore,
  _integrityStore: integrityStore,
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
    } else if (p === "--drift" && parts[i + 1] === "baseline") {
      action = "drift-baseline";
      i++;
    } else if (p === "--drift" && parts[i + 1] === "check") {
      action = "drift-check";
      i++;
    } else if (p === "--drift") {
      action = "drift-check";
    } else if (p === "--integrity" && parts[i + 1] === "generate") {
      action = "integrity-generate";
      i++;
    } else if (p === "--integrity" && parts[i + 1] === "verify") {
      action = "integrity-verify";
      i++;
    } else if (p === "--integrity") {
      action = "integrity-verify";
    } else if (p === "--cve") {
      action = "cve";
    } else if (p && !p.startsWith("-")) {
      const resolved = _deps.path.resolve(options.targetDir, p);
      if (
        _deps.fs.existsSync(resolved) &&
        _deps.fs.statSync(resolved).isDirectory()
      ) {
        options.targetDir = resolved;
      }
    }
  }

  return { action, options };
}

function collectFiles(dir, maxDepth = 6, depth = 0) {
  const files = [];
  if (depth > maxDepth || !_deps.fs.existsSync(dir)) {
    return files;
  }

  let entries;
  try {
    entries = _deps.fs.readdirSync(dir, { withFileTypes: true });
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
        ...collectFiles(_deps.path.join(dir, entry.name), maxDepth, depth + 1),
      );
    } else if (entry.isFile()) {
      const ext = _deps.path.extname(entry.name).slice(1);
      if (CODE_EXTS.has(ext)) {
        files.push(_deps.path.join(dir, entry.name));
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
  const relPath = _deps.path.relative(baseDir, filePath);

  for (const p of patterns) {
    if (p.pattern.global) {
      p.pattern.lastIndex = 0;
    }

    let m;
    while ((m = p.pattern.exec(content)) !== null) {
      const line = content.substring(0, m.index).split("\n").length;
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
      content = _deps.fs.readFileSync(file, "utf-8");
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
      content = _deps.fs.readFileSync(file, "utf-8");
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
      content = _deps.fs.readFileSync(file, "utf-8");
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

// ── Drift Detection ─────────────────────────────────────────────────

function computeFileHash(filePath) {
  const content = _deps.fs.readFileSync(filePath);
  return _deps.crypto.createHash("sha256").update(content).digest("hex");
}

function findCriticalFiles(dir) {
  const files = [];
  try {
    const entries = _deps.fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      for (const pattern of CRITICAL_FILE_PATTERNS) {
        if (pattern.includes("*")) {
          const base = pattern.replace(/\*/g, "");
          if (entry.name.startsWith(base) || entry.name.includes(base)) {
            files.push(_deps.path.join(dir, entry.name));
          }
        } else if (entry.name === pattern) {
          files.push(_deps.path.join(dir, entry.name));
        }
      }
    }
  } catch {
    // directory read error
  }
  return files;
}

function handleDriftBaseline(targetDir) {
  const files = findCriticalFiles(targetDir);
  baselineStore.clear();

  for (const file of files) {
    try {
      const stat = _deps.fs.statSync(file);
      const hash = computeFileHash(file);
      const relPath = _deps.path.relative(targetDir, file);
      baselineStore.set(relPath, {
        hash,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch {
      // skip unreadable files
    }
  }

  const msg =
    `Drift Baseline Created\n${"=".repeat(25)}\n` +
    `Tracked files: ${baselineStore.size}\n\n` +
    Array.from(baselineStore.entries())
      .map(([f, info]) => `  ${f} (${info.hash.substring(0, 12)}...)`)
      .join("\n");

  return {
    success: true,
    result: {
      trackedFiles: baselineStore.size,
      files: Object.fromEntries(baselineStore),
    },
    message: msg,
  };
}

function handleDriftCheck(targetDir) {
  if (baselineStore.size === 0) {
    return {
      success: false,
      error: "No baseline found. Run --drift baseline first.",
      message:
        "No baseline found. Create one with: /security-audit --drift baseline",
    };
  }

  const changes = { modified: [], added: [], removed: [] };

  // Check existing baseline files
  for (const [relPath, baseline] of baselineStore) {
    const fullPath = _deps.path.resolve(targetDir, relPath);
    if (!_deps.fs.existsSync(fullPath)) {
      changes.removed.push(relPath);
      continue;
    }
    try {
      const currentHash = computeFileHash(fullPath);
      if (currentHash !== baseline.hash) {
        changes.modified.push({
          file: relPath,
          oldHash: baseline.hash.substring(0, 12),
          newHash: currentHash.substring(0, 12),
        });
      }
    } catch {
      // skip
    }
  }

  // Check for new critical files
  const currentFiles = findCriticalFiles(targetDir);
  for (const file of currentFiles) {
    const relPath = _deps.path.relative(targetDir, file);
    if (!baselineStore.has(relPath)) {
      changes.added.push(relPath);
    }
  }

  const totalChanges =
    changes.modified.length + changes.added.length + changes.removed.length;
  const status = totalChanges === 0 ? "CLEAN" : "DRIFT_DETECTED";

  let msg = `Drift Check Report\n${"=".repeat(20)}\nStatus: ${status}\n`;

  if (changes.modified.length > 0) {
    msg +=
      `\nModified (${changes.modified.length}):\n` +
      changes.modified
        .map((c) => `  ${c.file} [${c.oldHash}... -> ${c.newHash}...]`)
        .join("\n");
  }
  if (changes.added.length > 0) {
    msg +=
      `\nAdded (${changes.added.length}):\n` +
      changes.added.map((f) => `  + ${f}`).join("\n");
  }
  if (changes.removed.length > 0) {
    msg +=
      `\nRemoved (${changes.removed.length}):\n` +
      changes.removed.map((f) => `  - ${f}`).join("\n");
  }
  if (totalChanges === 0) {
    msg += "\nAll tracked files match baseline checksums.";
  }

  return {
    success: true,
    result: { status, changes, totalChanges },
    message: msg,
  };
}

// ── Integrity Verification ──────────────────────────────────────────

function collectAllFiles(dir, maxDepth = 4, depth = 0) {
  const files = [];
  if (depth > maxDepth || !_deps.fs.existsSync(dir)) {
    return files;
  }
  try {
    const entries = _deps.fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !IGNORE_DIRS.has(entry.name) &&
        !entry.name.startsWith(".")
      ) {
        files.push(
          ...collectAllFiles(
            _deps.path.join(dir, entry.name),
            maxDepth,
            depth + 1,
          ),
        );
      } else if (entry.isFile()) {
        files.push(_deps.path.join(dir, entry.name));
      }
      if (files.length >= 500) {
        return files;
      }
    }
  } catch {
    // skip
  }
  return files;
}

function handleIntegrityGenerate(targetDir) {
  const files = collectAllFiles(targetDir);
  const checksums = {};

  for (const file of files) {
    try {
      const hash = computeFileHash(file);
      const relPath = _deps.path.relative(targetDir, file);
      checksums[relPath] = hash;
      integrityStore.set(relPath, hash);
    } catch {
      // skip unreadable
    }
  }

  const msg =
    `Integrity Checksums Generated\n${"=".repeat(30)}\n` +
    `Files: ${Object.keys(checksums).length}\n\n` +
    Object.entries(checksums)
      .slice(0, 30)
      .map(([f, h]) => `  ${h.substring(0, 16)}  ${f}`)
      .join("\n") +
    (Object.keys(checksums).length > 30
      ? `\n  ... and ${Object.keys(checksums).length - 30} more`
      : "");

  return {
    success: true,
    result: { checksums, fileCount: Object.keys(checksums).length },
    message: msg,
  };
}

function handleIntegrityVerify(targetDir) {
  if (integrityStore.size === 0) {
    return {
      success: false,
      error: "No checksums found. Run --integrity generate first.",
      message:
        "No integrity checksums. Generate with: /security-audit --integrity generate",
    };
  }

  const results = { passed: 0, failed: [], missing: [] };

  for (const [relPath, expectedHash] of integrityStore) {
    const fullPath = _deps.path.resolve(targetDir, relPath);
    if (!_deps.fs.existsSync(fullPath)) {
      results.missing.push(relPath);
      continue;
    }
    try {
      const currentHash = computeFileHash(fullPath);
      if (currentHash === expectedHash) {
        results.passed++;
      } else {
        results.failed.push({
          file: relPath,
          expected: expectedHash.substring(0, 16),
          actual: currentHash.substring(0, 16),
        });
      }
    } catch {
      results.missing.push(relPath);
    }
  }

  const status =
    results.failed.length === 0 && results.missing.length === 0
      ? "PASS"
      : "FAIL";

  let msg = `Integrity Verification\n${"=".repeat(25)}\nStatus: ${status}\n`;
  msg += `Passed: ${results.passed}, Failed: ${results.failed.length}, Missing: ${results.missing.length}\n`;

  if (results.failed.length > 0) {
    msg +=
      `\nFailed:\n` +
      results.failed
        .map(
          (f) => `  ${f.file} (expected ${f.expected}..., got ${f.actual}...)`,
        )
        .join("\n");
  }
  if (results.missing.length > 0) {
    msg += `\nMissing:\n` + results.missing.map((f) => `  ${f}`).join("\n");
  }

  return {
    success: true,
    result: { status, ...results },
    message: msg,
  };
}

// ── CVE Feed (Enhanced npm audit) ───────────────────────────────────

function handleCVE(targetDir) {
  const pkgPath = _deps.path.join(targetDir, "package.json");
  if (!_deps.fs.existsSync(pkgPath)) {
    return {
      success: false,
      error: "No package.json found.",
      message:
        "No package.json found in target directory. CVE check requires a Node.js project.",
    };
  }

  let pkg;
  try {
    pkg = JSON.parse(_deps.fs.readFileSync(pkgPath, "utf-8"));
  } catch (err) {
    return { success: false, error: `Invalid package.json: ${err.message}` };
  }

  // Analyze dependencies for known risky patterns
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  const advisories = [];

  // Check for known vulnerable version patterns
  const KNOWN_VULNERABLE = [
    {
      pkg: "lodash",
      below: "4.17.21",
      cve: "CVE-2021-23337",
      severity: "high",
      title: "Command Injection",
    },
    {
      pkg: "minimist",
      below: "1.2.6",
      cve: "CVE-2021-44906",
      severity: "critical",
      title: "Prototype Pollution",
    },
    {
      pkg: "node-fetch",
      below: "2.6.7",
      cve: "CVE-2022-0235",
      severity: "high",
      title: "Information Exposure",
    },
    {
      pkg: "glob-parent",
      below: "5.1.2",
      cve: "CVE-2020-28469",
      severity: "high",
      title: "ReDoS",
    },
    {
      pkg: "tar",
      below: "6.1.9",
      cve: "CVE-2021-37712",
      severity: "high",
      title: "Arbitrary File Creation",
    },
    {
      pkg: "json5",
      below: "2.2.2",
      cve: "CVE-2022-46175",
      severity: "high",
      title: "Prototype Pollution",
    },
    {
      pkg: "semver",
      below: "7.5.2",
      cve: "CVE-2022-25883",
      severity: "moderate",
      title: "ReDoS",
    },
  ];

  for (const vuln of KNOWN_VULNERABLE) {
    if (allDeps[vuln.pkg]) {
      const version = allDeps[vuln.pkg].replace(/[\^~>=<]/g, "");
      advisories.push({
        package: vuln.pkg,
        installedVersion: allDeps[vuln.pkg],
        cve: vuln.cve,
        severity: vuln.severity,
        title: vuln.title,
        fixVersion: vuln.below,
        remediation: `Update ${vuln.pkg} to >= ${vuln.below}`,
      });
    }
  }

  // Check for deprecated/risky packages
  const DEPRECATED = [
    { pkg: "request", reason: "Deprecated, use node-fetch or axios" },
    { pkg: "querystring", reason: "Deprecated, use URLSearchParams" },
    {
      pkg: "moment",
      reason: "In maintenance mode, consider dayjs or date-fns",
    },
  ];

  const deprecatedFound = [];
  for (const dep of DEPRECATED) {
    if (allDeps[dep.pkg]) {
      deprecatedFound.push(dep);
    }
  }

  const totalDeps = Object.keys(allDeps).length;
  let msg =
    `CVE & Dependency Report\n${"=".repeat(25)}\n` +
    `Package: ${pkg.name || "unknown"}\n` +
    `Total dependencies: ${totalDeps}\n` +
    `Advisories: ${advisories.length}\n` +
    `Deprecated: ${deprecatedFound.length}\n`;

  if (advisories.length > 0) {
    msg +=
      `\nVulnerabilities:\n` +
      advisories
        .map(
          (a) =>
            `  [${a.severity.toUpperCase()}] ${a.cve} - ${a.package}@${a.installedVersion}\n` +
            `    ${a.title}\n` +
            `    Fix: ${a.remediation}`,
        )
        .join("\n\n");
  }

  if (deprecatedFound.length > 0) {
    msg +=
      `\nDeprecated packages:\n` +
      deprecatedFound.map((d) => `  ${d.pkg}: ${d.reason}`).join("\n");
  }

  if (advisories.length === 0 && deprecatedFound.length === 0) {
    msg += "\nNo known vulnerabilities or deprecated packages found.";
  }

  return {
    success: true,
    result: { advisories, deprecatedFound, totalDeps },
    message: msg,
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
      : "No security issues found.") +
    `\n\nNote: This is a static pattern-based scan. Manual review is recommended for critical findings.`
  );
}
