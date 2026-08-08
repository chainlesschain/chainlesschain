"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");

const ACTIVITY_VIEW_COMMAND = "workbench.view.extension.chainlesschainIde";
const CHAT_VIEW_FOCUS_COMMAND = "chainlesschainIdeChat.focus";

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function findOuterMacAppBundle(executablePath) {
  if (typeof executablePath !== "string" || executablePath.length === 0) {
    return null;
  }
  let current = path.posix.resolve(executablePath.replaceAll("\\", "/"));
  let bundle = null;
  while (true) {
    if (current.toLowerCase().endsWith(".app")) bundle = current;
    const parent = path.posix.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return bundle;
}

async function activateMacHostWindow({
  platform = process.platform,
  executablePath = process.execPath,
  execFileProcess = execFile,
  timeoutMs = 10_000,
  log = () => {},
} = {}) {
  if (platform !== "darwin") return false;
  const appBundle = findOuterMacAppBundle(executablePath);
  if (!appBundle) {
    throw new Error(
      `could not resolve the macOS VS Code app bundle from ${executablePath}`,
    );
  }
  await new Promise((resolve, reject) => {
    execFileProcess(
      "/usr/bin/open",
      [appBundle],
      { timeout: timeoutMs, windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  log(`activated macOS host app ${appBundle}`);
  return true;
}

async function requestChatViewForDomJourney({
  commands,
  timeoutMs = 15_000,
  waitForFocus = false,
  log = () => {},
}) {
  // Current stable VS Code can dispatch the activity-view reveal successfully
  // while leaving the command Promise pending until the workbench has focus.
  // Do not turn that settlement detail into a false failure: every caller
  // immediately performs a bounded, real DOM/host-API proof that still fails
  // closed if the view was not actually revealed.
  const activityReveal = commands.executeCommand(ACTIVITY_VIEW_COMMAND);
  let activityRevealTimer;
  const activityRevealSettled = await Promise.race([
    Promise.resolve(activityReveal).then(() => true),
    new Promise((resolve) => {
      activityRevealTimer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]).finally(() => clearTimeout(activityRevealTimer));
  if (!activityRevealSettled) {
    log(
      `ChainlessChain activity view reveal command is still pending after ${timeoutMs}ms; continuing to downstream host proof`,
    );
  }

  // VS Code's generated `<webview-id>.focus` command can keep its returned
  // Promise pending until the Webview has received workbench focus. External
  // CDP must not wait for that Promise because it is responsible for bringing
  // the target forward. The macOS message-relay path foregrounds the native
  // app first, so it can explicitly await focus before asserting DOM readiness.
  const focus = commands.executeCommand(CHAT_VIEW_FOCUS_COMMAND);
  if (waitForFocus) {
    await withTimeout(
      Promise.resolve(focus),
      timeoutMs,
      "ChainlessChain chat webview focus",
    );
    log("ChainlessChain chat webview focus command settled");
    return;
  }
  Promise.resolve(focus).then(
    () => log("ChainlessChain chat webview focus command settled"),
    (error) =>
      log(
        `ChainlessChain chat webview focus command rejected: ${String(
          error?.message || error,
        )}`,
      ),
  );
}

module.exports = {
  ACTIVITY_VIEW_COMMAND,
  CHAT_VIEW_FOCUS_COMMAND,
  activateMacHostWindow,
  findOuterMacAppBundle,
  requestChatViewForDomJourney,
  withTimeout,
};
