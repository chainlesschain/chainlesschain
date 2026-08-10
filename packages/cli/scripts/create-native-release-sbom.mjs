#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStrictSemver } from "./native-release-contract.mjs";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const WORKSPACE_PATH = "packages/cli";
const LOCKFILE_NAME = "package-lock.json";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])]),
  );
}

function assertSameDependencyMap(actual, expected, label) {
  const left = JSON.stringify(stableObject(actual || {}));
  const right = JSON.stringify(stableObject(expected || {}));
  if (left !== right) {
    throw new Error(`${label} does not match the exact repository lock`);
  }
}

function packagePurl(name, version) {
  const at = name.lastIndexOf("@");
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash <= 1) throw new Error(`invalid scoped package name: ${name}`);
    return `pkg:npm/${encodeURIComponent(name.slice(0, slash))}/${encodeURIComponent(name.slice(slash + 1))}@${encodeURIComponent(version)}`;
  }
  if (at >= 0) throw new Error(`invalid npm package name: ${name}`);
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function resolveLink(packages, packagePath) {
  const entry = packages[packagePath];
  if (!entry) return null;
  if (!entry.link) return { packagePath, entry };
  const target = path.posix.normalize(String(entry.resolved || ""));
  if (
    !target ||
    target === "." ||
    target.startsWith("../") ||
    path.posix.isAbsolute(target) ||
    !packages[target] ||
    packages[target].link
  ) {
    throw new Error(
      `package-lock contains an unsafe workspace link: ${packagePath}`,
    );
  }
  return { packagePath: target, entry: packages[target] };
}

function resolveDependency(packages, fromPath, dependency) {
  let directory = fromPath;
  for (;;) {
    const candidate = path.posix.join(directory, "node_modules", dependency);
    const resolved = resolveLink(packages, candidate);
    if (resolved) return resolved;
    if (!directory) break;
    const parent = path.posix.dirname(directory);
    directory = parent === "." ? "" : parent;
  }
  return null;
}

function integrityHash(integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    return null;
  }
  const bytes = Buffer.from(integrity.slice("sha512-".length), "base64");
  if (bytes.length !== 64) throw new Error("package-lock SHA-512 is invalid");
  return { alg: "SHA-512", content: bytes.toString("hex") };
}

function componentFor(packagePath, entry, dependencyName) {
  const name = String(entry.name || dependencyName || "");
  const version = String(entry.version || "");
  if (!name || !version) {
    throw new Error(`runtime package lacks name/version: ${packagePath}`);
  }
  const purl = packagePurl(name, version);
  const component = {
    type: "library",
    "bom-ref": purl,
    name,
    version,
    purl,
    properties: [{ name: "chainlesschain:scope", value: "runtime" }],
  };
  // package-lock license strings may be SPDX expressions or legacy names/URLs.
  // CycloneDX `license.name` is valid for all of them; `license.id` is only
  // valid for one SPDX identifier and would make those historical values fail
  // schema validation.
  if (entry.license) {
    component.licenses = [{ license: { name: String(entry.license) } }];
  }
  const hash = integrityHash(entry.integrity);
  if (hash) component.hashes = [hash];
  if (
    typeof entry.resolved === "string" &&
    /^https:\/\//u.test(entry.resolved)
  ) {
    component.externalReferences = [
      { type: "distribution", url: entry.resolved },
    ];
  }
  return component;
}

function uuidFromDigest(digest) {
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createNativeReleaseSbom(options) {
  const lockBytes = fs.readFileSync(path.resolve(options.lockPath));
  const packageBytes = fs.readFileSync(path.resolve(options.packagePath));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const packageJson = JSON.parse(packageBytes.toString("utf8"));
  const commit = String(options.commit || "");
  const timestamp = String(options.timestamp || "");
  if (lock.lockfileVersion !== 3 || !lock.packages) {
    throw new Error("native SBOM requires an npm package-lock v3 packages map");
  }
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("native SBOM commit must be a full lowercase SHA-1");
  }
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("native SBOM timestamp must be an ISO date");
  }
  if (packageJson.name !== "chainlesschain") {
    throw new Error("native SBOM package must be chainlesschain");
  }
  assertStrictSemver(packageJson.version, "native SBOM package version");
  const workspace = lock.packages[WORKSPACE_PATH];
  if (!workspace || workspace.name !== packageJson.name) {
    throw new Error("CLI workspace is missing from the repository lock");
  }
  if (workspace.version !== packageJson.version) {
    throw new Error("CLI version does not match the repository lock");
  }
  assertSameDependencyMap(
    workspace.dependencies,
    packageJson.dependencies,
    "CLI runtime dependencies",
  );
  assertSameDependencyMap(
    workspace.optionalDependencies,
    packageJson.optionalDependencies,
    "CLI optional dependencies",
  );
  assertSameDependencyMap(
    workspace.peerDependencies,
    packageJson.peerDependencies,
    "CLI peer dependencies",
  );
  assertSameDependencyMap(
    workspace.peerDependenciesMeta,
    packageJson.peerDependenciesMeta,
    "CLI peer dependency metadata",
  );

  const packages = lock.packages;
  const components = new Map();
  const graph = new Map();
  const visitedPaths = new Set();
  const refByPath = new Map();

  function visit(packagePath, entry, dependencyName) {
    if (visitedPaths.has(packagePath)) {
      return refByPath.get(packagePath);
    }
    visitedPaths.add(packagePath);
    const component = componentFor(packagePath, entry, dependencyName);
    const ref = component["bom-ref"];
    refByPath.set(packagePath, ref);
    const existing = components.get(ref);
    if (existing && JSON.stringify(existing) !== JSON.stringify(component)) {
      throw new Error(`ambiguous package identity in runtime closure: ${ref}`);
    }
    components.set(ref, component);
    const required = entry.dependencies || {};
    const optional = entry.optionalDependencies || {};
    const peers = entry.peerDependencies || {};
    const optionalPeers = new Set(
      Object.entries(entry.peerDependenciesMeta || {})
        .filter(([, metadata]) => metadata?.optional === true)
        .map(([name]) => name),
    );
    const dependencyNames = [
      ...new Set([
        ...Object.keys(required),
        ...Object.keys(optional),
        ...Object.keys(peers).filter((name) => !optionalPeers.has(name)),
      ]),
    ].sort();
    const dependsOn = [];
    for (const dependency of dependencyNames) {
      const resolved = resolveDependency(packages, packagePath, dependency);
      if (!resolved) {
        if (
          Object.hasOwn(optional, dependency) ||
          optionalPeers.has(dependency)
        ) {
          continue;
        }
        throw new Error(
          `repository lock cannot resolve runtime dependency ${dependency} from ${packagePath}`,
        );
      }
      dependsOn.push(visit(resolved.packagePath, resolved.entry, dependency));
    }
    graph.set(
      ref,
      [...new Set([...(graph.get(ref) || []), ...dependsOn])].sort(),
    );
    return ref;
  }

  const directNames = [
    ...new Set([
      ...Object.keys(workspace.dependencies || {}),
      ...Object.keys(workspace.optionalDependencies || {}),
      ...Object.keys(workspace.peerDependencies || {}).filter(
        (name) => workspace.peerDependenciesMeta?.[name]?.optional !== true,
      ),
    ]),
  ].sort();
  const rootDependsOn = [];
  for (const dependency of directNames) {
    const resolved = resolveDependency(packages, WORKSPACE_PATH, dependency);
    if (!resolved) {
      if (
        Object.hasOwn(workspace.optionalDependencies || {}, dependency) ||
        workspace.peerDependenciesMeta?.[dependency]?.optional === true
      ) {
        continue;
      }
      throw new Error(
        `repository lock cannot resolve direct CLI dependency ${dependency}`,
      );
    }
    rootDependsOn.push(visit(resolved.packagePath, resolved.entry, dependency));
  }

  const rootRef = packagePurl(packageJson.name, packageJson.version);
  const runtimeRefs = [...components.keys()].sort();
  const runtimeRefsSha256 = sha256(`${runtimeRefs.join("\n")}\n`);
  const lockSha256 = sha256(lockBytes);
  const packageSha256 = sha256(packageBytes);
  const serialSeed = sha256(
    `${commit}\n${lockSha256}\n${packageSha256}\n${rootRef}\n${runtimeRefsSha256}\n`,
  );
  const dependencies = [
    { ref: rootRef, dependsOn: [...new Set(rootDependsOn)].sort() },
    ...runtimeRefs.map((ref) => ({ ref, dependsOn: graph.get(ref) || [] })),
  ];
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${uuidFromDigest(serialSeed)}`,
    version: 1,
    metadata: {
      timestamp,
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: packageJson.name,
        version: packageJson.version,
        purl: rootRef,
        properties: [
          { name: "chainlesschain:source.commit", value: commit },
          { name: "chainlesschain:lock.path", value: LOCKFILE_NAME },
          { name: "chainlesschain:lock.sha256", value: lockSha256 },
          { name: "chainlesschain:package.sha256", value: packageSha256 },
          { name: "chainlesschain:workspace.path", value: WORKSPACE_PATH },
          {
            name: "chainlesschain:runtime.refs.sha256",
            value: runtimeRefsSha256,
          },
          {
            name: "chainlesschain:runtime.refs.count",
            value: String(runtimeRefs.length),
          },
        ],
      },
    },
    components: runtimeRefs.map((ref) => components.get(ref)),
    dependencies,
  };
}

function property(component, name) {
  return component?.properties?.find((item) => item.name === name)?.value;
}

function main() {
  const [lockPath, packagePath, commit, timestamp, output, ...extra] =
    process.argv.slice(2);
  if (
    !lockPath ||
    !packagePath ||
    !commit ||
    !timestamp ||
    !output ||
    extra.length
  ) {
    throw new Error(
      "usage: create-native-release-sbom.mjs <package-lock.json> <package.json> <commit> <timestamp> <output.json>",
    );
  }
  const sbom = createNativeReleaseSbom({
    lockPath,
    packagePath,
    commit,
    timestamp,
  });
  fs.writeFileSync(path.resolve(output), `${JSON.stringify(sbom, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({
      lockSha256: property(
        sbom.metadata.component,
        "chainlesschain:lock.sha256",
      ),
      runtimeRefsSha256: property(
        sbom.metadata.component,
        "chainlesschain:runtime.refs.sha256",
      ),
      runtimeRefsCount: Number(
        property(sbom.metadata.component, "chainlesschain:runtime.refs.count"),
      ),
      serialNumber: sbom.serialNumber,
    })}\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`native release SBOM failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
