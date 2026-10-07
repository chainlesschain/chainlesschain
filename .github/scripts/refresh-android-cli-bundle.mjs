#!/usr/bin/env node
// Product packaging only: never build or publish npm sources in this workflow.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { verifyCliRegistryInstall } from "../../packages/cli/scripts/verify-cli-registry-install.mjs";
import { verifyNpmReleaseProvenance } from "../../packages/cli/scripts/verify-npm-release-provenance.mjs";

export const RETAINED = Object.freeze({
  version: "20260711",
  archiveSha256:
    "5aeb69646c92f94611fdba409c0b32b3c3d49c475dda7656b243e2b8bdf00c29",
  nodeSha256:
    "47e6c97d178c00e3d0ba6d695d5d14bf94bf749b2f6170a789f480cf4021af2f",
  nodeVersion: "26.2.0",
  abi: 147,
  cipherVersion: "12.11.1",
  addonSha256:
    "068ec86bfc4f713a899b48aef7710fe911511b86e650f87f1eeb680e2828d858",
  donor:
    "package/node_modules/@chainlesschain/personal-data-hub/node_modules/better-sqlite3-multiple-ciphers",
  addon: "build/Release/better_sqlite3.node",
});
const REGISTRY = "https://registry.npmjs.org";
const TAR =
  process.platform === "win32"
    ? path.join(process.env.SystemRoot || "C:/Windows", "System32/tar.exe")
    : "tar";
const REPO = path.resolve(import.meta.dirname, "../..");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const digest = (bytes, algorithm = "sha256") =>
  crypto.createHash(algorithm).update(bytes).digest("hex");

export function requireDigest(file, expected) {
  const bytes = fs.readFileSync(file);
  assert.equal(
    digest(bytes),
    expected,
    `sha256 mismatch: ${path.basename(file)}`,
  );
  return bytes;
}

// Deliberately narrow: a changed dependency contract requires a reviewed refresh
// policy, rather than guessing how to override a new semver expression.
export function allowsPinnedVersion(range, version) {
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  if (range === version) return true;
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/u.exec(range || "");
  if (!match) return false;
  const base = match.slice(1).map(Number);
  const actual = version.split(".").map(Number);
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const upper = base[0]
    ? [base[0] + 1, 0, 0]
    : base[1]
      ? [0, base[1] + 1, 0]
      : [0, 0, base[2] + 1];
  return compare(actual, base) >= 0 && compare(actual, upper) < 0;
}

export function hydrationManifest(cli, pdh, coreDb) {
  assert.equal(cli.name, "chainlesschain");
  assert.equal(pdh.name, "@chainlesschain/personal-data-hub");
  assert.equal(coreDb.name, "@chainlesschain/core-db");
  assert.equal(cli.dependencies[pdh.name], pdh.version);
  assert.equal(cli.dependencies[coreDb.name], coreDb.version);
  const spec =
    pdh.optionalDependencies?.["better-sqlite3-multiple-ciphers"] ??
    pdh.dependencies?.["better-sqlite3-multiple-ciphers"];
  assert.ok(
    allowsPinnedVersion(spec, RETAINED.cipherVersion),
    "retained cipher version is outside PDH's published range",
  );
  const coreSpec =
    coreDb.optionalDependencies?.["better-sqlite3-multiple-ciphers"];
  assert.equal(
    coreSpec,
    "^11.0.0",
    "review changed core-db native/fallback contract before refreshing",
  );
  // In particular, never override core-db's ^11 dependency with a ^12 binary.
  return {
    name: "android-cli-registry-hydration",
    version: "1.0.0",
    private: true,
    dependencies: { chainlesschain: cli.version },
    overrides: {
      [`${pdh.name}@${pdh.version}`]: {
        "better-sqlite3-multiple-ciphers": RETAINED.cipherVersion,
      },
    },
  };
}

function boundedInteger(value, limit) {
  const result = Number(value);
  assert.ok(
    Number.isSafeInteger(result) && result >= 0 && result <= limit,
    "ELF offset outside file",
  );
  return result;
}

export function inspectAddon(bytes) {
  assert.ok(
    bytes.length >= 64 &&
      bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])),
    "not ELF",
  );
  assert.equal(bytes[4], 2, "ELF must be 64 bit");
  assert.equal(bytes[5], 1, "ELF must be little endian");
  assert.equal(bytes.readUInt16LE(16), 3, "ELF must be a shared object");
  assert.equal(bytes.readUInt16LE(18), 183, "ELF must target AArch64");
  const offset = boundedInteger(bytes.readBigUInt64LE(40), bytes.length);
  const stride = bytes.readUInt16LE(58),
    count = bytes.readUInt16LE(60);
  assert.equal(stride, 64);
  assert.ok(
    count > 0 && offset + count * stride <= bytes.length,
    "invalid ELF section table",
  );
  const sections = Array.from({ length: count }, (_, index) => {
    const at = offset + index * stride;
    const start = boundedInteger(bytes.readBigUInt64LE(at + 24), bytes.length);
    const size = boundedInteger(bytes.readBigUInt64LE(at + 32), bytes.length);
    const type = bytes.readUInt32LE(at + 4);
    if (type !== 8)
      assert.ok(start + size <= bytes.length, "ELF section outside file");
    return {
      type,
      link: bytes.readUInt32LE(at + 40),
      start,
      size,
      stride: Number(bytes.readBigUInt64LE(at + 56)),
    };
  });
  const text = (section, at) => {
    assert.ok(
      section && at >= 0 && at < section.size,
      "invalid ELF string offset",
    );
    const end = bytes.indexOf(0, section.start + at);
    assert.ok(
      end >= section.start + at && end < section.start + section.size,
      "unterminated ELF string",
    );
    return bytes.toString("utf8", section.start + at, end);
  };
  const exports = [],
    needed = [];
  for (const section of sections) {
    if (section.type === 11) {
      assert.equal(section.stride, 24);
      for (
        let at = section.start;
        at < section.start + section.size;
        at += 24
      ) {
        if (bytes.readUInt16LE(at + 6) && bytes[at + 4] >> 4)
          exports.push(text(sections[section.link], bytes.readUInt32LE(at)));
      }
    }
    if (section.type === 6) {
      assert.equal(section.stride, 16);
      for (let at = section.start; at < section.start + section.size; at += 16)
        if (bytes.readBigUInt64LE(at) === 1n)
          needed.push(
            text(sections[section.link], Number(bytes.readBigUInt64LE(at + 8))),
          );
    }
  }
  assert.ok(
    exports.includes(`node_register_module_v${RETAINED.abi}`),
    "missing ABI 147 registration export",
  );
  assert.ok(needed.length > 0, "ELF dependency table missing");
  for (const name of needed)
    assert.ok(
      ["libc.so", "libm.so", "libdl.so", "liblog.so"].includes(name),
      `unsupported Android ELF dependency: ${name}`,
    );
  return {
    machine: "aarch64",
    abi: RETAINED.abi,
    needed,
    sha256: digest(bytes),
    bytes: bytes.length,
  };
}

function files(root, relative = "") {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), {
    withFileTypes: true,
  })) {
    if (!relative && entry.name === "node_modules") continue;
    const child = path.posix.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), `unexpected package symlink: ${child}`);
    if (entry.isDirectory()) result.push(...files(root, child));
    else {
      assert.ok(entry.isFile(), `unsupported package entry: ${child}`);
      result.push(child);
    }
  }
  return result.sort();
}

export function verifySourceParity(
  source,
  installed,
  { allowExtra = false } = {},
) {
  const expected = files(source);
  if (!allowExtra)
    assert.deepEqual(
      files(installed),
      expected,
      "package file set differs from registry",
    );
  const hash = crypto.createHash("sha256");
  for (const relative of expected) {
    const target = path.join(installed, relative);
    assert.ok(
      fs.existsSync(target) && fs.lstatSync(target).isFile(),
      `missing registry file: ${relative}`,
    );
    const bytes = fs.readFileSync(path.join(source, relative));
    assert.ok(
      bytes.equals(fs.readFileSync(target)),
      `registry source changed: ${relative}`,
    );
    hash.update(relative).update("\0").update(digest(bytes)).update("\n");
  }
  return { files: expected.length, sourceDigest: hash.digest("hex") };
}

function run(command, args, cwd, extra = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...extra,
  });
}
function npm(args, cwd) {
  if (process.platform !== "win32") return run("npm", args, cwd);
  const candidates = [
    path.dirname(process.execPath),
    ...run("where.exe", ["npm.cmd"])
      .trim()
      .split(/\r?\n/u)
      .map((file) => path.dirname(file)),
  ];
  const cli = candidates
    .map((directory) => path.join(directory, "node_modules/npm/bin/npm-cli.js"))
    .find((file) => fs.existsSync(file));
  assert.ok(cli, "cannot locate npm-cli.js for shell-free Windows execution");
  return run(process.execPath, [cli, ...args], cwd);
}

function extract(archive, target, member) {
  fs.mkdirSync(target, { recursive: true });
  if (!member) {
    const names = run(TAR, ["-tzf", archive]).trim().split(/\r?\n/u);
    for (const name of names) {
      const normalized = name.replace(/\/$/u, "");
      assert.ok(
        normalized.startsWith("package/") || normalized === "package",
        "archive must have package/ prefix",
      );
      assert.equal(
        path.posix.normalize(normalized),
        normalized,
        "noncanonical tar path",
      );
      assert.ok(!normalized.includes("\\"), "backslash in tar path");
    }
    // Registry package archives contain regular files/directories; never extract links.
    for (const line of run(TAR, ["-tvzf", archive]).trim().split(/\r?\n/u))
      assert.ok(
        ["-", "d"].includes(line[0]),
        "registry archive contains a link or special file",
      );
  }
  run(TAR, ["-xzf", archive, "-C", target, ...(member ? [member] : [])]);
  return path.join(target, "package");
}

function registryManifest(name, version, cwd) {
  assert.match(name, /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/u);
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  const manifest = JSON.parse(
    npm(
      ["view", `${name}@${version}`, "--json", `--registry=${REGISTRY}`],
      cwd,
    ),
  );
  assert.equal(manifest.name, name);
  assert.equal(manifest.version, version);
  return manifest;
}

function registryPackage(manifest, root) {
  const target = fs.mkdtempSync(path.join(root, "registry-"));
  const result = JSON.parse(
    npm(
      [
        "pack",
        `${manifest.name}@${manifest.version}`,
        "--ignore-scripts",
        "--json",
        `--registry=${REGISTRY}`,
        "--pack-destination",
        target,
      ],
      target,
    ),
  );
  assert.equal(result.length, 1);
  assert.equal(path.basename(result[0].filename), result[0].filename);
  const archive = path.join(target, result[0].filename),
    bytes = fs.readFileSync(archive);
  assert.match(
    manifest.dist?.integrity || "",
    /^sha512-[A-Za-z0-9+/]+={0,2}$/u,
  );
  assert.equal(
    `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`,
    manifest.dist.integrity,
    "registry tarball integrity mismatch",
  );
  return {
    archive,
    root: extract(archive, path.join(target, "unpacked")),
    sha512: digest(bytes, "sha512"),
  };
}

function packageRoot(owner, name) {
  const require = createRequire(path.join(owner, "package.json"));
  let directory = path.dirname(require.resolve(name));
  for (;;) {
    const file = path.join(directory, "package.json");
    if (fs.existsSync(file) && readJson(file).name === name) return directory;
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `cannot locate package root: ${name}`);
    directory = parent;
  }
}

function download(url, file) {
  run("curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--location",
    "--retry",
    "3",
    "--output",
    file,
    url,
  ]);
}

export async function inspectRetained(archive, work) {
  requireDigest(archive, RETAINED.archiveSha256);
  const donorBase = path.join(work, "retained");
  extract(archive, donorBase, RETAINED.donor);
  const donor = path.join(donorBase, RETAINED.donor);
  const addon = inspectAddon(
    requireDigest(path.join(donor, RETAINED.addon), RETAINED.addonSha256),
  );
  const manifest = registryManifest(
    "better-sqlite3-multiple-ciphers",
    RETAINED.cipherVersion,
    work,
  );
  const published = registryPackage(manifest, work);
  assert.equal(
    readJson(path.join(donor, "package.json")).version,
    RETAINED.cipherVersion,
  );
  const parity = verifySourceParity(published.root, donor, {
    allowExtra: true,
  });
  return {
    donor,
    published,
    manifest,
    evidence: {
      version: RETAINED.cipherVersion,
      ...addon,
      registryIntegrity: manifest.dist.integrity,
      sourceParity: parity,
    },
  };
}

function unsupportedNativePackages(cli) {
  const result = [];
  for (const [owner, name, fallback] of [
    [
      cli,
      "better-sqlite3",
      "sql.js where supported; native SQLite-only features unavailable",
    ],
    [
      cli,
      "node-pty",
      "Android app PTY is separate; CLI node-pty gateway unavailable",
    ],
    [
      packageRoot(cli, "@chainlesschain/core-db"),
      "better-sqlite3-multiple-ciphers",
      "core-db probes native drivers and uses sql.js",
    ],
    [
      packageRoot(cli, "@chainlesschain/core-db"),
      "better-sqlite3",
      "core-db probes native drivers and uses sql.js",
    ],
  ]) {
    let version = null;
    try {
      version = readJson(
        path.join(packageRoot(owner, name), "package.json"),
      ).version;
    } catch {
      /* Optional package may be absent on Android. */
    }
    result.push({
      owner: path.relative(cli, owner).split(path.sep).join("/") || ".",
      name,
      version,
      supportedNativeBinding: false,
      fallback,
    });
  }
  return result;
}

export function stageInstalledCli(installRoot, stage) {
  const modules = path.join(installRoot, "node_modules"),
    cli = path.join(modules, "chainlesschain");
  // Hoisted dependencies can be moved together without changing resolution.
  // A nested CLI tree needs a different relocation proof; do not silently merge it.
  const nested = path.join(cli, "node_modules");
  assert.ok(
    !fs.existsSync(nested) || fs.readdirSync(nested).length === 0,
    "CLI has nested dependencies; refusing ambiguous dependency flattening",
  );
  const target = path.join(stage, "package");
  fs.cpSync(cli, target, { recursive: true, verbatimSymlinks: true });
  const destination = path.join(target, "node_modules");
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(modules)) {
    // .bin/cc points at the wrapper's chainlesschain/ directory and is not an
    // Android launch entrypoint. The app invokes package/bin/chainlesschain.js.
    if (["chainlesschain", ".bin", ".package-lock.json"].includes(name))
      continue;
    fs.cpSync(path.join(modules, name), path.join(destination, name), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  return target;
}

export async function refresh({
  cliVersion,
  expectedCliSha,
  fromVersion,
  output,
}) {
  assert.equal(
    process.platform,
    "linux",
    "production Android packaging requires GNU tar on Linux",
  );
  assert.match(cliVersion || "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  assert.match(expectedCliSha || "", /^[a-f0-9]{40}$/u);
  assert.equal(
    fromVersion,
    RETAINED.version,
    "unreviewed retained runtime; update the pinned policy first",
  );
  const tag = `v-npm-${cliVersion.replaceAll(".", "-")}`;
  assert.equal(
    run("git", ["rev-parse", `refs/tags/${tag}^{commit}`], REPO).trim(),
    expectedCliSha,
    "immutable CLI tag differs from requested source",
  );
  const sourceManifest = JSON.parse(
    run("git", ["show", `${expectedCliSha}:packages/cli/package.json`], REPO),
  );
  assert.equal(sourceManifest.version, cliVersion);
  assert.ok(!fs.existsSync(output), "output directory must be new");
  fs.mkdirSync(output, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "android-cli-refresh-"));
  console.log(`Work directory: ${work}`);
  // Leave the isolated temporary directory for runner diagnostics on failure.
  const cli = registryManifest("chainlesschain", cliVersion, work);
  const publishedCli = registryPackage(cli, work);
  assert.deepEqual(
    readJson(path.join(publishedCli.root, "package.json")),
    sourceManifest,
    "published CLI manifest differs from immutable source",
  );
  const pdh = registryManifest(
    "@chainlesschain/personal-data-hub",
    cli.dependencies["@chainlesschain/personal-data-hub"],
    work,
  );
  const coreDb = registryManifest(
    "@chainlesschain/core-db",
    cli.dependencies["@chainlesschain/core-db"],
    work,
  );
  const install = path.join(work, "install");
  fs.mkdirSync(install);
  writeJson(
    path.join(install, "package.json"),
    hydrationManifest(cli, pdh, coreDb),
  );
  npm(
    [
      "install",
      "--omit=dev",
      "--include=optional",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--workspaces=false",
      "--os=android",
      "--cpu=arm64",
      `--registry=${REGISTRY}`,
    ],
    install,
  );
  const dependencyAudit = verifyCliRegistryInstall(install, cli);
  const audit = JSON.parse(
    npm(
      [
        "audit",
        "signatures",
        "--include-attestations",
        "--json",
        `--registry=${REGISTRY}`,
      ],
      install,
    ),
  );
  const provenance = verifyNpmReleaseProvenance(audit, {
    version: cliVersion,
    commit: expectedCliSha,
    ref: `refs/tags/${tag}`,
    sha512: publishedCli.sha512,
  });
  const installedCli = path.join(install, "node_modules", "chainlesschain");
  verifySourceParity(publishedCli.root, installedCli);
  const children = [];
  for (const child of dependencyAudit.children) {
    const manifest = registryManifest(child.name, child.version, work);
    assert.equal(manifest.dist.integrity, child.integrity);
    const published = registryPackage(manifest, work);
    const directory = packageRoot(installedCli, child.name);
    children.push({
      ...child,
      parity: verifySourceParity(published.root, directory),
      sourceRoot: published.root,
    });
  }
  const archive = path.join(work, "retained-cc-cli.tgz"),
    nodeFile = path.join(work, "libnode.so");
  const base = `https://github.com/chainlesschain/chainlesschain/releases/download/internal-binaries-android-v${fromVersion}`;
  download(`${base}/cc-cli.tgz`, archive);
  download(`${base}/libnode.so`, nodeFile);
  const nodeBytes = requireDigest(nodeFile, RETAINED.nodeSha256);
  assert.equal(nodeBytes.readUInt16LE(18), 183);
  assert.ok(
    nodeBytes.includes(Buffer.from(`v${RETAINED.nodeVersion}\0`)),
    "retained Node version string absent",
  );
  const retained = await inspectRetained(archive, work);
  const installedPdh = packageRoot(installedCli, pdh.name);
  const cipher = packageRoot(installedPdh, "better-sqlite3-multiple-ciphers");
  assert.equal(
    readJson(path.join(cipher, "package.json")).version,
    RETAINED.cipherVersion,
  );
  verifySourceParity(retained.published.root, cipher);
  fs.mkdirSync(path.dirname(path.join(cipher, RETAINED.addon)), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(retained.donor, RETAINED.addon),
    path.join(cipher, RETAINED.addon),
  );
  const stage = path.join(work, "stage");
  fs.mkdirSync(stage);
  const packaged = stageInstalledCli(install, stage);
  const cliParity = verifySourceParity(publishedCli.root, packaged);
  for (const child of children)
    assert.deepEqual(
      verifySourceParity(child.sourceRoot, packageRoot(packaged, child.name)),
      child.parity,
    );
  const packagedCipher = packageRoot(
    packageRoot(packaged, pdh.name),
    "better-sqlite3-multiple-ciphers",
  );
  const addon = inspectAddon(
    requireDigest(
      path.join(packagedCipher, RETAINED.addon),
      RETAINED.addonSha256,
    ),
  );
  verifySourceParity(retained.published.root, packagedCipher, {
    allowExtra: true,
  });
  assert.ok(
    fs.existsSync(
      path.join(packageRoot(packaged, "sql.js"), "dist", "sql-wasm.wasm"),
    ),
    "sql.js fallback WASM missing",
  );
  const packed = path.join(output, "cc-cli.tgz");
  run("tar", ["--format=ustar", "-czf", packed, "package/"], stage);
  const evidence = {
    schema: "chainlesschain.android-cli-registry-refresh.v1",
    cliVersion,
    expectedCliSha,
    registry: REGISTRY,
    cliProvenance: provenance,
    cliSourceParity: cliParity,
    dependencies: dependencyAudit,
    children: children.map(({ sourceRoot, ...value }) => value),
    retained: {
      version: fromVersion,
      archiveSha256: RETAINED.archiveSha256,
      nodeSha256: RETAINED.nodeSha256,
      nodeVersion: RETAINED.nodeVersion,
      abi: RETAINED.abi,
    },
    requiredNativeBindings: [
      {
        name: "better-sqlite3-multiple-ciphers",
        ...retained.evidence,
        ...addon,
        selectedBy: pdh.name,
      },
    ],
    unsupportedOptionalNativeBindings: unsupportedNativePackages(packaged),
    validation: {
      registryBytes: true,
      retainedBinaryIdentity: true,
      androidRuntimeExecution: false,
      note: "Static ABI/source verification; no Android device execution in this packaging job.",
    },
    artifact: {
      name: "cc-cli.tgz",
      bytes: fs.statSync(packed).size,
      sha256: digest(fs.readFileSync(packed)),
      format: "ustar",
    },
  };
  writeJson(path.join(output, "android-cli-bundle.json"), evidence);
  console.log(
    JSON.stringify(
      {
        artifact: evidence.artifact,
        cliVersion,
        children: dependencyAudit.children,
      },
      null,
      2,
    ),
  );
  return evidence;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === "--inspect-retained" && args.length === 3) {
      const output = path.resolve(args[2]);
      fs.mkdirSync(output, { recursive: true });
      const result = await inspectRetained(path.resolve(args[1]), output);
      writeJson(path.join(output, "retained-binding.json"), result.evidence);
      console.log(JSON.stringify(result.evidence, null, 2));
    } else {
      assert.equal(
        args.length,
        0,
        "configuration is supplied through workflow environment variables",
      );
      await refresh({
        cliVersion: process.env.CLI_VERSION,
        expectedCliSha: process.env.EXPECTED_CLI_SHA,
        fromVersion: process.env.FROM_BINARIES_VERSION,
        output: path.resolve(
          process.env.BUNDLE_OUTPUT || "android-cli-bundle-output",
        ),
      });
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
