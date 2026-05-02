#!/usr/bin/env node
/**
 * GitHub Release Automation Script
 *
 * This script automates the process of creating GitHub releases with built artifacts
 * for Windows, macOS, and Linux platforms.
 *
 * Prerequisites:
 * 1. GitHub CLI (gh) installed: https://cli.github.com/
 * 2. Authenticated with: gh auth login
 * 3. Built artifacts in out/make directory
 *
 * Usage:
 *   node scripts/release.js [options]
 *
 * Options:
 *   --version <version>  Specify version (default: from package.json)
 *   --draft              Create as draft release
 *   --prerelease         Mark as prerelease
 *   --notes <file>       Release notes from file
 *   --skip-build         Skip building, use existing artifacts
 *   --builder            Use electron-builder (out/build, ships .blockmap +
 *                        latest*.yml so electron-updater can do differential
 *                        updates). Default = legacy electron-forge (out/make,
 *                        no blockmap → users always download full installer).
 *   --skip-verify        Skip the differential-update artifact verification
 *                        step. Only meaningful with --builder.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Color output helpers
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.error(`${colors.red}✗${colors.reset} ${msg}`),
  step: (msg) => console.log(`\n${colors.cyan}▶${colors.reset} ${msg}`),
};

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const ROOT_DIR = path.join(__dirname, "../..");
const DESKTOP_APP_DIR = path.join(__dirname, "..");
const PACKAGE_JSON = require("../package.json");
const VERSION = getArg("--version") || `v${PACKAGE_JSON.version}`;
const IS_DRAFT = hasFlag("--draft");
const IS_PRERELEASE = hasFlag("--prerelease");
const RELEASE_NOTES_FILE = getArg("--notes");
const SKIP_BUILD = hasFlag("--skip-build");
const USE_BUILDER = hasFlag("--builder");
const SKIP_VERIFY = hasFlag("--skip-verify");

/**
 * Execute command and return output
 */
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
    throw error;
  }
}

/**
 * Check if GitHub CLI is installed
 */
function checkGHCLI() {
  log.step("Checking GitHub CLI...");
  const version = exec("gh --version", { silent: true, ignoreError: true });
  if (!version) {
    log.error(
      "GitHub CLI not found. Please install it from https://cli.github.com/",
    );
    process.exit(1);
  }
  log.success(`GitHub CLI installed: ${version.split("\n")[0]}`);

  // Check authentication
  const authStatus = exec("gh auth status", {
    silent: true,
    ignoreError: true,
  });
  if (!authStatus || authStatus.includes("not logged")) {
    log.error("Not authenticated with GitHub. Run: gh auth login");
    process.exit(1);
  }
  log.success("Authenticated with GitHub");
}

/**
 * Build artifacts for all platforms
 */
async function buildArtifacts() {
  if (SKIP_BUILD) {
    log.warning("Skipping build (--skip-build flag set)");
    return;
  }

  log.step("Building artifacts...");
  log.info("This may take 10-30 minutes depending on your machine...");

  const builds = USE_BUILDER
    ? [
        { name: "Windows (x64)", script: "make:win:builder" },
        { name: "macOS (Universal)", script: "make:mac:builder" },
        { name: "Linux (x64)", script: "make:linux:builder" },
      ]
    : [
        { name: "Windows (x64)", script: "make:win" },
        { name: "macOS (Universal)", script: "make:mac" },
        { name: "Linux (x64)", script: "make:linux:x64" },
      ];

  for (const build of builds) {
    try {
      log.info(`Building ${build.name}...`);
      exec(`npm run ${build.script}`);
      log.success(`${build.name} build completed`);
    } catch (error) {
      log.error(`Failed to build ${build.name}: ${error.message}`);
      log.warning("Continuing with other builds...");
    }
  }
}

/**
 * Collect all artifacts from the build output directory.
 *
 * - Legacy electron-forge mode → out/make, only ships installers
 * - --builder mode → out/build, plus .blockmap and latest*.yml which
 *   electron-updater needs for differential updates / version discovery
 */
function collectArtifacts() {
  log.step("Collecting artifacts...");

  const buildOutputDir = USE_BUILDER
    ? path.join(DESKTOP_APP_DIR, "out", "build")
    : path.join(DESKTOP_APP_DIR, "out", "make");
  if (!fs.existsSync(buildOutputDir)) {
    log.error(
      `No artifacts found at ${buildOutputDir}. Run builds first or remove --skip-build flag.`,
    );
    process.exit(1);
  }

  const artifacts = [];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (isArtifact(entry.name)) {
        artifacts.push(fullPath);
      }
    }
  }

  function isArtifact(filename) {
    const installerExt = [".zip", ".dmg", ".deb", ".rpm", ".AppImage", ".exe"];
    if (installerExt.some((ext) => filename.endsWith(ext))) return true;
    if (!USE_BUILDER) return false;
    // electron-builder companions required by electron-updater
    if (filename.endsWith(".blockmap")) return true;
    if (/^latest(-mac|-linux)?\.ya?ml$/i.test(filename)) return true;
    return false;
  }

  scanDir(buildOutputDir);

  if (artifacts.length === 0) {
    log.error(
      "No valid artifacts found (.zip, .dmg, .deb, .rpm, .AppImage, .exe)",
    );
    process.exit(1);
  }

  log.success(`Found ${artifacts.length} artifact(s):`);
  artifacts.forEach((artifact) => {
    const size = (fs.statSync(artifact).size / 1024 / 1024).toFixed(2);
    log.info(`  - ${path.basename(artifact)} (${size} MB)`);
  });

  return artifacts;
}

/**
 * In --builder mode, ensure differential-update sidecars (.blockmap +
 * latest*.yml) are present before we upload. Without these, electron-updater
 * can't discover updates or do block-level diffs and users redownload the
 * full installer every time.
 */
function verifyDifferentialArtifacts() {
  if (!USE_BUILDER) return;
  if (SKIP_VERIFY) {
    log.warning(
      "Skipping differential-update artifact verification (--skip-verify)",
    );
    return;
  }
  log.step("Verifying differential-update artifacts...");
  const { verify, printReport } = require("./verify-release-artifacts");
  const buildDir = path.join(DESKTOP_APP_DIR, "out", "build");
  const result = verify(buildDir);
  printReport(result);
  if (!result.ok) {
    log.error(
      "Aborting release. Use --skip-verify to override (NOT recommended — auto-update will be broken).",
    );
    process.exit(1);
  }
}

/**
 * Generate release notes
 */
function generateReleaseNotes() {
  log.step("Generating release notes...");

  if (RELEASE_NOTES_FILE) {
    const notesPath = path.resolve(RELEASE_NOTES_FILE);
    if (fs.existsSync(notesPath)) {
      log.success(`Using release notes from: ${RELEASE_NOTES_FILE}`);
      return fs.readFileSync(notesPath, "utf8");
    }
    log.warning(`Release notes file not found: ${RELEASE_NOTES_FILE}`);
  }

  // Generate default notes from git commits
  try {
    const lastTag = exec("git describe --tags --abbrev=0", {
      silent: true,
      ignoreError: true,
      cwd: ROOT_DIR,
    })?.trim();

    const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
    const commits = exec(
      `git log ${range} --pretty=format:"- %s (%h)" --no-merges`,
      {
        silent: true,
        cwd: ROOT_DIR,
      },
    );

    const notes = `## ChainlessChain ${VERSION}

### What's Changed

${commits || "Initial release"}

### Installation

Download the appropriate file for your platform:
- **Windows**: \`.zip\` or \`.exe\` file
- **macOS**: \`.dmg\` file
- **Linux**: \`.AppImage\`, \`.deb\`, or \`.rpm\` file

### System Requirements

- **Windows**: Windows 10/11 (x64)
- **macOS**: macOS 10.15+ (Intel & Apple Silicon)
- **Linux**: Ubuntu 20.04+ / Fedora 34+ / Arch Linux (x64)

### Notes

- U-Key hardware integration is Windows-only
- Backend services can run via Docker or bundled binaries

**Full Changelog**: https://github.com/chainlesschain/chainlesschain/compare/${lastTag}...${VERSION}
`;

    return notes;
  } catch (error) {
    log.warning("Could not generate release notes from git history");
    return `## ChainlessChain ${VERSION}\n\nSee commits for details.`;
  }
}

/**
 * Create GitHub release
 */
function createRelease(artifacts, releaseNotes) {
  log.step("Creating GitHub release...");

  // Save notes to temp file
  const notesFile = path.join(DESKTOP_APP_DIR, ".release-notes.tmp");
  fs.writeFileSync(notesFile, releaseNotes, "utf8");

  try {
    const flags = [
      `--title "ChainlessChain ${VERSION}"`,
      `--notes-file "${notesFile}"`,
      IS_DRAFT ? "--draft" : "",
      IS_PRERELEASE ? "--prerelease" : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Create release
    log.info(`Creating release ${VERSION}...`);
    exec(`gh release create ${VERSION} ${flags}`, { cwd: ROOT_DIR });
    log.success(`Release ${VERSION} created`);

    // Upload artifacts
    log.info("Uploading artifacts...");
    for (const artifact of artifacts) {
      const filename = path.basename(artifact);
      log.info(`  Uploading ${filename}...`);
      exec(`gh release upload ${VERSION} "${artifact}" --clobber`, {
        cwd: ROOT_DIR,
      });
      log.success(`  ✓ ${filename}`);
    }

    log.success("All artifacts uploaded successfully!");

    // Get release URL
    const releaseUrl = exec(`gh release view ${VERSION} --json url --jq .url`, {
      silent: true,
      cwd: ROOT_DIR,
    }).trim();

    log.success(`\n🎉 Release published: ${releaseUrl}`);
  } catch (error) {
    log.error(`Failed to create release: ${error.message}`);
    process.exit(1);
  } finally {
    // Clean up temp file
    if (fs.existsSync(notesFile)) {
      fs.unlinkSync(notesFile);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║        ChainlessChain Release Automation Script          ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
  `);

  log.info(`Version: ${VERSION}`);
  log.info(`Draft: ${IS_DRAFT ? "Yes" : "No"}`);
  log.info(`Prerelease: ${IS_PRERELEASE ? "Yes" : "No"}`);
  log.info(
    `Builder: ${USE_BUILDER ? "electron-builder (differential)" : "electron-forge (legacy, full-download)"}`,
  );

  try {
    checkGHCLI();
    await buildArtifacts();
    verifyDifferentialArtifacts();
    const artifacts = collectArtifacts();
    const releaseNotes = generateReleaseNotes();
    createRelease(artifacts, releaseNotes);

    log.success("\n✨ Release process completed successfully!");
  } catch (error) {
    log.error(`\n❌ Release process failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
