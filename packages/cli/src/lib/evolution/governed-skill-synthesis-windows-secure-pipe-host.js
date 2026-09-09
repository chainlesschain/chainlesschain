import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const READY_SCHEMA = "chainlesschain.windows-secure-pipe-broker-ready/v1";
const REQUEST_SCHEMA = "chainlesschain.windows-secure-pipe-broker-request/v1";
const RESPONSE_SCHEMA = "chainlesschain.windows-secure-pipe-broker-response/v1";
const SECURITY_KEYS = new Set([
  "acl",
  "aclDigest",
  "peerIdentity",
  "principalDigest",
  "remoteClients",
]);
const PIPE_PREFIX = "\\\\.\\pipe\\";
const PIPE_NAME =
  /^cc-evolution-attestor-trust-(?:approval|ops)-[a-f0-9]{16,64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function exact(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.size &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === "string" && keys.has(key),
    )
  );
}

function normalizeSecurity(value) {
  if (
    !exact(value, SECURITY_KEYS) ||
    value.acl !== "protected-current-logon-dacl" ||
    value.peerIdentity !== "client-process-token-user-and-logon-sid" ||
    value.remoteClients !== false ||
    !DIGEST.test(value.aclDigest ?? "") ||
    !DIGEST.test(value.principalDigest ?? "")
  ) {
    throw new Error(
      "Windows secure pipe broker security descriptor is invalid",
    );
  }
  return Object.freeze({ ...value });
}

function powershellPath() {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  if (typeof windowsRoot !== "string" || windowsRoot.length < 3) {
    throw new Error("Windows secure pipe broker cannot locate PowerShell");
  }
  return path.join(
    windowsRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

export async function createGovernedSkillSynthesisWindowsSecurePipeHost({
  endpoint,
  maxFrameBytes,
  onRequest,
}) {
  if (process.platform !== "win32") {
    throw new Error("Windows secure pipe host is only available on Windows");
  }
  const pipeName = endpoint.startsWith(PIPE_PREFIX)
    ? endpoint.slice(PIPE_PREFIX.length)
    : "";
  if (
    !PIPE_NAME.test(pipeName) ||
    !Number.isSafeInteger(maxFrameBytes) ||
    maxFrameBytes < 1024 ||
    maxFrameBytes > 1024 * 1024 ||
    typeof onRequest !== "function"
  ) {
    throw new TypeError("Windows secure pipe host configuration is invalid");
  }

  const scriptPath = fileURLToPath(
    new URL(
      "../../../scripts/governed-learning-windows-secure-pipe-broker.ps1",
      import.meta.url,
    ),
  );
  const child = spawn(
    powershellPath(),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-PipeName",
      pipeName,
      "-MaxFrameBytes",
      String(maxFrameBytes),
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.setDefaultEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 32 * 1024) stderr += chunk.toString("utf8");
  });

  let ready = false;
  let settled = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

  const failReady = (error) => {
    if (settled) return;
    settled = true;
    rejectReady(error);
  };
  child.once("error", failReady);
  child.once("exit", (code, signal) => {
    if (!ready) {
      failReady(
        new Error(
          `Windows secure pipe broker exited before ready (${code ?? signal ?? "unknown"}): ${stderr.trim()}`,
        ),
      );
    }
  });
  lines.on("line", async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failReady(new Error("Windows secure pipe broker returned invalid JSON"));
      child.kill();
      return;
    }
    if (!ready) {
      try {
        if (
          !exact(message, new Set(["ok", "schema", "security"])) ||
          message.schema !== READY_SCHEMA ||
          message.ok !== true
        ) {
          throw new Error("Windows secure pipe broker readiness is invalid");
        }
        const security = normalizeSecurity(message.security);
        ready = true;
        settled = true;
        resolveReady(security);
      } catch (error) {
        failReady(error);
        child.kill();
      }
      return;
    }
    let response;
    try {
      if (
        !exact(
          message,
          new Set([
            "clientPrincipalDigest",
            "clientProcessId",
            "connectionId",
            "frame",
            "schema",
          ]),
        ) ||
        message.schema !== REQUEST_SCHEMA ||
        !/^[a-f0-9]{32}$/u.test(message.connectionId ?? "") ||
        !Number.isSafeInteger(message.clientProcessId) ||
        message.clientProcessId < 1 ||
        !DIGEST.test(message.clientPrincipalDigest ?? "") ||
        typeof message.frame !== "string" ||
        Buffer.byteLength(message.frame, "utf8") > maxFrameBytes
      ) {
        throw new Error("Windows secure pipe broker request is invalid");
      }
      response = await onRequest({
        frame: message.frame,
        peer: Object.freeze({
          processId: message.clientProcessId,
          principalDigest: message.clientPrincipalDigest,
        }),
      });
    } catch {
      response = { ok: false, requestId: null, code: "request_denied" };
    }
    if (!child.stdin.destroyed) {
      child.stdin.write(
        `${JSON.stringify({
          schema: RESPONSE_SCHEMA,
          connectionId: message.connectionId,
          frame: `${JSON.stringify(response)}\n`,
        })}\n`,
      );
    }
  });

  const security = await readyPromise;
  return Object.freeze({
    security,
    close() {
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 2_000);
        timer.unref?.();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill();
      });
    },
  });
}
