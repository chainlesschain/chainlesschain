/**
 * Research Agent Skill Handler
 *
 * Technical research assistant that compares libraries, solves errors,
 * evaluates dependencies, and searches local documentation.
 * Modes: --compare, --solve, --evaluate, --docs
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Known error patterns ────────────────────────────────────────────

const ERROR_PATTERNS = {
  ECONNREFUSED: {
    cause: "Connection refused -- target service is not running or unreachable",
    solutions: [
      "Check if the target service/server is running",
      "Verify the host and port are correct",
      "Check firewall rules and network connectivity",
      "For databases: ensure the service is started (pg_isready, redis-cli ping)",
    ],
  },
  ENOENT: {
    cause: "File or directory not found",
    solutions: [
      "Verify the file path is correct (check for typos)",
      "Ensure parent directories exist (mkdir -p)",
      "Check file permissions (ls -la)",
      "On Windows: check path length limits and use forward slashes",
    ],
  },
  MODULE_NOT_FOUND: {
    cause: "Required Node.js module is not installed",
    solutions: [
      "Run: npm install <missing-module>",
      "Check if node_modules exists (run npm install)",
      "Verify package name spelling in require/import",
      "Check NODE_PATH environment variable",
    ],
  },
  ERR_MODULE_NOT_FOUND: {
    cause: "ES module resolution failed",
    solutions: [
      "Ensure file extension is included in import path",
      "Check that type=module is set in package.json for ESM",
      "Verify the module exports field in the target package.json",
      "Use .mjs extension for ES modules or .cjs for CommonJS",
    ],
  },
  EADDRINUSE: {
    cause: "Port is already in use by another process",
    solutions: [
      "Find the process: lsof -i :<port> or netstat -ano | findstr :<port>",
      "Kill the process: kill -9 <PID>",
      "Use a different port via environment variable",
      "On dev: check for zombie processes from previous runs",
    ],
  },
  EPERM: {
    cause: "Operation not permitted -- insufficient permissions",
    solutions: [
      "Run with elevated privileges (sudo on Unix, Admin on Windows)",
      "Check file ownership and permissions (chmod/chown)",
      "On Windows: close any programs locking the file",
      "For npm: try npm cache clean --force",
    ],
  },
  ETIMEOUT: {
    cause: "Operation timed out",
    solutions: [
      "Check network connectivity (ping, curl)",
      "Increase timeout value in configuration",
      "Check if DNS resolution is working (nslookup)",
      "For npm: set registry to a faster mirror",
    ],
  },
  ENOMEM: {
    cause: "Out of memory",
    solutions: [
      "Increase Node.js heap size: node --max-old-space-size=4096",
      "Check for memory leaks (use --inspect and Chrome DevTools)",
      "Process data in streams/chunks instead of loading all at once",
      "Close unused connections and clear caches",
    ],
  },
  EACCES: {
    cause: "Permission denied",
    solutions: [
      "Check file/directory permissions (ls -la, chmod)",
      "For npm global install: fix npm permissions or use nvm",
      "On macOS: check System Preferences > Security",
      "Avoid running npm with sudo (fix ownership instead)",
    ],
  },
  CERT_HAS_EXPIRED: {
    cause: "SSL/TLS certificate has expired",
    solutions: [
      "Update CA certificates on the system",
      "Set NODE_TLS_REJECT_UNAUTHORIZED=0 (dev only, INSECURE)",
      "Update the target server certificate",
      "Check system clock (incorrect time causes cert failures)",
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

function readPackageJson(projectRoot) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
    );
  } catch (_e) {
    return null;
  }
}

function getInstalledPackageInfo(projectRoot, packageName) {
  const pkgPath = path.join(
    projectRoot,
    "node_modules",
    packageName,
    "package.json",
  );
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description || "(none)",
      license: pkg.license || "unknown",
      homepage: pkg.homepage || null,
      repository:
        typeof pkg.repository === "string"
          ? pkg.repository
          : pkg.repository?.url || null,
      dependencies: Object.keys(pkg.dependencies || {}).length,
      devDependencies: Object.keys(pkg.devDependencies || {}).length,
      main: pkg.main || pkg.exports || "index.js",
      engines: pkg.engines || null,
      lastModified: fs.statSync(pkgPath).mtime.toISOString().split("T")[0],
    };
  } catch (_e) {
    return null;
  }
}

function npmInfo(packageName) {
  try {
    const raw = execSync("npm view " + packageName + " --json 2>/dev/null", {
      encoding: "utf-8",
      timeout: 15000,
    });
    const data = JSON.parse(raw);
    return {
      name: data.name,
      version: data["dist-tags"]?.latest || data.version,
      description: data.description || "(none)",
      license: data.license || "unknown",
      homepage: data.homepage || null,
      dependencies: Object.keys(data.dependencies || {}).length,
      maintainers: (data.maintainers || []).length,
      modified: data.time?.modified || null,
    };
  } catch (_e) {
    return null;
  }
}

function searchProjectFiles(projectRoot, topic, maxResults) {
  maxResults = maxResults || 20;
  const results = [];
  const topicRe = new RegExp(
    topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi",
  );
  const ignoreDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    "__pycache__",
  ]);
  const validExts = new Set([
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".vue",
    ".md",
    ".json",
  ]);

  function walk(dir, depth) {
    if (results.length >= maxResults || depth > 6) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const ent of entries) {
      if (results.length >= maxResults) {
        return;
      }
      if (ignoreDirs.has(ent.name)) {
        continue;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!validExts.has(path.extname(ent.name).toLowerCase())) {
        continue;
      }
      try {
        const content = fs.readFileSync(full, "utf-8");
        const lines = content.split("\n");
        const matchingLines = [];
        for (let i = 0; i < lines.length && matchingLines.length < 3; i++) {
          if (topicRe.test(lines[i])) {
            matchingLines.push({
              line: i + 1,
              text: lines[i].trim().substring(0, 120),
            });
            topicRe.lastIndex = 0;
          }
        }
        if (matchingLines.length > 0) {
          results.push({
            file: path.relative(projectRoot, full),
            matches: matchingLines,
          });
        }
      } catch (_e) {
        /* skip */
      }
    }
  }
  walk(projectRoot, 0);
  return results;
}

// ── Mode handlers ───────────────────────────────────────────────────

function handleCompare(args, projectRoot) {
  if (args.length < 2) {
    return {
      success: false,
      error:
        "Need two library names. Usage: /research-agent --compare <lib1> <lib2>",
    };
  }
  const lib1 = args[0],
    lib2 = args[1];
  const info1 = getInstalledPackageInfo(projectRoot, lib1) || npmInfo(lib1);
  const info2 = getInstalledPackageInfo(projectRoot, lib2) || npmInfo(lib2);
  const fields = [
    "version",
    "license",
    "description",
    "dependencies",
    "homepage",
  ];
  const comparison = {};
  for (const field of fields) {
    comparison[field] = {};
    comparison[field][lib1] = info1
      ? info1[field] !== undefined
        ? info1[field]
        : "N/A"
      : "not found";
    comparison[field][lib2] = info2
      ? info2[field] !== undefined
        ? info2[field]
        : "N/A"
      : "not found";
  }
  const rootPkg = readPackageJson(projectRoot);
  const allDeps = Object.assign(
    {},
    rootPkg?.dependencies || {},
    rootPkg?.devDependencies || {},
  );
  comparison.inProject = {};
  comparison.inProject[lib1] =
    lib1 in allDeps ? "yes (" + allDeps[lib1] + ")" : "no";
  comparison.inProject[lib2] =
    lib2 in allDeps ? "yes (" + allDeps[lib2] + ")" : "no";
  const recommendations = [];
  if (info1 && info2) {
    if ((info1.dependencies || 0) < (info2.dependencies || 0)) {
      recommendations.push(
        lib1 + " has fewer dependencies (lighter footprint)",
      );
    } else if ((info2.dependencies || 0) < (info1.dependencies || 0)) {
      recommendations.push(
        lib2 + " has fewer dependencies (lighter footprint)",
      );
    }
    recommendations.push(
      "Check bundle size at bundlephobia.com for both packages",
    );
    recommendations.push(
      "Review GitHub stars, issues, and recent commit activity",
    );
  }
  let msg =
    "Library Comparison: " +
    lib1 +
    " vs " +
    lib2 +
    "\n" +
    "=".repeat(50) +
    "\n";
  for (const field of fields) {
    msg +=
      "  " +
      field.padEnd(14) +
      " " +
      String(comparison[field][lib1]).padEnd(28) +
      " " +
      comparison[field][lib2] +
      "\n";
  }
  msg +=
    "  " +
    "In project".padEnd(14) +
    " " +
    String(comparison.inProject[lib1]).padEnd(28) +
    " " +
    comparison.inProject[lib2] +
    "\n";
  msg +=
    "\nRecommendations:\n" +
    recommendations
      .map(function (r) {
        return "  - " + r;
      })
      .join("\n");
  return {
    success: true,
    result: {
      query: "compare " + lib1 + " vs " + lib2,
      mode: "compare",
      results: comparison,
      recommendations,
      searchQueries: [
        lib1 + " vs " + lib2 + " comparison",
        "npm " + lib1 + " " + lib2 + " benchmark",
      ],
    },
    message: msg,
  };
}

function handleSolve(args) {
  const errorText = args.join(" ");
  if (!errorText) {
    return {
      success: false,
      error:
        "No error message provided. Usage: /research-agent --solve <error message>",
    };
  }
  const matchedPatterns = [];
  for (const [code, info] of Object.entries(ERROR_PATTERNS)) {
    if (errorText.toUpperCase().includes(code)) {
      matchedPatterns.push(Object.assign({ code }, info));
    }
  }
  const keyTerms = errorText
    .replace(/[^a-zA-Z0-9_.\-:/ ]/g, " ")
    .split(/\s+/)
    .filter(function (t) {
      return t.length > 2;
    })
    .filter(function (t) {
      return !["the", "and", "for", "error", "from", "with", "not"].includes(
        t.toLowerCase(),
      );
    });
  const searchQueries = [
    errorText.substring(0, 80) + " site:stackoverflow.com",
    "node.js " + keyTerms.slice(0, 4).join(" ") + " fix",
    keyTerms.slice(0, 3).join(" ") + " github issue",
  ];
  const solutions =
    matchedPatterns.length > 0
      ? matchedPatterns.reduce(function (acc, p) {
          return acc.concat(p.solutions);
        }, [])
      : [
          "Search for the exact error message online",
          "Check documentation of the failing module/service",
          "Verify environment variables and configuration",
          "Try clearing caches: npm cache clean --force, delete node_modules and reinstall",
          "Check for version incompatibilities in package.json",
        ];
  let msg =
    "Error Analysis: " +
    errorText.substring(0, 100) +
    "\n" +
    "=".repeat(50) +
    "\n";
  if (matchedPatterns.length > 0) {
    msg +=
      "Matched patterns:\n" +
      matchedPatterns
        .map(function (p) {
          return "  [" + p.code + "] " + p.cause;
        })
        .join("\n") +
      "\n\n";
  } else {
    msg += "No exact pattern matched. General solutions:\n\n";
  }
  msg +=
    "Solutions:\n" +
    solutions
      .map(function (s, i) {
        return "  " + (i + 1) + ". " + s;
      })
      .join("\n");
  msg +=
    "\n\nSearch queries:\n" +
    searchQueries
      .map(function (q) {
        return "  - " + q;
      })
      .join("\n");
  return {
    success: true,
    result: {
      query: errorText,
      mode: "solve",
      results: { matchedPatterns, keyTerms: keyTerms.slice(0, 10) },
      recommendations: solutions,
      searchQueries,
    },
    message: msg,
  };
}

function handleEvaluate(args, projectRoot) {
  const libName = args[0];
  if (!libName) {
    return {
      success: false,
      error:
        "No library name provided. Usage: /research-agent --evaluate <library>",
    };
  }
  const localInfo = getInstalledPackageInfo(projectRoot, libName);
  const remoteInfo = npmInfo(libName);
  const info = localInfo || remoteInfo;
  const rootPkg = readPackageJson(projectRoot);
  const allDeps = Object.assign(
    {},
    rootPkg?.dependencies || {},
    rootPkg?.devDependencies || {},
  );
  const inProject = libName in allDeps;
  const projectVersion = allDeps[libName] || null;
  let vulnerabilities = null;
  if (inProject) {
    try {
      const auditRaw = execSync("npm audit --json 2>/dev/null", {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 20000,
      });
      const audit = JSON.parse(auditRaw);
      const vulns = audit.vulnerabilities?.[libName];
      if (vulns) {
        vulnerabilities = {
          severity: vulns.severity,
          via: (vulns.via || [])
            .map(function (v) {
              return typeof v === "string" ? v : v.title;
            })
            .slice(0, 5),
          fixAvailable: vulns.fixAvailable || false,
        };
      }
    } catch (_e) {
      /* audit unavailable */
    }
  }
  const recommendations = [];
  if (!info) {
    recommendations.push(
      'Package "' + libName + '" not found. Check spelling or npm registry.',
    );
  } else {
    if (inProject && remoteInfo && localInfo) {
      if (localInfo.version !== remoteInfo.version) {
        recommendations.push(
          "Update available: " +
            localInfo.version +
            " -> " +
            remoteInfo.version,
        );
      } else {
        recommendations.push("You are on the latest version");
      }
    }
    if (vulnerabilities) {
      recommendations.push(
        "Security: " +
          vulnerabilities.severity +
          " severity vulnerability found",
      );
    } else if (inProject) {
      recommendations.push("No known vulnerabilities detected");
    }
    if (info.dependencies > 30) {
      recommendations.push(
        "Heavy dependency tree -- consider lighter alternatives",
      );
    }
  }
  let msg =
    "Library Evaluation: " +
    libName +
    "\n" +
    "=".repeat(30 + libName.length) +
    "\n";
  if (info) {
    msg +=
      "Version: " +
      info.version +
      "\nLicense: " +
      info.license +
      "\nDescription: " +
      info.description +
      "\nDependencies: " +
      info.dependencies +
      "\nHomepage: " +
      (info.homepage || "N/A") +
      "\nIn project: " +
      (inProject ? "yes (" + projectVersion + ")" : "no") +
      "\n";
  } else {
    msg += "Package not found in npm registry.\n";
  }
  if (vulnerabilities) {
    msg +=
      "Vulnerabilities: " +
      vulnerabilities.severity +
      " (" +
      vulnerabilities.via.join(", ") +
      ")\n";
  }
  msg +=
    "\nRecommendations:\n" +
    recommendations
      .map(function (r) {
        return "  - " + r;
      })
      .join("\n");
  return {
    success: true,
    result: {
      query: libName,
      mode: "evaluate",
      results: {
        packageInfo: info,
        inProject,
        projectVersion,
        vulnerabilities,
      },
      recommendations,
      searchQueries: [
        libName + " npm alternatives",
        libName + " security vulnerabilities",
        libName + " bundle size performance",
      ],
    },
    message: msg,
  };
}

function handleDocs(args, projectRoot) {
  const topic = args.join(" ");
  if (!topic) {
    return {
      success: false,
      error: "No topic provided. Usage: /research-agent --docs <topic>",
    };
  }
  const results = searchProjectFiles(projectRoot, topic);
  const searchQueries = [
    topic + " documentation",
    topic + " tutorial example",
    topic + " site:developer.mozilla.org OR site:nodejs.org",
  ];
  let msg =
    "Documentation Search: " +
    topic +
    "\n" +
    "=".repeat(25 + topic.length) +
    "\n";
  if (results.length > 0) {
    msg += "Found " + results.length + " local references:\n\n";
    results.slice(0, 15).forEach(function (r) {
      msg += "  " + r.file + "\n";
      r.matches.forEach(function (m) {
        msg += "    L" + m.line + ": " + m.text + "\n";
      });
      msg += "\n";
    });
  } else {
    msg += 'No local references found for "' + topic + '".\n';
  }
  msg +=
    "\nSearch queries for more info:\n" +
    searchQueries
      .map(function (q) {
        return "  - " + q;
      })
      .join("\n");
  return {
    success: true,
    result: {
      query: topic,
      mode: "docs",
      results: { localReferences: results, referenceCount: results.length },
      recommendations:
        results.length > 0
          ? ["Found " + results.length + ' local references to "' + topic + '"']
          : ['No local references found for "' + topic + '". Search online.'],
      searchQueries,
    },
    message: msg,
  };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info("[research-agent] init: " + (_skill?.name || "research-agent"));
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();
    const compareMatch = input.match(/--compare\s+(.+)/i);
    const solveMatch = input.match(/--solve\s+(.+)/i);
    const evaluateMatch = input.match(/--evaluate\s+(\S+)/i);
    const docsMatch = input.match(/--docs\s+(.+)/i);

    try {
      if (compareMatch) {
        return handleCompare(compareMatch[1].trim().split(/\s+/), projectRoot);
      }
      if (solveMatch) {
        return handleSolve(solveMatch[1].trim().split(/\s+/));
      }
      if (evaluateMatch) {
        return handleEvaluate([evaluateMatch[1].trim()], projectRoot);
      }
      if (docsMatch) {
        return handleDocs([docsMatch[1].trim()], projectRoot);
      }

      // No mode specified -- try to infer
      if (input) {
        if (/error|exception|cannot|failed|refused|denied/i.test(input)) {
          return handleSolve(input.split(/\s+/));
        }
        return handleDocs([input], projectRoot);
      }

      return {
        success: false,
        error:
          "No mode specified. Usage: /research-agent --compare <a> <b> | --solve <error> | --evaluate <lib> | --docs <topic>",
      };
    } catch (err) {
      logger.error("[research-agent] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Research agent failed: " + err.message,
      };
    }
  },
};
