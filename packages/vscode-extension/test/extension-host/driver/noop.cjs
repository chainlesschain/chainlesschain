"use strict";

const vscode = require("vscode");

const DRIVER_COMMAND = "chainlesschainTests.runHostJourney";

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(DRIVER_COMMAND, () =>
      require("./smoke.cjs").run(),
    ),
  );
}

function deactivate() {}

module.exports = { DRIVER_COMMAND, activate, deactivate };
