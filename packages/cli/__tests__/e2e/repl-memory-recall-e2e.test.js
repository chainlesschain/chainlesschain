import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const fixture = fileURLToPath(
  new URL("../fixtures/repl-memory-recall-state.mjs", import.meta.url),
);
const OLD_MARKER = "REPL_RECALL_OLD_51947";
const NEW_MARKER = "REPL_RECALL_NEW_86253";

function isolatedEnvironment(root) {
  // No inherited credentials, NODE_OPTIONS, deployment descriptors, or the
  // Vitest egress sentinel. Children use this runner's actual Node/SQLite ABI.
  const env = {};
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "ComSpec",
    "COMSPEC",
    "PATH",
    "Path",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    CHAINLESSCHAIN_HOME: path.join(root, "config"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "anchors"),
    CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default",
    HOME: path.join(root, "user-home"),
    USERPROFILE: path.join(root, "user-home"),
    CI: "1",
    NO_COLOR: "1",
  };
}

async function runJourney(disabled) {
  const temporaryParent = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "cc-repl-recall-e2e-"),
  );
  if (
    path.dirname(root) !== temporaryParent ||
    !path.basename(root).startsWith("cc-repl-recall-e2e-")
  )
    throw new Error("unsafe temporary cleanup path");
  for (const name of ["config", "anchors", "workspace", "user-home"])
    fs.mkdirSync(path.join(root, name));
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(path.join(cwd, ".chainlesschain"));
  fs.writeFileSync(path.join(cwd, ".chainlesschain", "config.json"), "{}");
  const env = isolatedEnvironment(root);
  const runs = [];
  const requests = [];
  const serverErrors = [];
  const receipt = {
    disabled,
    node: process.version,
    terminal: "emulated stdin isTTY, not an OS PTY",
    network: "loopback HTTP only; real CLI/Evolution/provider transport",
    encryptedDatabaseInstallationVerified: false,
    requests,
    stages: [],
  };
  const server = http.createServer((request, response) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      text += chunk;
    });
    request.on("error", () => serverErrors.push("request_error"));
    request.on("end", () => {
      try {
        const body = JSON.parse(text);
        const messages = JSON.stringify(body.messages);
        requests.push({
          index: requests.length + 1,
          path: request.url,
          hasOldMarker: messages.includes(OLD_MARKER),
          hasNewMarker: messages.includes(NEW_MARKER),
          userTurns: body.messages.filter((message) => message.role === "user")
            .length,
        });
        response.writeHead(200, {
          "content-type": "application/json",
          connection: "close",
        });
        response.end(
          JSON.stringify({
            message: {
              role: "assistant",
              content: `REPL_RESPONSE_${requests.length}`,
            },
            prompt_eval_count: 10,
            eval_count: 5,
            done: true,
          }),
        );
      } catch {
        serverErrors.push("invalid_provider_request");
        response.writeHead(400);
        response.end();
      }
    });
  });
  function launch(args) {
    const child = spawn(process.execPath, [fixture, ...args], {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const run = { child, stdout: "", stderr: "", closed: false };
    runs.push(run);
    const timer = setTimeout(() => child.kill(), 110_000);
    run.done = new Promise((resolve) => {
      child.once("error", (error) => {
        run.spawnError = error.code || error.name;
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        Object.assign(run, { closed: true, code, signal });
        resolve(run);
      });
    });
    for (const [stream, property] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ])
      stream.setEncoding("utf8").on("data", (chunk) => {
        run[property] += chunk;
        if (run[property].length > 4 * 1024 * 1024) child.kill();
      });
    return run;
  }
  async function waitFor(run, predicate, stage) {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (predicate()) {
        receipt.stages.push(stage);
        return;
      }
      if (run.closed)
        throw new Error(
          `${stage}: child exited (${run.code}, ${run.spawnError || run.signal || "no signal"})`,
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${stage}: timed out`);
  }
  async function state(mode) {
    const run = await launch([mode]).done;
    if (run.code !== 0) throw new Error(`state ${mode}: exit ${run.code}`);
    const result = run.stdout
      .split(/\r?\n/)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          return parsed.fixture === "repl-memory-recall" ? [parsed] : [];
        } catch {
          return [];
        }
      })
      .at(-1);
    if (!result) throw new Error(`state ${mode}: missing receipt`);
    return result;
  }
  const atPrompt = (run) => stripVTControlCharacters(run.stdout).endsWith("> ");
  async function turn(run, index) {
    run.child.stdin.write(`Use REPL_TOPIC turn ${index}\n`);
    await waitFor(
      run,
      () =>
        stripVTControlCharacters(run.stdout).includes(
          `REPL_RESPONSE_${index}`,
        ) && atPrompt(run),
      `response-${index}`,
    );
  }
  async function stop(run) {
    run.child.stdin.write("/exit\n");
    await waitFor(run, () => run.closed, "clean-exit");
    if (run.code !== 0) throw new Error(`interactive exit ${run.code}`);
  }
  try {
    receipt.seed = await state("seed");
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    // Control keeps the no-session first entry. Disabled also covers creating
    // an explicit session id, then restoring that same verified transcript.
    const requestedSession = disabled ? "repl-recall-disabled-session" : "";
    const run = launch([
      "repl",
      endpoint,
      disabled ? "deny" : "allow",
      requestedSession,
    ]);
    await waitFor(run, () => atPrompt(run), "initial-prompt");
    await turn(run, 1);
    receipt.replacement = await state("replace");
    await turn(run, 2);
    await stop(run);
    receipt.beforeResume = await state("inspect");
    if (receipt.beforeResume.sessions.length !== 1)
      throw new Error("expected exactly one persisted session");
    const sessionId = receipt.beforeResume.sessions[0].id;
    // Recall is an invocation option: repeat it on resume. This does not claim
    // persistence of a user preference or an OS-terminal integration result.
    const resumed = launch([
      "repl",
      endpoint,
      disabled ? "deny" : "allow",
      sessionId,
      "resume",
    ]);
    await waitFor(resumed, () => atPrompt(resumed), "resumed-prompt");
    await turn(resumed, 3);
    await stop(resumed);
    receipt.afterResume = await state("inspect");
    receipt.serverErrors = serverErrors;
    // A fallback warning is diagnostic only, never evidence of encrypted
    // database installation. The verified JSONL/HTTP assertions are required.
    receipt.encryptedDatabaseFallbackObserved = runs.some((run) =>
      /fallback|falling back/i.test(run.stderr + run.stdout),
    );
    return receipt;
  } finally {
    for (const run of runs) if (!run.closed) run.child.kill();
    await Promise.all(runs.map((run) => run.done));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("real interactive CLI canonical Memory recall policy", () => {
  it.each([false, true])(
    "disabled=%s: first entry, live replacement, and same-session process restart",
    async (disabled) => {
      const receipt = await runJourney(disabled);
      // Safe booleans/stages only, including on the expected pre-fix red run.
      console.info("REPL_RECALL_RECEIPT", JSON.stringify(receipt));
      if (process.env.CC_REPL_RECALL_TEST_REPORT) {
        fs.appendFileSync(
          process.env.CC_REPL_RECALL_TEST_REPORT,
          `${JSON.stringify(receipt)}\n`,
          { encoding: "utf8", flag: "a" },
        );
      }
      expect(receipt.serverErrors).toEqual([]);
      expect(receipt.requests).toHaveLength(3);
      expect(receipt.replacement.revision).not.toEqual(receipt.seed.revision);
      for (const inspection of [receipt.beforeResume, receipt.afterResume]) {
        expect(inspection.sessions).toHaveLength(1);
        expect(inspection.sessions[0]).toMatchObject({
          verified: true,
          hasOldMarker: false,
          hasNewMarker: false,
        });
        expect(inspection.sessions[0].eventCount).toBeGreaterThan(0);
      }
      expect(receipt.afterResume.sessions[0].id).toBe(
        receipt.beforeResume.sessions[0].id,
      );
      expect(receipt.beforeResume.sessions[0].userTurns).toBe(2);
      expect(receipt.afterResume.sessions[0].userTurns).toBe(3);
      expect(
        receipt.requests.map(({ hasOldMarker, hasNewMarker }) => ({
          hasOldMarker,
          hasNewMarker,
        })),
        JSON.stringify(receipt),
      ).toEqual(
        disabled
          ? Array.from({ length: 3 }, () => ({
              hasOldMarker: false,
              hasNewMarker: false,
            }))
          : [
              { hasOldMarker: true, hasNewMarker: false },
              { hasOldMarker: false, hasNewMarker: true },
              { hasOldMarker: false, hasNewMarker: true },
            ],
      );
    },
    180_000,
  );
});
