import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_BIN = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const STATE_FIXTURE = fileURLToPath(
  new URL("../fixtures/cli-memory-restart-state.mjs", import.meta.url),
);
const temporaryParent = fs.realpathSync.native(os.tmpdir());
const prompt = "RESTART_TOPIC read both local evidence files";

function isolatedEnvironment(root) {
  // Do not carry deployment descriptors, provider credentials, NODE_OPTIONS,
  // project roots, IDE endpoints or Vitest's in-process egress adapters into
  // the real executable. Only the explicitly bound loopback provider is used.
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

function launch(args, { cwd, env, stream = false }) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: [stream ? "pipe" : "ignore", "pipe", "pipe"],
  });
  const run = {
    child,
    args,
    events: [],
    stdout: "",
    stderr: "",
    closed: false,
  };
  let pending = "";
  const timer = setTimeout(() => child.kill(), 60_000);
  run.done = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timer);
      run.closed = true;
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      Object.assign(run, { closed: true, code, signal });
      resolve(run);
    });
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    run.stdout += chunk;
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      try {
        run.events.push(JSON.parse(line));
      } catch {
        /* Preserve diagnostics verbatim. */
      }
    }
    if (run.stdout.length > 4 * 1024 * 1024) child.kill();
  });
  child.stderr.on("data", (chunk) => {
    run.stderr += chunk;
    if (run.stderr.length > 1024 * 1024) child.kill();
  });
  return run;
}

async function settledResult(run) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const result = run.events.find((event) => event.type === "result");
    if (result) {
      expect(result, run.stderr).toMatchObject({
        subtype: "success",
        is_error: false,
      });
      return result;
    }
    if (run.closed)
      throw new Error(
        `CLI exited before result: ${run.code}/${run.signal}: ${run.stderr}\n${run.stdout.slice(-2000)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`CLI result timeout: ${run.stderr}`);
}

describe("real CLI compaction and independent-process Memory recovery", () => {
  for (const entry of ["headless", "stream"]) {
    it.each(["supersede", "delete"])(
      `${entry} resumes current Memory and project rules after %s`,
      async (change) => {
        const root = fs.mkdtempSync(
          path.join(temporaryParent, "cc-cli-memory-restart-"),
        );
        const cwd = path.join(root, "workspace");
        const env = isolatedEnvironment(root);
        const children = [];
        const requests = [];
        const providerErrors = [];
        const sessionId = `restart-${entry}-${change}`;
        const receipt = {
          entry,
          change,
          sessionId,
          node: process.version,
          executable: process.execPath,
          requests,
          processes: [],
        };
        let phase = "writer",
          ordinary = 0;
        const provider = http.createServer((request, response) => {
          let input = "";
          request.on("data", (chunk) => {
            input += chunk;
          });
          request.on("end", () => {
            try {
              expect(request.url).toBe("/api/chat");
              expect(request.method).toBe("POST");
              const body = JSON.parse(input);
              requests.push({ phase, body });
              expect(body.stream).toBe(false);
              expect(body.messages[0].content).not.toContain(
                "Create a durable conversation handoff",
              );
              let message;
              if (phase === "writer" && ++ordinary === 1) {
                message = {
                  role: "assistant",
                  content: "Read local evidence",
                  tool_calls: ["a", "b"].map((name) => ({
                    id: `read-${name}`,
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: { path: `${name}.txt` },
                    },
                  })),
                };
              } else
                message = {
                  role: "assistant",
                  content:
                    phase === "writer"
                      ? "WRITER_SETTLED_99317"
                      : "READER_SETTLED_99317",
                };
              response.writeHead(200, {
                "content-type": "application/json",
                connection: "close",
              });
              response.end(
                JSON.stringify({
                  message,
                  prompt_eval_count: 10,
                  eval_count: 5,
                  done: true,
                }),
              );
            } catch (error) {
              providerErrors.push(error.message);
              response.writeHead(500, { connection: "close" });
              response.end("Local protocol fixture failed");
            }
          });
        });
        const start = (args, stream = false) => {
          const run = launch(args, { cwd, env, stream });
          children.push(run);
          return run;
        };
        const state = async (mode) => {
          const run = await start([STATE_FIXTURE, mode, sessionId, change])
            .done;
          expect(run.code, run.stderr).toBe(0);
          expect(run.events).toHaveLength(1);
          const result = run.events[0];
          expect(result.networkCalls).toBe(0);
          return result;
        };
        try {
          for (const name of ["workspace", "config", "anchors", "user-home"])
            fs.mkdirSync(path.join(root, name));
          fs.mkdirSync(path.join(cwd, ".chainlesschain"));
          fs.writeFileSync(path.join(cwd, ".chainlesschain/config.json"), "{}");
          fs.writeFileSync(
            path.join(cwd, ".chainlesschain/rules.md"),
            "PROJECT_RULE_OLD_99317",
          );
          fs.writeFileSync(
            path.join(cwd, "cc.md"),
            "# Restart fixture\n@file-memory.md\n",
          );
          fs.writeFileSync(
            path.join(cwd, "file-memory.md"),
            "FILE_MEMORY_OLD_99317",
          );
          for (const name of ["a", "b"])
            fs.writeFileSync(
              path.join(cwd, `${name}.txt`),
              Array.from(
                { length: 200 },
                (_, index) => `${name}-${index}: ${name.repeat(250)}`,
              ).join("\n"),
            );
          await new Promise((resolve, reject) => {
            provider.once("error", reject);
            provider.listen(0, "127.0.0.1", resolve);
          });
          const baseUrl = `http://127.0.0.1:${provider.address().port}`;
          const common = [
            "--provider",
            "ollama",
            "--model",
            "qwen2.5:7b",
            "--base-url",
            baseUrl,
            "--allowed-tools",
            "read_file",
            "--no-mcp",
            "--no-ide",
            "--no-pdh",
            "--no-jetbrains",
            "--no-checkpoint",
            "--no-file-refs",
            "--no-stream",
            "--sandbox-mode",
            "off",
            "--output-format",
            "stream-json",
            "--max-turns",
            "5",
          ];
          receipt.seed = await state("seed");
          const writer =
            entry === "stream"
              ? start(
                  [
                    CLI_BIN,
                    "agent",
                    "--input-format",
                    "stream-json",
                    "--session",
                    sessionId,
                    ...common,
                  ],
                  true,
                )
              : start([
                  CLI_BIN,
                  "agent",
                  "-p",
                  prompt,
                  "--session",
                  sessionId,
                  ...common,
                ]);
          if (entry === "stream")
            writer.child.stdin.write(
              JSON.stringify({ type: "user", content: prompt }) + "\n",
            );
          const written = await settledResult(writer);
          expect(written.result).toBe("WRITER_SETTLED_99317");
          if (entry === "stream") {
            expect(writer.child.exitCode).toBeNull();
            expect(writer.child.kill()).toBe(true);
          }
          await writer.done;
          if (entry === "headless") expect(writer.code, writer.stderr).toBe(0);
          else expect(writer.signal !== null || writer.code !== 0).toBe(true);
          const compactions = writer.events.filter(
            (event) => event.type === "compaction",
          );
          expect(compactions).toHaveLength(1);
          expect(compactions[0].stats.canonicalReceipt.status).toBe(
            "committed",
          );
          receipt.before = await state("inspect");
          expect(receipt.before.compactEvents).toHaveLength(1);
          expect(receipt.before.compactEvents[0].canonical.operationId).toBe(
            compactions[0].stats.canonicalReceipt.operationId,
          );
          expect(receipt.before.usage).toHaveLength(2);
          expect(requests).toHaveLength(2);
          for (const { body } of requests) {
            const text = JSON.stringify(body.messages);
            expect(text).toContain("OLD_RECALL_99317");
            expect(text).toContain("PROJECT_RULE_OLD_99317");
            expect(text).toContain("FILE_MEMORY_OLD_99317");
          }
          receipt.mutation = await state("mutate");
          expect(receipt.mutation.revision).toBeGreaterThan(
            receipt.before.revision,
          );
          phase = "reader";
          const continuePrompt = "RESTART_TOPIC continue using current policy";
          const reader =
            entry === "stream"
              ? start(
                  [
                    CLI_BIN,
                    "agent",
                    "--input-format",
                    "stream-json",
                    "--resume",
                    sessionId,
                    ...common,
                  ],
                  true,
                )
              : start([
                  CLI_BIN,
                  "agent",
                  "-p",
                  continuePrompt,
                  "--resume",
                  sessionId,
                  ...common,
                ]);
          if (entry === "stream")
            reader.child.stdin.end(
              JSON.stringify({ type: "user", content: continuePrompt }) + "\n",
            );
          const resumed = await settledResult(reader);
          expect(resumed.result).toBe("READER_SETTLED_99317");
          await reader.done;
          expect(reader.code, reader.stderr).toBe(0);
          expect(requests).toHaveLength(3);
          const text = JSON.stringify(requests[2].body.messages);
          for (const marker of [
            "CURRENT_RECALL_99317",
            "PROJECT_RULE_NEW_99317",
            "FILE_MEMORY_NEW_99317",
            "WRITER_SETTLED_99317",
          ])
            expect(text).toContain(marker);
          expect(text.includes("SUCCESSOR_RECALL_99317")).toBe(
            change === "supersede",
          );
          for (const marker of [
            "OLD_RECALL_99317",
            "PROJECT_RULE_OLD_99317",
            "FILE_MEMORY_OLD_99317",
          ])
            expect(text).not.toContain(marker);
          for (const { body } of requests)
            for (const marker of [
              "FORBIDDEN_SCOPE_99317",
              "FORBIDDEN_SINK_99317",
            ])
              expect(JSON.stringify(body.messages)).not.toContain(marker);
          const plans = reader.events.filter(
            (event) => event.type === "context.plan.created",
          );
          expect(plans).toHaveLength(1);
          expect(plans[0].plan.memoryRevision).toBe(receipt.mutation.revision);
          receipt.after = await state("inspect");
          expect(receipt.after.compactEvents).toEqual(
            receipt.before.compactEvents,
          );
          expect(
            receipt.after.eventHashes.slice(
              0,
              receipt.before.eventHashes.length,
            ),
          ).toEqual(receipt.before.eventHashes);
          expect(receipt.after.usage).toHaveLength(3);
          expect(receipt.after.usageStarted).toHaveLength(3);
          expect(receipt.after.unknownUsage).toBe(0);
          expect(
            new Set(receipt.after.usage.map((row) => row.callId)).size,
          ).toBe(3);
          expect(receipt.after.usage.map((row) => row.callId).sort()).toEqual(
            receipt.after.usageStarted.map((row) => row.callId).sort(),
          );
          for (const row of receipt.after.usage)
            expect(row.usage).toMatchObject({
              input_tokens: 10,
              output_tokens: 5,
            });
          expect(
            new Set([writer.child.pid, receipt.mutation.pid, reader.child.pid])
              .size,
          ).toBe(3);
          expect(providerErrors).toEqual([]);
          receipt.passed = true;
        } catch (error) {
          receipt.failure = error.stack || error.message;
          throw error;
        } finally {
          for (const run of children) {
            if (!run.closed) run.child.kill();
            await run.done;
            receipt.processes.push({
              pid: run.child.pid,
              args: run.args,
              code: run.code,
              signal: run.signal,
              stdout: run.stdout,
              stderr: run.stderr,
            });
          }
          provider.closeAllConnections();
          if (provider.listening)
            await new Promise((resolve) => provider.close(resolve));
          const evidence = process.env.CC_TEST_CLI_RESTART_EVIDENCE_DIR;
          if (evidence)
            fs.writeFileSync(
              path.join(
                fs.realpathSync.native(evidence),
                `${entry}-${change}.json`,
              ),
              JSON.stringify(receipt, null, 2) + "\n",
            );
          expect(path.dirname(root)).toBe(temporaryParent);
          expect(path.basename(root).startsWith("cc-cli-memory-restart-")).toBe(
            true,
          );
          expect(fs.realpathSync.native(root)).toBe(root);
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
      180_000,
    );
  }
});
