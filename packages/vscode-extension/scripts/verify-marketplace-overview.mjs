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

function releaseSection(readme, headingText) {
  const lines = markdownLinesOutsideFences(readme);
  const matchingHeadings = lines.filter((entry) => entry.line === headingText);
  assert.ok(
    matchingHeadings.length <= 1,
    `README must contain at most one ${headingText} section`,
  );
  const heading = matchingHeadings[0];
  if (!heading) return null;
  if (
    headingText === "## Next release candidate" ||
    headingText === "## Release pairing"
  ) {
    const currentHeading = lines.find((entry) =>
      /^## Current release[ \t]*$/u.test(entry.line),
    );
    assert.ok(
      !currentHeading || heading.start < currentHeading.start,
      `${headingText.slice(3)} section must appear before Current release`,
    );
  }

  const nextHeading = lines.find(
    (entry) => entry.start > heading.start && /^## [^#]/u.test(entry.line),
  );
  return readme.slice(heading.end, nextHeading?.start ?? readme.length).trim();
}

function publishedReleasePair(readme) {
  const pairMatch = currentReleaseStatus(readme).match(
    /Open VSX version \*\*(0\.37\.\d+)\*\* pairs with public CLI `(0\.\d+\.\d+)`\./u,
  );
  assert.ok(
    pairMatch,
    "Current release section must declare its published Open VSX and CLI versions",
  );
  return { extensionVersion: pairMatch[1], cliVersion: pairMatch[2] };
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

  const introMatch = readme.match(/^# [^\n]+\n\n([\s\S]*?)\n\n## [^\n]+/mu);
  assert.ok(
    introMatch,
    "README must contain an introduction before Current release",
  );
  assert.equal(
    normalizeText(introMatch[1]),
    normalizeText(extensionManifest.description),
    "README introduction must match the Marketplace package description",
  );

  const releaseStatus = currentReleaseStatus(readme);
  const currentPair = publishedReleasePair(readme);
  const candidateSection = releaseSection(readme, "## Next release candidate");
  const sourceSection = releaseSection(readme, "## Release pairing");
  assert.ok(
    candidateSection === null || sourceSection === null,
    "README must not mix a Release pairing with a Next release candidate section",
  );
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

  if (sourceSection !== null) {
    const sourceText = markdownLinesOutsideFences(sourceSection)
      .map(({ line }) => line)
      .join("\n");
    const declarations = [
      ...sourceText.matchAll(
        /Version \*\*(0\.37\.\d+)\*\* recommends CLI \*\*`?(0\.\d+\.\d+)`?\*\*/gu,
      ),
    ];
    assert.equal(
      declarations.length,
      1,
      "Release pairing must declare exactly one source VS Code and recommended CLI version",
    );
    assert.equal(
      declarations[0][1],
      extensionVersion,
      "Release pairing VS Code version must match the extension manifest",
    );
    assert.equal(
      declarations[0][2],
      cliVersion,
      "Release pairing CLI version must match the extension manifest",
    );
    assert.ok(
      compareVersions(extensionVersion, currentPair.extensionVersion) >= 0,
      "Source release cannot be older than the current public VS Code extension",
    );
    assert.ok(
      compareVersions(cliVersion, currentPair.cliVersion) >= 0,
      "Source CLI cannot be older than the current public CLI pairing",
    );
  } else if (candidateSection !== null) {
    const candidateMatch = candidateSection.match(
      /Source candidate \*\*(0\.37\.\d+)\*\* recommends CLI \*\*`?(0\.\d+\.\d+)`?\*\*/u,
    );
    assert.ok(
      candidateMatch,
      "Next release candidate must declare its VS Code and recommended CLI versions",
    );
    assert.equal(
      candidateMatch[1],
      extensionVersion,
      "Next release candidate VS Code version must match the extension manifest",
    );
    assert.equal(
      candidateMatch[2],
      cliVersion,
      "Next release candidate CLI version must match the extension manifest",
    );
    assert.match(
      candidateSection,
      /The extension has not been published\b/iu,
      "Next release candidate must say the extension has not been published",
    );
    assert.ok(
      compareVersions(extensionVersion, currentPair.extensionVersion) > 0,
      "Next release candidate must be newer than the current public VS Code extension",
    );
    assert.ok(
      compareVersions(cliVersion, currentPair.cliVersion) >= 0,
      "Next release candidate CLI cannot be older than the current public CLI pairing",
    );
  } else {
    assert.equal(
      currentPair.extensionVersion,
      extensionVersion,
      "Without a candidate section, the extension manifest must match the current public release",
    );
    assert.equal(
      currentPair.cliVersion,
      cliVersion,
      "Without a candidate section, the recommended CLI must match the current public release",
    );
  }

  const publicExtensionVersion = currentPair.extensionVersion;
  const publicCliVersion = currentPair.cliVersion;
  const vsixUrl =
    `https://open-vsx.org/api/chainlesschain/chainlesschain-ide/${publicExtensionVersion}` +
    `/file/chainlesschain.chainlesschain-ide-${publicExtensionVersion}.vsix`;

  for (const snippet of [
    `| VS Code extension         | **${publicExtensionVersion}**;`,
    `| Recommended CLI           | **\`chainlesschain@${publicCliVersion}\`**`,
    `ide-vscode-v${publicExtensionVersion}`,
    vsixUrl,
    `npm i -g chainlesschain@${publicCliVersion}`,
    `Using \`@${publicCliVersion}\``,
    `chainlesschain-ide-${publicExtensionVersion}.vsix`,
  ]) {
    assert.ok(
      readme.includes(snippet),
      `README is missing current release metadata: ${snippet}`,
    );
  }

  assert.ok(
    releaseStatus.includes(`ide-vscode-v${publicExtensionVersion}`),
    "Current release status must name its immutable VS Code tag",
  );
  for (const pattern of [
    /ide-vscode-v(0\.37\.\d+)/gu,
    /chainlesschain-ide\/(0\.37\.\d+)\/file/gu,
    /chainlesschain-ide-(0\.37\.\d+)\.vsix/gu,
  ]) {
    assert.ok(
      capturedVersions(releaseStatus, pattern).every(
        (version) => version === publicExtensionVersion,
      ),
      "Current release status contains stale VS Code release metadata",
    );
  }
  assert.ok(
    capturedVersions(releaseStatus, /chainlesschain@(0\.\d+\.\d+)/gu).every(
      (version) => version === publicCliVersion,
    ),
    "Current release status contains a stale recommended CLI package version",
  );
  assert.ok(
    releaseStatus.includes(`CLI \`${publicCliVersion}\``),
    "Current release narrative must describe the recommended CLI",
  );

  return {
    extensionVersion,
    cliVersion,
    sourceCliVersion,
    publicExtensionVersion,
    publicCliVersion,
    vsixUrl,
  };
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
