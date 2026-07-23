import { describe, expect, it, vi } from "vitest";
import { openMemoryEditor } from "../../src/commands/memory.js";

describe("memory editor process boundary", () => {
  it("passes editor arguments and the memory path through Broker argv", () => {
    const execFileSync = vi.fn(() => "");
    const filePath = 'C:\\Users\\name\\Memory "x" & calc.md';

    openMemoryEditor(
      '"C:\\Program Files\\Editor\\editor.exe" --wait',
      filePath,
      { execFileSync },
    );

    expect(execFileSync).toHaveBeenCalledWith(
      "C:\\Program Files\\Editor\\editor.exe",
      ["--wait", filePath],
      {
        stdio: "inherit",
        origin: "memory:editor",
        policy: "allow",
        scope: "memory",
        shell: false,
      },
    );
  });

  it("rejects empty or malformed editor commands before spawning", () => {
    const execFileSync = vi.fn();
    expect(() => openMemoryEditor("", "MEMORY.md", { execFileSync })).toThrow(
      /command is empty/,
    );
    expect(() =>
      openMemoryEditor('"unterminated', "MEMORY.md", { execFileSync }),
    ).toThrow(/unterminated quote/);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
