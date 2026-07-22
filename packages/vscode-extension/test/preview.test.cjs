"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { PreviewController } = require("../src/preview.js");

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit("exit", 0);
  return child;
}

async function eventually(check, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("condition did not become true before timeout");
}

(async () => {
  const opened = [];
  const statuses = [];
  let child;
  const controller = new PreviewController({
    readPackageJson: () => ({ scripts: { dev: "vite" } }),
    spawn: () => {
      child = childProcess();
      return child;
    },
    probeUrl: async () => true,
    openUrl: (url) => opened.push(url),
    onStatus: (status) => statuses.push(status),
  });
  assert.deepEqual(controller.start("C:/workspace"), { started: true, script: "dev" });
  child.stdout.write("Local: http://localhost:5173/\n");
  await eventually(() => controller.state().health === "ok");
  assert.equal(controller.state().url, "http://localhost:5173/");
  assert.deepEqual(opened, ["http://localhost:5173/"]);
  assert.equal(statuses.at(-1).state, "ready");

  const failed = new PreviewController({
    readPackageJson: () => ({ scripts: { dev: "vite" } }),
    spawn: () => {
      const next = childProcess();
      setImmediate(() => next.stdout.write("http://localhost:4173/\n"));
      return next;
    },
    probeUrl: async () => false,
    openUrl: () => assert.fail("unhealthy preview must not open"),
  });
  failed.start("C:/workspace");
  await eventually(() => failed.state().health === "failed");
  assert.equal(failed.state().running, true);

  console.log("preview: 8 assertions passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
