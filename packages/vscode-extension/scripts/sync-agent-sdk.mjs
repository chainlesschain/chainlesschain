/**
 * Vendor @chainlesschain/agent-sdk (CJS build) into the VS Code and Desktop
 * production trees.
 *
 * The extension packages with `vsce package --no-dependencies` and ships
 * only src/, so the SDK cannot be a node_modules dependency — it is copied
 * in at sync time instead (same generated-artifact pattern as web-panel
 * dist → cli/src/assets). Re-run after any packages/agent-sdk change:
 *
 *   node scripts/sync-agent-sdk.mjs
 *
 * The vendored files are git-tracked; edit packages/agent-sdk/src and
 * re-sync — never edit src/vendor/agent-sdk directly.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = join(extensionRoot, "..", "..");
const sdkRoot = join(extensionRoot, "..", "agent-sdk");
const sdkDist = join(sdkRoot, "dist", "cjs");
const targets = [
  {
    label: "VS Code",
    path: join(extensionRoot, "src", "vendor", "agent-sdk"),
  },
  {
    label: "Desktop",
    path: join(
      repoRoot,
      "desktop-app-vue",
      "src",
      "main",
      "vendor",
      "agent-sdk",
    ),
  },
];
const checkOnly = process.argv.includes("--check");

function collectFiles(root, entryPaths, { exclude = new Set() } = {}) {
  const files = [];
  const visit = (absolutePath) => {
    const entries = readdirSync(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(absolutePath, entry.name);
      const childRelative = relative(root, child).replaceAll("\\", "/");
      if (exclude.has(childRelative)) continue;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
    }
  };

  for (const entryPath of entryPaths) {
    const absolutePath = join(root, entryPath);
    if (!existsSync(absolutePath)) continue;
    visit(absolutePath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function hashFiles(root, files) {
  const hash = createHash("sha256");
  for (const absolutePath of files) {
    hash.update(relative(root, absolutePath).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function hashSdkSources() {
  const files = [
    join(sdkRoot, "package.json"),
    join(sdkRoot, "tsconfig.json"),
    join(sdkRoot, "tsconfig.cjs.json"),
    join(sdkRoot, "tsconfig.esm.json"),
    ...collectFiles(sdkRoot, ["scripts", "src"]),
  ].filter(existsSync);
  return hashFiles(sdkRoot, files);
}

function hashVendoredOutput(target) {
  return hashFiles(
    target,
    collectFiles(target, ["."], { exclude: new Set(["VENDORED.md"]) }),
  );
}

if (!existsSync(join(sdkRoot, "package.json"))) {
  console.error("packages/agent-sdk not found next to the extension");
  process.exit(1);
}

// A schema change must first be reflected in the SDK's generated bindings.
// This makes the IDE freshness gate cover both packages/agent-sdk and the
// canonical packages/agent-protocol source that produces those bindings.
execFileSync("npm", ["run", "protocol:check"], {
  cwd: sdkRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const sdkVersion = JSON.parse(
  readFileSync(join(sdkRoot, "package.json"), "utf8"),
).version;
const sourceDigest = hashSdkSources();

if (checkOnly) {
  for (const target of targets) {
    const markerPath = join(target.path, "VENDORED.md");
    if (!existsSync(markerPath)) {
      console.error(
        `${target.label} vendored Agent SDK marker is missing; ` +
          "run npm run sync:agent-sdk",
      );
      process.exit(1);
    }
    const marker = readFileSync(markerPath, "utf8");
    const outputDigest = hashVendoredOutput(target.path);
    const expectedLines = [
      `# Vendored @chainlesschain/agent-sdk v${sdkVersion}`,
      `Target: ${target.label}`,
      `Source tree SHA-256: \`${sourceDigest}\``,
      `Vendored output SHA-256: \`${outputDigest}\``,
    ];
    const missing = expectedLines.filter((line) => !marker.includes(line));
    if (missing.length > 0) {
      console.error(
        `${target.label} vendored Agent SDK is stale or modified; ` +
          "run npm run sync:agent-sdk",
      );
      for (const line of missing) console.error(`missing marker: ${line}`);
      process.exit(1);
    }
  }
  console.log(
    `vendored @chainlesschain/agent-sdk v${sdkVersion} is current ` +
      `for ${targets.map((target) => target.label).join(" and ")}`,
  );
  process.exit(0);
}

// dist/ is gitignored and may exist from an older source revision. Always
// rebuild before copying so a normal sync can never overwrite the vendored
// protocol with stale generated output.
console.log("building agent-sdk before vendoring…");
execFileSync("npm", ["run", "build"], {
  cwd: sdkRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

for (const target of targets) {
  rmSync(target.path, { recursive: true, force: true });
  mkdirSync(target.path, { recursive: true });
  cpSync(sdkDist, target.path, { recursive: true });
  const outputDigest = hashVendoredOutput(target.path);
  writeFileSync(
    join(target.path, "VENDORED.md"),
    `# Vendored @chainlesschain/agent-sdk v${sdkVersion}\n\n` +
      "Generated by packages/vscode-extension/scripts/sync-agent-sdk.mjs — " +
      "DO NOT EDIT.\n" +
      `Target: ${target.label}\n` +
      "Source: packages/agent-sdk/src (TypeScript). Edit there and re-sync.\n\n" +
      `Source tree SHA-256: \`${sourceDigest}\`\n` +
      `Vendored output SHA-256: \`${outputDigest}\`\n`,
    "utf8",
  );
  console.log(
    `vendored @chainlesschain/agent-sdk v${sdkVersion} ` +
      `for ${target.label} → ${target.path}`,
  );
}
