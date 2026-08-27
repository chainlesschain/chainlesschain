#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function oneMatch(value, pattern, label) {
  const matches = [...value.matchAll(pattern)];
  assert.equal(matches.length, 1, `expected exactly one ${label}`);
  return matches[0][1].trim();
}

function capturedVersions(value, pattern) {
  return [...new Set([...value.matchAll(pattern)].map((match) => match[1]))];
}

export function verifyReleaseMetadata({
  gradle,
  pluginXml,
  changelog,
  readme,
  cliManifest,
}) {
  assert.equal(cliManifest.name, "chainlesschain");
  const pluginVersion = oneMatch(
    gradle,
    /^version\s*=\s*"([^"]+)"\s*$/gmu,
    "Gradle project version",
  );
  assert.equal(
    oneMatch(
      pluginXml,
      /^\s*<version>([^<]+)<\/version>\s*$/gmu,
      "plugin.xml version",
    ),
    pluginVersion,
    "Gradle and plugin.xml versions must match",
  );
  const leadingChangelog = changelog.match(/^## \[([^\]]+)\]/mu);
  assert.ok(leadingChangelog, "changelog must contain a version heading");
  assert.equal(
    leadingChangelog[1],
    pluginVersion,
    "leading changelog version must match the plugin",
  );

  const compatibility = readme.match(
    /## Release compatibility\n\n([\s\S]*?)\n\n## /mu,
  );
  assert.ok(
    compatibility,
    "README must contain a bounded Release compatibility section",
  );
  const section = compatibility[1];
  assert.ok(
    section.includes(`Plugin **${pluginVersion}** is the current release`),
    "README must identify the current plugin release",
  );
  assert.ok(
    section.includes(`chainlesschain@${cliManifest.version}`),
    "README must identify the recommended CLI release",
  );
  assert.deepEqual(
    capturedVersions(section, /\b(0\.4\.\d+)\b/gu),
    [pluginVersion],
    "README contains a stale JetBrains plugin version",
  );
  assert.deepEqual(
    capturedVersions(section, /chainlesschain@(0\.\d+\.\d+)/gu),
    [cliManifest.version],
    "README contains a stale recommended CLI version",
  );

  return { pluginVersion, cliVersion: cliManifest.version };
}

function main() {
  const result = verifyReleaseMetadata({
    gradle: readFileSync(join(PLUGIN_ROOT, "build.gradle.kts"), "utf8"),
    pluginXml: readFileSync(
      join(PLUGIN_ROOT, "src", "main", "resources", "META-INF", "plugin.xml"),
      "utf8",
    ),
    changelog: readFileSync(join(PLUGIN_ROOT, "CHANGELOG.md"), "utf8"),
    readme: readFileSync(join(PLUGIN_ROOT, "README.md"), "utf8"),
    cliManifest: JSON.parse(
      readFileSync(join(PLUGIN_ROOT, "..", "cli", "package.json"), "utf8"),
    ),
  });
  process.stdout.write(
    `JetBrains release metadata verified: ${JSON.stringify(result)}\n`,
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
      `JetBrains release metadata verification failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
