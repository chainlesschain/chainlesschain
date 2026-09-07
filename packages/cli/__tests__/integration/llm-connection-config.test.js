import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { it, expect } from "vitest";
const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
function run(args, env, cwd, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("CLI test timeout"));
    }, 60_000);
    child.stdout.on("data", (b) => {
      stdout += b;
    });
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
it("saves a custom relay via real CLI stdin and tests its protocol without exposing credentials", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-llm-connection-"));
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (b) => {
      body += b;
    });
    req.on("end", () => {
      requests.push({
        path: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(body),
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "Hello" } }] }));
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    const env = {
      ...process.env,
      CHAINLESSCHAIN_HOME: path.join(root, "state"),
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "anchor"),
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: "",
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: "",
      NO_COLOR: "1",
    };
    const draft = {
      provider: "openai",
      model: "relay/custom-model",
      baseUrl: `http://127.0.0.1:${server.address().port}/proxy/v1`,
      apiKey: "test-only-relay-key",
      visionModel: "",
    };
    const saved = await run(
      ["llm", "configure", "--storage", "file"],
      env,
      workspace,
      JSON.stringify(draft),
    );
    expect(saved.code, saved.stderr).toBe(0);
    expect(saved.stdout + saved.stderr).not.toContain(draft.apiKey);
    const tested = await run(["llm", "test"], env, workspace);
    expect(tested.code, tested.stderr).toBe(0);
    expect(requests).toEqual([
      {
        path: "/proxy/v1/chat/completions",
        auth: `Bearer ${draft.apiKey}`,
        body: {
          model: draft.model,
          messages: [{ role: "user", content: "Say hi in one word." }],
          max_tokens: 16,
        },
      },
    ]);
    const file = path.join(root, "state", "config.json");
    const original = fs.readFileSync(file, "utf8");
    const failed = await run(
      ["llm", "configure", "--storage", "file"],
      env,
      workspace,
      JSON.stringify({
        ...draft,
        baseUrl: "https://unrelated.example/v1",
        apiKey: "",
      }),
    );
    expect(failed.code).not.toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
