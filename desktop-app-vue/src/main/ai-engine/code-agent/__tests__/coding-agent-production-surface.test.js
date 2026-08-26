import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const { CODING_AGENT_IPC_CHANNELS } = require("../coding-agent-ipc-v3.js");

function extractChannels(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]);
}

describe("Coding Agent V3 production surface guard", () => {
  it("keeps every preload invoke backed by an ipcMain handler", () => {
    const preloadSource = fs.readFileSync(
      path.resolve(__dirname, "../../../../preload/index.js"),
      "utf8",
    );
    const ipcSource = fs.readFileSync(
      path.resolve(__dirname, "../coding-agent-ipc-v3.js"),
      "utf8",
    );

    const preloadChannels = extractChannels(
      preloadSource,
      /ipcRenderer\.invoke\(\s*["'](coding-agent:[^"']+)["']/g,
    );
    const registeredChannels = extractChannels(
      ipcSource,
      /\bipc\.handle\(\s*["'](coding-agent:[^"']+)["']/g,
    );
    const loopRegisteredChannels = extractChannels(
      ipcSource,
      /\[\s*["'](coding-agent:app-server-(?:thread|turn)-[^"']+)["']\s*,\s*["'][^"']+["']\s*\]/g,
    );

    // The legacy respondQuestion and canonical respondElicitation preload
    // methods intentionally share one handler. Pin that compatibility alias
    // while rejecting any additional accidental duplicate invocation.
    const duplicatePreloadChannels = preloadChannels.filter(
      (channel, index) => preloadChannels.indexOf(channel) !== index,
    );
    expect(duplicatePreloadChannels).toEqual([
      "coding-agent:respond-elicitation",
    ]);
    expect(new Set(CODING_AGENT_IPC_CHANNELS).size).toBe(
      CODING_AGENT_IPC_CHANNELS.length,
    );
    expect(
      [...new Set([...registeredChannels, ...loopRegisteredChannels])].sort(),
    ).toEqual([...CODING_AGENT_IPC_CHANNELS].sort());
    expect([...new Set(preloadChannels)].sort()).toEqual(
      [...CODING_AGENT_IPC_CHANNELS].sort(),
    );
  });

  it("is called from the production main-process lifetime", () => {
    const mainSource = fs.readFileSync(
      path.resolve(__dirname, "../../../../main/index.js"),
      "utf8",
    );

    expect(mainSource).toContain("this.initializeCodingAgentV3();");
    expect(mainSource).toContain(
      "this.codingAgentBootstrap.attachWindow(this.mainWindow)",
    );
    expect(mainSource).toContain("await this.codingAgentBootstrap.dispose()");
  });
});
