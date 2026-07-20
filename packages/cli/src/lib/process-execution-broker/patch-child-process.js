/**
 * Monkey-patch node:child_process to route ALL spawn/exec calls through ExecutionBroker (M1)
 * This runs at CLI startup, before any other imports, ensuring every subprocess is audited
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Import ExecutionBroker singleton
const { executionBroker } = require("./index.js");

// Get the REAL native child_process module (unpatched, from Node.js internals)
const nativeCp = require("node:child_process");

// Replace all exported functions with broker-wrapped versions
// The broker already imports native methods directly, so NO RECURSION here
nativeCp.spawn = function patchedSpawn(command, args, options) {
  return executionBroker.spawn(command, args, options);
};

nativeCp.spawnSync = function patchedSpawnSync(command, args, options) {
  return executionBroker.spawnSync(command, args, options);
};

nativeCp.exec = function patchedExec(command, options, callback) {
  return executionBroker.exec(command, options, callback);
};

nativeCp.execSync = function patchedExecSync(command, options) {
  return executionBroker.execSync(command, options);
};

nativeCp.execFile = function patchedExecFile(file, args, options, callback) {
  return executionBroker.execFile(file, args, options, callback);
};

nativeCp.execFileSync = function patchedExecFileSync(file, args, options) {
  return executionBroker.execFileSync(file, args, options);
};

nativeCp.fork = function patchedFork(modulePath, args, options) {
  return executionBroker.fork(modulePath, args, options);
};

// Also patch child_process for CommonJS require
const cpModule = require.cache[require.resolve("node:child_process")];
if (cpModule && cpModule.exports) {
  cpModule.exports = nativeCp;
}

export default executionBroker;
