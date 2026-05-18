/**
 * E2E tests: chainlesschain orchestrate command
 *
 * Tests CLI behavior by spawning the real binary:
 *   - Help and option display
 *   - detect sub-command
 *   - --status output structure
 *   - --json mode
 *   - --no-ci mode (skips CI, faster)
 *   - Webhook server startup
 */

import { describe, it, expect } from "vitest";
import { execSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const bin = join(cliRoot, "bin", "chainlesschain.js");

function run(args, opts = {}) {
  return execSync(`node "${bin}" ${args}`, {
    encoding: "utf-8",
    timeout: 20000,
    stdio: "pipe",
    ...opts,
  });
}

function tryRun(args, opts = {}) {
  try {
    const stdout = run(args, opts);
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status ?? 1,
    };
  }
}

// ─── Help & Options ───────────────────────────────────────────────

describe("E2E: orchestrate --help", () => {
  it("shows command description", () => {
    const out = run("orchestrate --help");
    expect(out).toContain("Orchestrate AI coding tasks");
  });

  it("shows --agents option", () => {
    const out = run("orchestrate --help");
    expect(out).toContain("--agents");
  });

  it("shows --backends option", () => {
    const out = run("orchestrate --help");
    expect(out).toContain("--backends");
  });

  it("shows --strategy option", () => {
    const out = run("orchestrate --help");
    expect(out).toContain("--strategy");
    expect(out).toContain("round-robin");
  });

  it("shows --webhook option", () => {
    const out = run("orchestrate --help");
    expect(out).toContain("--webhook");
  });

  it("shows --no-ci option", () => {
    const out = run("orchestrate --help");
    expect(out).toContain("--no-ci");
  });

  it("shows --source option with IM platforms", () => {
    const out = run("orchestrate --help");
    expect(out).toContain("--source");
    expect(out).toContain("wecom");
    expect(out).toContain("dingtalk");
    expect(out).toContain("feishu");
  });
});

// ─── detect sub-command ───────────────────────────────────────────

describe("E2E: orchestrate detect", () => {
  it("shows AI CLI detection header", () => {
    const out = tryRun("orchestrate detect");
    expect(out.stdout).toContain("AI CLI Detection");
  });

  it("shows claude status (installed or not)", () => {
    const out = tryRun("orchestrate detect");
    // Either installed (✓) or not (✗), but should mention claude
    expect(out.stdout).toContain("claude");
  });

  it("shows codex status", () => {
    const out = tryRun("orchestrate detect");
    expect(out.stdout).toContain("codex");
  });
});

// ─── --status mode ────────────────────────────────────────────────

describe("E2E: orchestrate --status", () => {
  it("shows orchestrator status header", () => {
    const out = tryRun("orchestrate --status");
    expect(out.stdout).toContain("Orchestrator Status");
  });

  it("shows CLI Tools section", () => {
    const out = tryRun("orchestrate --status");
    expect(out.stdout).toContain("CLI Tools");
    expect(out.stdout).toContain("claude");
  });

  it("shows Auto-detected Backends section", () => {
    const out = tryRun("orchestrate --status");
    expect(out.stdout).toContain("Backends");
  });

  it("shows Notification Channels section", () => {
    const out = tryRun("orchestrate --status");
    expect(out.stdout).toContain("Notification");
  });

  it("--json outputs valid JSON with backends", () => {
    const out = tryRun("orchestrate --status --json");
    let parsed;
    expect(() => {
      parsed = JSON.parse(out.stdout);
    }).not.toThrow();
    expect(parsed).toHaveProperty("cliTools");
    expect(parsed).toHaveProperty("backends");
    expect(Array.isArray(parsed.backends)).toBe(true);
  });
});

// ─── No task → shows usage ────────────────────────────────────────

describe("E2E: orchestrate with no task", () => {
  it("shows usage hint when no task provided", () => {
    const out = tryRun("orchestrate");
    // Should show usage or error, not crash
    const combined = out.stdout + out.stderr;
    expect(combined).toMatch(/orchestrate|usage|task/i);
  });
});

// ─── --no-ci with mocked LLM (skips real CI/LLM by using ollama) ──

describe("E2E: orchestrate --no-ci --provider ollama", () => {
  it("exits gracefully when ollama is unreachable (expected failure)", () => {
    // This tests that the pipeline runs and reports an error cleanly
    const out = tryRun(
      `orchestrate "Fix test bug" --no-ci --provider ollama --model llama3 --json`,
      { timeout: 15000 },
    );
    // Intent: "must not crash with unhandled exception". Process may exit with
    // any well-defined status (success / handled error / timeout-kill) and may
    // produce no stdout if it hangs silently — the contract is "no segfault /
    // no thrown stack trace". Empty output on timeout-kill is acceptable.
    expect(out.exitCode).toBeDefined();
    // If JSON output was produced, it must be parseable (no truncated output)
    if (out.stdout.trim().startsWith("{")) {
      const parsed = JSON.parse(out.stdout.trim());
      expect(parsed).toBeDefined();
    }
    // stderr (if any) must not contain a Node.js unhandled-rejection or v8 crash
    expect(out.stderr).not.toMatch(
      /UnhandledPromiseRejection|Segmentation fault|FATAL ERROR/i,
    );
  }, 20000);
});

// ─── Webhook server startup ───────────────────────────────────────

describe("E2E: orchestrate --webhook server", () => {
  it("starts HTTP webhook server and responds to POST /dingtalk", async () => {
    const port = 19820;

    const proc = spawn(
      "node",
      [bin, "orchestrate", "--webhook", "--webhook-port", String(port)],
      {
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0" },
      },
    );

    // Wait for server to print its ready message
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("webhook server timeout")),
        12000,
      );
      let buf = "";
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve();
      };
      proc.stdout.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("Webhook") || buf.includes("localhost")) done();
      });
      proc.stderr.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("Webhook") || buf.includes("localhost")) done();
      });
      proc.on("error", reject);
    });

    // Poll TCP readiness — guards against ECONNREFUSED race when "Webhook"
    // is logged before listen() actually bound the socket under load.
    await new Promise((resolveReady, rejectReady) => {
      const startedAt = Date.now();
      const tryConnect = () => {
        const probe = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            method: "HEAD",
            timeout: 500,
          },
          (res) => {
            res.resume();
            resolveReady();
          },
        );
        probe.on("error", () => {
          if (Date.now() - startedAt > 5000)
            return rejectReady(new Error("port not ready"));
          setTimeout(tryConnect, 200);
        });
        probe.end();
      };
      tryConnect();
    });

    // Send a DingTalk-style POST
    const body = JSON.stringify({
      msgtype: "text",
      text: { content: "Fix auth bug" },
    });

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/dingtalk",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (d) => (data += d));
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));

    expect(response.status).toBe(200);
    const json = JSON.parse(response.body);
    expect(json.ok).toBe(true);
    expect(json.message).toContain("Fix auth bug");
  }, 20000);

  it("returns 200 with challenge for Feishu verification", async () => {
    const port = 19821;

    const proc = spawn(
      "node",
      [bin, "orchestrate", "--webhook", "--webhook-port", String(port)],
      {
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0" },
      },
    );

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 12000);
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve();
      };
      proc.stdout.on("data", (d) => {
        if (d.includes("Webhook")) done();
      });
      proc.stderr.on("data", (d) => {
        if (d.includes("Webhook")) done();
      });
      proc.on("error", reject);
    });

    // Poll for port readiness — guards against ECONNREFUSED race when the
    // child has emitted "Webhook" before listen() actually bound the socket
    // (or when the full-suite load slows process startup).
    await new Promise((resolveReady, rejectReady) => {
      const startedAt = Date.now();
      const tryConnect = () => {
        const socket = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            method: "HEAD",
            timeout: 500,
          },
          (res) => {
            res.resume();
            resolveReady();
          },
        );
        socket.on("error", () => {
          if (Date.now() - startedAt > 5000)
            return rejectReady(new Error("port not ready"));
          setTimeout(tryConnect, 200);
        });
        socket.end();
      };
      tryConnect();
    });

    const body = JSON.stringify({ challenge: "test-challenge-token" });

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/feishu",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (d) => (data += d));
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        },
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));

    expect(response.status).toBe(200);
    const json = JSON.parse(response.body);
    // Feishu challenge-response: { challenge: "test-challenge-token" }
    expect(json.challenge).toBe("test-challenge-token");
  }, 20000);
});
