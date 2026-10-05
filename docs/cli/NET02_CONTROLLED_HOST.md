# NET-02 Linux controlled-host permission authority

As of 2026-10-05, the explicit host API is included in public CLI
`0.166.86@8458a0a502`; administrator provisioning is still required.

The source entry `chainlesschain/src/runtime/permission-authority-host.js`
(added after the public npm `0.166.85@84f204db94` release)
connects durable authority to settings writers, scoped permission writers,
permission providers, and headless runtimes. This is an explicit cooperative
Linux host API, not an automatically enabled CLI mode. Node 22.12 or later is
required. Windows and macOS reject provisioning/reopening; they do not silently
substitute an in-memory authority.

## Administrator provisioning

Provision once, while no runtime is using these sources. Choose an existing,
private, real directory for the domain, outside every workspace, additional
writable root, settings source, and scoped permission source. Source parent
directories must already exist. The adapter never creates missing parents or
registers a new context during a read/write.

Example administrator script (run from a host project with `chainlesschain`
installed; substitute the absolute paths for your deployment):

```js
import fs from "node:fs";
import { initializePermissionAuthorityHost } from "chainlesschain/src/runtime/permission-authority-host.js";

const launch = initializePermissionAuthorityHost({
  directory: "/srv/cc-authority/app", // Pre-created, owned by host, mode 0700.
  forbiddenRoots: ["/srv/work/app", "/srv/cc-policy"],
  contexts: [
    {
      contextId: "app",
      cwd: "/srv/work/app",
      settingsFile: null,
      userSettingsFile: "/srv/cc-policy/settings.json",
      managedSettingsFile: "/srv/cc-policy/managed.json",
      scopedFile: "/srv/cc-policy/scoped.json",
    },
  ],
});
fs.writeFileSync("/srv/cc-host/app-launch.json", JSON.stringify(launch), {
  flag: "wx",
  mode: 0o600,
});
```

`cwd` is also automatically excluded from domain placement. Explicitly include
all other writable roots in `forbiddenRoots`. Keep the launch descriptor in
host-owned storage outside those roots. It pins the domain identity, context,
discovery inputs, settings paths, and scoped path. A new process or Worker
receives the same JSON descriptor over a trusted host channel; it does not infer
the binding from its current working directory. The descriptor is not a secret
or a substitute for a trusted launch channel.

## Reopen, run, and write from a separate process

The current source adds an explicit one-shot CLI entry. It does not change the
default `agent` launch or provision an authority. Run from the exact workspace
registered in the descriptor; keep the descriptor and sandbox settings in
trusted host storage. Both JSON inputs must be absolute regular files, bounded
to 1 MiB. Windows/macOS reject this entry before reading these files.

Save Docker egress settings such as the following to
`/srv/cc-host/app-sandbox.json`, replacing both placeholder digests with actual
approved image digests:

```json
{
  "engine": "docker-egress",
  "image": "node@sha256:<approved-target-image-digest>",
  "relayImage": "node@sha256:<approved-relay-image-digest>",
  "network": { "allowedDomains": ["example.com"] }
}
```

```sh
cd /srv/work/app
cc agent controlled-host --launch /srv/cc-host/app-launch.json \
  --context app --sandbox-settings /srv/cc-host/app-sandbox.json --check

cc agent controlled-host --launch /srv/cc-host/app-launch.json \
  --context app --sandbox-settings /srv/cc-host/app-sandbox.json \
  --prompt 'Inspect this project' --provider ollama --model qwen2.5:7b \
  --base-url http://127.0.0.1:11434 --output-format json
```

`--check` reports validated authority identity and configuration only. Its
`backendAvailabilityProbed` and `backendExecutionVerified` are both `false`;
`configured` is not evidence that Docker, an image, or a network request worked.
A task probes Docker availability before credential resolution or a model
request; actual container/UDS admission still validates the execution path when
a shell tool runs. This entry accepts only the existing Linux x64/ARM64
`docker-egress` contract: pinned images and explicit domain rules, no bypass
commands or additional filesystem mounts. Shell network governance does not
establish governance of the model provider connection.

Tasks use fixed `dontAsk` permission mode, with the bound permission provider
attached and official deny/ask rules enforced. There is no bypass flag. Put all
options after `controlled-host`; parent `agent` flags are rejected. Registered
MCP/IDE discovery and prompt slash/file expansion are disabled for this narrow
entry. It supports one prompt, captured output, and 1–100 turns (default 10),
not interactive input, background launch, or session resume. For a provider
requiring credentials, `--api-key-env NAME` resolves that environment variable
or its existing credential-broker reference; never put a key in the launch JSON.

Host identity failure, missing state, failed preflight, or a runtime error closes
the opened authority and exits unsuccessfully; no automatic enrollment, repair,
or model retry is attempted by this entry. Use the API below for separately
managed streaming runtimes and authorized writers.

```js
import fs from "node:fs";
import { openPermissionAuthorityHost } from "chainlesschain/src/runtime/permission-authority-host.js";

const host = openPermissionAuthorityHost({
  launch: JSON.parse(fs.readFileSync("/srv/cc-host/app-launch.json", "utf8")),
  contextId: "app",
});
try {
  await host.runHeadless({
    prompt: "Inspect this project",
    permissionMode: "plan",
  });
} finally {
  host.close();
}
```

Use `host.runHeadlessStream(options, deps)` for the streaming runner. A trusted
embedding that already calls `executeTool` can obtain pinned context options
from `host.runtimeOptions(options)`. The branded provider in those options must
remain attached throughout execution. Reopening and each runtime admission
validate the domain; failures throw rather than using sampled defaults.

A separate authorized writer process opens the same launch and uses:

```js
host.addRule({ kind: "deny", rule: "Bash", scope: "project" });
const grant = host.addScopedRule({
  decision: "allow",
  rule: "Read",
  expiresAt: Date.now() + 60_000,
});
host.revokeScopedRule({ id: grant.id, expectedRevision: grant.revision });
```

These are synchronous official transactions. They take the authority lock
before the source lock, compare the exact revision captured during preparation,
and preserve concurrent writers' changes. Scoped add/revoke uses the same
transaction path. An official deny followed by revoke still consumes revisions,
even if the effective rules return to their previous value. Readers project
settings and scoped rules from one validated observation and recheck after
environment/expiry projection.

Do not mix unbound writers or raw file edits into a provisioned domain. Changes
that bypass the transaction protocol invalidate the domain's source manifest.
Before changing discovery roots, paths, or registration, stop affected runtimes
and perform an explicit administrator migration. This API does not automatically
repair, enroll, migrate, or expand writable roots.

## Failure and stop-receipt contract

Inspect `error.code`, `error.cause?.code`, `error.commitState`, and
`error.authorityState`; do not rely on error message text. Representative codes:

| Code                                         | Meaning/action                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CC_SETTINGS_AUTHORITY_PLATFORM_UNSUPPORTED` | No durable implementation on this platform.                                                         |
| `CC_SETTINGS_PERMISSION_BINDING_INVALID`     | Invalid/closed binding or malformed launch descriptor.                                              |
| `CC_SETTINGS_AUTHORITY_CONTEXT_UNREGISTERED` | Requested context was not provisioned.                                                              |
| `CC_SETTINGS_AUTHORITY_BINDING_CHANGED`      | Registered discovery/source binding changed.                                                        |
| `CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP`       | Domain overlaps an admitted writable root/source.                                                   |
| `CC_SETTINGS_AUTHORITY_NOT_READY`            | Pending transaction or unavailable ready authority.                                                 |
| `CC_SETTINGS_AUTHORITY_TRANSITION_FAILED`    | Inspect nested cause and commit/authority state; never blindly retry a possibly committed mutation. |

Missing/corrupt/replaced ledger, namespace, or guard files also fail closed.
Do not delete these files to restore access. Existing low-level explicit
transaction recovery requires the exact transaction identity and independently
verified before/after outcome; this host API deliberately exposes no automatic
recovery shortcut.

The provider sends synchronous in-process revocation and polls durable state at
100 ms for other processes/Workers. Scheduling can delay observation. A writer
returning successfully is **not** a promise that every receiver has stopped.

After Docker egress revocation, `authorityFailure.stopAcknowledgement` is emitted
only after the proxy abort and session close both complete successfully, all
cleanup tasks settle, and monitoring stops. It includes a unique per-monitor
`receiverId`, host `sessionId`, and the admitted `policyVersion`. The monitor's
immutable `stopIdentity` is available before revocation for host correlation.
Consumers must match that identity and the exact admitted policy version; an
old receipt cannot discharge another receiver/session. No receipt is emitted on
cleanup failure. This is a receiver-specific stop receipt, not a distributed
quorum protocol or a stop guarantee for unregistered receivers.

## Validation and remaining scope

The native Linux probe runs real production child/Worker writers, concurrent
settings writes, scoped add/revoke and ABA, CAS conflicts, local notification
followed by polling, fixed launch validation, controlled-host entry, and an
actual proxy connection plus native child heartbeat stop. The separate domain
probe covers 58 transaction/fault/recovery cases.

Docker integration contains durable settings process/Worker and scoped revoke/
Worker ABA variants, with connection counters, heartbeat, container cleanup,
and stop-receipt assertions. Those require the hosted Linux x64/ARM64 Docker
gate; a native proxy/child probe is not evidence of Docker enforcement.

This does not claim hostile same-UID rollback resistance, protection against a
compromised host, automatic default CLI registration, Windows/macOS durable
support, or full NET-02 completion. Exact-release Linux/Windows/macOS CLI CI and
strict-sandbox matrices remain required before OIDC publication.
