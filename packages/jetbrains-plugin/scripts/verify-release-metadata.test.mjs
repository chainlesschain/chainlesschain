import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyReleaseMetadata } from "./verify-release-metadata.mjs";

function releaseInputs() {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  return {
    gradle: read("../build.gradle.kts"),
    gradleProperties: read("../gradle.properties"),
    pluginXml: read("../src/main/resources/META-INF/plugin.xml"),
    changelog: read("../CHANGELOG.md"),
    readme: read("../README.md"),
    cliManifest: JSON.parse(read("../../cli/package.json")),
    cliVersionCheck: read(
      "../src/main/java/com/chainlesschain/ide/CliVersionCheck.java",
    ),
  };
}

function publicReleaseInputs() {
  const inputs = releaseInputs();
  const version = inputs.gradle.match(/^version\s*=\s*"([^"]+)"/m)[1];
  inputs.readme = inputs.readme.replace(
    `Plugin **${version}** is the current release candidate`,
    `Plugin **${version}** is the current public release`,
  );
  inputs.readme = inputs.readme.replace(
    `## Release compatibility\n\nPlugin **${version}** recommends`,
    `## Release compatibility\n\nPlugin **${version}** is the current public release. It recommends`,
  );
  return inputs;
}

test("checked-in release documentation matches the package pairing", () => {
  const inputs = releaseInputs();
  assert.equal(
    verifyReleaseMetadata(inputs).cliVersion,
    inputs.cliManifest.version,
  );
});

test("public release documentation matches the checked-in package pairing", () => {
  const inputs = publicReleaseInputs();
  const result = verifyReleaseMetadata(inputs);
  assert.equal(result.cliVersion, inputs.cliManifest.version);
  assert.ok(
    inputs.readme.includes(
      `Plugin **${result.pluginVersion}** is the current public release`,
    ),
  );
});

test("candidate wording remains valid before the next Marketplace publication", () => {
  const inputs = publicReleaseInputs();
  const publicResult = verifyReleaseMetadata(inputs);
  inputs.readme = inputs.readme.replace(
    `Plugin **${publicResult.pluginVersion}** is the current public release`,
    `Plugin **${publicResult.pluginVersion}** is the current release candidate`,
  );
  assert.deepEqual(verifyReleaseMetadata(inputs), publicResult);
});

test("neutral source pairing preserves exact versions without claiming public availability", () => {
  const inputs = publicReleaseInputs();
  const expected = verifyReleaseMetadata(inputs);
  inputs.readme = inputs.readme.replace(
    `Plugin **${expected.pluginVersion}** is the current public release. It recommends`,
    `Plugin **${expected.pluginVersion}** recommends`,
  );
  assert.deepEqual(verifyReleaseMetadata(inputs), expected);
  const section = inputs.readme
    .split("## Release compatibility\n\n")[1]
    .split("\n\n## ")[0];
  assert.doesNotMatch(
    section,
    /is the current public release|not been published/,
  );
  const altered = {
    ...inputs,
    readme: inputs.readme.replace(
      `## Release compatibility\n\nPlugin **${expected.pluginVersion}** recommends`,
      "## Release compatibility\n\nPlugin **0.4.0** recommends",
    ),
  };
  assert.throws(() => verifyReleaseMetadata(altered), /README must identify/);
});

test("neutral source wording cannot change the recommended CLI", () => {
  const inputs = publicReleaseInputs();
  const expected = verifyReleaseMetadata(inputs);
  inputs.readme = inputs.readme.replace(
    `Plugin **${expected.pluginVersion}** is the current public release. It recommends \`chainlesschain@${expected.cliVersion}\``,
    `Plugin **${expected.pluginVersion}** recommends \`chainlesschain@0.166.0\``,
  );
  assert.throws(
    () => verifyReleaseMetadata(inputs),
    /README must identify|stale recommended CLI/,
  );
});

test("public wording cannot declare a different plugin version", () => {
  const inputs = publicReleaseInputs();
  const { pluginVersion } = verifyReleaseMetadata(inputs);
  inputs.readme = inputs.readme.replace(
    `Plugin **${pluginVersion}** is the current public release`,
    "Plugin **0.4.0** is the current public release",
  );
  assert.throws(
    () => verifyReleaseMetadata(inputs),
    /README must identify the current plugin release or release candidate/,
  );
});
