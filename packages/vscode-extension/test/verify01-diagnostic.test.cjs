const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");
const {
  settleDiagnosticLauncher,
} = require("./extension-host/verify01-diagnostic.cjs");

function launch(program) {
  const child = spawn(process.execPath, ["-e", program], {
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const handle = { child, closed: false, done: null };
  handle.done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      handle.closed = true;
      resolve({ code, signal });
    });
  });
  handle.done.catch(() => {});
  return handle;
}

test("diagnostic supervisor preserves real successful exit", async () => {
  const handle = launch("process.disconnect();");
  const result = await settleDiagnosticLauncher(handle, Date.now() + 5000);
  assert.deepEqual(result.exit, { code: 0, signal: null });
  assert.equal(result.failure, undefined);
  assert.equal(result.cleanupError, undefined);
});

test("outer deadline requests bounded orderly IPC cleanup and remains failed", async () => {
  const handle = launch(
    "process.on('message',m=>{if(m.type==='verify01-cancel')process.exit(0)});",
  );
  const result = await settleDiagnosticLauncher(handle, Date.now() + 500, 3000);
  assert.match(result.failure, /outer VS Code diagnostic deadline exceeded/u);
  assert.deepEqual(result.exit, { code: 0, signal: null });
  assert.equal(result.cleanupError, undefined);
  assert.equal(handle.closed, true);
});

test("unresponsive launcher is force-cleaned after bounded cancellation", async () => {
  const handle = launch(
    "process.on('message',()=>{});setInterval(()=>{},1000);",
  );
  const result = await settleDiagnosticLauncher(handle, Date.now() + 500, 200);
  assert.match(result.failure, /deadline exceeded/u);
  assert.match(result.cleanupError, /launcher cleanup deadline exceeded/u);
  assert.equal(handle.closed, true);
  assert.throws(() => process.kill(handle.child.pid, 0), { code: "ESRCH" });
});
