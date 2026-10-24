# Completed-tool settlement acknowledgement recovery

The user requested an independent Astra review of the completed-tool settlement
failure and related boundaries. The review confirmed settlement before retention,
post-settlement candidate/CAS snapshots, JSON-safe omitted provider content, and
private provenance preservation through trusted cloning.

The review found one additional mismatch: streaming accepted an absent durable
head acknowledgement while the other headless host rejected it. Streaming now
stops with `CC_SESSION_TOOL_ROUND_SETTLEMENT_HEAD_UNKNOWN` when the acknowledgement
has no nonempty string hash. The existing persistence-failure subtype and editor
handling remain in use.

Seven new controls cover false, undefined, null, missing, empty and invalid hash
acknowledgements, plus a real append whose acknowledgement is lost. The host
stops, keeps written tool evidence, does not retry settlement, does not accept
the next input, and does not write an unacknowledged final answer.

The complete stream/tool-round and receipt-retention suites passed 37 tests with
the final production guard and first six new controls. The seventh test was
added afterwards and the final seven controls passed separately in the included
native Vitest JSON. Test counts overlap and must not be summed. The six-suite
59-test run is labelled a pre-edit baseline. The SDK session suite passed 25
tests. Logs identify captured tool stdout excerpts explicitly; they are not
native Vitest JSON or complete original log streams.

`preparation.json` also binds the separately retained Workbench repair evidence.
Production source hashes match the independent review receipt. These local
Windows checks do not qualify publication: the final exact commit still requires
complete Linux, Windows and macOS Actions gates and original Formal limits.

Real stale authority, storage failure or unverifiable session data continues to
stop the host. No real online model task was run for this review; historical
acceptance and paid/native promotion limits remain unchanged.
