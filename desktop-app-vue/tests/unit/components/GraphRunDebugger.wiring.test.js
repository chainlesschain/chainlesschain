import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..", "..", "..");

function source(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("GraphRunDebugger production wiring", () => {
  it.each([
    ["Coding Agent", "src/renderer/pages/AIChatPage.vue"],
    ["Workflow Manager", "src/renderer/pages/WorkflowMonitorPage.vue"],
    ["Specialized Agents", "src/renderer/shell/AgentDashboardPanel.vue"],
  ])("mounts the shared metadata-only overlay in %s", (_surface, file) => {
    const value = source(file);

    expect(value).toContain("GraphRunDebugger");
    expect(value).toContain("<GraphRunDebugger");
    expect(value).toContain(":graph=");
  });

  it("hydrates Coding Agent graph and durable event metadata together", () => {
    const value = source("src/renderer/pages/useAiChatHarness.js");

    expect(value).toContain("codingAgentStore.fetchTaskGraph(sessionId)");
    expect(value).toContain("codingAgentStore.fetchSessionEvents(sessionId)");
    expect(value).toContain("Promise.all");
  });
});
