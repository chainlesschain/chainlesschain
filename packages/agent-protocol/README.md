# @chainlesschain/agent-protocol

Canonical, versioned Agent and Graph protocol contract used by ChainlessChain.
The package contains the JSON Schema, compatibility checker, and generated
Kotlin and Swift bindings. TypeScript and Python applications can use the
separately published Agent SDKs when they need a transport client in addition
to the wire contract.

## Install

```bash
npm install @chainlesschain/agent-protocol
```

Node.js 22.12 or newer is required.

## JavaScript API

```js
import {
  CC_AGENT_PROTOCOL_SCHEMA,
  CC_AGENT_PROTOCOL_SCHEMA_DIGEST,
  CC_AGENT_STREAM_EVENT_TYPES,
  CC_AGENT_PROTOCOL_VERSION,
  assertCanonicalAgentStreamEvent,
  assertAgentStreamEvent,
  assertApprovalDecision,
  assertProtocolCompatible,
  validateProtocolMessage,
} from "@chainlesschain/agent-protocol";

console.log(CC_AGENT_PROTOCOL_VERSION, CC_AGENT_PROTOCOL_SCHEMA_DIGEST);
console.log(CC_AGENT_STREAM_EVENT_TYPES);
assertProtocolCompatible(previousSchema, CC_AGENT_PROTOCOL_SCHEMA);
assertApprovalDecision({ kind: "acceptOnce" });
assertAgentStreamEvent({ type: "result", subtype: "success" });
assertCanonicalAgentStreamEvent({
  type: "result",
  subtype: "success",
  is_error: false,
});
console.log(validateProtocolMessage(incomingJsonRpcMessage));
```

`validateProtocolMessage`, `validateProtocolDefinition`, and
`validateApprovalDecision`/`validateAgentStreamEvent` are derived from the
packaged canonical schema and return `{ ok, errors }`. Their `assert*`
counterparts throw on invalid input. `CC_AGENT_STREAM_EVENT_TYPES` is the
generated inventory of known stdout discriminators. `AgentStreamEventEnvelope`
and `validateAgentStreamEvent` are the lossless transport boundary and accept
unknown future event types. `AgentStreamEventPayload` /
`CanonicalAgentStreamEvent` and `validateCanonicalAgentStreamEvent` validate
the complete discriminator-specific payload for every currently known event.
Use the strict validator at application boundaries, while transports should
still preserve unknown future event types for forward compatibility.

Public subpath exports:

- `@chainlesschain/agent-protocol/schema` — canonical JSON Schema.
- `@chainlesschain/agent-protocol/compatibility` — additive/breaking-change
  comparison helpers.
- `@chainlesschain/agent-protocol/generated/kotlin` — generated Kotlin source.
- `@chainlesschain/agent-protocol/generated/swift` — generated Swift source.

The package version and the protocol version are separate. The current npm
package release candidate is `0.1.8`; the embedded wire protocol is version
`1` and declares its
minimum compatible protocol version in `x-cc-protocol`.

## Release integrity

Generated outputs are checked against the canonical schema before publish.
Compatibility is checked against `schema/baselines/v1.json`; breaking changes
must not be released under the existing protocol version.
