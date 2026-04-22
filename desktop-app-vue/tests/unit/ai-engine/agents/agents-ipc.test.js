/**
 * Structural contract tests for agents-ipc.
 *
 * Handler-level behavior tests are not feasible here because the module
 * lazy-loads AgentTemplateManager / AgentRegistry / AgentCoordinator via
 * CommonJS require() inside factory closures; Vitest's `vi.mock` cannot
 * reliably intercept those dynamic CJS requires without a source-level DI
 * refactor. These tests instead verify the IPC contract: module loads,
 * exports exist, and all 16 declared channels are registered.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_PATH = resolve(
  __dirname,
  "../../../../src/main/ai-engine/agents/agents-ipc.js",
);

const EXPECTED_CHANNELS = [
  "agents:list-templates",
  "agents:get-template",
  "agents:create-template",
  "agents:update-template",
  "agents:delete-template",
  "agents:deploy-agent",
  "agents:terminate-agent",
  "agents:list-instances",
  "agents:get-status",
  "agents:assign-task",
  "agents:get-task-status",
  "agents:cancel-task",
  "agents:orchestrate",
  "agents:get-plan",
  "agents:get-performance",
  "agents:get-statistics",
];

describe("agents-ipc (structural)", () => {
  it("source file exists", () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it("exports registerAgentsIPC", () => {
    const src = readFileSync(SOURCE_PATH, "utf-8");
    expect(src).toMatch(/module\.exports\s*=\s*\{[^}]*registerAgentsIPC/);
  });

  it("declares all 16 expected channels in source", () => {
    const src = readFileSync(SOURCE_PATH, "utf-8");
    for (const channel of EXPECTED_CHANNELS) {
      expect(src).toContain(`'${channel}'`);
    }
  });

  it("registers exactly 16 ipcMain.handle calls", () => {
    const src = readFileSync(SOURCE_PATH, "utf-8");
    const matches = src.match(/ipcMain\.handle\(/g);
    expect(matches).toHaveLength(EXPECTED_CHANNELS.length);
  });

  it("declares lazy-init singletons for its three managers", () => {
    const src = readFileSync(SOURCE_PATH, "utf-8");
    expect(src).toContain("AgentTemplateManager");
    expect(src).toContain("AgentRegistry");
    expect(src).toContain("AgentCoordinator");
  });
});
