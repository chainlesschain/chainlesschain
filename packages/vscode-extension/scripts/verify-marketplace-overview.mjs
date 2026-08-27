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

export function verifyMarketplaceOverview({
  extensionManifest,
  cliManifest,
  readme,
}) {
  assert.equal(extensionManifest.name, "chainlesschain-ide");
  assert.equal(cliManifest.name, "chainlesschain");

  const introMatch = readme.match(
    /^# [^\n]+\n\n([\s\S]*?)\n\n## Current release/mu,
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

  const releaseMatch = readme.match(
    /## Current release\n\n([\s\S]*?)\n\n## Highlights/mu,
  );
  assert.ok(
    releaseMatch,
    "README must contain a bounded Current release section",
  );
  const releaseSection = releaseMatch[1];
  const extensionVersion = extensionManifest.version;
  const cliVersion = cliManifest.version;
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

  for (const pattern of [
    /ide-vscode-v(0\.37\.\d+)/gu,
    /chainlesschain-ide\/(0\.37\.\d+)\/file/gu,
    /chainlesschain-ide-(0\.37\.\d+)\.vsix/gu,
  ]) {
    assert.deepEqual(
      capturedVersions(readme, pattern),
      [extensionVersion],
      "README contains stale VS Code release metadata",
    );
  }
  assert.deepEqual(
    [
      ...new Set(
        [...readme.matchAll(/chainlesschain@(0\.\d+\.\d+)/gu)].map(
          (match) => match[1],
        ),
      ),
    ],
    [cliVersion],
    "README contains a stale recommended CLI package version",
  );
  assert.ok(
    releaseSection.includes(`CLI \`${cliVersion}\``),
    "Current release narrative must describe the recommended CLI",
  );

  return { extensionVersion, cliVersion, vsixUrl };
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
