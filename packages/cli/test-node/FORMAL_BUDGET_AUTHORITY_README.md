# Durable formal budget authority

Status: **implemented storage and guarded transport; NOT_PAID_READY**. The frozen
36 tasks plus 9 soaks, model choices, default thinking and existing release source
are unchanged. This work lives on a separate development branch.

## Shipped modules

`src/lib/formal-budget-contract.js` validates activation facts and computes prices
with exact integer arithmetic. `formal-budget-authority.js` uses the CLI's already
declared direct `better-sqlite3` optional dependency. Normal Node 22.12 startup
needs no experimental flag. If native SQLite is unavailable, opening the authority
fails; there is no in-memory or sql.js fallback. No child npm package changes are
needed.

`formal-budget-transport.js` owns provider credentials in a trusted-host closure.
Its JSON and SSE path reserves before dispatch, pins the request body, forbids
redirects, never retries, bounds response parsing, and settles only complete,
validated usage. Default thinking is preserved; thinking overrides and unsupported
billed dimensions are rejected. `max_tokens` never reduces the reservation, which
always includes the full contract input, answer and reasoning bounds. Responses
are buffered until settlement. JSON rejects duplicate decoded keys and nonfinite
numbers; both JSON and SSE reject provider error envelopes. SSE requires an
explicit supported completion reason before final usage and DONE. Contract and FX
validity are rechecked after asynchronous credential loading, immediately before
dispatch. This transport is deliberately not wired into
existing interactive streaming UX yet.

## Activation and trust boundary

Initialization requires all of these, bound by a trusted-host `verifyEvidence`
callback. There is no default verifier and no environment switch that substitutes
public prices for account facts:

- A frozen plan digest, original lineage ID, 36 task caps of $2 and 9 soak caps of
  $3, and the original $99 total. The 36 tasks must retain 18 Volcengine and 18
  OpenAI contracts. Task-to-contract assignments belong to that
  verified plan; this module cannot relabel the frozen provider strata.
- Exact provider/model/HTTPS endpoint contracts, actual account evidence, effective
  dates, input/answer/reasoning bounds, input/cache/output rates, native currency,
  fixed fee ceiling, all charged dimensions, and accepted response service tiers.
- A verified `inputEnvelope` mapping the exact endpoint, model, request protocol,
  text/function schema and maximum serialized UTF-8 request bytes to an inclusive
  billed prompt-token ceiling. Evidence must cover message templates, all allowed
  roles, tools, provider framing, implicit system overhead and all billed input.
  This is a required provider/account guarantee, not a generic bytes-per-token
  estimate; absent evidence blocks activation. Requests outside that envelope,
  multimodal input, hosted tools and unsupported request options are rejected.
- A binding native-currency-to-USD ceiling, using integer numerator/denominator
  and including settlement fees. Native micro-units and USD micro-units are both
  retained. Public spot FX is not treated as an account settlement guarantee.
- Complete original-lineage history for every task, including used run slots,
  prior spend and unresolved reserved liability. Unknown liability, even with an
  unknown amount encoded as zero, initializes an immediately halted authority.
- Trusted receipts with artifact digests verified against the exact canonical
  subjects. A callback which simply returns true is not production verification.
  The fixture verifier exists only in `test-node/formal-budget-fixture.mjs`, which
  is excluded from the published package.

The API is for a trusted host service. Tasks must not receive the authority object,
SQLite files, evidence verifier, credentials, or credential-loading callback. The
environment allowlist removes provider keys, home/config locations and Node
injection settings, but is only one layer: it does not prevent direct network or
filesystem access without the existing OS sandbox.

## Storage behavior

`initialize` exclusively creates a new file. `new FormalBudgetAuthority` only
opens an existing regular file with pinned lineage, plan and activation digest.
It never recreates a missing/corrupt database. SQLite WAL, `synchronous=FULL`,
foreign keys and `BEGIN IMMEDIATE` protect transactions across processes. Use a
single authority host and local filesystem, not a network-mounted SQLite file.

Each task has stable initial/remediation run IDs and two total slots. Reopening an
active run consumes no new slot; remediation requires the initial run to close and
shares the original task balance. Imported historical slots cannot be reclaimed.

Every physical call ID is unique within one authority database. A durable `held` reservation
precedes `dispatched`, which precedes the network request. Replayed call IDs cannot
grant dispatch again. The first implementation serializes physical requests: any
held/dispatched/unknown liability blocks every later request, including another
task. Settlement is idempotent only for an identical canonical receipt. A
conflicting settlement restores the full reservation and halts the authority.

Crash before dispatch, disconnect, malformed or missing usage, unpriced model or
tier, output beyond the contractual ceiling, HTTP errors and storage failures
never release responsibility optimistically. There is no TTL release, force-clear,
reset, or generic retry path. Provider-confirmed unknown-charge reconciliation is
not yet implemented. Restart cannot clear pending or halted state.

Exclusive creation protects only one pathname. The same signed lineage/history
can still initialize two different database paths; those databases do not share
call IDs or budget state. Production requires external durable lineage
registration, fencing and monotonic state to prevent duplicate authorities and
backup rollback. A single-host operational convention is not that guarantee.
This unresolved limitation blocks paid readiness.

Provider response content, prompts, keys and hidden reasoning text are not stored.
The accounting receipt keeps only provider ID, model, tier and usage metadata.
This is a conservative allocated cost under verified ceilings, not an invoice.

## Runtime integration audit

There is no single existing fetch choke point. The current source contains paid
fetches in `runtime/agent-core.js` (Chat Completions, Responses, Anthropic and other
adapters), `lib/chat-core.js`, `lib/provider-stream.js`, `lib/llm-providers.js`
(connection probes), and `lib/hub-llm-client.js`. Advisor and provider-backed
compaction mostly call the agent runtime; retries can repeat those physical
fetches. The formal child environment in `commands/eval.js` no longer forwards
`CC_API_KEY` or provider credentials.

This change does not claim those routes are covered. `requireFormalBudgetRuntime`
always refuses full-runtime activation with `CC_BUDGET_RUNTIME_NOT_COVERED`.
The formal CLI refuses non-dry-run verification before task setup; the actual
VERIFY01 launcher also refuses a bound task before spawning its child, including
when `_argv` is injected by a test. These guards prove refusal, not coverage of
other paid egress. Ordinary CLI behavior is
unchanged; the guarded transport still requires explicit trusted-host integration.

The next integration needs an authenticated authority IPC client, dispatch IDs for
every physical fetch/retry, an authority-owned credential path, and OS-enforced
denial of direct provider egress/credential reads in task children. Route Agent,
Chat, compaction, advisor, probes, hub calls and fallbacks through it, or explicitly
disable unsupported paths before activation. Keep default model request semantics.
Validate this on the exact new source with Linux/Windows/macOS CI before any paid
formal sample. Never transfer previous release CI to these development changes.

## Validation

Run from the repository root with normal Node 22.12 or newer:

```sh
node --test packages/cli/test-node/formal-budget-authority.test.mjs
```

The suite uses synthetic `.invalid` endpoints and injected fetches; it makes no
network request. It exercises real SQLite, six competing processes, real process
kills after reservation/dispatch/settlement, persistent unknown state, shared
remediation caps, imported $99 exposure, injected SQLite write failure, identity
and receipt conflicts, native currency rounding, missing account facts, JSON/SSE
transport failures, and key-free task environments.

Remaining validation includes power-loss/filesystem faults, external backup
rollback detection and authority-host handover, native install matrix coverage,
authenticated IPC/egress control and authoritative unknown-charge reconciliation.
The database requires trusted host ownership/ACLs; a task able to modify it or
restore an old backup defeats local accounting. These limitations prevent a
paid-ready claim even after this local regression suite passes.
