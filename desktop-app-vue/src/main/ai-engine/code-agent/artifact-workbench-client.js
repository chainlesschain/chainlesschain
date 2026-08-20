const path = require("path");
const {
  spawnWithDesktopBroker,
} = require("../../process/desktop-process-broker.js");

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,255}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

const _deps = {
  spawn: spawnWithDesktopBroker,
};

function requireId(value, label) {
  const normalized = String(value || "");
  if (!SAFE_ID.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function requireDigest(value, label) {
  const normalized = String(value || "");
  if (!SHA256.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function boundedAppend(current, chunk, label) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  if (next.length > MAX_OUTPUT_BYTES) {
    throw new Error(`artifact CLI ${label} exceeds its output limit`);
  }
  return next;
}

class ArtifactWorkbenchClient {
  constructor(options = {}) {
    this.repoRoot =
      options.repoRoot || path.resolve(__dirname, "../../../../../");
    this.cliEntry =
      options.cliEntry ||
      path.resolve(
        this.repoRoot,
        "packages",
        "cli",
        "bin",
        "chainlesschain.js",
      );
    this.spawn = options.spawn || _deps.spawn;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  async _run(args, expectedSchema) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawn(process.execPath, [this.cliEntry, ...args], {
          cwd: this.repoRoot,
          env: { ...process.env, FORCE_COLOR: "0" },
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          origin: "desktop:artifact-workbench",
        });
      } catch (error) {
        reject(error);
        return;
      }
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          child.kill();
        } catch {
          // The timeout is authoritative even if the process already exited.
        }
        reject(new Error("artifact CLI timed out"));
      }, this.timeoutMs);
      const finish = (callback) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const terminateAndReject = (error) =>
        finish(() => {
          try {
            child.kill();
          } catch {
            // Best effort only; the original validation error is retained.
          }
          reject(error);
        });
      child.stdout.on("data", (chunk) => {
        if (settled) {
          return;
        }
        try {
          stdout = boundedAppend(stdout, chunk, "stdout");
        } catch (error) {
          terminateAndReject(error);
        }
      });
      child.stderr.on("data", (chunk) => {
        if (settled) {
          return;
        }
        try {
          stderr = boundedAppend(stderr, chunk, "stderr");
        } catch (error) {
          terminateAndReject(error);
        }
      });
      child.stdout.once("error", terminateAndReject);
      child.stderr.once("error", terminateAndReject);
      child.once("error", (error) => finish(() => reject(error)));
      child.once("close", (code) =>
        finish(() => {
          if (code !== 0) {
            reject(new Error(`artifact CLI failed with exit code ${code}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(stdout.toString("utf8"));
          } catch {
            reject(new Error("artifact CLI returned invalid JSON"));
            return;
          }
          if (!parsed || parsed.schema !== expectedSchema) {
            reject(new Error("artifact CLI returned an unsupported schema"));
            return;
          }
          resolve(parsed);
        }),
      );
    });
  }

  workbench() {
    return this._run(
      ["artifacts", "workbench", "--json"],
      "cc-artifact-workbench/v1",
    );
  }

  access(input = {}) {
    const artifactId = requireId(input.artifactId, "artifact id");
    const accessId = requireId(input.accessId, "access id");
    const action = String(input.action || "");
    if (!["preview", "download", "reveal", "open-external"].includes(action)) {
      throw new Error("artifact access action is invalid");
    }
    return this._run(
      [
        "artifacts",
        "access",
        artifactId,
        "--client",
        "desktop",
        "--action",
        action,
        "--access-id",
        accessId,
        "--json",
      ],
      "cc-artifact-content-access-authorization/v1",
    );
  }

  remove(input = {}) {
    return this._run(
      [
        "artifacts",
        "remove",
        requireId(input.artifactId, "artifact id"),
        "--client",
        "desktop",
        "--deletion-id",
        requireId(input.deletionId, "deletion id"),
        "--json",
      ],
      "cc-artifact-deletion-receipt/v1",
    );
  }

  adjudicate(input = {}) {
    const decision = String(input.decision || "");
    if (!["retry", "delete-orphan", "defer"].includes(decision)) {
      throw new Error("artifact recovery decision is invalid");
    }
    return this._run(
      [
        "artifacts",
        "recovery-adjudicate",
        requireId(input.itemId, "recovery item id"),
        "--plan-digest",
        requireDigest(input.planDigest, "recovery plan digest"),
        "--decision",
        decision,
        "--adjudication-id",
        requireId(input.adjudicationId, "adjudication id"),
        ...(decision === "defer" ? [] : ["--approve"]),
        "--json",
      ],
      "cc-artifact-recovery-adjudication/v1",
    );
  }
}

module.exports = {
  ArtifactWorkbenchClient,
  MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  _deps,
};
