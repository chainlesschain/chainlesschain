// Match the native CJS-to-ESM import used by the Desktop main process.
module.exports = () =>
  import("../../src/lib/evolution/agent-evolution-runtime-composition.js");
