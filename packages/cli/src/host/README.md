# Native host composition APIs (unreleased source)

`project-goal-graph.js` is a supported ESM host entry independent of the CLI
program entry. Importing it does not preload commands or start an agent/model
loop. Matching source builds of the CLI, Session Core and desktop host are
required; the public CLI 0.166.143 release does not include this API.

The API version is `PROJECT_GOAL_GRAPH_HOST_VERSION = 1`.
`createProjectGoalGraphAuthority({database, mode, clock, readCommittedResult})`
composes the existing `SchedulerOccurrenceGraphAuthority`, `GraphKernel`,
`GraphEventStore`, native SQLite rollout adapter and cutover ledger. Supply a
dedicated, protected native database; the returned authority owns its close.
The desktop host derives its path and persistent identity from trusted app and
project storage, rather than renderer input or CLI profile environment variables.

`ProjectGoalMonitoringEngine` receives this authority through its trusted
`graphAuthorityFactory` and adds native participation/head watermarks. A
`readCommittedResult(context)` callback must synchronously return either
`{found: true, result}` containing the exact, currently authorized native receipt,
or `{found: false}`. Missing evidence never permits automatic effect replay.
Cached scheduler successes are checked against both native evidence and durable
Graph history. Reads do not acquire Graph writer authority.

The personal-project host accepts `CHAINLESSCHAIN_GRAPH_PROJECT_GOALS` values
`legacy` (default), `shadow`, or `canonical`. An existing cutover ledger controls
new occurrences; existing Graph occurrences retain their original authority
when the flag changes. Loss, replacement, corruption or rollback of a required
journal is an error and never creates an implicit legacy fallback.

Entering Graph explicitly upgrades only participating native goals to
`chainlesschain.goal/v2` with `requiresGraphAwareHost: true`. This is a reader-floor
format migration; objective revision and control generation remain unchanged.
Older validators reject the record. Current native CAS forbids removing the
reader floor, and native monitoring requires a Graph-aware host thereafter.
Unused goals keep v1. Native risk receipts, budgets, permissions, confirmation
and independent goal completion remain under their existing services.

This is local opt-in support. Real product GUI, full platform/cutover observation
and exact-source release validation must be recorded separately. The production
inventory now includes `scheduler/desktop-project-goals`: 24 total entries,
21 durable, eight migratable, 13 retired and three disabled. Production evidence
therefore requires 72 independent signed source receipts; old 23-entry evidence
does not qualify the new inventory.
