"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const extensionManifest = require("../package.json");
const {
  buildRemoteControlStartArgs,
  formatPairingNote,
  isPairingUsableFromAnotherDevice,
} = require("../src/chat/remote-handoff.js");
const {
  createRemoteControlHost,
  pairingQrHtml,
} = require("../src/remote-control-host.js");

test("LAN consent can only be configured at machine scope", () => {
  const property =
    extensionManifest.contributes.configuration.properties[
      "chainlesschain.remote.allowLan"
    ];
  assert.equal(property.default, false);
  assert.equal(property.scope, "machine");
});

function directPairing(overrides = {}) {
  return {
    mode: "direct",
    exposure: "loopback",
    lanAccessible: false,
    port: 18800,
    pairingUri: "chainlesschain://remote-control/pair#local-only",
    pairing: { expiresAt: 1760000000000 },
    ...overrides,
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
  };
  return child;
}

function fakeVscode(settings, onStartMenu) {
  const menus = [];
  const information = [];
  let panels = 0;
  return {
    api: {
      ViewColumn: { Beside: 2 },
      workspace: {
        getConfiguration: (section) => {
          assert.equal(section, "chainlesschain.remote");
          return { get: (key) => settings[key] };
        },
      },
      env: { clipboard: { writeText: async () => {} } },
      window: {
        showQuickPick: async (items) => {
          menus.push(items);
          if (onStartMenu && menus.length === 1) {
            return items.find((item) => item.action === "start");
          }
          return undefined;
        },
        showInformationMessage: (...args) => {
          information.push(args);
          return Promise.resolve(undefined);
        },
        showWarningMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
        setStatusBarMessage: () => {},
        createWebviewPanel: () => {
          panels++;
          return {
            webview: { html: "" },
            onDidDispose: () => {},
            reveal: () => {},
            dispose: () => {},
          };
        },
      },
    },
    menus,
    information,
    panels: () => panels,
  };
}

test("LAN exposure is emitted only for a strict explicit opt-in", () => {
  assert.deepEqual(buildRemoteControlStartArgs(), [
    "remote-control",
    "start",
    "--json",
  ]);
  assert.deepEqual(buildRemoteControlStartArgs({ allowLan: false }), [
    "remote-control",
    "start",
    "--json",
  ]);
  assert.deepEqual(buildRemoteControlStartArgs({ allowLan: "true" }), [
    "remote-control",
    "start",
    "--json",
  ]);
  assert.deepEqual(
    buildRemoteControlStartArgs({
      allowLan: true,
      relayUrl: " wss://relay.example ",
      peerId: " ide-1 ",
    }),
    [
      "remote-control",
      "start",
      "--json",
      "--relay-url",
      "wss://relay.example",
      "--peer-id",
      "ide-1",
    ],
  );
  assert.deepEqual(buildRemoteControlStartArgs({ allowLan: true }), [
    "remote-control",
    "start",
    "--json",
    "--allow-lan",
  ]);
});

test("direct pairing is fail-closed unless CLI explicitly reports LAN exposure", () => {
  const loopback = directPairing();
  const legacyDirect = directPairing({
    exposure: undefined,
    lanAccessible: undefined,
  });
  const inconsistent = directPairing({
    exposure: "lan",
    lanAccessible: false,
  });
  const lan = directPairing({ exposure: "lan", lanAccessible: true });
  const relay = directPairing({ mode: "relay", exposure: "loopback" });

  assert.equal(isPairingUsableFromAnotherDevice(loopback), false);
  assert.equal(isPairingUsableFromAnotherDevice(legacyDirect), false);
  assert.equal(isPairingUsableFromAnotherDevice(inconsistent), false);
  assert.equal(isPairingUsableFromAnotherDevice(lan), true);
  assert.equal(isPairingUsableFromAnotherDevice(relay), true);

  const localNote = formatPairingNote(loopback);
  assert.match(localNote, /direct loopback/i);
  assert.match(localNote, /only by clients on this machine/i);
  assert.doesNotMatch(localNote, /pair a phone/i);
  assert.match(formatPairingNote(lan), /direct LAN \(explicit opt-in\)/i);
  assert.match(formatPairingNote(relay), /relay \(E2EE\)/i);

  const localHtml = pairingQrHtml(loopback);
  assert.match(localHtml, /loopback-only/i);
  assert.match(localHtml, /intentionally not rendered/i);
  assert.doesNotMatch(localHtml, /<svg/i);
});

test("VS Code defaults to loopback and does not offer a phone QR", async () => {
  const child = fakeChild();
  let spawnedArgs;
  const logs = [];
  const ui = fakeVscode({ relayUrl: "", peerId: "", allowLan: false }, true);
  const host = createRemoteControlHost(ui.api, {
    command: () => "cc",
    log: (line) => logs.push(line),
    deps: {
      platform: "linux",
      spawn: (_command, args) => {
        spawnedArgs = args;
        return child;
      },
    },
  });

  await host.openMenu();
  assert.deepEqual(spawnedArgs, ["remote-control", "start", "--json"]);

  child.stdout.write(`${JSON.stringify(directPairing())}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.information[0][0], /loopback-only/i);
  assert.deepEqual(ui.information[0].slice(1), ["Copy local URI"]);
  assert.equal(
    logs.some((line) => line.includes("#local-only")),
    false,
  );
  assert.equal(
    logs.some((line) => line.includes("sensitive pairing URI hidden")),
    true,
  );

  await host.openMenu();
  assert.equal(
    ui.menus[1].some((item) => item.action === "qr"),
    false,
  );
  assert.equal(
    ui.menus[1].some((item) => /local-only pairing URI/i.test(item.label)),
    true,
  );
  assert.equal(ui.panels(), 0);
});

test("VS Code passes --allow-lan only when its setting is true", async () => {
  const child = fakeChild();
  let spawnedArgs;
  const ui = fakeVscode({ relayUrl: "", peerId: "", allowLan: true }, true);
  const host = createRemoteControlHost(ui.api, {
    deps: {
      platform: "linux",
      spawn: (_command, args) => {
        spawnedArgs = args;
        return child;
      },
    },
  });

  await host.openMenu();
  assert.deepEqual(spawnedArgs, [
    "remote-control",
    "start",
    "--json",
    "--allow-lan",
  ]);
});
