#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function normalizeText(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function capturedVersions(value, pattern) {
  return [...new Set([...value.matchAll(pattern)].map((match) => match[1]))];
}

function markdownLinesOutsideFences(markdown) {
  const lines = [];
  let offset = 0;
  let fenceCharacter = null;
  let fenceLength = 0;

  for (const rawLine of markdown.match(/.*(?:\r?\n|$)/gu) ?? []) {
    if (rawLine.length === 0) continue;
    const line = rawLine.replace(/\r?\n$/u, "");
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/u);

    if (fenceCharacter) {
      const closingFence = new RegExp(
        `^ {0,3}${fenceCharacter}{${fenceLength},}\\s*$`,
        "u",
      );
      if (closingFence.test(line)) {
        fenceCharacter = null;
        fenceLength = 0;
      }
    } else if (fence) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
    } else {
      lines.push({ line, start: offset, end: offset + line.length });
    }

    offset += rawLine.length;
  }

  return lines;
}

function currentReleaseStatus(readme) {
  const lines = markdownLinesOutsideFences(readme);
  const currentHeading = lines.find((entry) =>
    /^## Current release[ \t]*$/u.test(entry.line),
  );
  assert.ok(currentHeading, "README must contain a Current release heading");

  const isReleaseMarker = (line) =>
    /^<!-- release\d+-status -->[ \t]*$/u.test(line);
  const isBoundary = (line) =>
    /^### Previous verified release(?:[ \t]+.*)?$/u.test(line) ||
    /^## Highlights[ \t]*$/u.test(line) ||
    isReleaseMarker(line);
  const firstEvent = lines.find(
    (entry) => entry.start > currentHeading.start && isBoundary(entry.line),
  );
  assert.ok(
    firstEvent && isReleaseMarker(firstEvent.line),
    "README must contain a current release status marker before history or Highlights",
  );

  const nextBoundary = lines.find(
    (entry) => entry.start > firstEvent.start && isBoundary(entry.line),
  );
  const sectionEnd = nextBoundary?.start ?? readme.length;
  const status = readme.slice(firstEvent.end, sectionEnd).trim();
  assert.ok(status, "Current release status block must not be empty");
  return status;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

export function verifyMarketplaceOverview({
  extensionManifest,
  cliManifest,
  readme,
}) {
  assert.equal(extensionManifest.name, "chainlesschain-ide");
  assert.equal(cliManifest.name, "chainlesschain");

  const introMatch = readme.match(
    /^# [^\n]+\n\n([\s\S]*?)\n\n## [^\n]+/mu,
  );
  assert.ok(
    introMatch,
    "README must contain an introduction before Current release",
  );
  assert.equal(
    normalizeText(introMatch[1]),
    normalizeText(extensionManifest.description),
    "README introduction must match the Marketplace package description",
  );

  const releaseSection = currentReleaseStatus(readme);
  const extensionVersion = extensionManifest.version;
  const sourceCliVersion = cliManifest.version;
  const cliVersion = extensionManifest.chainlesschain?.recommendedCliVersion;
  assert.match(
    cliVersion ?? "",
    /^0\.\d+\.\d+$/u,
    "Extension manifest must declare chainlesschain.recommendedCliVersion",
  );
  assert.match(
    sourceCliVersion,
    /^0\.\d+\.\d+$/u,
    "CLI source manifest must declare a stable semantic version",
  );
  assert.ok(
    compareVersions(cliVersion, sourceCliVersion) <= 0,
    "Recommended public CLI cannot be newer than the checked-out CLI source",
  );
  const vsixUrl =
    `https://open-vsx.org/api/chainlesschain/chainlesschain-ide/${extensionVersion}` +
    `/file/chainlesschain.chainlesschain-ide-${extensionVersion}.vsix`;

  for (const snippet of [
    `| VS Code extension         | **${extensionVersion}**;`,
    `| Recommended CLI           | **\`chainlesschain@${cliVersion}\`**`,
    `ide-vscode-v${extensionVersion}`,
    vsixUrl,
    `npm i -g chainlesschain@${cliVersion}`,
    `Using \`@${cliVersion}\``,
    `chainlesschain-ide-${extensionVersion}.vsix`,
  ]) {
    assert.ok(
      readme.includes(snippet),
      `README is missing current release metadata: ${snippet}`,
    );
  }

  assert.ok(
    releaseSection.includes(`ide-vscode-v${extensionVersion}`),
    "Current release status must name its immutable VS Code tag",
  );
  for (const pattern of [
    /ide-vscode-v(0\.37\.\d+)/gu,
    /chainlesschain-ide\/(0\.37\.\d+)\/file/gu,
    /chainlesschain-ide-(0\.37\.\d+)\.vsix/gu,
  ]) {
    assert.ok(
      capturedVersions(releaseSection, pattern).every(
        (version) => version === extensionVersion,
      ),
      "Current release status contains stale VS Code release metadata",
    );
  }
  assert.ok(
    capturedVersions(releaseSection, /chainlesschain@(0\.\d+\.\d+)/gu).every(
      (version) => version === cliVersion,
    ),
    "Current release status contains a stale recommended CLI package version",
  );
  assert.ok(
    releaseSection.includes(`CLI \`${cliVersion}\``),
    "Current release narrative must describe the recommended CLI",
  );

  return { extensionVersion, cliVersion, sourceCliVersion, vsixUrl };
}

function main() {
  const extensionManifest = JSON.parse(
    readFileSync(join(EXTENSION_ROOT, "package.json"), "utf8"),
  );
  const cliManifest = JSON.parse(
    readFileSync(join(EXTENSION_ROOT, "..", "cli", "package.json"), "utf8"),
  );
  const readme = readFileSync(join(EXTENSION_ROOT, "README.md"), "utf8");
  const result = verifyMarketplaceOverview({
    extensionManifest,
    cliManifest,
    readme,
  });
  process.stdout.write(
    `Marketplace Overview verified: ${JSON.stringify(result)}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Marketplace Overview verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
