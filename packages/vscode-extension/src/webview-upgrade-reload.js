/**
 * VS Code may retain Webview DOMs while restarting the Extension Host. On the
 * first activation of a new extension build, offer a full Window Reload so no
 * old client script survives without resolving its provider again.
 *
 * `workbench.action.webview.reloadWebviewAction` is intentionally NOT used:
 * it can reload the renderer's cached HTML without recreating the Extension
 * Host/provider message lifecycle. A full `reloadWindow` works, but is
 * disruptive, so it is only run after an explicit user click.
 */
const WINDOW_RELOAD_PROMPT_VERSION_KEY =
  "chainlesschain.chatWindowReloadPromptVersion.v1";
const RELOAD_WINDOW_COMMAND = "workbench.action.reloadWindow";
const RELOAD_WINDOW_BUTTON = "Reload Window";
const LATER_BUTTON = "Later";

function cleanVersion(value) {
  const version = typeof value === "string" ? value.trim() : "";
  return version || null;
}

/** Resolve the running extension version, with package.json as a test/legacy
 * fallback for hosts that do not expose context.extension.packageJSON. */
function resolveExtensionVersion(context, packageJson) {
  return (
    cleanVersion(context?.extension?.packageJSON?.version) ||
    cleanVersion(context?.extension?.packageJson?.version) ||
    cleanVersion(packageJson?.version)
  );
}

/** Pure decision helper: downgrades also count as a change because their
 * bundled Webview script may differ just as much as an upgrade. */
function planWindowReloadPrompt(previousVersion, currentVersion) {
  const previous = cleanVersion(previousVersion);
  const current = cleanVersion(currentVersion);
  if (!current) {
    return {
      shouldPrompt: false,
      previousVersion: previous,
      currentVersion: null,
      reason: "missing-current-version",
    };
  }
  if (previous === current) {
    return {
      shouldPrompt: false,
      previousVersion: previous,
      currentVersion: current,
      reason: "same-version",
    };
  }
  return {
    shouldPrompt: true,
    previousVersion: previous,
    currentVersion: current,
    reason: previous ? "version-changed" : "marker-missing",
  };
}

function isMemento(value) {
  return (
    value &&
    typeof value.get === "function" &&
    typeof value.update === "function"
  );
}

/**
 * Reload Window only affects the current VS Code window, so its prompt marker
 * must be workspace/window scoped too. A global marker would let the first
 * upgraded window suppress the necessary prompt in every other open window.
 */
function resolveWindowReloadPromptState(context) {
  if (isMemento(context?.workspaceState)) return context.workspaceState;
  if (isMemento(context?.globalState)) return context.globalState;
  return null;
}

/**
 * Persist before showing the prompt. If the user accepts and VS Code restarts
 * the Extension Host, the next activation sees the marker and does not prompt
 * or reload again. Dismissing the prompt also stays quiet for this version.
 */
async function promptForWindowReloadAfterExtensionUpgrade({
  vscode,
  context,
  packageJson,
} = {}) {
  const state = resolveWindowReloadPromptState(context);
  if (!state) {
    return {
      shouldPrompt: false,
      prompted: false,
      reloaded: false,
      reason: "persistent-state-unavailable",
    };
  }

  const currentVersion = resolveExtensionVersion(context, packageJson);
  const previousVersion = state.get(WINDOW_RELOAD_PROMPT_VERSION_KEY);
  const plan = planWindowReloadPrompt(previousVersion, currentVersion);
  if (!plan.shouldPrompt) {
    return { ...plan, prompted: false, reloaded: false };
  }

  await state.update(WINDOW_RELOAD_PROMPT_VERSION_KEY, plan.currentVersion);
  const choice = await vscode.window.showInformationMessage(
    `ChainlessChain IDE ${plan.currentVersion} is installed. Reload this VS Code window once to refresh the retained chat UI.`,
    RELOAD_WINDOW_BUTTON,
    LATER_BUTTON,
  );
  if (choice !== RELOAD_WINDOW_BUTTON) {
    return { ...plan, prompted: true, reloaded: false };
  }
  await vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND);
  return { ...plan, prompted: true, reloaded: true };
}

module.exports = {
  WINDOW_RELOAD_PROMPT_VERSION_KEY,
  RELOAD_WINDOW_COMMAND,
  RELOAD_WINDOW_BUTTON,
  cleanVersion,
  resolveExtensionVersion,
  planWindowReloadPrompt,
  resolveWindowReloadPromptState,
  promptForWindowReloadAfterExtensionUpgrade,
};
