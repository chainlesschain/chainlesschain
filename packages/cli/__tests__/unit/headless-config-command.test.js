/**
 * Headless `/config` directive (Claude-Code 2.1.181 — /config in `-p` mode).
 *
 *   1. Pure layer — isHeadlessConfigCommand / runConfigDirective with a fake
 *      config manager (no disk): detection, get/set/show, secret masking.
 *   2. runAgentHeadless end-to-end — a `/config` prompt returns early (no LLM,
 *      no bootstrap) and emits the right shape for text / json / stream-json.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import {
  isHeadlessConfigCommand,
  runConfigDirective,
} from "../../src/lib/headless-config-command.js";
import { runAgentHeadless } from "../../src/runtime/headless-runner.js";

describe("isHeadlessConfigCommand", () => {
  it("matches a leading /config slash command only", () => {
    expect(isHeadlessConfigCommand("/config")).toBe(true);
    expect(isHeadlessConfigCommand("  /config llm.model=opus ")).toBe(true);
    expect(isHeadlessConfigCommand("/config llm.model")).toBe(true);
    // not a config command:
    expect(isHeadlessConfigCommand("/configure something")).toBe(false);
    expect(isHeadlessConfigCommand("write code about /config")).toBe(false);
    expect(isHeadlessConfigCommand("explain the config file")).toBe(false);
    expect(isHeadlessConfigCommand("")).toBe(false);
  });
});

describe("runConfigDirective (pure, fake config manager)", () => {
  const makeCm = (initial = {}) => {
    let store = JSON.parse(JSON.stringify(initial));
    return {
      loadConfig: () => store,
      getConfigValue: (k) =>
        k.split(".").reduce((o, p) => (o == null ? undefined : o[p]), store),
      setConfigValue: (k, v) => {
        // mimic config-manager's parseValue coercion
        let val = v;
        if (v === "true") val = true;
        else if (v === "false") val = false;
        else if (v === "null") val = null;
        else if (v !== "" && !isNaN(Number(v))) val = Number(v);
        const parts = k.split(".");
        let cur = store;
        for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ??= {};
        cur[parts.at(-1)] = val;
      },
    };
  };

  it("sets a value (and coerces numbers/booleans)", () => {
    const cm = makeCm();
    expect(
      runConfigDirective("/config llm.model=opus", { configManager: cm }),
    ).toEqual({
      text: "set llm.model = opus",
      isError: false,
    });
    expect(cm.getConfigValue("llm.model")).toBe("opus");
    runConfigDirective("/config webSearch.maxResults=8", { configManager: cm });
    expect(cm.getConfigValue("webSearch.maxResults")).toBe(8);
    runConfigDirective("/config telemetry.enabled=false", {
      configManager: cm,
    });
    expect(cm.getConfigValue("telemetry.enabled")).toBe(false);
  });

  it("reads a value", () => {
    const cm = makeCm({ llm: { provider: "ollama" } });
    expect(
      runConfigDirective("/config llm.provider", { configManager: cm }),
    ).toEqual({
      text: "llm.provider = ollama",
      isError: false,
    });
  });

  it("masks secrets on set and get", () => {
    const cm = makeCm();
    const set = runConfigDirective("/config llm.apiKey=sk-ant-secret-9999", {
      configManager: cm,
    });
    expect(set.text).toBe("set llm.apiKey = set (…9999)");
    expect(set.text).not.toContain("secret");
    const get = runConfigDirective("/config llm.apiKey", { configManager: cm });
    expect(get.text).toBe("llm.apiKey = set (…9999)");
  });

  it("shows the full summary for bare /config", () => {
    const cm = makeCm({ llm: { provider: "anthropic", model: "opus" } });
    const out = runConfigDirective("/config", {
      configManager: cm,
      getConfigPath: () => "/tmp/config.json",
    });
    expect(out.isError).toBe(false);
    expect(out.text).toContain("provider: anthropic");
    expect(out.text).toContain("config file: /tmp/config.json");
  });

  it("reports a parse error (missing key before =)", () => {
    const cm = makeCm();
    const out = runConfigDirective("/config =value", { configManager: cm });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/missing key/);
  });
});

describe("runAgentHeadless — /config directive (no LLM, early return)", () => {
  let home;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hcfg-"));
    process.env.CHAINLESSCHAIN_HOME = home;
  });
  afterEach(() => {
    delete process.env.CHAINLESSCHAIN_HOME;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  });

  it("text: sets config and prints the confirmation, exit 0", async () => {
    const out = [];
    const r = await runAgentHeadless(
      { prompt: "/config llm.provider=anthropic", outputFormat: "text" },
      { writeOut: (s) => out.push(s) },
    );
    expect(r).toMatchObject({ exitCode: 0, isError: false });
    expect(out.join("").trim()).toBe("set llm.provider = anthropic");
  });

  it("json: emits a success result envelope", async () => {
    const out = [];
    const r = await runAgentHeadless(
      { prompt: "/config llm.provider", outputFormat: "json" },
      { writeOut: (s) => out.push(s) },
    );
    const env = JSON.parse(out.join(""));
    expect(env).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
    });
    expect(env.result).toContain("llm.provider");
    expect(r.exitCode).toBe(0);
  });

  it("stream-json: emits a single result line", async () => {
    const out = [];
    await runAgentHeadless(
      { prompt: "/config llm.model=haiku", outputFormat: "stream-json" },
      { writeOut: (s) => out.push(s) },
    );
    const lines = out
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "result", subtype: "success" });
    expect(lines[0].result).toBe("set llm.model = haiku");
  });

  it("a parse error returns exit 1 with an error subtype", async () => {
    const out = [];
    const r = await runAgentHeadless(
      { prompt: "/config =bad", outputFormat: "json" },
      { writeOut: (s) => out.push(s) },
    );
    const env = JSON.parse(out.join(""));
    expect(env.subtype).toBe("error");
    expect(env.is_error).toBe(true);
    expect(r.exitCode).toBe(1);
  });

  it("does NOT intercept a normal prompt (would need bootstrap → not a /config path)", () => {
    // Just the detection boundary — a normal task prompt is not a config directive.
    expect(isHeadlessConfigCommand("summarize @file.txt")).toBe(false);
  });
});
