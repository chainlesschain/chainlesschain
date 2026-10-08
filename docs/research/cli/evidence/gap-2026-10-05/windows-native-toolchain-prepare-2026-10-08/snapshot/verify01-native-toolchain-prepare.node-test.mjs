import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  extractRegistryPackageFiles,
  verifyRegistryPackageContent,
} from "../scripts/verify01-registry-content.mjs";
import {
  planLockedToolchain,
  resolveLockedDependency,
  safePreparationPath,
  prepareNativeToolchain,
} from "../scripts/verify01-native-toolchain-prepare.mjs";
import {
  fixture,
  integrity,
  sha256,
  tarBytes,
} from "./helpers/verify01-registry-tar.mjs";

function entry(name, extra = {}) {
  return {
    version: "1.0.0",
    resolved: `https://registry.npmjs.org/${name}/-/${name}.tgz`,
    integrity: "sha512-" + Buffer.alloc(64).toString("base64"),
    ...extra,
  };
}
function locked(packages) {
  return { lockfileVersion: 3, packages };
}
test("dependency resolution preserves closest nested and hoisted original lock paths", () => {
  const packages = {
    "node_modules/a": entry("a"),
    "node_modules/a/node_modules/b": entry("b"),
    "node_modules/b": entry("b", { version: "2.0.0" }),
    "node_modules/c": entry("c"),
  };
  packages["node_modules/a"].dependencies = { b: "1.x", c: "*" };
  assert.equal(
    resolveLockedDependency(packages, "node_modules/a", "b"),
    "node_modules/a/node_modules/b",
  );
  assert.equal(
    resolveLockedDependency(packages, "node_modules/a/node_modules/b", "c"),
    "node_modules/c",
  );
  assert.deepEqual(
    planLockedToolchain(locked(packages), { roots: ["a"] }).packages.map(
      (row) => row.path,
    ),
    ["node_modules/a", "node_modules/a/node_modules/b", "node_modules/c"],
  );
});
test("cycles terminate and required/optional peers resolve from frozen installation", () => {
  const packages = {
    "node_modules/a": entry("a", {
      dependencies: { b: "*" },
      peerDependencies: { absent: "*" },
      peerDependenciesMeta: { absent: { optional: true } },
    }),
    "node_modules/b": entry("b", { peerDependencies: { a: "1.x" } }),
  };
  const plan = planLockedToolchain(locked(packages), { roots: ["a"] });
  assert.equal(plan.packages.length, 2);
  assert.equal(plan.omitted[0].reason, "optional-absent");
});
test("optional platform artifacts omitted but required mismatches and missing dependencies fail", () => {
  const packages = {
    "node_modules/a": entry("a", { optionalDependencies: { native: "*" } }),
    "node_modules/native": entry("native", { os: ["linux"], cpu: ["arm64"] }),
  };
  assert.equal(
    planLockedToolchain(locked(packages), {
      roots: ["a"],
      platform: "win32",
      arch: "x64",
    }).packages.length,
    1,
  );
  packages["node_modules/a"].optionalDependencies = {};
  packages["node_modules/a"].dependencies = { native: "*" };
  assert.throws(
    () =>
      planLockedToolchain(locked(packages), {
        roots: ["a"],
        platform: "win32",
        arch: "x64",
      }),
    /excludes target/,
  );
  delete packages["node_modules/native"];
  assert.throws(
    () => planLockedToolchain(locked(packages), { roots: ["a"] }),
    /missing locked dependency/,
  );
});
for (const [name, mutation] of [
  [
    "linked package",
    (e) => {
      e.link = true;
    },
  ],
  [
    "HTTP artifact",
    (e) => {
      e.resolved = "http://registry.npmjs.org/a.tgz";
    },
  ],
  [
    "foreign artifact host",
    (e) => {
      e.resolved = "https://example.com/a.tgz";
    },
  ],
  [
    "URL credentials",
    (e) => {
      e.resolved = "https://user:pass@registry.npmjs.org/a.tgz";
    },
  ],
  [
    "missing integrity",
    (e) => {
      delete e.integrity;
    },
  ],
])
  test(`rejects ${name}`, () => {
    const e = entry("a");
    mutation(e);
    assert.throws(() =>
      planLockedToolchain(locked({ "node_modules/a": e }), { roots: ["a"] }),
    );
  });
test("rejects lock resolution with incompatible version", () => {
  assert.throws(
    () =>
      planLockedToolchain(
        locked({
          "node_modules/a": entry("a", { dependencies: { b: "^2" } }),
          "node_modules/b": entry("b"),
        }),
        { roots: ["a"] },
      ),
    /does not satisfy/,
  );
});
test("safe writer names reject traversal, aliases and Windows special paths", () => {
  for (const name of [
    "../escape",
    "/absolute",
    "a/./b",
    "a\\b",
    "a/NUL.txt",
    "a/ADS:stream",
    "a/trailing.",
    "a/trailing ",
  ])
    assert.throws(() => safePreparationPath(name));
});
test("extraction exposes bytes only after the same complete registry validation", () => {
  const options = fixture([
    { name: "package/never-run.cjs", bytes: "throw Error('must not execute')" },
  ]);
  const extracted = extractRegistryPackageFiles(options);
  assert.equal(
    extracted.files[1].content.toString(),
    "throw Error('must not execute')",
  );
  assert.equal(
    verifyRegistryPackageContent({
      ...options,
      installedFiles: extracted.files,
    }).registryContentVerified,
    true,
  );
  assert.equal(
    Object.hasOwn(verifyRegistryPackageContent(options), "files"),
    false,
  );
});
for (const [name, rows] of [
  ["symlink", [{ name: "package/link", type: "2" }]],
  ["path traversal", [{ name: "package/../escape", bytes: "x" }]],
  [
    "case alias",
    [
      { name: "package/a", bytes: "x" },
      { name: "package/A", bytes: "x" },
    ],
  ],
])
  test(`new extraction API still rejects ${name}`, () =>
    assert.throws(() => extractRegistryPackageFiles(fixture(rows))));
test("bad integrity and trailing malformed entry cannot expose earlier file bytes", () => {
  const options = fixture();
  assert.throws(
    () =>
      extractRegistryPackageFiles({
        ...options,
        integrity: integrity(Buffer.from("different")),
      }),
    /integrity differs/,
  );
  assert.throws(() =>
    extractRegistryPackageFiles(
      fixture([
        { name: "package/ok", bytes: "ok" },
        { name: "package/link", type: "1" },
      ]),
    ),
  );
});

function typesArchive({
  root = "chai",
  metadata = { name: "@types/chai", version: "5.2.3" },
  extra = [],
} = {}) {
  const tarball = gzipSync(
    tarBytes([
      { name: `${root}/`, type: "5" },
      { name: `${root}/package.json`, bytes: JSON.stringify(metadata) },
      { name: `${root}/index.d.ts`, bytes: "export {};" },
      ...extra,
    ]),
  );
  return {
    tarball,
    integrity: integrity(tarball),
    packageName: "@types/chai",
    packageVersion: "5.2.3",
  };
}
test("supports DefinitelyTyped NAME root only for independently locked @types/NAME", () => {
  for (const root of ["chai", "package"]) {
    const options = typesArchive({ root });
    const result = extractRegistryPackageFiles(options);
    assert.deepEqual(
      result.files.map((file) => file.path),
      ["package.json", "index.d.ts"],
    );
    assert.equal(
      verifyRegistryPackageContent({ ...options, installedFiles: result.files })
        .registryContentVerified,
      true,
    );
  }
  assert.throws(
    () =>
      extractRegistryPackageFiles({ ...typesArchive(), packageName: "chai" }),
    /outside package root/,
  );
});
for (const root of ["unknown", "chai-other", "Chai"])
  test(`rejects unknown or root-like DefinitelyTyped prefix ${root}`, () => {
    assert.throws(
      () => extractRegistryPackageFiles(typesArchive({ root })),
      /outside package root/,
    );
  });
test("rejects mixed package and DefinitelyTyped roots in either order", () => {
  for (const [root, other] of [
    ["chai", "package"],
    ["package", "chai"],
  ]) {
    const options = typesArchive({
      root,
      extra: [{ name: `${other}/foreign.d.ts`, bytes: "x" }],
    });
    assert.throws(
      () => extractRegistryPackageFiles(options),
      /outside package root/,
    );
  }
});
test("DefinitelyTyped root cannot bypass frozen metadata name/version", () => {
  for (const metadata of [
    { name: "other", version: "5.2.3" },
    { name: "@types/chai", version: "9.0.0" },
  ])
    assert.throws(
      () => extractRegistryPackageFiles(typesArchive({ metadata })),
      /identity differs/,
    );
});

async function preparedFixture({ corrupt = false, existing = false } = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-prepare-contract-"),
  );
  const output = path.join(directory, "new-output");
  const tarballs = new Map(),
    packages = {};
  for (const name of ["vitest", "vite", "happy-dom"]) {
    const tarball = gzipSync(
      tarBytes([
        {
          name: "package/package.json",
          bytes: JSON.stringify({
            name,
            version: "1.0.0",
            scripts: { install: "throw Error('never execute')" },
          }),
        },
        { name: "package/install.cjs", bytes: "throw Error('never execute')" },
      ]),
    );
    const value = entry(name, { integrity: integrity(tarball) });
    packages[`node_modules/${name}`] = value;
    tarballs.set(value.resolved, tarball);
  }
  const bytes = Buffer.from(JSON.stringify(locked(packages)));
  const options = {
    output,
    lockDigest: sha256(bytes),
    readFrozen: () => [
      {
        path: "package-lock.json",
        content: bytes,
        bytes: bytes.length,
        digest: sha256(bytes),
      },
    ],
    fetchArtifact: async (url) =>
      corrupt ? Buffer.from("bad") : tarballs.get(url),
  };
  if (existing) {
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, "sentinel"), "keep");
  }
  return { directory, output, options };
}
test("prepares exact package paths without lifecycle, links, imports or addon execution", async () => {
  const fixture = await preparedFixture();
  try {
    const result = await prepareNativeToolchain(fixture.options);
    assert.equal(result.status, "PREPARED_NOT_EXECUTED");
    assert.equal(result.packages.length, 3);
    assert.equal(result.executionStatus, "NOT_RUN");
    assert.equal(result.trusted, false);
    assert.equal(
      fs.existsSync(path.join(fixture.output, "tree/node_modules/.bin")),
      false,
    );
    const manifest = fs.readFileSync(
      path.join(fixture.output, "registry-artifacts.json"),
    );
    assert.equal(sha256(manifest), result.registryManifestDigest);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
test("refuses an existing destination and preserves its files", async () => {
  const fixture = await preparedFixture({ existing: true });
  try {
    await assert.rejects(prepareNativeToolchain(fixture.options), /EEXIST/);
    assert.equal(
      fs.readFileSync(path.join(fixture.output, "sentinel"), "utf8"),
      "keep",
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
test("failed integrity retains raw downloaded artifact and failure report without extracting package", async () => {
  const fixture = await preparedFixture({ corrupt: true });
  try {
    const result = await prepareNativeToolchain(fixture.options);
    assert.equal(result.status, "FAILED_RETAINED");
    assert.equal(result.artifacts[0].verified, false);
    assert.equal(
      fs.readFileSync(path.join(fixture.output, "tarballs/0000.tgz"), "utf8"),
      "bad",
    );
    assert.equal(
      fs.existsSync(path.join(fixture.output, "tree/node_modules")),
      false,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(fixture.output, "preparation.json")))
        .status,
      "FAILED_RETAINED",
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
