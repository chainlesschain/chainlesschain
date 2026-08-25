# @chainlesschain/agent-sdk

TypeScript SDK for driving the ChainlessChain `cc` CLI agent — the typed
contract for **stream events, approval callbacks, checkpoints, and session
resume**, so consumers (VS Code extension, web-panel, custom hosts) stop
hand-assembling CLI argv and hand-parsing NDJSON.

```ts
import { AgentSession, listSessions } from "@chainlesschain/agent-sdk";

const session = new AgentSession({
  resume: previousSessionId, // session-resume contract
  permissionMode: "acceptEdits",
  onApproval: async (req) =>
    (await ui.confirm(req))
      ? { kind: "acceptOnce" }
      : { kind: "decline", reason: "User denied the operation" },
  onQuestion: async (req) => await ui.answer(req), // SDK echoes req.binding
  onElicitation: async (req) => await ui.answerMcp(req),
});
session.on("text", (delta) => render(delta)); // stream-event contract
const ready = new Promise<void>((resolve) =>
  session.on("init", (e) => {
    persist(e.session_id);
    resolve();
  }),
);
session.on("elicitation_deferred", (e) => queueForInteractiveHost(e));
session.on("elicitation_complete", (e) => settleExternalFlow(e));
session.start();
await ready; // system/init is the protocol readiness signal
const nextResult = session.nextResult();
session.send("run the tests and fix failures");
const result = await nextResult;
```

Approval callbacks may still return booleans for source compatibility. Direct
`respondApproval(id, boolean)` calls retain the legacy boolean wire; structured
decisions echo the request binding and can express scoped turn/session grants.

Entries:

- `@chainlesschain/agent-sdk` — Node: `AgentSession` (stream-json spawn
  client), `attachBackgroundSession` (pipe attach), `listSessions` /
  `listCheckpoints` / `restoreCheckpoint` (checkpoint contract, one-shot
  `--json` wrappers).
- `@chainlesschain/agent-sdk/protocol` — pure types + guards, no runtime I/O.
- `@chainlesschain/agent-sdk/browser` — browser-safe: protocol types,
  NDJSON carry-buffer decoder, `bg-*` WS frame helpers for web-panel.

Non-TypeScript consumers (JetBrains plugin) implement the same wire contract
from [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — the protocol, not the SDK, is
the compatibility surface.

Build: `npm run build` (tsc dual ESM + CJS). Test: `npm test` (vitest).
