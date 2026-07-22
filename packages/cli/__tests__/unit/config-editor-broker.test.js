import { describe, expect, it, vi } from "vitest";
import {
  openConfigEditor,
  parseEditorCommand,
} from "../../src/commands/config.js";

describe("config editor process boundary", () => {
  it("parses executable arguments without shell expansion", () => {
    expect(parseEditorCommand("code --wait --reuse-window")).toEqual([
      "code",
      "--wait",
      "--reuse-window",
    ]);
    expect(
      parseEditorCommand('"C:\\Program Files\\Editor\\editor.exe" --wait'),
    ).toEqual(["C:\\Program Files\\Editor\\editor.exe", "--wait"]);
  });

  it("preserves quoted and empty editor arguments", () => {
    expect(parseEditorCommand(`editor --name "two words" ''`)).toEqual([
      "editor",
      "--name",
      "two words",
      "",
    ]);
  });

  it("rejects malformed editor configuration", () => {
    expect(() => parseEditorCommand('"unterminated')).toThrow(
      /unterminated quote/,
    );
    expect(() => openConfigEditor("", "config.json")).toThrow(
      /command is empty/,
    );
  });

  it("passes the config path as a verbatim argv item through the Broker seam", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));
    const configPath = 'C:\\Users\\name\\config "x" & calc.json';

    openConfigEditor(
      '"C:\\Program Files\\Editor\\editor.exe" --wait',
      configPath,
      {
        spawnSync,
      },
    );

    expect(spawnSync).toHaveBeenCalledWith(
      "C:\\Program Files\\Editor\\editor.exe",
      ["--wait", configPath],
      {
        stdio: "inherit",
        origin: "config:editor",
        policy: "allow",
        scope: "config",
        shell: false,
      },
    );
  });
});
