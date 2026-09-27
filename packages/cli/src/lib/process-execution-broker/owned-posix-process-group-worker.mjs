// Broker implementation detail. fd 3 is a private caller lifeline, never
// inherited by the target. stdout/stderr remain the target's raw byte streams.
import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";

const control = new Socket({ fd: 3, readable: true, writable: true });
const MAX_REQUEST_BYTES = 1024 * 1024;
let buffer = "";
const decoder = new StringDecoder("utf8");
let bytes = 0;
let target = null;
let launched = false;
let stopping = false;
let killing = false;
let graceMs = 250;
let killTimer;

function hardStop() {
  if (killing) return;
  killing = true;
  clearTimeout(killTimer);
  // We are still the live leader, so -process.pid cannot name a reused group.
  const killGroup = () => {
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      process.exit(70);
    }
  };
  if (!control.destroyed && control.writable) {
    control.write('{"type":"terminating"}\n', killGroup);
    setTimeout(killGroup, 100);
  } else {
    killGroup();
  }
}

function stop(signal = "SIGTERM") {
  if (signal === "SIGKILL") {
    hardStop();
    return;
  }
  if (stopping || killing) return;
  stopping = true;
  killTimer = setTimeout(hardStop, graceMs);
  try {
    process.kill(-process.pid, "SIGTERM");
  } catch {
    hardStop();
  }
}

process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
control.on("end", () => stop());
control.on("error", () => stop());
control.on("close", () => stop());
// A caller that disappears or never sends a launch cannot leave a keeper.
const startupTimer = setTimeout(() => stop(), 10_000);

function sendTargetExit(code, signal, spawnError = null) {
  if (!control.destroyed && control.writable) {
    control.write(
      JSON.stringify({ type: "target-exit", code, signal, spawnError }) + "\n",
    );
  }
  stop();
}

function receive(message) {
  if (
    message.type === "stop" &&
    ["SIGTERM", "SIGKILL"].includes(message.signal)
  ) {
    stop(message.signal);
    return;
  }
  if (message.type !== "launch" || launched || stopping || killing)
    throw new Error("invalid launch");
  launched = true;
  clearTimeout(startupTimer);
  if (
    !Number.isSafeInteger(message.graceMs) ||
    message.graceMs < 1 ||
    message.graceMs > 5000
  )
    throw new Error("invalid grace");
  graceMs = message.graceMs;
  // This is the exact, pre-admitted plan supplied by the Broker-side caller.
  // No shell, inherited control fd, detached target, or env expansion.
  target = spawn(message.command, message.args, {
    cwd: message.cwd,
    env: message.env,
    shell: false,
    detached: false,
    stdio: [0, 1, 2],
  });
  target.once("spawn", () => {
    control.write(JSON.stringify({ type: "started", pid: target.pid }) + "\n");
  });
  target.once("error", (error) =>
    sendTargetExit(
      null,
      null,
      /^[A-Z0-9_]{1,40}$/.test(error.code ?? "") ? error.code : "SPAWN_FAILED",
    ),
  );
  // exit, not close: a descendant can retain inherited stdout after root exit.
  target.once("exit", (code, signal) => sendTargetExit(code, signal));
}

control.on("data", (chunk) => {
  bytes += chunk.length;
  if (bytes > MAX_REQUEST_BYTES + 1024) {
    stop();
    return;
  }
  buffer += decoder.write(chunk);
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      receive(JSON.parse(line));
    } catch {
      stop();
      return;
    }
  }
});
