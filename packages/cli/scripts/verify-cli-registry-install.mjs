#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const samePath = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** The CLI archive is local; every production child must come from public npm. */
export function verifyCliRegistryInstall(installRoot, expectedCli) {
  const root = fs.realpathSync.native(installRoot);
  const cliRoot = path.join(root, "node_modules", "chainlesschain");
  if (
    !samePath(fs.realpathSync.native(cliRoot), cliRoot) ||
    fs.lstatSync(cliRoot).isSymbolicLink()
  )
    throw new Error("CLI must be an installed archive, not a workspace link");
  const cliFile = path.join(cliRoot, "package.json");
  const installedCli = read(cliFile);
  if (
    expectedCli.name !== "chainlesschain" ||
    installedCli.name !== expectedCli.name ||
    installedCli.version !== expectedCli.version
  )
    throw new Error(
      "installed CLI identity differs from the release candidate",
    );
  const expected = Object.entries(expectedCli.dependencies || {}).filter(
    ([name]) => name.startsWith("@chainlesschain/"),
  );
  for (const name of [
    "@chainlesschain/core-db",
    "@chainlesschain/session-core",
  ])
    if (!expected.some(([dependency]) => dependency === name))
      throw new Error(`required CLI child missing: ${name}`);
  const lock = read(path.join(root, "package-lock.json"));
  const require = createRequire(cliFile);
  const children = expected.map(([name, version]) => {
    if (
      !/^\d+\.\d+\.\d+$/u.test(version) ||
      installedCli.dependencies?.[name] !== version
    )
      throw new Error(`CLI child must have the exact release pin: ${name}`);
    let directory = path.dirname(require.resolve(name));
    let manifest = null;
    while (inside(root, directory) && directory !== root) {
      const candidate = path.join(directory, "package.json");
      if (fs.existsSync(candidate) && read(candidate).name === name) {
        manifest = read(candidate);
        break;
      }
      directory = path.dirname(directory);
    }
    if (!manifest || manifest.version !== version || !inside(root, directory))
      throw new Error(
        `child is missing, outside the clean install, or has the wrong version: ${name}`,
      );
    if (
      fs.lstatSync(directory).isSymbolicLink() ||
      !samePath(fs.realpathSync.native(directory), directory)
    )
      throw new Error(`workspace or substituted child path: ${name}`);
    const lockPath = path.relative(root, directory).split(path.sep).join("/");
    const entry = lock.packages?.[lockPath];
    if (
      !entry ||
      entry.link ||
      entry.version !== version ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity || "")
    )
      throw new Error(
        `child has no exact integrity-bearing registry lock: ${name}`,
      );
    const url = new URL(entry.resolved);
    if (
      url.origin !== "https://registry.npmjs.org" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.includes("/-/")
    )
      throw new Error(`child did not resolve from public npm: ${name}`);
    return {
      name,
      version,
      resolved: entry.resolved,
      integrity: entry.integrity,
    };
  });
  return {
    schema: "chainlesschain.cli-public-dependency-install.v1",
    package: installedCli.name,
    version: installedCli.version,
    cliSource: "immutable-candidate-tarball",
    childrenSource: "https://registry.npmjs.org",
    children,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const [root, manifestFile, output, ...extra] = process.argv.slice(2);
    if (!root || !manifestFile || !output || extra.length)
      throw new Error(
        "usage: verify-cli-registry-install.mjs <install-root> <candidate-package.json> <output.json>",
      );
    const report = verifyCliRegistryInstall(root, read(manifestFile));
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(
      `Verified ${report.children.length} public npm children for CLI ${report.version}\n`,
    );
  } catch (error) {
    process.stderr.write(`CLI registry install error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
