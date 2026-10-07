#!/usr/bin/env node
/** Inspect an operator-prepared native toolchain without importing it or running
 * npm, addons, setup, tests, or a provider. An inventory is not sandbox admission.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import { readNativeReviewBundle } from "./verify01-native-review-admission.mjs";
import { validateVerify01Bundle } from "../src/lib/eval/verify01-contracts.js";
import { verifyRegistryPackageContent } from "./verify01-registry-content.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TREE_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 20000;
const SUPPORT_FILES = [
  "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
  "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
  "packages/cli/test/helpers/windows-sandbox-adapter-cleanup.js",
  "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js",
  "packages/cli/test/setup/agent-evolution-test-boundary.js",
];
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`Native toolchain inventory: ${message}`);
};
function readPlain(file, bound = MAX_FILE_BYTES) {
  const named = fs.lstatSync(file, { bigint: true });
  requireCondition(
    named.isFile() &&
      !named.isSymbolicLink() &&
      named.nlink === 1n &&
      named.size <= BigInt(bound),
    "file is linked, not regular, or exceeds bound",
  );
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    const buffer = Buffer.alloc(Number(named.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(
        fd,
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    // Windows pathname and opened-handle IDs can belong to different domains.
    // Compare each within its own domain, and reopen to detect substitution.
    const reopened = fs.openSync(file, fs.constants.O_RDONLY);
    let second;
    try {
      second = fs.fstatSync(reopened, { bigint: true });
    } finally {
      fs.closeSync(reopened);
    }
    const same = (a, b) =>
      ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
        (key) => a[key] === b[key],
      );
    requireCondition(
      offset === Number(named.size) &&
        same(named, current) &&
        same(before, after) &&
        same(after, second) &&
        before.isFile() &&
        before.nlink === 1n,
      "file changed during bounded descriptor read",
    );
    return buffer.subarray(0, offset);
  } finally {
    fs.closeSync(fd);
  }
}
function plainPath(root, relative, directory = false) {
  requireCondition(
    typeof relative === "string" &&
      relative.length > 0 &&
      !/[\\:*?<>|"\u0000]/u.test(relative) &&
      relative
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            !/[. ]$/u.test(part) &&
            !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
        ),
    "unsafe inventory path",
  );
  let file = root;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    file = path.join(file, part);
    const stat = fs.lstatSync(file);
    requireCondition(
      !stat.isSymbolicLink() &&
        (index < parts.length - 1 || directory
          ? stat.isDirectory()
          : stat.isFile()) &&
        fs.realpathSync.native(file).toLowerCase() ===
          path.resolve(file).toLowerCase(),
      "inventory cannot traverse a link or path alias",
    );
  }
  return file;
}

export function inspectNativeToolchain({
  root: rootInput,
  lockDigest,
  registry,
  bundle = readNativeReviewBundle(),
  readFrozenBlob = (commit, file) =>
    execFileSync("git", ["-C", repository, "show", `${commit}:${file}`], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: MAX_FILE_BYTES,
    }),
} = {}) {
  validateVerify01Bundle(bundle);
  requireCondition(
    typeof rootInput === "string" && path.isAbsolute(rootInput),
    "absolute root required",
  );
  const root = path.resolve(rootInput);
  const rootStat = fs.lstatSync(root, { bigint: true });
  requireCondition(
    rootStat.isDirectory() &&
      !rootStat.isSymbolicLink() &&
      fs.realpathSync.native(root).toLowerCase() === root.toLowerCase(),
    "plain inventory root required",
  );
  const lockBytes = readPlain(plainPath(root, "package-lock.json"));
  requireCondition(
    /^sha256:[a-f0-9]{64}$/u.test(lockDigest ?? "") &&
      evalDigest(lockBytes) === lockDigest,
    "independently pinned lock digest differs",
  );
  const frozenLock = readFrozenBlob(
    bundle.catalog.projectCommit,
    "package-lock.json",
  );
  requireCondition(
    Buffer.isBuffer(frozenLock) && frozenLock.equals(lockBytes),
    "lock differs from frozen Git blob",
  );
  const lock = JSON.parse(lockBytes.toString("utf8"));
  requireCondition(
    [2, 3].includes(lock.lockfileVersion) &&
      lock.packages &&
      typeof lock.packages === "object",
    "unsupported npm lock format",
  );
  const files = [],
    packages = [],
    addons = [],
    directories = [];
  let totalBytes = 0;
  function visit(relative) {
    requireCondition(
      directories.length < MAX_FILES,
      "directory count exceeds bound",
    );
    const directory = plainPath(root, relative, true);
    const before = fs.lstatSync(directory, { bigint: true });
    const names = fs.readdirSync(directory).sort();
    requireCondition(
      names.length <= MAX_FILES &&
        new Set(names.map((name) => name.toLowerCase())).size === names.length,
      "directory contains too many entries or case aliases",
    );
    directories.push(relative);
    for (const name of names) {
      const child = `${relative}/${name}`;
      const file = plainPath(
        root,
        child,
        fs.lstatSync(path.join(root, child)).isDirectory(),
      );
      if (fs.lstatSync(file).isDirectory()) {
        visit(child);
        continue;
      }
      requireCondition(files.length < MAX_FILES, "file count exceeds bound");
      const bytes = readPlain(file);
      totalBytes += bytes.length;
      requireCondition(totalBytes <= MAX_TREE_BYTES, "tree exceeds byte bound");
      const artifact = {
        path: child,
        bytes: bytes.length,
        digest: evalDigest(bytes),
      };
      files.push(artifact);
      if (name.endsWith(".node")) addons.push(artifact);
      if (
        name === "package.json" &&
        /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/u.test(relative)
      ) {
        const entry = lock.packages[relative],
          metadata = JSON.parse(bytes.toString("utf8"));
        requireCondition(
          entry &&
            !entry.link &&
            entry.version === metadata.version &&
            typeof metadata.name === "string" &&
            relative.endsWith(`node_modules/${metadata.name}`) &&
            typeof entry.resolved === "string" &&
            /^https:\/\//u.test(entry.resolved) &&
            typeof entry.integrity === "string" &&
            /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity),
          "package version, registry integrity or non-link provenance missing",
        );
        packages.push({
          path: relative,
          name: metadata.name,
          version: metadata.version,
          resolved: entry.resolved,
          integrity: entry.integrity,
          packageDigest: artifact.digest,
        });
      }
    }
    const after = fs.lstatSync(directory, { bigint: true });
    requireCondition(
      ["dev", "ino", "mtimeNs", "ctimeNs"].every(
        (key) => before[key] === after[key],
      ) &&
        JSON.stringify(fs.readdirSync(directory).sort()) ===
          JSON.stringify(names),
      "directory changed during inventory",
    );
  }
  visit("node_modules");
  for (const file of files) {
    // A package may contain nested fixture package.json files. Its enclosing
    // installed package, however, must be represented by the locked inventory.
    requireCondition(
      packages.some((entry) => file.path.startsWith(`${entry.path}/`)),
      "installed file belongs to an unlocked package",
    );
  }
  requireCondition(
    packages.some((entry) => entry.name === "vitest") &&
      packages.some((entry) => entry.name === "vite") &&
      packages.some((entry) => entry.name === "happy-dom"),
    "required test toolchain packages missing",
  );
  const support = SUPPORT_FILES.map((file) => {
    const bytes = readPlain(plainPath(root, file));
    const frozen = readFrozenBlob(bundle.catalog.projectCommit, file);
    requireCondition(
      Buffer.isBuffer(frozen) && frozen.equals(bytes),
      "test support differs from frozen Git blob",
    );
    return { path: file, bytes: bytes.length, digest: evalDigest(bytes) };
  });
  const currentRoot = fs.lstatSync(root, { bigint: true });
  requireCondition(
    currentRoot.dev === rootStat.dev &&
      currentRoot.ino === rootStat.ino &&
      !currentRoot.isSymbolicLink(),
    "inventory root changed",
  );
  const inventory = {
    schema: "chainlesschain.native-review-toolchain-inventory/v1",
    projectCommit: bundle.catalog.projectCommit,
    planDigest: bundle.expectedPlanDigest,
    lockDigest,
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      modulesAbi: process.versions.modules,
      executableDigest: evalDigest(
        readPlain(fs.realpathSync.native(process.execPath), 128 * 1024 * 1024),
      ),
    },
    files,
    directories,
    packages,
    addons,
    support,
    totalBytes,
  };
  let registryChecks = null;
  if (registry !== undefined) {
    requireCondition(
      registry && typeof registry.root === "string" && path.isAbsolute(registry.root) &&
        Array.isArray(registry.artifacts) && registry.artifacts.length === packages.length,
      "one registry artifact for every installed package is required",
    );
    const artifactRoot = path.resolve(registry.root);
    const artifactRootStat = fs.lstatSync(artifactRoot, { bigint: true });
    requireCondition(artifactRootStat.isDirectory() && !artifactRootStat.isSymbolicLink() &&
      fs.realpathSync.native(artifactRoot).toLowerCase() === artifactRoot.toLowerCase(), "plain registry artifact root required");
    const byPackage = new Map();
    for (const artifact of registry.artifacts) {
      requireCondition(artifact && typeof artifact.packagePath === "string" &&
        packages.some((entry) => entry.path === artifact.packagePath) &&
        !byPackage.has(artifact.packagePath), "unknown or duplicate registry package binding");
      byPackage.set(artifact.packagePath, artifact.file);
    }
    registryChecks = packages.map((entry) => {
      const installedFiles = files.filter((file) => {
        if (!file.path.startsWith(`${entry.path}/`)) return false;
        return !packages.some((nested) => nested.path.startsWith(`${entry.path}/`) &&
          file.path.startsWith(`${nested.path}/`));
      }).map((file) => ({ ...file, path: file.path.slice(entry.path.length + 1) }));
      const artifactFile = plainPath(artifactRoot, byPackage.get(entry.path));
      const verified = verifyRegistryPackageContent({ tarball: readPlain(artifactFile),
        integrity: entry.integrity, installedFiles, packageName: entry.name, packageVersion: entry.version });
      return { packagePath: entry.path, artifact: byPackage.get(entry.path), ...verified };
    });
    const after = fs.lstatSync(artifactRoot, { bigint: true });
    requireCondition(after.dev === artifactRootStat.dev && after.ino === artifactRootStat.ino &&
      !after.isSymbolicLink(), "registry artifact root changed");
    inventory.registryChecks = registryChecks;
  }
  return {
    inventory,
    inventoryDigest: outcomeDigest(inventory),
    status: "INVENTORIED_NOT_EXECUTABLE",
    executionStatus: "NOT_RUN",
    trusted: false,
    registryContentVerified: registryChecks !== null,
    addonAbiVerified: false,
    nativeAclAssessed: false,
    fullReviewPackReady: false,
    formalSample: false,
    providerAssessed: false,
    blockers: [
      ...(registryChecks === null ? ["REGISTRY_CONTENT_VERIFICATION_REQUIRED"] : []),
      "NATIVE_CAPSULE_BACKEND_NOT_IMPLEMENTED",
      "LOCKED_TEST_SUPPORT_EXECUTION_NOT_VERIFIED",
      ...(addons.length ? ["ADDON_ABI_NOT_VERIFIED"] : []),
    ],
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string" },
        "lock-digest": { type: "string" },
        "plan-dir": { type: "string" },
        "tarball-dir": { type: "string" },
        "tarball-manifest": { type: "string" },
        "tarball-manifest-digest": { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "Read-only frozen-lock native toolchain inventory; never installs, imports or executes tools.\n--root ABSOLUTE_ISOLATED_TREE --lock-digest sha256:INDEPENDENT_DIGEST [--plan-dir DIR]\nAn inventory never grants native execution; exit 2 retains all outstanding trust/ABI/ACL requirements.",
      );
    else {
      let registry;
      if (["tarball-dir", "tarball-manifest", "tarball-manifest-digest"].some((key) => values[key] !== undefined)) {
        requireCondition(values["tarball-dir"] && values["tarball-manifest"] && values["tarball-manifest-digest"],
          "tarball directory, manifest and independent digest are all required");
        const bytes = readPlain(path.resolve(values["tarball-manifest"]));
        requireCondition(evalDigest(bytes) === values["tarball-manifest-digest"], "registry manifest digest differs");
        const manifest = JSON.parse(bytes.toString("utf8"));
        requireCondition(manifest.schema === "chainlesschain.native-review-registry-artifacts/v1" && Array.isArray(manifest.artifacts),
          "registry manifest schema differs");
        registry = { root: values["tarball-dir"], artifacts: manifest.artifacts };
      }
      console.log(
        JSON.stringify(
          inspectNativeToolchain({
            root: values.root,
            lockDigest: values["lock-digest"],
            bundle: readNativeReviewBundle(values["plan-dir"]),
            registry,
          }),
          null,
          2,
        ),
      );
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
