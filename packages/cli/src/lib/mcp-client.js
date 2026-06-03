/**
 * @deprecated — canonical implementation lives in `../harness/mcp-client.js`
 * as of the CLI Runtime Convergence roadmap (Phase 3, 2026-04-09).
 * This file is retained as a re-export shim for backwards compatibility
 * and will be removed once all external consumers have migrated.
 *
 * Please import `MCPClient`, `MCPServerConfig`, and `ServerState` directly
 * from `packages/cli/src/harness/mcp-client.js` in new code.
 */

export {
  ServerState,
  MCPClient,
  MCPServerConfig,
  inferTransport,
  isHttpTransport,
  _deps,
} from "../harness/mcp-client.js";
