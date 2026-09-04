const assert = require("node:assert/strict");
const test = require("node:test");

const manifest = require("../package.json");
const {
  RECOMMENDED_CLI_VERSION,
  UPGRADE_COMMAND,
  runCliVersionSync,
} = require("../src/version-check");

test("uses the extension release recommendation for the startup CLI nudge", async () => {
  assert.equal(RECOMMENDED_CLI_VERSION, "0.166.22");
  assert.equal(
    RECOMMENDED_CLI_VERSION,
    manifest.chainlesschain.recommendedCliVersion,
  );

  let promptMessage = "";
  let upgradeCommand = "";
  const result = await runCliVersionSync({
    getVersion: async () => "chainlesschain 0.166.21",
    isDismissed: () => false,
    setDismissed: () => {},
    prompt: async (message) => {
      promptMessage = message;
      return "upgrade";
    },
    upgrade: (command) => {
      upgradeCommand = command;
    },
  });

  assert.equal(result, "upgrade");
  assert.match(promptMessage, /0\.166\.21/u);
  assert.match(promptMessage, /0\.166\.22/u);
  assert.equal(upgradeCommand, UPGRADE_COMMAND);
  assert.equal(upgradeCommand, "npm i -g chainlesschain@latest");
});

test("does not nudge when the installed CLI matches the recommendation", async () => {
  const result = await runCliVersionSync({
    getVersion: async () => "0.166.22",
    isDismissed: () => false,
    setDismissed: () => {},
    prompt: async () => {
      throw new Error("prompt must not be shown");
    },
    upgrade: () => {
      throw new Error("upgrade must not run");
    },
  });

  assert.equal(result, "none");
});
