import { describe, expect, it, vi } from "vitest";

import {
  RELOAD_WINDOW_BUTTON,
  RELOAD_WINDOW_COMMAND,
  WINDOW_RELOAD_PROMPT_VERSION_KEY,
  planWindowReloadPrompt,
  promptForWindowReloadAfterExtensionUpgrade,
  resolveExtensionVersion,
} from "../../../vscode-extension/src/webview-upgrade-reload.js";

function makeState(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    get: vi.fn((key, fallback) =>
      values.has(key) ? values.get(key) : fallback,
    ),
    update: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
  };
}

describe("upgrade Window Reload prompt decision", () => {
  it("prefers the running extension packageJSON and supports package fallbacks", () => {
    expect(
      resolveExtensionVersion(
        { extension: { packageJSON: { version: " 0.37.29 " } } },
        { version: "0.1.0" },
      ),
    ).toBe("0.37.29");
    expect(
      resolveExtensionVersion(
        { extension: { packageJson: { version: "0.37.28" } } },
        { version: "0.1.0" },
      ),
    ).toBe("0.37.28");
    expect(resolveExtensionVersion({}, { version: "0.37.27" })).toBe("0.37.27");
  });

  it("prompts for a missing marker or changed version, but not the same version", () => {
    expect(planWindowReloadPrompt(null, "0.37.29")).toMatchObject({
      shouldPrompt: true,
      reason: "marker-missing",
    });
    expect(planWindowReloadPrompt("0.37.28", "0.37.29")).toMatchObject({
      shouldPrompt: true,
      reason: "version-changed",
    });
    expect(planWindowReloadPrompt("0.37.29", "0.37.29")).toMatchObject({
      shouldPrompt: false,
      reason: "same-version",
    });
    expect(planWindowReloadPrompt("0.37.29", null)).toMatchObject({
      shouldPrompt: false,
      reason: "missing-current-version",
    });
  });
});

describe("one-shot activation Window Reload prompt", () => {
  it("persists before prompting, never auto-reloads, and stays quiet on same-version EH restart", async () => {
    const order = [];
    const state = makeState();
    state.update.mockImplementation(async (key, value) => {
      order.push(`persist:${value}`);
      state.values.set(key, value);
    });
    const showInformationMessage = vi.fn(async () => {
      order.push("prompt");
      return undefined;
    });
    const executeCommand = vi.fn(async (command) => {
      order.push(`execute:${command}`);
    });
    const args = {
      vscode: {
        window: { showInformationMessage },
        commands: { executeCommand },
      },
      context: {
        extension: { packageJSON: { version: "0.37.29" } },
        workspaceState: state,
      },
      packageJson: { version: "fallback" },
    };

    const first = await promptForWindowReloadAfterExtensionUpgrade(args);
    const restarted = await promptForWindowReloadAfterExtensionUpgrade(args);

    expect(first).toMatchObject({
      prompted: true,
      reloaded: false,
      reason: "marker-missing",
      currentVersion: "0.37.29",
    });
    expect(restarted).toMatchObject({
      prompted: false,
      reloaded: false,
      reason: "same-version",
    });
    expect(order).toEqual(["persist:0.37.29", "prompt"]);
    expect(state.values.get(WINDOW_RELOAD_PROMPT_VERSION_KEY)).toBe("0.37.29");
    expect(showInformationMessage).toHaveBeenCalledTimes(1);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("reloads the full window only after the user confirms", async () => {
    const state = makeState({
      [WINDOW_RELOAD_PROMPT_VERSION_KEY]: "0.37.28",
    });
    const showInformationMessage = vi.fn(async () => RELOAD_WINDOW_BUTTON);
    const executeCommand = vi.fn(() => Promise.resolve());

    const result = await promptForWindowReloadAfterExtensionUpgrade({
      vscode: {
        window: { showInformationMessage },
        commands: { executeCommand },
      },
      context: { workspaceState: state },
      packageJson: { version: "0.37.29" },
    });

    expect(result).toMatchObject({
      prompted: true,
      reloaded: true,
      reason: "version-changed",
    });
    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Reload this VS Code window"),
      RELOAD_WINDOW_BUTTON,
      "Later",
    );
    expect(executeCommand).toHaveBeenCalledWith(RELOAD_WINDOW_COMMAND);
    expect(executeCommand).not.toHaveBeenCalledWith(
      "workbench.action.webview.reloadWebviewAction",
    );
  });

  it("keeps the new marker when the confirmed Window Reload fails", async () => {
    const state = makeState();
    const showInformationMessage = vi.fn(async () => RELOAD_WINDOW_BUTTON);
    const executeCommand = vi.fn(async () => {
      throw new Error("command unavailable");
    });

    await expect(
      promptForWindowReloadAfterExtensionUpgrade({
        vscode: {
          window: { showInformationMessage },
          commands: { executeCommand },
        },
        context: {
          extension: { packageJSON: { version: "0.37.29" } },
          workspaceState: state,
        },
      }),
    ).rejects.toThrow("command unavailable");

    expect(state.values.get(WINDOW_RELOAD_PROMPT_VERSION_KEY)).toBe("0.37.29");
  });

  it("does nothing when persistent state is unavailable", async () => {
    const showInformationMessage = vi.fn();
    const executeCommand = vi.fn();
    const result = await promptForWindowReloadAfterExtensionUpgrade({
      vscode: {
        window: { showInformationMessage },
        commands: { executeCommand },
      },
      context: {},
      packageJson: { version: "0.37.29" },
    });

    expect(result).toMatchObject({
      prompted: false,
      reloaded: false,
      reason: "persistent-state-unavailable",
    });
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
