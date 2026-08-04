"use strict";

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

async function requestChatViewForDomJourney({
  commands,
  timeoutMs = 15_000,
  log = () => {},
}) {
  await withTimeout(
    commands.executeCommand(ACTIVITY_VIEW_COMMAND),
    timeoutMs,
    "ChainlessChain activity view reveal",
  );

  // VS Code's generated `<webview-id>.focus` command can keep its returned
  // Promise pending until the Webview has received workbench focus. On the
  // macOS extension-test host that creates a deadlock: the external CDP peer
  // is deliberately waiting for our ready signal before it starts discovering
  // and driving the Webview target. Dispatch the real production command, but
  // let CDP's target/DOM assertions be the authoritative readiness check.
  const focus = commands.executeCommand(CHAT_VIEW_FOCUS_COMMAND);
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
  requestChatViewForDomJourney,
  withTimeout,
};
