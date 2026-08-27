import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ipcSource = readFileSync(
  resolve(process.cwd(), "src/main/llm/stream-controller-ipc.js"),
  "utf8",
);

describe("bounded stream controller IPC wiring", () => {
  it("routes controller lifecycle operations through the bounded registry", () => {
    expect(ipcSource).toContain("new StreamControllerRegistry()");
    expect(ipcSource).toContain("streamControllerRegistry.getOrCreate(");
    expect(ipcSource).toContain("streamControllerRegistry.validateStreamId(");
    expect(ipcSource).toContain(
      "streamControllerRegistry.scheduleTerminalDelete(",
    );
    expect(ipcSource).toContain("streamControllerRegistry.destroyAll()");
    expect(ipcSource).not.toContain("const activeControllers = new Map()");
  });
});
