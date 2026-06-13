/**
 * `/doctor` REPL command (Claude-Code parity) — consolidated session-health
 * checks + render. Pure: buildDoctorChecks(state) → checks, renderDoctor.
 */
import { describe, it, expect } from "vitest";
import {
  buildDoctorChecks,
  renderDoctor,
} from "../../src/repl/doctor-status.js";

const find = (checks, name) => checks.find((c) => c.name === name);

describe("buildDoctorChecks", () => {
  it("warns when no provider is configured", () => {
    const checks = buildDoctorChecks({ config: {} });
    const p = find(checks, "LLM provider");
    expect(p.level).toBe("warn");
    expect(p.detail).toMatch(/unset/);
  });

  it("reports provider + model OK when configured", () => {
    const checks = buildDoctorChecks({
      config: {
        llm: { provider: "anthropic", model: "claude-opus", apiKey: "sk-x" },
      },
    });
    expect(find(checks, "LLM provider")).toMatchObject({
      level: "ok",
      detail: "anthropic · claude-opus",
    });
    // key present → no API key warning
    expect(find(checks, "API key")).toBeUndefined();
  });

  it("warns when a cloud provider has no API key", () => {
    const checks = buildDoctorChecks({
      config: { llm: { provider: "openai", model: "gpt-4o" } },
    });
    expect(find(checks, "API key").level).toBe("warn");
  });

  it("does NOT warn about keys for local providers", () => {
    const checks = buildDoctorChecks({
      config: { llm: { provider: "ollama", model: "qwen2.5:7b" } },
    });
    expect(find(checks, "API key")).toBeUndefined();
  });

  it("reflects IDE tools, MCP servers, permission rules, and hooks", () => {
    const checks = buildDoctorChecks({
      config: { llm: { provider: "ollama" } },
      ideTools: ["getSelection", "getDiagnostics"],
      mcpServers: [{ server: "ide" }, { server: "fs" }],
      permissionRules: { allow: ["Read"], ask: [], deny: ["Bash(rm:*)"] },
      settingsHooks: {},
    });
    expect(find(checks, "IDE bridge").detail).toBe("2 tools connected");
    expect(find(checks, "MCP servers").detail).toBe("2 connected");
    expect(find(checks, "Permission rules").detail).toBe("2 rule(s)");
    expect(find(checks, "settings.json hooks").detail).toBe("loaded");
  });

  it("shows the disconnected/none states by default", () => {
    const checks = buildDoctorChecks({
      config: { llm: { provider: "ollama" } },
    });
    expect(find(checks, "IDE bridge").detail).toBe("not connected");
    expect(find(checks, "MCP servers").detail).toBe("none");
    expect(find(checks, "Permission rules").detail).toMatch(/default gate/);
    expect(find(checks, "settings.json hooks").detail).toBe("none");
  });
});

describe("renderDoctor", () => {
  it("renders icons and a clean-bill summary", () => {
    const out = renderDoctor([
      { level: "ok", name: "LLM provider", detail: "ollama" },
      { level: "info", name: "MCP servers", detail: "none" },
    ]);
    expect(out).toContain("Session health (/doctor):");
    expect(out).toContain("✓ LLM provider: ollama");
    expect(out).toContain("· MCP servers: none");
    expect(out).toContain("no problems detected");
  });

  it("counts warnings/errors in the summary", () => {
    const out = renderDoctor([
      { level: "warn", name: "API key", detail: "missing" },
      { level: "err", name: "X", detail: "broken" },
      { level: "ok", name: "Y", detail: "fine" },
    ]);
    expect(out).toContain("⚠ API key: missing");
    expect(out).toContain("✗ X: broken");
    expect(out).toContain("2 item(s) need attention");
  });

  it("tolerates empty/invalid input", () => {
    expect(renderDoctor(null)).toContain("no problems detected");
    expect(renderDoctor([])).toContain("Session health");
  });
});
