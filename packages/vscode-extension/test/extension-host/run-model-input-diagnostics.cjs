"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  cp = require("node:child_process");
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "cc-model-input-vscode-host-"),
);
const profile = path.join(root, "profile"),
  workspace = path.join(root, "workspace");
fs.mkdirSync(path.join(profile, "User"), { recursive: true });
fs.mkdirSync(workspace);
fs.writeFileSync(
  path.join(profile, "User", "settings.json"),
  JSON.stringify({
    "chainlesschain.ide.enabled": false,
    "chainlesschain.cli.managed.enabled": false,
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "workbench.startupEditor": "none",
  }),
);
const env = {
  ...process.env,
  CC_MODEL_INPUT_HOST_DIR: root,
  CC_MODEL_INPUT_NODE: process.execPath,
};
for (const key of Object.keys(env))
  if (
    /API_KEY|TOKEN|SECRET|AUTH|NODE_OPTIONS|ELECTRON_RUN_AS_NODE|VSCODE_IPC_HOOK_CLI/i.test(
      key,
    )
  )
    delete env[key];
const extension = path.resolve(__dirname, "../..");
const binary = process.argv[2];
if (!binary || !path.isAbsolute(binary))
  throw Error(
    "Usage: node test/extension-host/run-model-input-diagnostics.cjs <absolute VS Code executable>",
  );
if (!fs.existsSync(binary)) throw Error("Installed Code executable missing");
const log = fs.openSync(path.join(root, "code.log"), "wx");
const child = cp.spawn(
  binary,
  [
    "--user-data-dir",
    profile,
    "--extensions-dir",
    path.join(root, "extensions"),
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--new-window",
    "--extensionDevelopmentPath=" + extension,
    "--extensionTestsPath=" +
      path.join(
        extension,
        "test/extension-host/driver/model-input-diagnostics.cjs",
      ),
    workspace,
  ],
  { env, windowsHide: true, stdio: ["ignore", log, log] },
);
console.log(JSON.stringify({ root, pid: child.pid }));
const timer = setTimeout(() => {
  child.kill();
  console.error("Native host deadline exceeded");
  process.exitCode = 1;
}, 90000);
child.on("error", (e) => {
  clearTimeout(timer);
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  fs.closeSync(log);
  const output = path.join(root, "host-result.json");
  console.log(
    JSON.stringify({ root, code, signal, resultExists: fs.existsSync(output) }),
  );
  if (code !== 0 || !fs.existsSync(output)) {
    process.exitCode = 1;
    console.error(
      fs.readFileSync(path.join(root, "code.log"), "utf8").slice(-2500),
    );
  } else console.log(fs.readFileSync(output, "utf8"));
});
