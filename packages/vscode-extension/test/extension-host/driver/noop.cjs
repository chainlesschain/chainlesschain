"use strict";

const vscode = require("vscode");

const DRIVER_COMMAND = "chainlesschainTests.runHostJourney";

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(DRIVER_COMMAND, async () => {
      try {
        return await require("./smoke.cjs").run();
      } finally {
        if (
          process.env.CC_UI_CONVERSATION_RECOVERY === "1" &&
          /^[a-f0-9]{64}$/u.test(
            process.env.CHAINLESSCHAIN_HOST_DOM_TOKEN || "",
          )
        ) {
          // Normal hosts have real Memento databases. Ask VS Code to close
          // normally so its storage lifecycle flushes before the next phase.
          setTimeout(
            () =>
              Promise.resolve(
                vscode.commands.executeCommand("workbench.action.quit"),
              ).catch((error) => console.error("Host shutdown failed", error)),
            250,
          );
        }
      }
    }),
  );
}

function deactivate() {}

module.exports = { DRIVER_COMMAND, activate, deactivate };
