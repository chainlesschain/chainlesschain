import { describe, expect, it, vi } from "vitest";
import pkg from "../../../../src/main/terminal/terminal-create-request.js";

const { createBoundTerminalSession } = pkg;

describe("shared Desktop terminal create adapter", () => {
  it("forwards projectId and legacy cwd selectors but drops root claims", () => {
    const ptyManager = {
      create: vi.fn(() => ({ sessionId: "session-1" })),
    };

    const result = createBoundTerminalSession(ptyManager, {
      projectId: "project-1",
      cwd: "C:\\legacy-selector",
      workspaceCwd: "C:\\renderer-spoof",
      policyCwd: "C:\\renderer-spoof",
      projectRoot: "C:\\renderer-spoof",
      shell: "pwsh",
      env: { SAFE: "1" },
      cols: 120,
      rows: 40,
    });

    expect(result).toEqual({ sessionId: "session-1" });
    expect(ptyManager.create).toHaveBeenCalledWith({
      projectId: "project-1",
      cwd: "C:\\legacy-selector",
      shell: "pwsh",
      env: { SAFE: "1" },
      cols: 120,
      rows: 40,
    });
  });
});
