import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { test } from "vitest";

const require = createRequire(import.meta.url);
const cliRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workerPath = path.join(
  cliRoot,
  "src",
  "lib",
  "mcp-stdio-capsule-builder-worker.cjs",
);
const resolverPath = path.join(
  cliRoot,
  "src",
  "lib",
  "mcp-stdio-immutable-vfs-resolver.cjs",
);

function transferableCopy(input) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const copy = Buffer.allocUnsafeSlow(source.length);
  source.copy(copy);
  return copy;
}

async function collectWorkerResult(worker) {
  const messages = [];
  worker.on("message", (message) => messages.push(message));
  const exitCode = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  await worker.terminate();
  return { exitCode, messages };
}

function createRealBuilderWorker(workerSource, nonce) {
  const wasmBytes = transferableCopy(
    fs.readFileSync(require.resolve("esbuild-wasm/esbuild.wasm")),
  );
  const entryBytes = transferableCopy('module.exports = "blocked";\n');
  return new Worker(workerSource, {
    eval: true,
    resourceLimits: {
      maxOldGenerationSizeMb: 256,
      maxYoungGenerationSizeMb: 64,
      stackSizeMb: 8,
    },
    transferList: [wasmBytes.buffer, entryBytes.buffer],
    workerData: {
      schema: "chainlesschain.mcp-stdio-capsule-builder-worker/v1",
      nonce,
      browserApiSource: fs.readFileSync(
        require.resolve("esbuild-wasm/lib/browser.js"),
        "utf8",
      ),
      resolverSource: fs.readFileSync(resolverPath, "utf8"),
      wasmBytes,
      builderVersion: "0.28.1",
      files: [["/tree/index.cjs", entryBytes]],
      fileCount: 1,
      totalBytes: entryBytes.byteLength,
      entryPath: "/tree/index.cjs",
      vfsRoot: "/tree",
      banner: "",
      maxOutputBytes: 1024 * 1024,
      maxMetafileBytes: 1024 * 1024,
    },
  });
}

test("rejects a declared immutable VFS total above the external-memory budget", async () => {
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const wasmBytes = transferableCopy([0]);
  const entryBytes = transferableCopy("x");
  const worker = new Worker(workerSource, {
    eval: true,
    transferList: [wasmBytes.buffer, entryBytes.buffer],
    workerData: {
      schema: "chainlesschain.mcp-stdio-capsule-builder-worker/v1",
      nonce: "b".repeat(64),
      browserApiSource: "invalid but unreachable",
      resolverSource: "invalid but unreachable",
      wasmBytes,
      builderVersion: "0.28.1",
      files: [["/tree/index.cjs", entryBytes]],
      fileCount: 1,
      totalBytes: 64 * 1024 * 1024 + 64 * 1024 + 1,
      entryPath: "/tree/index.cjs",
      vfsRoot: "/tree",
      banner: "",
      maxOutputBytes: 1024,
      maxMetafileBytes: 1024,
    },
  });

  const { exitCode, messages } = await collectWorkerResult(worker);
  assert.equal(exitCode, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ok, false);
  assert.equal(messages[0].nonce, "b".repeat(64));
  assert.match(messages[0].error.message, /Worker input is invalid/);
});

test("drops the transferred VFS container after the resolver owns private copies", () => {
  const workerSource = fs.readFileSync(workerPath, "utf8");
  assert.match(
    workerSource,
    /new ImmutableVfsResolver[\s\S]*files\.clear\(\);\s*workerData\.files\.length = 0;/,
  );
});

test("constructor-escape self-test rejects a weakened browser VM", async () => {
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const weakenedSource = workerSource.replace(
    "codeGeneration: { strings: false, wasm: true }",
    "codeGeneration: { strings: true, wasm: true }",
  );
  assert.notEqual(weakenedSource, workerSource);

  const worker = createRealBuilderWorker(weakenedSource, "a".repeat(64));
  const { exitCode, messages } = await collectWorkerResult(worker);

  assert.equal(exitCode, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ok, false);
  assert.equal(messages[0].nonce, "a".repeat(64));
  assert.match(messages[0].error.message, /browser context is not isolated/);
}, 30_000);

test("constructor-escape self-test rejects a host-realm bridge error", async () => {
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const weakenedSource = workerSource.replace(
    `try {
           randomFillBridge(view);
         } catch {
           throw new Error("crypto.getRandomValues bridge failed");
         }`,
    "randomFillBridge(view);",
  );
  assert.notEqual(weakenedSource, workerSource);

  const worker = createRealBuilderWorker(weakenedSource, "c".repeat(64));
  const { exitCode, messages } = await collectWorkerResult(worker);

  assert.equal(exitCode, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ok, false);
  assert.equal(messages[0].nonce, "c".repeat(64));
  assert.match(messages[0].error.message, /browser context is not isolated/);
}, 30_000);
