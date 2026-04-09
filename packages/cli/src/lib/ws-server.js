/**
 * @deprecated — canonical implementation lives in
 * `../gateways/ws/ws-server.js` as of the CLI Runtime Convergence
 * roadmap (Phase 6a, 2026-04-09). This file is retained as a
 * re-export shim for backwards compatibility and will be removed
 * once all external consumers have migrated.
 *
 * Please import `ChainlessChainWSServer` and `tokenizeCommand`
 * directly from `packages/cli/src/gateways/ws/ws-server.js`
 * in new code.
 */

export {
  ChainlessChainWSServer,
  tokenizeCommand,
} from "../gateways/ws/ws-server.js";
