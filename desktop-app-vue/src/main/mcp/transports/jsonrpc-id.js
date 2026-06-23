/**
 * JSON-RPC request-id helpers shared by the MCP transports.
 */

/**
 * Whether an outgoing JSON-RPC message needs a transport-assigned request id.
 *
 * Only method-bearing messages that lack an id get one assigned. The absence
 * check uses `== null` (matches only null/undefined) rather than a falsy check:
 * `!message.id` would treat a spec-valid id of `0` (or an empty-string id) as
 * missing and reassign it, after which the server's response — echoing the
 * original id `0` — would never match the reassigned pending id, orphaning the
 * response until it times out.
 *
 * @param {{ id?: unknown, method?: unknown } | null | undefined} message
 * @returns {boolean}
 */
function needsRequestId(message) {
  return !!(message && message.id == null && message.method);
}

module.exports = { needsRequestId };
