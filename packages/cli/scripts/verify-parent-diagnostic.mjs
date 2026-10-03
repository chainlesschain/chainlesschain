import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const driver = path.dirname(fileURLToPath(import.meta.url));
const probe = path.join(driver, "vitest-parent-diagnostic.cjs");
const source = fs.readFileSync(probe, "utf8");
let imports = 0;
vm.runInNewContext(source, {
  process: {
    argv: ["node", "C:\\repo\\node_modules\\vitest\\dist\\workers\\forks.js"],
  },
  require() {
    imports++;
    throw new Error("worker imported module");
  },
});
assert.equal(imports, 0);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vitest-parent-probe-"));
const childPath = path.join(temp, "worker.cjs");
const parentPath = path.join(temp, "probe-parent.cjs");
fs.writeFileSync(
  childPath,
  `
const assert = require('node:assert/strict');
assert.equal(process.listenerCount('message'), 0);
assert.equal(require('node:child_process').spawn.name, 'spawn');
if (process.argv[2] === 'abnormal') process.exit(7);
process.on('message', message => {
  if (message.type === 'run') process.send({__vitest_worker_response__:true,type:'testfileFinished'});
  if (message.type === 'stop') process.send({__vitest_worker_response__:true,type:'stopped'});
});
process.send({__vitest_worker_response__:true,type:'started'});
`,
);
fs.writeFileSync(
  parentPath,
  `
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const child = fork(process.argv[2], [process.argv[3]], {stdio:'pipe'});
function emitUnexpectedExit() {}
child.on('exit', emitUnexpectedExit);
child.on('message', message => {
  if (message.type === 'started') child.send({__vitest_worker_request__:true,type:'run',context:{files:[{filepath:'example.test.js'}]}});
  if (message.type === 'testfileFinished') {
    child.off('exit', emitUnexpectedExit);
    child.send({__vitest_worker_request__:true,type:'stop'});
  }
  if (message.type === 'stopped') child.kill();
});
child.on('exit', (code, signal) => {
  if (process.argv[3] === 'abnormal') assert.equal(code, 7);
  else assert.equal(signal, 'SIGTERM');
});
`,
);
for (const mode of ["abnormal", "normal"]) {
  const output = path.join(temp, mode);
  const result = spawnSync(
    process.execPath,
    ["--require", probe, parentPath, childPath, mode],
    {
      encoding: "utf8",
      env: { ...process.env, CC_PARENT_DIAGNOSTIC_DIR: output },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const records = fs
    .readdirSync(output)
    .map((file) =>
      JSON.parse(fs.readFileSync(path.join(output, file), "utf8")),
    );
  const child = records.find((record) => record.kind === "fork");
  const exit = child.events.find((event) => event.event === "exit");
  assert.ok(exit);
  if (mode === "abnormal") {
    assert.equal(exit.code, 7);
    assert.ok(
      exit.exitListeners.some(
        (listener) => listener.name === "emitUnexpectedExit",
      ),
    );
    assert.equal(
      child.events.filter((event) => event.event === "kill").length,
      0,
    );
  } else {
    assert.equal(exit.signal, "SIGTERM");
    assert.ok(
      !exit.exitListeners.some(
        (listener) => listener.name === "emitUnexpectedExit",
      ),
    );
    const finished = child.events.find(
      (event) => event.type === "testfileFinished",
    );
    const removed = child.events.find(
      (event) => event.event === "listener:off",
    );
    const stop = child.events.find(
      (event) => event.event === "send" && event.type === "stop",
    );
    const stopped = child.events.find((event) => event.type === "stopped");
    const kill = child.events.find((event) => event.event === "kill");
    assert.ok(
      finished.sequence < removed.sequence &&
        removed.sequence < stop.sequence &&
        stop.sequence < stopped.sequence &&
        stopped.sequence < kill.sequence &&
        kill.sequence < exit.sequence,
    );
    assert.ok(kill.stack.includes("probe-parent.cjs"));
  }
  // The parent preload must never produce a worker-owned observation file.
  assert.ok(
    records.every(
      (record) => record.pid !== child.pid || record.kind === "fork",
    ),
  );
}
console.log(
  JSON.stringify(
    {
      success: true,
      checks: [
        "worker imports=0",
        "worker message listeners=0",
        "worker child_process unchanged",
        "raw abnormal exit=7 preserved",
        "unexpected exit listener present on abnormal exit",
        "normal testfileFinished/remove/stop/stopped/kill/exit order",
        "raw SIGTERM preserved",
        "no worker observations",
      ],
      evidenceDirectory: temp,
    },
    null,
    2,
  ),
);
