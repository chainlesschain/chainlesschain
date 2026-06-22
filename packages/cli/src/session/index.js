/**
 * CLI session module — thin re-export of @chainlesschain/session-core
 *
 * Managed Agents parity Phase A+B.
 * Consume via: import { ... } from "../session/index.js" inside packages/cli/src/.
 *
 * NOTE: packages/cli is ESM ("type": "module"). The previous
 * `module.exports = require(...)` form silently broke here (module/require are
 * undefined in ESM); use an ESM re-export.
 */
export * from "@chainlesschain/session-core";
