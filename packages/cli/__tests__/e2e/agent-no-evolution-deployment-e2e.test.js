/**
 * Regression: an installed CLI with no Evolution deployment must still serve
 * the first IDE-style duplex Agent turn. This deliberately exercises the real
 * bin and clears deployment variables instead of using Vitest's test ingress.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_BIN = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const root = fs.mkdtempSync(
  path.join(fs.realpathSync.native(os.tmpdir()), "cc-no-evolution-e2e-"),
);
const configHome = path.join(root, "config");
const securityAnchorHome = path.join(root, "security-anchors");
const userHome = path.join(root, "user-home");
const workspace = path.join(root, "workspace");

let provider;
let providerUrl;
let providerCalls = 0;

beforeAll(async () => {
  for (const directory of [
    configHome,
    securityAnchorHome,
    userHome,
    workspace,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  provider = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      providerCalls += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      expect(request.url).toBe("/api/chat");
      expect(body.messages.at(-1)).toMatchObject({
        role: "user",
        content: expect.stringContaining("hello"),
      });
      response.writeHead(200, {
        "content-type": "application/json",
        connection: "close",
      });
      response.end(
        JSON.stringify({
          message: { role: "assistant", content: "hello from loopback" },
          prompt_eval_count: 4,
          eval_count: 3,
          done: true,
          done_reason: "stop",
        }),
      );
    });
  });
  await new Promise((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", () => {
      provider.off("error", reject);
      resolve();
    });
  });
  providerUrl = `http://127.0.0.1:${provider.address().port}`;
});

afterAll(async () => {
  provider?.closeAllConnections?.();
  if (provider?.listening) {
    await new Promise((resolve) => provider.close(resolve));
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4 || error?.code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
});

function environmentWithoutEvolutionDeployment() {
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    CHAINLESSCHAIN_HOME: configHome,
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: securityAnchorHome,
    HOME: userHome,
    USERPROFILE: userHome,
  };
  delete env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR;
  delete env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  delete env.NODE_OPTIONS;
  delete env.CC_PROVIDER;
  delete env.LLM_PROVIDER;
  delete env.LLM_MODEL;
  delete env.CC_API_KEY;
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST") || key.endsWith("_API_KEY")) delete env[key];
  }
  return env;
}

async function waitForEvent(
  { events, childState, stderr },
  predicate,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = events.find(predicate);
    if (event) return event;
    if (childState.closed) {
      throw new Error(
        `CLI exited before expected event (${childState.code}/${childState.signal}): ${stderr()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`CLI event timeout after ${timeoutMs}ms: ${stderr()}`);
}

describe("real Agent duplex startup without an Evolution deployment", () => {
  it("returns a successful result for the first user turn", async () => {
    const child = spawn(
      process.execPath,
      [
        CLI_BIN,
        "agent",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--provider",
        "ollama",
        "--model",
        "loopback-model",
        "--base-url",
        providerUrl,
        "--sandbox-mode",
        "off",
        "--ephemeral",
      ],
      {
        cwd: workspace,
        env: environmentWithoutEvolutionDeployment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    let stdout = "";
    let stderr = "";
    const childState = { closed: false, code: null, signal: null };
    const events = [];
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) events.push(JSON.parse(line));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("close", (code, signal) => {
      childState.closed = true;
      childState.code = code;
      childState.signal = signal;
    });

    try {
      await waitForEvent(
        { events, childState, stderr: () => stderr },
        (event) => event.subtype === "init",
        90_000,
      );

      child.stdin.write(JSON.stringify({ type: "user", text: "hello" }) + "\n");
      const result = await waitForEvent(
        { events, childState, stderr: () => stderr },
        (event) => event.type === "result",
        90_000,
      );
      expect(result).toMatchObject({
        subtype: "success",
        is_error: false,
        result: "hello from loopback",
      });
      expect(providerCalls).toBe(1);

      child.stdin.end();
      const close = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ code: null, signal: "timeout" });
        }, 15_000);
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          resolve({ code, signal });
        });
      });
      expect(close, stderr || stdout).toEqual({ code: 0, signal: null });
      expect(stderr).not.toContain("evolution composition factory");
      expect(stderr).not.toContain("CC_AGENT_EVOLUTION_INGRESS_FAILED");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 210_000);
});
