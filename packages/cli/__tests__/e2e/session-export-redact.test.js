/**
 * E2E (§8.1 export gate): `cc session export` redacts secrets from the exported
 * transcript by default — a transcript leaving the machine must fail toward
 * "no leak". `--no-redact` keeps raw values for the user's own trusted backup.
 *
 * Seeds a JSONL agent session (the `cc agent --resume` store) whose user turn
 * carries a provider token, then runs the REAL cc bin against an isolated HOME.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { testHome, CLI_BIN } from "./_helpers/cli-e2e.js";

const t = testHome("session-export-redact");
afterAll(() => t.cleanup());

// A realistic OpenAI-style token (sk- + 40 chars) — matches the provider_token
// pattern and MUST NOT survive a default export.
const SECRET = "sk-abcdef0123456789abcdef0123456789abcdef01";

function seed(id) {
  const dir = path.join(t.home, ".chainlesschain", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    {
      type: "session_start",
      timestamp: Date.now(),
      data: { title: "seed", provider: "ollama", model: "test" },
    },
    {
      type: "user_message",
      timestamp: Date.now(),
      data: { role: "user", content: `set OPENAI_API_KEY=${SECRET} and run` },
    },
    {
      type: "assistant_message",
      timestamp: Date.now(),
      data: { role: "assistant", content: "done" },
    },
  ];
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf-8",
  );
}

function runExport(args) {
  return spawnSync(process.execPath, [CLI_BIN, "session", "export", ...args], {
    env: t.env(),
    cwd: t.home,
    encoding: "utf-8",
  });
}

describe("cc session export secret redaction (§8.1)", () => {
  it("redacts secrets from the exported transcript by default", () => {
    seed("sid-redact");
    const r = runExport(["sid-redact"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stdout).toContain("[REDACTED]");
    // The redaction count notice goes to stderr, not into the exported file.
    expect(r.stderr).toMatch(/[Rr]edacted \d+ secret/);
  }, 60_000);

  it("keeps raw values with --no-redact", () => {
    seed("sid-raw");
    const r = runExport(["sid-raw", "--no-redact"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(SECRET);
    expect(r.stdout).not.toContain("[REDACTED]");
  }, 60_000);
});
