import test from "node:test";
import assert from "node:assert/strict";
import {
  publicPluginRecord,
  cliShim,
} from "../../jetbrains-plugin/scripts/verify01-public-first-run.mjs";

test("public plugin selection rejects pending, hidden, wrong-version and unsafe archive records", () => {
  const record = {
    id: 1192210,
    version: "0.4.161",
    approve: true,
    listed: true,
    hidden: false,
    file: "32208/1192210/chainlesschain-ide-bridge-0.4.161.zip",
  };
  assert.equal(publicPluginRecord([record]).id, record.id);
  for (const delta of [
    { version: "0.4.166" },
    { hidden: true },
    { approve: false },
    { listed: false },
    { file: "../plugin.zip" },
  ])
    assert.throws(() => publicPluginRecord([{ ...record, ...delta }]));
});

test("CLI shims forward arguments to real public CLI and reject Windows expansion syntax", () => {
  assert.equal(
    cliShim("C:\\node.exe", "C:\\public cli\\bin.js", true),
    '@echo off\r\n"C:\\node.exe" "C:\\public cli\\bin.js" %*\r\n',
  );
  assert.match(
    cliShim("/node path/node", "/cli's/bin.js", false),
    /exec '\/node path\/node' '\/cli'"'"'s\/bin\.js' "\$@"/u,
  );
  assert.throws(() => cliShim("C:\\%PATH%\\node.exe", "C:\\cli.js", true));
});
