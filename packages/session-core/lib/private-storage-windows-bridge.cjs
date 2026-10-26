// Pipe/deadline controller. Native code runs only in the isolated child.
const { parentPort, workerData } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const { dirname } = require("node:path");
const monotonicMilliseconds = () =>
  Number(process.hrtime.bigint() / 1_000_000n);
const MAX_FRAME = 8 * 1024 * 1024 + 65536;
let child = null,
  active = null,
  output = Buffer.alloc(0),
  timer = null;

function destroyChild() {
  clearTimeout(timer);
  timer = null;
  const previous = child;
  child = null;
  output = Buffer.alloc(0);
  if (previous) {
    previous.stdin.destroy();
    previous.kill("SIGKILL");
  }
}
function finish(result) {
  const request = active;
  active = null;
  clearTimeout(timer);
  timer = null;
  if (!request) return;
  const bytes = Buffer.from(JSON.stringify(result));
  const state = new Int32Array(request.shared, 0, 4);
  if (Atomics.load(state, 0) !== 0) return;
  bytes.copy(Buffer.from(request.shared, 16));
  Atomics.store(state, 1, bytes.length);
  if (Atomics.compareExchange(state, 0, 0, 1) === 0) Atomics.notify(state, 0);
}
function fail(code) {
  destroyChild();
  finish({ status: null, error: { code } });
}
function launch() {
  const current = spawn(
    process.execPath,
    [workerData.workerPath, "--persistent"],
    {
      env: workerData.environment,
      // A persistent child must not pin the caller's disposable project cwd
      // on Windows. Its script and all ACL targets already use absolute paths.
      cwd: dirname(process.execPath),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child = current;
  current.on("error", () => {
    if (child === current) fail("ACL_WORKER_ERROR");
  });
  current.on("exit", () => {
    if (child === current) fail("ACL_WORKER_EXIT");
  });
  current.stdin.on("error", () => {
    if (child === current) fail("ACL_PIPE_ERROR");
  });
  // Production workers encode only sanitized diagnostics in their response.
  // Unexpected stderr is a protocol violation, never accumulated or exposed.
  current.stderr.on("data", () => {
    if (child === current) fail("ACL_PROTOCOL_ERROR");
  });
  current.stdout.on("data", (chunk) => {
    if (child !== current) return;
    output = Buffer.concat([output, chunk]);
    if (output.length > MAX_FRAME) return fail("E2BIG");
    const newline = output.indexOf(10);
    if (newline < 0) return;
    if (!active || newline !== output.length - 1)
      return fail("ACL_PROTOCOL_ERROR");
    let response;
    try {
      response = JSON.parse(output.subarray(0, newline).toString("utf8"));
    } catch {
      return fail("ACL_PROTOCOL_ERROR");
    }
    output = Buffer.alloc(0);
    if (
      response?.id !== active.id ||
      ![0, 4].includes(response.status) ||
      typeof response.stdout !== "string" ||
      typeof response.stderr !== "string" ||
      Buffer.byteLength(response.stdout) > 4 * 1024 * 1024 ||
      Buffer.byteLength(response.stderr) > 1024
    )
      return fail("ACL_PROTOCOL_ERROR");
    // The former one-shot worker exited after any native failure. Preserve
    // that cleanup boundary: a failed CloseHandle/mutex cleanup must never
    // leave retained resources or locks in a process serving another request.
    if (response.status !== 0) destroyChild();
    finish({
      status: response.status,
      stdout: response.stdout,
      stderr: response.stderr,
    });
  });
  return current;
}
parentPort.on("message", (request) => {
  if (request.close) {
    destroyChild();
    finish({ status: null, error: { code: "ACL_CLIENT_CLOSED" } });
    parentPort.close();
    return;
  }
  if (active) return fail("ACL_PROTOCOL_ERROR");
  active = request;
  const state = new Int32Array(request.shared, 0, 4);
  if (
    Atomics.load(state, 0) !== 0 ||
    monotonicMilliseconds() >= request.deadline
  )
    return fail("ETIMEDOUT");
  const current = child || launch();
  if (
    Atomics.load(state, 0) !== 0 ||
    monotonicMilliseconds() >= request.deadline
  )
    return fail("ETIMEDOUT");
  timer = setTimeout(
    () => fail("ETIMEDOUT"),
    Math.max(1, request.deadline - monotonicMilliseconds()),
  );
  current.stdin.write(
    `{"id":${JSON.stringify(request.id)},"request":${request.input}}\n`,
  );
});
parentPort.on("close", destroyChild);
