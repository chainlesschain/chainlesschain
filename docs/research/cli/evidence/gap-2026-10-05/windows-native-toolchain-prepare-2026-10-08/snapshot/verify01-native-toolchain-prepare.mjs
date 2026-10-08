#!/usr/bin/env node
/** Materialize frozen registry/Git bytes in a NEW operator tree. No npm,
 * lifecycle scripts, package imports, addon loads, or native execution. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import semver from "semver";
import { readNativeReviewBundle } from "./verify01-native-review-admission.mjs";
import { validateVerify01Bundle } from "../src/lib/eval/verify01-contracts.js";
import { extractRegistryPackageFiles } from "./verify01-registry-content.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const MAX_FILE = 32 * 1024 * 1024,
  MAX_TOTAL = 512 * 1024 * 1024,
  MAX_FILES = 20000;
const ROOTS = ["vitest", "vite", "happy-dom"];
const METADATA = [
  "package.json",
  "package-lock.json",
  "packages/cli/package.json",
  "packages/cli/vitest.config.js",
];
const SUPPORT = [
  "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
  "packages/cli/test/helpers/windows-sandbox-adapter-temp-root.js",
  "packages/cli/test/helpers/windows-sandbox-adapter-cleanup.js",
  "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js",
  "packages/cli/test/setup/agent-evolution-test-boundary.js",
];
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const requireCondition = (value, message) => {
  if (!value) throw new Error(`Native toolchain preparation: ${message}`);
};
export function safePreparationPath(value) {
  requireCondition(
    typeof value === "string" &&
      value.length <= 1024 &&
      !/[\\:*?<>|"\u0000]/u.test(value) &&
      value.split("/").length <= 32 &&
      value
        .split("/")
        .every(
          (part) =>
            part &&
            part !== "." &&
            part !== ".." &&
            !/[. ]$/u.test(part) &&
            !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
        ),
    "unsafe destination path",
  );
  return value;
}
function packageName(location) {
  return location.slice(location.lastIndexOf("node_modules/") + 13);
}
export function resolveLockedDependency(packages, from, name) {
  requireCondition(
    /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/u.test(name),
    "unsafe dependency name",
  );
  let directory = from;
  for (;;) {
    if (path.posix.basename(directory) !== "node_modules") {
      const candidate =
        (directory ? directory + "/" : "") + "node_modules/" + name;
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    if (!directory) return null;
    const parent = path.posix.dirname(directory);
    directory = parent === "." ? "" : parent;
  }
}
function matchesTarget(conditions, target) {
  if (conditions === undefined) return true;
  requireCondition(
    Array.isArray(conditions) &&
      conditions.every((item) => typeof item === "string"),
    "invalid OS/CPU constraint",
  );
  const positives = conditions.filter((item) => !item.startsWith("!"));
  return (
    !conditions.includes("!" + target) &&
    (!positives.length ||
      positives.includes(target) ||
      positives.includes("any"))
  );
}
export function planLockedToolchain(
  lock,
  { platform = process.platform, arch = process.arch, roots = ROOTS } = {},
) {
  requireCondition(
    [2, 3].includes(lock?.lockfileVersion) &&
      lock.packages &&
      typeof lock.packages === "object",
    "invalid frozen lock",
  );
  const selected = new Map(),
    queue = [],
    omitted = [];
  function add(from, name, range, optional, relation) {
    const location = resolveLockedDependency(lock.packages, from, name);
    if (!location) {
      requireCondition(
        optional,
        `missing locked dependency ${name} from ${from}`,
      );
      omitted.push({ from, name, reason: "optional-absent" });
      return;
    }
    const entry = lock.packages[location];
    if (!matchesTarget(entry.os, platform) || !matchesTarget(entry.cpu, arch)) {
      requireCondition(
        optional,
        `required dependency ${location} excludes target`,
      );
      omitted.push({
        from,
        name,
        path: location,
        reason: "optional-target-excluded",
      });
      return;
    }
    requireCondition(
      !entry.libc || platform === "win32" || platform === "darwin",
      "Linux libc must be explicitly supported before preparation",
    );
    requireCondition(
      !entry.link &&
        typeof entry.version === "string" &&
        semver.valid(entry.version),
      `linked or unversioned package ${location}`,
    );
    safePreparationPath(location);
    requireCondition(
      location.startsWith("node_modules/"),
      "dependency escapes registry installation tree",
    );
    requireCondition(
      typeof entry.resolved === "string",
      "registry URL missing",
    );
    const url = new URL(entry.resolved);
    requireCondition(
      url.protocol === "https:" &&
        url.hostname === "registry.npmjs.org" &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.search,
      "only frozen HTTPS registry.npmjs.org artifacts supported",
    );
    requireCondition(
      /^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry.integrity ?? ""),
      "locked sha512 integrity missing",
    );
    requireCondition(
      range === null ||
        (typeof range === "string" &&
          semver.validRange(range) &&
          semver.satisfies(entry.version, range)),
      `locked version does not satisfy ${name} ${range}`,
    );
    if (!selected.has(location)) {
      requireCondition(
        selected.size < 2048,
        "dependency closure exceeds package bound",
      );
      const row = {
        path: location,
        name: packageName(location),
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
        entry,
      };
      selected.set(location, row);
      queue.push(row);
    }
  }
  for (const name of roots) add("", name, null, false, "root");
  for (let index = 0; index < queue.length; index++) {
    const { path: from, entry } = queue[index];
    const dependencies = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
    };
    for (const [name, range] of Object.entries(dependencies))
      add(
        from,
        name,
        range,
        Object.hasOwn(entry.optionalDependencies ?? {}, name),
        "dependency",
      );
    for (const [name, range] of Object.entries(entry.peerDependencies ?? {}))
      add(
        from,
        name,
        range,
        entry.peerDependenciesMeta?.[name]?.optional === true,
        "peer",
      );
  }
  return {
    platform,
    architecture: arch,
    roots: [...roots],
    packages: [...selected.values()]
      .map(({ entry, ...row }) => row)
      .sort((a, b) => a.path.localeCompare(b.path)),
    omitted,
  };
}

export function readFrozenPreparationFiles(
  commit,
  git = (args, options = {}) =>
    execFileSync("git", ["-C", repository, ...args], {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: MAX_TOTAL,
      ...options,
    }),
) {
  requireCondition(/^[a-f0-9]{40}$/u.test(commit), "invalid frozen commit");
  const listing = git([
    "ls-tree",
    "-rlz",
    commit,
    "--",
    ...METADATA,
    ...SUPPORT,
    "packages/cli/src",
    "packages/cli/test/helpers",
  ]).toString("utf8");
  const entries = listing
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/u.exec(
        line,
      );
      requireCondition(
        match,
        "frozen Git tree contains a link or unsupported entry",
      );
      const [, mode, oid, size, relative] = match;
      safePreparationPath(relative);
      const bytes = Number(size);
      requireCondition(
        Number.isSafeInteger(bytes) && bytes <= MAX_FILE,
        "frozen Git file exceeds bound",
      );
      return { path: relative, oid, bytes };
    });
  requireCondition(
    entries.length > 0 &&
      entries.length <= MAX_FILES &&
      entries.reduce((sum, row) => sum + row.bytes, 0) <= MAX_TOTAL,
    "frozen source closure exceeds bound",
  );
  const names = new Set(entries.map((row) => row.path.toLowerCase()));
  requireCondition(
    names.size === entries.length &&
      [...METADATA, ...SUPPORT].every((name) => names.has(name.toLowerCase())),
    "frozen source closure missing metadata/support or has aliases",
  );
  const batch = git(["cat-file", "--batch"], {
    input: entries.map((row) => row.oid).join("\n") + "\n",
  });
  let offset = 0;
  return entries.map((entry) => {
    const end = batch.indexOf(10, offset);
    requireCondition(
      end > offset &&
        batch.subarray(offset, end).toString("ascii") ===
          `${entry.oid} blob ${entry.bytes}`,
      "Git blob response differs",
    );
    const start = end + 1,
      next = start + entry.bytes;
    requireCondition(
      next < batch.length && batch[next] === 10,
      "Git blob response truncated",
    );
    const content = Buffer.from(batch.subarray(start, next));
    const oid = createHash("sha1")
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest("hex");
    requireCondition(oid === entry.oid, "Git blob object digest differs");
    offset = next + 1;
    if (entry === entries.at(-1))
      requireCondition(
        offset === batch.length,
        "extra Git blob response bytes",
      );
    return { ...entry, digest: hash(content), content };
  });
}

async function downloadArtifact(url) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  requireCondition(
    response.ok && response.body,
    `registry response ${response.status}`,
  );
  const length = response.headers.get("content-length");
  requireCondition(
    !length || (/^\d+$/u.test(length) && Number(length) <= MAX_FILE),
    "registry compressed artifact exceeds bound",
  );
  const parts = [];
  let count = 0;
  try {
    for await (const part of response.body) {
      count += part.length;
      requireCondition(
        count <= MAX_FILE,
        "registry response exceeds byte bound",
      );
      parts.push(part);
    }
  } catch (error) {
    await response.body.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(parts, count);
}

export async function prepareNativeToolchain({
  output,
  bundle = readNativeReviewBundle(),
  lockDigest,
  fetchArtifact = downloadArtifact,
  readFrozen = readFrozenPreparationFiles,
} = {}) {
  validateVerify01Bundle(bundle);
  requireCondition(
    path.isAbsolute(output),
    "new absolute output directory required",
  );
  const parent = path.dirname(output);
  requireCondition(
    fs.realpathSync.native(parent).toLowerCase() ===
      path.resolve(parent).toLowerCase(),
    "output parent is a path alias",
  );
  const frozen = readFrozen(bundle.catalog.projectCommit);
  const lockFile = frozen.find((row) => row.path === "package-lock.json");
  requireCondition(
    /^sha256:[a-f0-9]{64}$/u.test(lockDigest ?? "") &&
      hash(lockFile.content) === lockDigest,
    "independent frozen lock digest differs",
  );
  const plan = planLockedToolchain(
    JSON.parse(lockFile.content.toString("utf8")),
  );
  fs.mkdirSync(output, { mode: 0o700 }); // No existing directory is overwritten or removed.
  const tree = path.join(output, "tree"),
    tarballs = path.join(output, "tarballs");
  fs.mkdirSync(tree, { mode: 0o700 });
  fs.mkdirSync(tarballs, { mode: 0o700 });
  const report = {
    schema: "chainlesschain.native-toolchain-preparation/v1",
    startedAt: new Date().toISOString(),
    projectCommit: bundle.catalog.projectCommit,
    planDigest: bundle.expectedPlanDigest,
    lockDigest,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    sourceDigest: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    status: "PREPARING",
    formalSample: false,
    providerAssessed: false,
    executionStatus: "NOT_RUN",
    trusted: false,
    nativeAclAssessed: false,
    addonAbiVerified: false,
    fullReviewPackReady: false,
    output,
    tree,
    tarballs,
    plan,
    artifacts: [],
    packages: [],
    frozenFiles: [],
    files: 0,
    totalBytes: 0,
    compressedBytes: 0,
  };
  const written = new Set();
  const writeTree = (relative, content) => {
    safePreparationPath(relative);
    requireCondition(
      Buffer.isBuffer(content) &&
        content.length <= MAX_FILE &&
        report.files < MAX_FILES &&
        report.totalBytes + content.length <= MAX_TOTAL,
      "materialized tree exceeds bound",
    );
    requireCondition(
      !written.has(relative.toLowerCase()),
      "duplicate/case-alias materialized file",
    );
    let directory = tree;
    const segments = relative.split("/");
    for (const part of segments.slice(0, -1)) {
      directory = path.join(directory, part);
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
      const stat = fs.lstatSync(directory);
      requireCondition(
        stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          fs.realpathSync.native(directory).toLowerCase() ===
            directory.toLowerCase(),
        "materialization encountered a link or alias",
      );
    }
    fs.writeFileSync(path.join(directory, segments.at(-1)), content, {
      flag: "wx",
      mode: 0o600,
    });
    written.add(relative.toLowerCase());
    report.files++;
    report.totalBytes += content.length;
  };
  try {
    for (const file of frozen) {
      writeTree(file.path, file.content);
      const { content, ...descriptor } = file;
      report.frozenFiles.push(descriptor);
    }
    for (const [index, entry] of plan.packages.entries()) {
      const tarball = await fetchArtifact(entry.resolved);
      requireCondition(
        Buffer.isBuffer(tarball) &&
          tarball.length <= MAX_FILE &&
          report.compressedBytes + tarball.length <= MAX_TOTAL,
        "compressed download budget exceeded",
      );
      report.compressedBytes += tarball.length;
      // Preserve even a rejected artifact for root-cause inspection; extraction
      // is strictly after integrity, complete tar and identity verification.
      const file = `${String(index).padStart(4, "0")}.tgz`;
      fs.writeFileSync(path.join(tarballs, file), tarball, {
        flag: "wx",
        mode: 0o600,
      });
      report.artifacts.push({
        packagePath: entry.path,
        file,
        digest: hash(tarball),
        verified: false,
      });
      const extracted = extractRegistryPackageFiles({
        tarball,
        integrity: entry.integrity,
        packageName: entry.name,
        packageVersion: entry.version,
      });
      requireCondition(
        report.files + extracted.fileCount <= MAX_FILES &&
          report.totalBytes + extracted.contentBytes <= MAX_TOTAL,
        "package exceeds remaining tree budget",
      );
      for (const item of extracted.files)
        writeTree(`${entry.path}/${item.path}`, item.content);
      report.artifacts.at(-1).verified = true;
      report.packages.push({
        path: entry.path,
        artifactDigest: extracted.artifactDigest,
        files: extracted.files.map(({ content, ...descriptor }) => descriptor),
      });
    }
    const manifest = {
      schema: "chainlesschain.native-review-registry-artifacts/v1",
      artifacts: report.artifacts.map(({ packagePath, file }) => ({
        packagePath,
        file,
      })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    fs.writeFileSync(
      path.join(output, "registry-artifacts.json"),
      manifestBytes,
      { flag: "wx" },
    );
    report.registryManifestDigest = hash(manifestBytes);
    const sourceManifest = Buffer.from(
      JSON.stringify(
        { projectCommit: report.projectCommit, files: report.frozenFiles },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(output, "frozen-source-files.json"),
      sourceManifest,
      { flag: "wx" },
    );
    report.frozenSourceManifestDigest = hash(sourceManifest);
    report.status = "PREPARED_NOT_EXECUTED";
  } catch (error) {
    report.status = "FAILED_RETAINED";
    report.error = String(error.stack || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(output, "preparation.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "confirm-prepare": { type: "boolean" },
        output: { type: "string" },
        "lock-digest": { type: "string" },
      },
    });
    requireCondition(
      values["confirm-prepare"] === true,
      "--confirm-prepare required",
    );
    const report = await prepareNativeToolchain({
      output: values.output,
      lockDigest: values["lock-digest"],
    });
    console.log(
      JSON.stringify({
        status: report.status,
        packages: report.packages.length,
        files: report.files,
        totalBytes: report.totalBytes,
        registryManifestDigest: report.registryManifestDigest,
        error: report.error,
        output: report.output,
      }),
    );
    process.exitCode = report.status === "PREPARED_NOT_EXECUTED" ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
