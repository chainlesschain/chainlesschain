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

test("constructor-escape self-test rejects a weakened browser VM", async () => {
  const workerSource = fs.readFileSync(workerPath, "utf8");
  const weakenedSource = workerSource.replace(
    "codeGeneration: { strings: false, wasm: true }",
    "codeGeneration: { strings: true, wasm: true }",
  );
  assert.notEqual(weakenedSource, workerSource);

  const wasmBytes = transferableCopy(
    fs.readFileSync(require.resolve("esbuild-wasm/esbuild.wasm")),
  );
  const entryBytes = transferableCopy('module.exports = "blocked";\n');
  const worker = new Worker(weakenedSource, {
    eval: true,
    resourceLimits: {
      maxOldGenerationSizeMb: 512,
      maxYoungGenerationSizeMb: 64,
      stackSizeMb: 8,
    },
    transferList: [wasmBytes.buffer, entryBytes.buffer],
    workerData: {
      schema: "chainlesschain.mcp-stdio-capsule-builder-worker/v1",
      nonce: "a".repeat(64),
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
  const messages = [];
  worker.on("message", (message) => messages.push(message));
  const exitCode = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  await worker.terminate();

  assert.equal(exitCode, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ok, false);
  assert.equal(messages[0].nonce, "a".repeat(64));
  assert.match(messages[0].error.message, /browser context is not isolated/);
}, 30_000);
