#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCliRegistryInstall } from "../packages/cli/scripts/verify-cli-registry-install.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** Verify a fresh public install, including the CLI itself, before any IDE upload. */
export function verifyIdeCliPrerequisite(root, expected) {
  const install = path.join(root, "install");
  const children = verifyCliRegistryInstall(install, expected);
  const lock = read(path.join(install, "package-lock.json"));
  const entry = lock.packages?.["node_modules/chainlesschain"];
  if (
    !entry ||
    entry.link ||
    entry.version !== expected.version ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity || "")
  ) {
    throw new Error("Paired CLI has no exact integrity-bearing registry lock");
  }
  const url = new URL(entry.resolved);
  if (
    url.origin !== "https://registry.npmjs.org" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/chainlesschain/-/chainlesschain-${expected.version}.tgz`
  ) {
    throw new Error(
      "Paired CLI must be fetched from public npm before IDE publication",
    );
  }
  const installed = read(
    path.join(install, "node_modules/chainlesschain/package.json"),
  );
  const internalPins = (manifest) =>
    Object.entries(manifest.dependencies || {})
      .filter(([name]) => name.startsWith("@chainlesschain/"))
      .sort(([a], [b]) => a.localeCompare(b));
  if (
    JSON.stringify(internalPins(installed)) !==
    JSON.stringify(internalPins(expected))
  ) {
    throw new Error(
      "Published CLI child dependencies differ from the paired release",
    );
  }
  const version = fs
    .readFileSync(path.join(root, "cli-version.txt"), "utf8")
    .trim();
  if (version !== expected.version)
    throw new Error(
      "Published CLI version probe does not match the paired release",
    );
  const capabilities = read(path.join(root, "agent-capabilities.json"));
  if (
    !Number.isSafeInteger(capabilities?.protocol_version) ||
    capabilities.protocol_version < 1
  ) {
    throw new Error(
      "Published CLI cannot provide a valid Agent capability manifest",
    );
  }
  return {
    schema: "chainlesschain.ide-cli-publication-prerequisite/v1",
    package: "chainlesschain",
    version,
    cliSource: "https://registry.npmjs.org",
    resolved: entry.resolved,
    integrity: entry.integrity,
    children: children.children,
    protocolVersion: capabilities.protocol_version,
    verifiedAt: new Date().toISOString(),
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const [root, manifest, output, ...extra] = process.argv.slice(2);
    if (!root || !manifest || !output || extra.length) {
      throw new Error(
        "usage: verify-ide-cli-prerequisite.mjs <probe-root> <paired-package.json> <receipt.json>",
      );
    }
    const receipt = verifyIdeCliPrerequisite(root, read(manifest));
    fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", {
      flag: "wx",
    });
    process.stdout.write(
      `Verified published CLI ${receipt.version} and ${receipt.children.length} public child packages before IDE upload\n`,
    );
  } catch (error) {
    process.stderr.write(
      `IDE publication prerequisite failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
