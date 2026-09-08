import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { it, expect } from "vitest";
const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const { testLlm } = createRequire(import.meta.url)(
  "../../../vscode-extension/src/llm-config.js",
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
it.each(["openai", "volcengine"])(
  "saves %s via real CLI stdin and verifies CLI and IDE probes without exposing credentials",
  async (provider) => {
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
        const truncated = JSON.parse(body).max_tokens < 34;
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: truncated ? "length" : "stop",
                message: {
                  content: truncated ? "" : "Hello",
                  reasoning_content: "test-only private reasoning",
                },
              },
            ],
          }),
        );
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
        provider,
        model:
          provider === "volcengine"
            ? "deepseek-v4-flash-260425"
            : "relay/custom-model",
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
      const ideResult = await testLlm({
        command: bin,
        deps: {
          execFile: (command, args, options, callback) =>
            execFile(
              command,
              args,
              {
                ...options,
                cwd: workspace,
                env: { ...options.env, ...env },
              },
              callback,
            ),
        },
      });
      expect(ideResult.ok, ideResult.detail).toBe(true);
      expect(ideResult.detail).toContain("Connected");
      expect(ideResult.detail).not.toContain(draft.apiKey);
      expect(ideResult.detail).not.toContain("private reasoning");
      expect(requests).toHaveLength(2);
      for (const request of requests)
        expect(request).toEqual({
          path: "/proxy/v1/chat/completions",
          auth: `Bearer ${draft.apiKey}`,
          body: {
            model: draft.model,
            messages: [{ role: "user", content: "Say hi in one word." }],
            max_tokens: 1024,
          },
        });
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
  },
  180_000,
);
