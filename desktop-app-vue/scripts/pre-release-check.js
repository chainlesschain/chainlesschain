#!/usr/bin/env node
/**
 * Pre-Release Checklist Validator
 *
 * This script validates that all necessary steps are completed before creating a release.
 *
 * Usage: node scripts/pre-release-check.js [version]
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const DESKTOP_APP_DIR = path.join(__dirname, "..");
const ROOT_DIR = path.join(__dirname, "../..");
const PACKAGE_JSON = require("../package.json");

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: options.silent ? "pipe" : "inherit",
      cwd: options.cwd || DESKTOP_APP_DIR,
      ...options,
    });
  } catch (error) {
    if (options.ignoreError) {
      return null;
    }
    return null;
  }
}

function checkPass(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
  passCount++;
}

function checkFail(message, details = "") {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
  if (details) {
    console.log(`  ${colors.red}→${colors.reset} ${details}`);
  }
  failCount++;
}

function checkWarn(message, details = "") {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
  if (details) {
    console.log(`  ${colors.yellow}→${colors.reset} ${details}`);
  }
  warnCount++;
}

function section(title) {
  console.log(`\n${colors.cyan}▶ ${title}${colors.reset}`);
}

console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║           Pre-Release Checklist Validator                ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

const targetVersion = process.argv[2] || `v${PACKAGE_JSON.version}`;
console.log(`${colors.blue}Target Version:${colors.reset} ${targetVersion}\n`);

// 1. Version Checks
section("Version Information");

const packageVersion = PACKAGE_JSON.version;
console.log(`  Package.json version: ${packageVersion}`);

if (targetVersion === `v${packageVersion}`) {
  checkPass("Version matches package.json");
} else {
  checkWarn(
    `Target version (${targetVersion}) differs from package.json (v${packageVersion})`,
  );
}

// 2. Git Status
section("Git Status");

const gitStatus = exec("git status --porcelain", {
  silent: true,
  cwd: ROOT_DIR,
});
if (!gitStatus || gitStatus.trim() === "") {
  checkPass("Working directory is clean");
} else {
  checkWarn(
    "Working directory has uncommitted changes",
    "Consider committing or stashing changes",
  );
}

// Check if on main/master branch
const currentBranch = exec("git branch --show-current", {
  silent: true,
  cwd: ROOT_DIR,
})?.trim();
if (currentBranch === "main" || currentBranch === "master") {
  checkPass(`On ${currentBranch} branch`);
} else {
  checkWarn(
    `Not on main/master branch (currently: ${currentBranch})`,
    "Releases are typically made from main/master",
  );
}

// 3. Dependencies
section("Dependencies");

const nodeModulesExists = fs.existsSync(
  path.join(DESKTOP_APP_DIR, "node_modules"),
);
if (nodeModulesExists) {
  checkPass("node_modules directory exists");
} else {
  checkFail("node_modules not found", "Run: npm install");
}

// Check for package-lock.json
const lockFileExists = fs.existsSync(
  path.join(DESKTOP_APP_DIR, "package-lock.json"),
);
if (lockFileExists) {
  checkPass("package-lock.json exists");
} else {
  checkWarn(
    "package-lock.json not found",
    "Consider creating lock file for consistent builds",
  );
}

// 4. Build Check
section("Build Verification");

const distExists = fs.existsSync(path.join(DESKTOP_APP_DIR, "dist"));
if (distExists) {
  checkPass("dist directory exists");

  const mainJsExists = fs.existsSync(
    path.join(DESKTOP_APP_DIR, "dist", "main", "index.js"),
  );
  if (mainJsExists) {
    checkPass("Main process build exists");
  } else {
    checkFail("Main process not built", "Run: npm run build:main");
  }

  const rendererExists = fs.existsSync(
    path.join(DESKTOP_APP_DIR, "dist", "renderer"),
  );
  if (rendererExists) {
    checkPass("Renderer build exists");
  } else {
    checkFail("Renderer not built", "Run: npm run build:renderer");
  }
} else {
  checkFail("dist directory not found", "Run: npm run build");
}

// 5. Tests
section("Test Status");

console.log("  Testing can take a while, skipping automatic test runs...");
checkWarn("Tests not verified automatically", "Recommended: npm run test:all");

// 6. Security Audit
section("Security Audit");

const auditResult = exec("npm audit --audit-level=high", {
  silent: true,
  ignoreError: true,
});
if (auditResult && auditResult.includes("found 0 vulnerabilities")) {
  checkPass("No high/critical vulnerabilities found");
} else if (auditResult && auditResult.includes("vulnerabilities")) {
  const vulnCount = (auditResult.match(/(\d+) (high|critical)/g) || []).length;
  if (vulnCount > 0) {
    checkFail("High/critical vulnerabilities found", "Run: npm audit fix");
  } else {
    checkWarn(
      "Low/moderate vulnerabilities found",
      "Consider running: npm audit fix",
    );
  }
} else {
  checkWarn("Could not verify security status", "Run: npm audit");
}

// 7. Documentation
section("Documentation");

const changelogExists = fs.existsSync(path.join(ROOT_DIR, "CHANGELOG.md"));
if (changelogExists) {
  checkPass("CHANGELOG.md exists");
} else {
  checkWarn("CHANGELOG.md not found", "Consider maintaining a changelog");
}

const readmeExists = fs.existsSync(path.join(ROOT_DIR, "README.md"));
if (readmeExists) {
  checkPass("README.md exists");
} else {
  checkWarn("README.md not found");
}

// 8. GitHub CLI
section("GitHub CLI");

const ghVersion = exec("gh --version", { silent: true, ignoreError: true });
if (ghVersion) {
  checkPass(`GitHub CLI installed: ${ghVersion.split("\n")[0]}`);

  const authStatus = exec("gh auth status", {
    silent: true,
    ignoreError: true,
  });
  if (authStatus && !authStatus.includes("not logged")) {
    checkPass("Authenticated with GitHub");
  } else {
    checkFail("Not authenticated with GitHub", "Run: gh auth login");
  }
} else {
  checkFail(
    "GitHub CLI not installed",
    "Install from: https://cli.github.com/",
  );
}

// 9. Git Tags
section("Git Tags");

const tagExists = exec(`git tag -l ${targetVersion}`, {
  silent: true,
  cwd: ROOT_DIR,
})?.trim();
if (tagExists) {
  checkWarn(
    `Tag ${targetVersion} already exists`,
    "This will overwrite the existing tag",
  );
} else {
  checkPass(`Tag ${targetVersion} is available`);
}

// 10. Remote Repository
section("Remote Repository");

const remoteUrl = exec("git remote get-url origin", {
  silent: true,
  cwd: ROOT_DIR,
})?.trim();
if (remoteUrl) {
  checkPass(`Remote origin configured: ${remoteUrl}`);

  if (remoteUrl.includes("github.com")) {
    checkPass("Remote is GitHub (compatible with gh CLI)");
  } else {
    checkWarn("Remote is not GitHub", "GitHub CLI may not work correctly");
  }
} else {
  checkFail("No remote origin configured");
}

// Summary
console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

console.log(`Summary:`);
console.log(`  ${colors.green}✓ Passed:${colors.reset} ${passCount}`);
console.log(`  ${colors.yellow}⚠ Warnings:${colors.reset} ${warnCount}`);
console.log(`  ${colors.red}✗ Failed:${colors.reset} ${failCount}`);

if (failCount > 0) {
  console.log(`
${colors.red}❌ Pre-release checks FAILED${colors.reset}
Please fix the issues above before creating a release.
`);
  process.exit(1);
} else if (warnCount > 0) {
  console.log(`
${colors.yellow}⚠️  Pre-release checks passed with warnings${colors.reset}
Review the warnings above and proceed with caution.
`);
  process.exit(0);
} else {
  console.log(`
${colors.green}✅ All pre-release checks PASSED${colors.reset}
Ready to create release ${targetVersion}!

Next steps:
  1. Review changes: git log --oneline v${packageVersion}..HEAD
  2. Create release: npm run release:draft
  3. Test the release artifacts
  4. Publish: gh release edit ${targetVersion} --draft=false
`);
  process.exit(0);
}
