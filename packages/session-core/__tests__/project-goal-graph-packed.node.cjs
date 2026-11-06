const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const { gunzipSync } = require("node:zlib");
const { test } = require("node:test");
const repo = path.resolve(__dirname, "../../..");
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    ),
    path.join(
      path.dirname(path.dirname(process.execPath)),
      "lib/node_modules/npm/bin/npm-cli.js",
    ),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  assert.ok(found, "npm CLI is required");
  return found;
}
function unpack(pack, destination, filter) {
  const archive = gunzipSync(fs.readFileSync(pack)),
    entries = new Map();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (a, b) =>
      header.subarray(a, b).toString("utf8").replace(/\0.*$/s, "").trim();
    const name = field(0, 100),
      prefix = field(345, 500),
      full = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(field(124, 136) || "0", 8),
      start = offset + 512;
    assert.ok(
      Number.isSafeInteger(size) && size >= 0 && start + size <= archive.length,
    );
    if (full.startsWith("package/") && filter(full.slice(8))) {
      assert.ok(
        ["", "0"].includes(field(156, 157)) && !field(157, 257),
        "Regular packed files only",
      );
      const relative = full.slice(8);
      assert.ok(
        !relative.split("/").includes("..") && !path.isAbsolute(relative),
      );
      assert.ok(!entries.has(relative), `Duplicate packed file ${relative}`);
      entries.set(relative, archive.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  for (const [name, bytes] of entries) {
    const file = path.resolve(destination, ...name.split("/"));
    assert.ok(
      path.relative(destination, file) &&
        !path.relative(destination, file).startsWith(".."),
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return entries;
}
function copySchemaDependencies(destinationRoot) {
  const copied = new Map();
  function copy(name, from) {
    let source = path.dirname(require.resolve(name, { paths: [from] })),
      metadata;
    for (;;) {
      const file = path.join(source, "package.json");
      if (fs.existsSync(file)) {
        const value = JSON.parse(fs.readFileSync(file, "utf8"));
        if (value.name === name) {
          metadata = value;
          break;
        }
      }
      const parent = path.dirname(source);
      assert.notEqual(parent, source, `Missing package root: ${name}`);
      source = parent;
    }
    if (copied.has(name)) {
      assert.equal(copied.get(name), metadata.version);
      return;
    }
    copied.set(name, metadata.version);
    const destination = path.join(
      destinationRoot,
      "node_modules",
      ...name.split("/"),
    );
    fs.cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter: (file) =>
        !path.relative(source, file).split(path.sep).includes("node_modules"),
    });
    for (const child of Object.keys(metadata.dependencies ?? {}))
      copy(child, source);
  }
  const cli = JSON.parse(
    fs.readFileSync(path.join(repo, "packages/cli/package.json"), "utf8"),
  );
  for (const name of ["ajv", "ajv-formats"]) {
    assert.ok(cli.dependencies[name]);
    copy(name, path.join(repo, "packages/cli"));
  }
}
test(
  "packed CLI project Graph host loads without CLI program startup or workspace dependencies",
  { timeout: 150000 },
  () => {
    const temporaryBase = path.resolve(os.tmpdir()),
      root = fs.mkdtempSync(path.join(temporaryBase, "cc-packed-goal-graph-"));
    assert.equal(path.dirname(root), temporaryBase);
    try {
      const roots = {
        "session-core": path.join(
          root,
          "node_modules/@chainlesschain/session-core",
        ),
        cli: path.join(root, "packages/cli"),
      };
      for (const name of ["session-core", "cli"]) {
        const packed = spawnSync(
          process.execPath,
          [
            npmCli(),
            "pack",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            root,
            "--cache",
            path.join(root, "cache"),
          ],
          {
            cwd: path.join(repo, "packages", name),
            encoding: "utf8",
            windowsHide: true,
            timeout: 60000,
            maxBuffer: 32 * 1024 * 1024,
          },
        );
        assert.equal(packed.status, 0, packed.error?.message || packed.stderr);
        const archive = path.join(root, JSON.parse(packed.stdout)[0].filename);
        const contents = unpack(
          archive,
          roots[name],
          (p) =>
            p === "package.json" ||
            (name === "session-core"
              ? p.startsWith("lib/")
              : p.startsWith("src/") && /\.(?:js|mjs|cjs|json)$/u.test(p)),
        );
        if (name === "cli")
          for (const p of [
            "src/host/project-goal-graph.js",
            "src/lib/graph-kernel/runtime.js",
            "src/lib/graph-kernel/graph-runtime-surfaces.json",
          ])
            assert.deepEqual(
              contents.get(p),
              fs.readFileSync(path.join(repo, "packages/cli", p)),
              `Packed source mismatch: ${p}`,
            );
      }
      copySchemaDependencies(root);
      const probe = path.join(root, "probe.mjs");
      fs.writeFileSync(
        probe,
        `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {PROJECT_GOAL_GRAPH_HOST_VERSION,createProjectGoalGraphAuthority,projectGoalGraphMode} from './packages/cli/src/host/project-goal-graph.js';
assert.equal(PROJECT_GOAL_GRAPH_HOST_VERSION,1);assert.equal(projectGoalGraphMode({}),'legacy');
const authority=createProjectGoalGraphAuthority({database:new DatabaseSync('./native-graph.sqlite'),mode:'canonical',readCommittedResult:()=>({found:false})});
const context={job:{id:'native-job',kind:'project-risk-review',revision:1,retryPolicy:{maxAttempts:1}},occurrence:{id:'native-occurrence',jobRevision:1,idempotencyKey:'native-occurrence',ownerId:'native-owner',fence:1,attempt:1},authority:{}};
authority.begin(context);authority.settleSuccess(context,{reviewId:'native-review'});
assert.equal(authority.validateCommittedResult(context,{reviewId:'native-review'}).status,'succeeded');authority.close();
assert.equal(fs.existsSync('./unexpected-cli-home'),false);console.log('isolated-packed-project-graph-host: passed');
`,
      );
      const result = spawnSync(
        process.execPath,
        ["--experimental-sqlite", probe],
        {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
          env: {
            ...process.env,
            NODE_PATH: "",
            CHAINLESSCHAIN_HOME: path.join(root, "unexpected-cli-home"),
          },
        },
      );
      assert.equal(result.status, 0, result.error?.message || result.stderr);
      assert.match(
        result.stdout,
        /isolated-packed-project-graph-host: passed/u,
      );
    } finally {
      if (path.dirname(path.resolve(root)) === temporaryBase)
        fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
